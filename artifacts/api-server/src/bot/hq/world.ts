// ─────────────────────────────────────────────────────────────────────────────
// HQ — world territories (the AI-first world map).
//
// Owns `hq_world_nodes`: which of the blueprint's AI castles are still in
// faction hands, which a member has taken, and the shield/tribute clocks that
// go with holding one. The blueprint (positions, tiers, garrison sizes) stays in
// defs/world.ts — this module never invents geography, it only tracks WHO holds
// WHAT, so adding a territory is a data edit and existing guilds pick it up on
// their next map view.
//
// It also builds the AI GARRISON a raider fights. There is no AI player and no
// AI collection, so a garrison is synthesised from the guild's own card pool:
// deterministic per territory (the same castle always fields the same defenders)
// and scaled by tier through the normal level/star-rank knobs, which means the
// real battle engine can fight it with no special cases.
// ─────────────────────────────────────────────────────────────────────────────

import {
  db, hqWorldNodesTable, type HqWorldNode,
} from "@workspace/db";
import { and, eq, sql } from "drizzle-orm";
import type { OwnedBattleCard } from "../battle/db.js";
import type { RarityContext } from "../rarity-runtime.js";
import { rarityLadderRank } from "../rarity-runtime.js";
import type { Rarity } from "../cards-data.js";
import { seededRng, hashString } from "./paint.js";
import {
  HQ_TERRITORIES, resolveFaction, tierProfile,
  type HqTerritory, type HqFaction,
} from "./defs/world.js";

// A territory's shield after it changes hands, and the raider's per-target
// cooldown — mirrors the player-base knobs so conquest feels consistent.
export const WORLD_SHIELD_MS = 30 * 60 * 1000;   // 30m breather after a capture
export const WORLD_COOLDOWN_MS = 10 * 60 * 1000; // per-target attacker cooldown
export const WORLD_MAX_PER_WINDOW = 3;
// Uncollected hold-tribute is capped so a territory left unvisited for weeks
// doesn't dump a jackpot.
export const WORLD_TRIBUTE_CAP_HOURS = 48;

// ── Rows ──────────────────────────────────────────────────────────────────────

/**
 * Create any missing rows for this guild's blueprint. Idempotent, cheap, and
 * safe to call on every map view — new territories added to defs/world.ts
 * appear in existing servers without a migration.
 */
export async function ensureWorld(guildId: string): Promise<void> {
  if (HQ_TERRITORIES.length === 0) return;
  await db.insert(hqWorldNodesTable)
    .values(HQ_TERRITORIES.map(t => ({ guildId, nodeId: t.id })))
    .onConflictDoNothing({ target: [hqWorldNodesTable.guildId, hqWorldNodesTable.nodeId] });
}

export async function getWorldNodes(guildId: string): Promise<Map<string, HqWorldNode>> {
  const rows = await db.select().from(hqWorldNodesTable)
    .where(eq(hqWorldNodesTable.guildId, guildId));
  return new Map(rows.map(r => [r.nodeId, r]));
}

export async function getWorldNode(guildId: string, nodeId: string): Promise<HqWorldNode | null> {
  const [row] = await db.select().from(hqWorldNodesTable)
    .where(and(eq(hqWorldNodesTable.guildId, guildId), eq(hqWorldNodesTable.nodeId, nodeId)))
    .limit(1);
  return row ?? null;
}

// A territory in the shape the map, the pickers and the siege flow all read:
// static blueprint + faction + live holder state, resolved once.
export interface WorldTerritoryView {
  territory: HqTerritory;
  faction: HqFaction;
  heldByUserId: string | null;
  heldByName: string | null;
  heldSince: Date | null;
  shieldUntil: Date | null;
  captures: number;
}

export async function listTerritories(guildId: string): Promise<WorldTerritoryView[]> {
  await ensureWorld(guildId).catch(() => {});
  const rows = await getWorldNodes(guildId).catch(() => new Map<string, HqWorldNode>());
  return HQ_TERRITORIES.map(t => {
    const row = rows.get(t.id);
    return {
      territory: t,
      faction: resolveFaction(t.factionId),
      heldByUserId: row?.heldByUserId ?? null,
      heldByName: row?.heldByName ?? null,
      heldSince: row?.heldSince ?? null,
      shieldUntil: row?.shieldUntil ?? null,
      captures: row?.captures ?? 0,
    };
  });
}

/** Territories a player currently holds, with the clock tribute accrues from. */
export async function getHeldTerritories(
  guildId: string, holderId: string,
): Promise<{ nodeId: string; since: Date }[]> {
  const rows = await db.select({
      nodeId: hqWorldNodesTable.nodeId,
      lastTributeAt: hqWorldNodesTable.lastTributeAt,
      heldSince: hqWorldNodesTable.heldSince,
      updatedAt: hqWorldNodesTable.updatedAt,
    })
    .from(hqWorldNodesTable)
    .where(and(eq(hqWorldNodesTable.guildId, guildId), eq(hqWorldNodesTable.heldByUserId, holderId)));
  return rows.map(r => ({ nodeId: r.nodeId, since: r.lastTributeAt ?? r.heldSince ?? r.updatedAt }));
}

/**
 * Hand a territory to its conqueror. `previousHolder` is returned so the caller
 * can notify whoever just lost it — taking a castle off another member is half
 * the point of the map.
 */
export async function captureTerritory(
  guildId: string, nodeId: string, userId: string, userName: string, shieldMs = WORLD_SHIELD_MS,
): Promise<{ previousHolder: string | null }> {
  const now = new Date();
  const prev = await getWorldNode(guildId, nodeId);
  await db.insert(hqWorldNodesTable)
    .values({
      guildId, nodeId, heldByUserId: userId, heldByName: userName,
      heldSince: now, lastTributeAt: now, lastAttackedAt: now,
      shieldUntil: new Date(now.getTime() + shieldMs), captures: 1,
    })
    .onConflictDoUpdate({
      target: [hqWorldNodesTable.guildId, hqWorldNodesTable.nodeId],
      set: {
        heldByUserId: userId, heldByName: userName,
        heldSince: now, lastTributeAt: now, lastAttackedAt: now,
        shieldUntil: new Date(now.getTime() + shieldMs),
        captures: sql`${hqWorldNodesTable.captures} + 1`,
        updatedAt: now,
      },
    });
  return { previousHolder: prev?.heldByUserId ?? null };
}

/** Record a failed assault (drives the per-target cooldown read). */
export async function markTerritoryAttacked(guildId: string, nodeId: string): Promise<void> {
  const now = new Date();
  await db.insert(hqWorldNodesTable)
    .values({ guildId, nodeId, lastAttackedAt: now })
    .onConflictDoUpdate({
      target: [hqWorldNodesTable.guildId, hqWorldNodesTable.nodeId],
      set: { lastAttackedAt: now, updatedAt: now },
    });
}

/** Restart tribute accrual after a holder collects. */
export async function markTerritoryTributesCollected(
  guildId: string, holderId: string, nodeIds: string[], at: Date,
): Promise<void> {
  if (nodeIds.length === 0) return;
  await db.update(hqWorldNodesTable)
    .set({ lastTributeAt: at, updatedAt: new Date() })
    .where(and(
      eq(hqWorldNodesTable.guildId, guildId),
      eq(hqWorldNodesTable.heldByUserId, holderId),
      sql`${hqWorldNodesTable.nodeId} = ANY(${nodeIds})`,
    ));
}

/** Admin/reset: hand a territory back to its founding AI faction. */
export async function releaseTerritory(guildId: string, nodeId: string): Promise<void> {
  await db.insert(hqWorldNodesTable)
    .values({ guildId, nodeId })
    .onConflictDoUpdate({
      target: [hqWorldNodesTable.guildId, hqWorldNodesTable.nodeId],
      set: {
        heldByUserId: null, heldByName: null, heldSince: null,
        lastTributeAt: null, shieldUntil: null, updatedAt: new Date(),
      },
    });
}

/** Tribute owed for one held territory, tier-scaled and cap-bounded. */
export function territoryTributeOwed(tier: number, since: Date, now: Date = new Date()): number {
  const hours = Math.max(0, (now.getTime() - since.getTime()) / 3_600_000);
  return Math.floor(Math.min(hours, WORLD_TRIBUTE_CAP_HOURS) * tierProfile(tier).tributePerHour);
}

// ── AI garrison ───────────────────────────────────────────────────────────────

// The card shape the garrison builder needs from the guild's pool. Deliberately
// the loose subset `getAllCardsCached` already returns.
export interface GarrisonSourceCard {
  id: number;
  name: string;
  rarity: string;
  cardType: string;
  worthValue: number;
  imageUrl: string | null;
}

/**
 * Build the AI defenders for a territory as real `OwnedBattleCard`s, so the
 * ordinary battle engine fights them with no AI-specific branch.
 *
 * Selection is seeded by the territory id: the same castle always fields the
 * same faces, which makes scouting meaningful and repeat attempts fair. Cards
 * are drawn from the guild's own pool at or above the tier's rarity floor
 * (falling back to the whole pool on a small/young server), then scaled by the
 * tier's level and star rank.
 */
export function buildGarrison(
  territory: HqTerritory, pool: GarrisonSourceCard[], ctx: RarityContext,
): OwnedBattleCard[] {
  if (pool.length === 0) return [];
  const prof = tierProfile(territory.tier);
  const ranked = pool
    .map(c => ({ c, rank: rarityLadderRank(String(c.rarity), ctx) }))
    .sort((a, b) => b.rank - a.rank || b.c.worthValue - a.c.worthValue || a.c.id - b.c.id);

  // Prefer cards at/above the tier's rarity floor; fall back to the strongest
  // available so a brand-new server still gets a fightable garrison.
  let eligible = ranked.filter(r => r.rank >= prof.minRarityRank);
  if (eligible.length < territory.garrison) {
    eligible = ranked.slice(0, Math.max(territory.garrison, Math.ceil(ranked.length * 0.5)));
  }
  if (eligible.length === 0) eligible = ranked;

  const rnd = seededRng(hashString(`garrison:${territory.id}`));
  const picked: GarrisonSourceCard[] = [];
  const used = new Set<number>();
  let guard = 0;
  while (picked.length < territory.garrison && guard++ < 400) {
    const pick = eligible[Math.floor(rnd() * eligible.length)]!;
    if (used.has(pick.c.id) && used.size < eligible.length) continue;
    used.add(pick.c.id);
    picked.push(pick.c);
  }

  return picked.map((c, i) => ({
    id: c.id,
    name: c.name,
    rarity: c.rarity as Rarity,
    cardType: c.cardType,
    worthValue: c.worthValue,
    imageUrl: c.imageUrl,
    owned: 1,
    // The front rank is slightly softer than the captain at the back, so a
    // garrison has a shape to break rather than a wall of identical stats.
    level: Math.max(1, Math.round(prof.cardLevel * (0.82 + 0.18 * (i / Math.max(1, picked.length - 1))))),
    starRank: prof.starRank,
    config: null,
  }));
}

/** Human label for who flies the flag over a territory right now. */
export function holderLabel(view: WorldTerritoryView): string {
  return view.heldByUserId ? (view.heldByName ?? "a rival") : view.faction.name;
}
