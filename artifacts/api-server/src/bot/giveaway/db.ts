// Giveaway data-access layer. Thin CRUD over the three giveaway tables. All
// queries are per-guild. Live giveaway messages are edited in place (see
// manager.ts) — this layer only persists giveaways, entries, and winners.

import {
  db, giveawaysTable, giveawayEntriesTable, giveawayWinnersTable,
} from "@workspace/db";
import type {
  Giveaway, GiveawayEntry, GiveawayWinner, GiveawayStatus, GiveawayClaimStatus,
} from "@workspace/db";
import { and, eq, desc, inArray, lte, isNotNull } from "drizzle-orm";

// ── Giveaways ────────────────────────────────────────────────────────────────
export async function createGiveaway(values: Partial<Giveaway> & {
  guildId: string; title: string; createdBy: string;
}): Promise<Giveaway> {
  const [row] = await db.insert(giveawaysTable).values(values).returning();
  return row!;
}

export async function updateGiveaway(id: number, patch: Partial<Giveaway>): Promise<Giveaway | null> {
  const [row] = await db.update(giveawaysTable)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(giveawaysTable.id, id))
    .returning();
  return row ?? null;
}

export async function getGiveaway(id: number): Promise<Giveaway | null> {
  const [row] = await db.select().from(giveawaysTable).where(eq(giveawaysTable.id, id)).limit(1);
  return row ?? null;
}

export async function listGiveaways(guildId: string, status?: GiveawayStatus): Promise<Giveaway[]> {
  const where = status
    ? and(eq(giveawaysTable.guildId, guildId), eq(giveawaysTable.status, status))
    : eq(giveawaysTable.guildId, guildId);
  return db.select().from(giveawaysTable).where(where).orderBy(desc(giveawaysTable.createdAt));
}

export async function getActiveGiveaways(guildId: string): Promise<Giveaway[]> {
  return db.select().from(giveawaysTable)
    .where(and(eq(giveawaysTable.guildId, guildId), eq(giveawaysTable.status, "active")))
    .orderBy(desc(giveawaysTable.createdAt));
}

// Giveaways that are active and past their end time — the sweeper closes these.
export async function getDueGiveaways(now = new Date()): Promise<Giveaway[]> {
  return db.select().from(giveawaysTable)
    .where(and(
      eq(giveawaysTable.status, "active"),
      isNotNull(giveawaysTable.endsAt),
      lte(giveawaysTable.endsAt, now),
    ));
}

export async function deleteGiveaway(id: number): Promise<void> {
  await db.delete(giveawaysTable).where(eq(giveawaysTable.id, id));
}

// ── Entries ──────────────────────────────────────────────────────────────────
export async function getEntry(giveawayId: number, userId: string): Promise<GiveawayEntry | null> {
  const [row] = await db.select().from(giveawayEntriesTable)
    .where(and(eq(giveawayEntriesTable.giveawayId, giveawayId), eq(giveawayEntriesTable.userId, userId)))
    .limit(1);
  return row ?? null;
}

// Ensure an entry row exists (race-safe). Returns the current row.
export async function ensureEntry(giveawayId: number, guildId: string, userId: string): Promise<GiveawayEntry> {
  await db.insert(giveawayEntriesTable)
    .values({ giveawayId, guildId, userId, progress: {}, entries: 0, completed: false })
    .onConflictDoNothing();
  const row = await getEntry(giveawayId, userId);
  return row!;
}

export async function saveEntry(
  id: number, patch: Pick<GiveawayEntry, "progress" | "entries" | "completed">,
): Promise<void> {
  await db.update(giveawayEntriesTable)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(giveawayEntriesTable.id, id));
}

export async function listEntries(giveawayId: number): Promise<GiveawayEntry[]> {
  return db.select().from(giveawayEntriesTable)
    .where(eq(giveawayEntriesTable.giveawayId, giveawayId));
}

export async function countEntrants(giveawayId: number): Promise<{ entrants: number; totalEntries: number }> {
  const rows = await listEntries(giveawayId);
  return {
    entrants: rows.length,
    totalEntries: rows.reduce((s, r) => s + r.entries, 0),
  };
}

// ── Winners ──────────────────────────────────────────────────────────────────
export async function addWinners(rows: Array<Partial<GiveawayWinner> & {
  giveawayId: number; guildId: string; userId: string;
}>): Promise<GiveawayWinner[]> {
  if (rows.length === 0) return [];
  return db.insert(giveawayWinnersTable).values(rows).returning();
}

export async function getWinner(id: number): Promise<GiveawayWinner | null> {
  const [row] = await db.select().from(giveawayWinnersTable).where(eq(giveawayWinnersTable.id, id)).limit(1);
  return row ?? null;
}

export async function listWinners(giveawayId: number): Promise<GiveawayWinner[]> {
  return db.select().from(giveawayWinnersTable)
    .where(eq(giveawayWinnersTable.giveawayId, giveawayId))
    .orderBy(desc(giveawayWinnersTable.wonAt));
}

export async function updateWinner(id: number, patch: Partial<GiveawayWinner>): Promise<GiveawayWinner | null> {
  const [row] = await db.update(giveawayWinnersTable).set(patch).where(eq(giveawayWinnersTable.id, id)).returning();
  return row ?? null;
}

// Winners whose claim window has elapsed without a claim — the sweeper rerolls
// these automatically.
export async function getExpiredWinners(now = new Date()): Promise<GiveawayWinner[]> {
  return db.select().from(giveawayWinnersTable)
    .where(and(
      eq(giveawayWinnersTable.claimStatus, "pending"),
      isNotNull(giveawayWinnersTable.claimDeadline),
      lte(giveawayWinnersTable.claimDeadline, now),
    ));
}

// User ids already selected as winners for a giveaway (any status) — excluded
// from reroll draws so the same person can't win the same slot twice.
export async function pastWinnerIds(giveawayId: number): Promise<Set<string>> {
  const rows = await db.select({ userId: giveawayWinnersTable.userId }).from(giveawayWinnersTable)
    .where(eq(giveawayWinnersTable.giveawayId, giveawayId));
  return new Set(rows.map(r => r.userId));
}

export async function claimStatusesFor(giveawayId: number, statuses: GiveawayClaimStatus[]): Promise<GiveawayWinner[]> {
  return db.select().from(giveawayWinnersTable)
    .where(and(eq(giveawayWinnersTable.giveawayId, giveawayId), inArray(giveawayWinnersTable.claimStatus, statuses)));
}
