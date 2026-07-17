// Raid data-access layer — admin-owned boss definitions. Live raid sessions are
// in-memory (see manager.ts); only the boss templates are persisted.

import { db, raidBossesTable, raidFrameUnlocksTable } from "@workspace/db";
import type { RaidBoss } from "@workspace/db";
import { and, eq, asc } from "drizzle-orm";

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

export async function getBossByName(guildId: string, name: string): Promise<RaidBoss | null> {
  const bosses = await getAllBosses(guildId);
  const q = name.toLowerCase().trim();
  return bosses.find(b => b.name.toLowerCase() === q)
    ?? bosses.find(b => b.name.toLowerCase().includes(q))
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
