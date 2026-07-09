// Raid data-access layer — admin-owned boss definitions. Live raid sessions are
// in-memory (see manager.ts); only the boss templates are persisted.

import { db, raidBossesTable } from "@workspace/db";
import type { RaidBoss } from "@workspace/db";
import { and, eq, asc } from "drizzle-orm";

export async function getEnabledBosses(guildId: string): Promise<RaidBoss[]> {
  return db.select().from(raidBossesTable)
    .where(and(eq(raidBossesTable.guildId, guildId), eq(raidBossesTable.enabled, true)))
    .orderBy(asc(raidBossesTable.name));
}

export async function getAllBosses(guildId: string): Promise<RaidBoss[]> {
  return db.select().from(raidBossesTable)
    .where(eq(raidBossesTable.guildId, guildId))
    .orderBy(asc(raidBossesTable.name));
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
