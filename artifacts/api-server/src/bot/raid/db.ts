// Raid data-access layer — admin-owned boss definitions. Live raid sessions are
// in-memory (see manager.ts); only the boss templates are persisted.
//
// Campaign progression needs no table of its own: a per-player boss clear is
// recorded as a dynamic achievement row keyed `raid_boss:<bossId>` (the same
// composite-key pattern the set-completion achievements use). That row IS the
// "🏆 Boss Defeated!" achievement AND the source of truth for campaign progress.

import { db, raidBossesTable, raidFrameUnlocksTable, achievementsTable } from "@workspace/db";
import type { RaidBoss } from "@workspace/db";
import { and, eq, asc } from "drizzle-orm";
import { fuzzyBest } from "../search/fuse-service.js";
import { getUnlockedKeys } from "../achievements.js";

// Bosses are ordered by their progression `sequence` first (0 = first boss,
// highest = the finale), then name as a stable tiebreaker.
export async function getEnabledBosses(guildId: string): Promise<RaidBoss[]> {
  return db.select().from(raidBossesTable)
    .where(and(eq(raidBossesTable.guildId, guildId), eq(raidBossesTable.enabled, true)))
    .orderBy(asc(raidBossesTable.sequence), asc(raidBossesTable.name));
}

export async function getAllBosses(guildId: string): Promise<RaidBoss[]> {
  return db.select().from(raidBossesTable)
    .where(eq(raidBossesTable.guildId, guildId))
    .orderBy(asc(raidBossesTable.sequence), asc(raidBossesTable.name));
}

// The next boss in the ladder after `boss` (by sequence). Null if `boss` is the
// finale. Only considers enabled bosses.
export async function getNextBoss(guildId: string, boss: RaidBoss): Promise<RaidBoss | null> {
  const ladder = await getEnabledBosses(guildId);
  const idx = ladder.findIndex(b => b.id === boss.id);
  if (idx < 0) return null;
  return ladder[idx + 1] ?? null;
}

// ── Account-wide raid frame unlocks ──────────────────────────────────────────
export async function getRaidFrameUnlocks(guildId: string, userId: string): Promise<Set<string>> {
  const rows = await db.select({ frameId: raidFrameUnlocksTable.frameId })
    .from(raidFrameUnlocksTable)
    .where(and(eq(raidFrameUnlocksTable.guildId, guildId), eq(raidFrameUnlocksTable.userId, userId)));
  return new Set(rows.map(r => r.frameId));
}

// Grant a raid frame to a user (idempotent — re-granting is a no-op). Returns
// true if it was newly unlocked, false if they already had it.
export async function grantRaidFrame(
  guildId: string, userId: string, frameId: string, bossId: number | null,
): Promise<boolean> {
  const rows = await db.insert(raidFrameUnlocksTable)
    .values({ guildId, userId, frameId, bossId })
    .onConflictDoNothing()
    .returning();
  return rows.length > 0;
}

// ── Campaign progression (per-player, backed by the achievements table) ──────

// The achievement key that records a player's first clear of a given boss.
export function bossClearKey(bossId: number): string { return `raid_boss:${bossId}`; }

export interface CampaignProgress {
  ordered: RaidBoss[];          // enabled bosses in ladder order (by sequence)
  defeatedIds: Set<number>;     // boss ids this player has cleared
  defeated: number;
  total: number;
  next: RaidBoss | null;        // first enabled boss not yet cleared (null = done)
  isFinaleNext: boolean;        // the only boss left is the highest-sequence one
  isComplete: boolean;          // every enabled boss cleared
}

// Compute a player's campaign progress from enabled bosses + their unlocked
// `raid_boss:<id>` achievement keys. No new storage — purely derived.
export async function getCampaignProgress(guildId: string, userId: string): Promise<CampaignProgress> {
  const [ordered, unlocked] = await Promise.all([
    getEnabledBosses(guildId),
    getUnlockedKeys(guildId, userId),
  ]);
  const defeatedIds = new Set<number>();
  for (const b of ordered) if (unlocked.has(bossClearKey(b.id))) defeatedIds.add(b.id);
  const next = ordered.find(b => !defeatedIds.has(b.id)) ?? null;
  const total = ordered.length;
  const defeated = defeatedIds.size;
  const isComplete = total > 0 && defeated >= total;
  const isFinaleNext = !!next && total > 0 && next.id === ordered[total - 1]!.id && defeated === total - 1;
  return { ordered, defeatedIds, defeated, total, next, isFinaleNext, isComplete };
}

// Record a player's clear of a boss (idempotent). Returns true only on the FIRST
// clear, so callers can pay a one-time first-clear bonus without double-paying
// on replays. Mirrors the dynamic set-completion achievement insert.
export async function markBossCleared(guildId: string, userId: string, bossId: number): Promise<boolean> {
  const rows = await db.insert(achievementsTable)
    .values({ guildId, userId, achievementKey: bossClearKey(bossId) })
    .onConflictDoNothing()
    .returning({ id: achievementsTable.id });
  return rows.length > 0;
}

export async function getBossByName(guildId: string, name: string): Promise<RaidBoss | null> {
  const bosses = await getAllBosses(guildId);
  const q = name.toLowerCase().trim();
  return bosses.find(b => b.name.toLowerCase() === q)
    ?? bosses.find(b => b.name.toLowerCase().includes(q))
    // Fuzzy fallback (typos / partial / acronym) via the shared search service.
    ?? fuzzyBest(bosses, name, b => b.name)
    ?? null;
}

export async function getBossById(id: number): Promise<RaidBoss | null> {
  const [row] = await db.select().from(raidBossesTable).where(eq(raidBossesTable.id, id)).limit(1);
  return row ?? null;
}

export async function createBoss(args: {
  guildId: string; name: string; createdBy: string;
} & Partial<RaidBoss>): Promise<RaidBoss> {
  const { guildId, name, createdBy, ...rest } = args;
  const [row] = await db.insert(raidBossesTable)
    .values({ guildId, name, createdBy, ...rest })
    .returning();
  return row!;
}

export async function updateBoss(id: number, patch: Partial<RaidBoss>): Promise<RaidBoss | null> {
  const [row] = await db.update(raidBossesTable)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(raidBossesTable.id, id))
    .returning();
  return row ?? null;
}

export async function deleteBoss(id: number): Promise<void> {
  await db.delete(raidBossesTable).where(eq(raidBossesTable.id, id));
}
