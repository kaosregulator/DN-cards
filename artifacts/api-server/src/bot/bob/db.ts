// Bob data-access + economy. Owns Bob Coins, XP/levels, stats, temporary
// curses, cooldowns, and leaderboards. Completely separate from the DN Cards
// economy — the only crossover is an OPT-IN reward grant (see grantReward).

import {
  db, bobSettingsTable, bobProfilesTable,
} from "@workspace/db";
import type { BobSettings, BobProfile, BobMemory } from "@workspace/db";
import { and, eq, desc, sql } from "drizzle-orm";
import { logger } from "../../lib/logger.js";

export const COINS_EMOJI = "🪙";
const MEMORY_CAP = 8;

// ── Settings ─────────────────────────────────────────────────────────────────
const settingsCache = new Map<string, { at: number; s: BobSettings }>();
const SETTINGS_TTL = 20_000;

export async function getBobSettings(guildId: string): Promise<BobSettings> {
  const hit = settingsCache.get(guildId);
  if (hit && Date.now() - hit.at < SETTINGS_TTL) return hit.s;
  let [row] = await db.select().from(bobSettingsTable).where(eq(bobSettingsTable.guildId, guildId)).limit(1);
  if (!row) {
    await db.insert(bobSettingsTable).values({ guildId }).onConflictDoNothing();
    [row] = await db.select().from(bobSettingsTable).where(eq(bobSettingsTable.guildId, guildId)).limit(1);
  }
  settingsCache.set(guildId, { at: Date.now(), s: row! });
  return row!;
}

export async function updateBobSettings(guildId: string, patch: Partial<BobSettings>): Promise<BobSettings> {
  await getBobSettings(guildId); // ensure row exists
  const [row] = await db.update(bobSettingsTable)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(bobSettingsTable.guildId, guildId))
    .returning();
  settingsCache.delete(guildId);
  return row!;
}

export function gameEnabled(settings: BobSettings, key: string): boolean {
  return settings.gamesEnabled[key] !== false;
}

// ── Profiles ─────────────────────────────────────────────────────────────────
export async function getBobProfile(guildId: string, userId: string): Promise<BobProfile> {
  await db.insert(bobProfilesTable).values({ guildId, userId }).onConflictDoNothing();
  const [row] = await db.select().from(bobProfilesTable)
    .where(and(eq(bobProfilesTable.guildId, guildId), eq(bobProfilesTable.userId, userId))).limit(1);
  return row!;
}

// ── Cooldown (shared per-user anti-spam) ─────────────────────────────────────
export async function checkCooldown(
  guildId: string, userId: string, seconds: number,
): Promise<{ ok: boolean; retryMs: number }> {
  const p = await getBobProfile(guildId, userId);
  const now = Date.now();
  const last = p.lastActionAt ? p.lastActionAt.getTime() : 0;
  const wait = seconds * 1000 - (now - last);
  if (wait > 0) return { ok: false, retryMs: wait };
  await db.update(bobProfilesTable).set({ lastActionAt: new Date() })
    .where(and(eq(bobProfilesTable.guildId, guildId), eq(bobProfilesTable.userId, userId)));
  return { ok: true, retryMs: 0 };
}

// ── XP / levels ──────────────────────────────────────────────────────────────
const XP_PER_LEVEL = 300;
export function levelForXp(xp: number): number { return Math.floor(xp / XP_PER_LEVEL) + 1; }
export function xpIntoLevel(xp: number): { into: number; need: number } {
  return { into: xp % XP_PER_LEVEL, need: XP_PER_LEVEL };
}

// ── Reward grant ─────────────────────────────────────────────────────────────
export interface RewardSpec {
  coins?: number;
  xp?: number;
  title?: string;
  gambled?: number;         // coins put at risk (for stats)
  countGame?: boolean;      // increments gamesPlayed
  win?: boolean;            // increments wins + updates biggestWin with coins
  loss?: boolean;
  jackpot?: boolean;
  interaction?: boolean;    // increments interactions
}

export interface RewardResult {
  profile: BobProfile;
  leveledTo?: number;       // set if the player leveled up
  newTitle?: string;        // set if a new title was unlocked
}

// Apply a reward/stat bundle atomically-ish and return the fresh profile. Coins
// and XP are scaled by the guild reward multiplier. Coins never go below zero.
export async function grantReward(
  guildId: string, userId: string, settings: BobSettings, spec: RewardSpec,
): Promise<RewardResult> {
  const before = await getBobProfile(guildId, userId);
  const mult = Math.max(0, settings.rewardMultiplierPct) / 100;
  const coinsDelta = Math.round((spec.coins ?? 0) * (spec.coins && spec.coins > 0 ? mult : 1));
  const xpDelta = Math.max(0, Math.round((spec.xp ?? 0) * mult));

  const newCoins = Math.max(0, before.coins + coinsDelta);
  const newXp = before.xp + xpDelta;
  const newLevel = levelForXp(newXp);
  const leveledTo = newLevel > before.level ? newLevel : undefined;

  let titles = before.titles;
  let newTitle: string | undefined;
  if (spec.title && !titles.includes(spec.title)) {
    titles = [...titles, spec.title];
    newTitle = spec.title;
  }

  const biggestWin = spec.win && coinsDelta > before.biggestWin ? coinsDelta : before.biggestWin;

  const [row] = await db.update(bobProfilesTable).set({
    coins: newCoins,
    xp: newXp,
    level: newLevel,
    titles,
    currentTitle: before.currentTitle ?? newTitle ?? before.currentTitle,
    biggestWin,
    gamesPlayed: before.gamesPlayed + (spec.countGame ? 1 : 0),
    wins: before.wins + (spec.win ? 1 : 0),
    losses: before.losses + (spec.loss ? 1 : 0),
    jackpots: before.jackpots + (spec.jackpot ? 1 : 0),
    interactions: before.interactions + (spec.interaction ? 1 : 0),
    coinsGambled: before.coinsGambled + Math.max(0, spec.gambled ?? 0),
    updatedAt: new Date(),
  }).where(and(eq(bobProfilesTable.guildId, guildId), eq(bobProfilesTable.userId, userId))).returning();

  return { profile: row!, leveledTo, newTitle };
}

// ── Roulette streak helpers ──────────────────────────────────────────────────
export async function bumpRouletteStreak(guildId: string, userId: string, survived: boolean): Promise<{ streak: number; best: number; brokeRecord: boolean }> {
  const p = await getBobProfile(guildId, userId);
  const streak = survived ? p.rouletteStreak + 1 : 0;
  const best = Math.max(p.bestRouletteStreak, streak);
  const brokeRecord = best > p.bestRouletteStreak;
  await db.update(bobProfilesTable).set({ rouletteStreak: streak, bestRouletteStreak: best })
    .where(and(eq(bobProfilesTable.guildId, guildId), eq(bobProfilesTable.userId, userId)));
  return { streak, best, brokeRecord };
}

export async function incRoasts(guildId: string, userId: string): Promise<void> {
  await db.update(bobProfilesTable)
    .set({ roastsGiven: sql`${bobProfilesTable.roastsGiven} + 1`, interactions: sql`${bobProfilesTable.interactions} + 1` })
    .where(and(eq(bobProfilesTable.guildId, guildId), eq(bobProfilesTable.userId, userId)));
}

// ── Temporary "curse" (cosmetic, harmless, expires) ──────────────────────────
export async function applyCurse(guildId: string, userId: string, label: string, minutes: number): Promise<void> {
  await db.update(bobProfilesTable)
    .set({ curseLabel: label, curseUntil: new Date(Date.now() + minutes * 60_000) })
    .where(and(eq(bobProfilesTable.guildId, guildId), eq(bobProfilesTable.userId, userId)));
}

export function activeCurse(p: BobProfile): string | null {
  if (p.curseLabel && p.curseUntil && p.curseUntil.getTime() > Date.now()) return p.curseLabel;
  return null;
}

// ── Talk memory ──────────────────────────────────────────────────────────────
export async function pushMemory(guildId: string, userId: string, entries: BobMemory[]): Promise<BobMemory[]> {
  const p = await getBobProfile(guildId, userId);
  const memory = [...p.memory, ...entries].slice(-MEMORY_CAP);
  await db.update(bobProfilesTable).set({ memory, interactions: sql`${bobProfilesTable.interactions} + 1` })
    .where(and(eq(bobProfilesTable.guildId, guildId), eq(bobProfilesTable.userId, userId)));
  return memory;
}

export async function clearMemory(guildId: string, userId: string): Promise<void> {
  await db.update(bobProfilesTable).set({ memory: [] })
    .where(and(eq(bobProfilesTable.guildId, guildId), eq(bobProfilesTable.userId, userId)));
}

// ── Leaderboards ─────────────────────────────────────────────────────────────
export type BobBoard = "coins" | "wins" | "streak" | "interactions" | "gambled" | "jackpots" | "level";

const BOARD_COLUMN = {
  coins: bobProfilesTable.coins,
  wins: bobProfilesTable.wins,
  streak: bobProfilesTable.bestRouletteStreak,
  interactions: bobProfilesTable.interactions,
  gambled: bobProfilesTable.coinsGambled,
  jackpots: bobProfilesTable.jackpots,
  level: bobProfilesTable.level,
} as const;

export async function getBobLeaderboard(guildId: string, board: BobBoard, limit = 10): Promise<BobProfile[]> {
  return db.select().from(bobProfilesTable)
    .where(eq(bobProfilesTable.guildId, guildId))
    .orderBy(desc(BOARD_COLUMN[board]))
    .limit(limit);
}

// Luck % = wins / gamesPlayed. Only meaningful past a few games.
export function luckPct(p: BobProfile): number {
  if (p.gamesPlayed < 3) return 0;
  return Math.round((p.wins / p.gamesPlayed) * 100);
}

// ── OPT-IN DN Cards reward bridge ────────────────────────────────────────────
// Only fires when an admin enabled dexIntegration. Rare Bob events can then pay
// real DN Shards or a pack. Best-effort; never blocks Bob's own reward.
export async function grantDexReward(
  guildId: string, userId: string, settings: BobSettings,
  reward: { shards?: number; packTier?: string },
): Promise<string[]> {
  if (!settings.dexIntegration) return [];
  const notes: string[] = [];
  try {
    if (reward.shards && reward.shards > 0) {
      const { addShards } = await import("../db.js");
      await addShards(guildId, userId, reward.shards);
      notes.push(`💠 ${reward.shards.toLocaleString()} DN Shards`);
    }
    if (reward.packTier) {
      const { grantFreePack } = await import("../battle/pack-grant.js");
      await grantFreePack(guildId, userId, reward.packTier);
      notes.push(`📦 ${reward.packTier} pack`);
    }
  } catch (err) {
    logger.warn({ err, guildId, userId }, "bob grantDexReward failed (non-fatal)");
  }
  return notes;
}
