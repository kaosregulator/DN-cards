// Giveaway engine — requirement progress tracking + winner selection.
//
// Progress is fed by lightweight, fire-and-forget event hooks (see hooks.ts)
// scattered through the SAME catch/pack/burn/battle/raid/echo/message flows the
// quests engine already taps. Nothing here can break a catch or a battle: every
// entry point swallows its own errors.

import type {
  Giveaway, GiveawayRequirement, GiveawayEntry, GiveawayReqType,
} from "@workspace/db";
import {
  getActiveGiveaways, ensureEntry, saveEntry, listEntries,
} from "./db.js";
import { logger } from "../../lib/logger.js";
import type { Rarity } from "../cards-data.js";

const RARITY_RANK: Record<string, number> = {
  common: 1, uncommon: 2, rare: 3, epic: 4, legendary: 5, mythic: 6,
};

// ── Active-giveaway cache ────────────────────────────────────────────────────
// Requirement events fire on hot paths (every catch, every message). Avoid a DB
// round-trip per event by caching each guild's active giveaways briefly. The
// cache only decides WHICH giveaways to touch — progress writes are always live.
const ACTIVE_TTL_MS = 30_000;
const activeCache = new Map<string, { at: number; giveaways: Giveaway[] }>();

export function invalidateActiveCache(guildId?: string): void {
  if (guildId) activeCache.delete(guildId);
  else activeCache.clear();
}

async function activeGiveawaysCached(guildId: string): Promise<Giveaway[]> {
  const hit = activeCache.get(guildId);
  if (hit && Date.now() - hit.at < ACTIVE_TTL_MS) return hit.giveaways;
  const giveaways = await getActiveGiveaways(guildId);
  activeCache.set(guildId, { at: Date.now(), giveaways });
  return giveaways;
}

// ── Requirement matching ─────────────────────────────────────────────────────
export interface EventOpts { rarity?: Rarity }

function reqMatches(req: GiveawayRequirement, type: GiveawayReqType, rarity?: string): boolean {
  if (req.type !== type) return false;
  if ((type === "catch" || type === "burn") && req.rarityMin) {
    if (!rarity) return false;
    return (RARITY_RANK[rarity] ?? 0) >= (RARITY_RANK[req.rarityMin] ?? 99);
  }
  return true;
}

// Recompute cached entries + completion from raw progress. Entry-based draws add
// entriesPerUnit per counted unit (capped at the goal) plus a flat
// entriesOnComplete bonus once the goal is reached. Completion is "every
// requirement's goal met".
export function computeEntries(
  requirements: GiveawayRequirement[], progress: Record<string, number>,
): { entries: number; completed: boolean } {
  let entries = 0;
  let completed = requirements.length > 0;
  for (const req of requirements) {
    const p = Math.min(progress[req.key] ?? 0, req.goal);
    if (p < req.goal) completed = false;
    if (req.entriesPerUnit) entries += p * req.entriesPerUnit;
    if (req.entriesOnComplete && p >= req.goal) entries += req.entriesOnComplete;
  }
  return { entries, completed };
}

// Progress percentage across all requirements (0–100), for display.
export function overallProgressPct(requirements: GiveawayRequirement[], progress: Record<string, number>): number {
  if (requirements.length === 0) return 100;
  const ratios = requirements.map(r => Math.min(1, (progress[r.key] ?? 0) / Math.max(1, r.goal)));
  return Math.round((ratios.reduce((a, b) => a + b, 0) / requirements.length) * 100);
}

// ── Event tracking ───────────────────────────────────────────────────────────
// Apply an activity event to every active giveaway in the guild whose
// requirements match. Best-effort and self-contained.
export async function recordGiveawayEvent(
  guildId: string, userId: string, type: GiveawayReqType,
  amount = 1, opts: EventOpts = {},
): Promise<void> {
  if (amount <= 0) return;
  try {
    const giveaways = await activeGiveawaysCached(guildId);
    if (giveaways.length === 0) return;
    for (const g of giveaways) {
      if (!g.requirements.some(r => reqMatches(r, type, opts.rarity))) continue;
      await applyToGiveaway(g, userId, type, amount, opts).catch(err =>
        logger.debug({ err, giveawayId: g.id }, "giveaway apply failed (non-fatal)"));
    }
  } catch (err) {
    logger.warn({ err, guildId, userId, type }, "recordGiveawayEvent failed (non-fatal)");
  }
}

async function applyToGiveaway(
  g: Giveaway, userId: string, type: GiveawayReqType, amount: number, opts: EventOpts,
): Promise<void> {
  const entry = await ensureEntry(g.id, g.guildId, userId);
  const progress = { ...entry.progress };
  let changed = false;
  for (const req of g.requirements) {
    if (!reqMatches(req, type, opts.rarity)) continue;
    const current = progress[req.key] ?? 0;
    if (current >= req.goal) continue;              // already maxed for this req
    progress[req.key] = Math.min(req.goal, current + amount);
    changed = true;
  }
  if (!changed) return;
  const { entries, completed } = computeEntries(g.requirements, progress);
  await saveEntry(entry.id, { progress, entries, completed });
}

// Read a single user's live standing in a giveaway (for /giveaway progress).
export async function userStanding(
  g: Giveaway, userId: string,
): Promise<{ progress: Record<string, number>; entries: number; completed: boolean }> {
  const { getEntry } = await import("./db.js");
  const entry = await getEntry(g.id, userId);
  const progress = entry?.progress ?? {};
  const { entries, completed } = computeEntries(g.requirements, progress);
  return { progress, entries, completed };
}

// ── Winner selection ─────────────────────────────────────────────────────────
// entry     → weighted random draw by earned entries (activity = chances).
// completion→ uniform random among players who completed every requirement.
// In both modes an entrant needs at least SOME qualifying activity to be drawn.
export async function selectWinners(
  g: Giveaway, count: number, excludeIds: Set<string> = new Set(),
): Promise<string[]> {
  const rows = (await listEntries(g.id)).filter(e => !excludeIds.has(e.userId));
  const pool = eligiblePool(g, rows);
  if (pool.length === 0) return [];

  const winners: string[] = [];
  const bag = [...pool];
  for (let i = 0; i < count && bag.length > 0; i++) {
    const idx = g.winnerMode === "completion"
      ? Math.floor(Math.random() * bag.length)
      : weightedIndex(bag);
    winners.push(bag[idx]!.userId);
    bag.splice(idx, 1);
  }
  return winners;
}

function eligiblePool(g: Giveaway, rows: GiveawayEntry[]): GiveawayEntry[] {
  if (g.winnerMode === "completion") return rows.filter(r => r.completed);
  // entry mode: anyone with at least one earned entry. If no requirement grants
  // entries at all (pure raffle), everyone who has an entry row qualifies.
  const anyEntries = rows.some(r => r.entries > 0);
  return anyEntries ? rows.filter(r => r.entries > 0) : rows;
}

function weightedIndex(rows: GiveawayEntry[]): number {
  const total = rows.reduce((s, r) => s + Math.max(1, r.entries), 0);
  let roll = Math.random() * total;
  for (let i = 0; i < rows.length; i++) {
    roll -= Math.max(1, rows[i]!.entries);
    if (roll <= 0) return i;
  }
  return rows.length - 1;
}
