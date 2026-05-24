import { db, cardsTable, collectionsTable, guildSettingsTable, adminUsersTable, spawnLogTable } from "@workspace/db";
import { eq, and, sql } from "drizzle-orm";
import type { Card, GuildSettings } from "@workspace/db";
import { DEFAULT_CARDS } from "./cards-data.js";
import { logger } from "../lib/logger.js";

// ── Seed default cards ────────────────────────────────────────────────────────
export async function seedDefaultCards() {
  const existing = await db.select({ id: cardsTable.id }).from(cardsTable).limit(1);
  if (existing.length > 0) return;
  logger.info("Seeding default cards...");
  for (const card of DEFAULT_CARDS) {
    await db.insert(cardsTable).values(card).onConflictDoNothing();
  }
  logger.info(`Seeded ${DEFAULT_CARDS.length} default cards.`);
}

// ── Guild Settings ────────────────────────────────────────────────────────────
export async function getOrCreateGuildSettings(guildId: string): Promise<GuildSettings> {
  const existing = await db
    .select()
    .from(guildSettingsTable)
    .where(eq(guildSettingsTable.guildId, guildId))
    .limit(1);
  if (existing[0]) return existing[0];

  const [created] = await db
    .insert(guildSettingsTable)
    .values({ guildId })
    .returning();
  return created;
}

export async function updateGuildSettings(guildId: string, values: Partial<GuildSettings>) {
  await db
    .update(guildSettingsTable)
    .set({ ...values, updatedAt: new Date() })
    .where(eq(guildSettingsTable.guildId, guildId));
}

// ── Admin Users ───────────────────────────────────────────────────────────────
export async function isAdmin(guildId: string, userId: string): Promise<boolean> {
  const rows = await db
    .select({ id: adminUsersTable.id })
    .from(adminUsersTable)
    .where(and(eq(adminUsersTable.guildId, guildId), eq(adminUsersTable.userId, userId)));
  return rows.length > 0;
}

export async function addAdmin(guildId: string, userId: string, addedBy: string) {
  await db
    .insert(adminUsersTable)
    .values({ guildId, userId, addedBy })
    .onConflictDoNothing();
}

export async function removeAdmin(guildId: string, userId: string) {
  await db
    .delete(adminUsersTable)
    .where(and(eq(adminUsersTable.guildId, guildId), eq(adminUsersTable.userId, userId)));
}

export async function listAdmins(guildId: string) {
  return db.select().from(adminUsersTable).where(eq(adminUsersTable.guildId, guildId));
}

// ── Cards ─────────────────────────────────────────────────────────────────────
export async function getAllCards(): Promise<Card[]> {
  return db.select().from(cardsTable);
}

export async function getCardByName(name: string): Promise<Card | undefined> {
  const [card] = await db
    .select()
    .from(cardsTable)
    .where(sql`lower(${cardsTable.name}) = lower(${name})`);
  return card;
}

export async function addCard(values: {
  name: string;
  description: string;
  rarity: string;
  dropWeight: number;
  imageUrl?: string;
}) {
  const [card] = await db.insert(cardsTable).values(values).returning();
  return card;
}

export async function removeCard(name: string) {
  await db.delete(cardsTable).where(sql`lower(${cardsTable.name}) = lower(${name})`);
}

// ── Weighted Random Card Pick ─────────────────────────────────────────────────
export async function pickRandomCard(): Promise<Card | undefined> {
  const cards = await getAllCards();
  if (cards.length === 0) return undefined;
  const totalWeight = cards.reduce((sum, c) => sum + c.dropWeight, 0);
  let rand = Math.random() * totalWeight;
  for (const card of cards) {
    rand -= card.dropWeight;
    if (rand <= 0) return card;
  }
  return cards[cards.length - 1];
}

// ── Collections ───────────────────────────────────────────────────────────────
export async function catchCard(guildId: string, userId: string, cardId: number) {
  const existing = await db
    .select()
    .from(collectionsTable)
    .where(
      and(
        eq(collectionsTable.guildId, guildId),
        eq(collectionsTable.userId, userId),
        eq(collectionsTable.cardId, cardId),
      ),
    );

  if (existing[0]) {
    await db
      .update(collectionsTable)
      .set({ count: existing[0].count + 1, lastCaughtAt: new Date() })
      .where(eq(collectionsTable.id, existing[0].id));
  } else {
    await db.insert(collectionsTable).values({ guildId, userId, cardId, count: 1 });
  }
}

export async function getUserCollection(guildId: string, userId: string) {
  return db
    .select({
      cardId: collectionsTable.cardId,
      count: collectionsTable.count,
      firstCaughtAt: collectionsTable.firstCaughtAt,
      name: cardsTable.name,
      rarity: cardsTable.rarity,
      description: cardsTable.description,
    })
    .from(collectionsTable)
    .innerJoin(cardsTable, eq(collectionsTable.cardId, cardsTable.id))
    .where(
      and(eq(collectionsTable.guildId, guildId), eq(collectionsTable.userId, userId)),
    );
}

export async function getLeaderboard(guildId: string) {
  return db
    .select({
      userId: collectionsTable.userId,
      totalCards: sql<number>`sum(${collectionsTable.count})`.as("total_cards"),
      uniqueCards: sql<number>`count(distinct ${collectionsTable.cardId})`.as("unique_cards"),
    })
    .from(collectionsTable)
    .where(eq(collectionsTable.guildId, guildId))
    .groupBy(collectionsTable.userId)
    .orderBy(sql`total_cards desc`)
    .limit(10);
}

// ── Spawn Log ─────────────────────────────────────────────────────────────────
export async function logSpawn(guildId: string, channelId: string, cardId: number, isForced: boolean) {
  const [row] = await db
    .insert(spawnLogTable)
    .values({ guildId, channelId, cardId, isForced })
    .returning();
  return row;
}

export async function markCaught(spawnId: number, userId: string) {
  await db
    .update(spawnLogTable)
    .set({ caughtBy: userId, caughtAt: new Date() })
    .where(eq(spawnLogTable.id, spawnId));
}
