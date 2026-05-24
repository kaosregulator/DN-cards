import {
  db,
  cardsTable, collectionsTable, guildSettingsTable,
  adminUsersTable, spawnLogTable, userCurrencyTable, tradesTable,
} from "@workspace/db";
import { eq, and, sql, desc } from "drizzle-orm";
import type { Card, GuildSettings, Trade } from "@workspace/db";
import { DEFAULT_CARDS } from "./cards-data.js";
import { logger } from "../lib/logger.js";

// ── Seed / resync default cards ───────────────────────────────────────────────
export async function seedDefaultCards() {
  const existing = await db.select({ id: cardsTable.id }).from(cardsTable).limit(1);
  if (existing.length > 0) {
    // Upsert all defaults in case new fields were added
    for (const card of DEFAULT_CARDS) {
      await db
        .insert(cardsTable)
        .values(card)
        .onConflictDoUpdate({
          target: cardsTable.name,
          set: {
            description: card.description,
            flavor: card.flavor,
            rarity: card.rarity,
            cardType: card.cardType,
            worthValue: card.worthValue,
            burnValue: card.burnValue,
          },
        });
    }
    return;
  }
  logger.info("Seeding DN Cards default roster...");
  for (const card of DEFAULT_CARDS) {
    await db.insert(cardsTable).values(card).onConflictDoNothing();
  }
  logger.info(`Seeded ${DEFAULT_CARDS.length} cards.`);
}

// ── Guild Settings ────────────────────────────────────────────────────────────
export async function getOrCreateGuildSettings(guildId: string): Promise<GuildSettings> {
  const [row] = await db
    .select().from(guildSettingsTable)
    .where(eq(guildSettingsTable.guildId, guildId)).limit(1);
  if (row) return row;
  const [created] = await db.insert(guildSettingsTable).values({ guildId }).returning();
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
  await db.insert(adminUsersTable).values({ guildId, userId, addedBy }).onConflictDoNothing();
}

export async function removeAdmin(guildId: string, userId: string) {
  await db.delete(adminUsersTable)
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
    .select().from(cardsTable)
    .where(sql`lower(${cardsTable.name}) = lower(${name})`);
  return card;
}

export async function addCard(values: {
  name: string; description: string; rarity: string; cardType?: string;
  dropWeight: number; worthValue: number; burnValue: number;
  isLimitedEdition?: boolean; isEventExclusive?: boolean;
  maxCopies?: number; imageUrl?: string; flavor?: string; droppable?: boolean;
}) {
  const [card] = await db.insert(cardsTable).values(values as any).returning();
  await db.update(cardsTable).set({ totalMinted: 0 }).where(eq(cardsTable.id, card.id));
  return card;
}

export async function removeCard(name: string) {
  const card = await getCardByName(name);
  if (!card) return;
  await db.delete(cardsTable).where(eq(cardsTable.id, card.id));
}

// ── Weighted Random Card Pick ─────────────────────────────────────────────────
export async function pickRandomCard(): Promise<Card | undefined> {
  const cards = (await getAllCards()).filter(c => c.droppable);
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
  const [existing] = await db
    .select().from(collectionsTable)
    .where(and(
      eq(collectionsTable.guildId, guildId),
      eq(collectionsTable.userId, userId),
      eq(collectionsTable.cardId, cardId),
    ));

  if (existing) {
    await db.update(collectionsTable)
      .set({ count: existing.count + 1, lastCaughtAt: new Date() })
      .where(eq(collectionsTable.id, existing.id));
  } else {
    await db.insert(collectionsTable).values({ guildId, userId, cardId, count: 1 });
  }

  // Track total minted globally
  await db.update(cardsTable)
    .set({ totalMinted: sql`${cardsTable.totalMinted} + 1` })
    .where(eq(cardsTable.id, cardId));
}

export async function getUserCollection(guildId: string, userId: string) {
  return db.select({
    cardId: collectionsTable.cardId,
    count: collectionsTable.count,
    firstCaughtAt: collectionsTable.firstCaughtAt,
    name: cardsTable.name,
    rarity: cardsTable.rarity,
    cardType: cardsTable.cardType,
    description: cardsTable.description,
    worthValue: cardsTable.worthValue,
    burnValue: cardsTable.burnValue,
    isLimitedEdition: cardsTable.isLimitedEdition,
    isEventExclusive: cardsTable.isEventExclusive,
  }).from(collectionsTable)
    .innerJoin(cardsTable, eq(collectionsTable.cardId, cardsTable.id))
    .where(and(eq(collectionsTable.guildId, guildId), eq(collectionsTable.userId, userId)));
}

export async function getUserCardCount(guildId: string, userId: string): Promise<{ unique: number; total: number; netWorth: number }> {
  const items = await getUserCollection(guildId, userId);
  return {
    unique: items.length,
    total: items.reduce((s, i) => s + i.count, 0),
    netWorth: items.reduce((s, i) => s + i.worthValue * i.count, 0),
  };
}

export async function getCollectionEntry(guildId: string, userId: string, cardId: number) {
  const [row] = await db.select().from(collectionsTable)
    .where(and(
      eq(collectionsTable.guildId, guildId),
      eq(collectionsTable.userId, userId),
      eq(collectionsTable.cardId, cardId),
    ));
  return row;
}

// ── Leaderboard ───────────────────────────────────────────────────────────────
export async function getLeaderboard(guildId: string) {
  return db.select({
    userId: collectionsTable.userId,
    totalCards: sql<number>`sum(${collectionsTable.count})`.as("total_cards"),
    uniqueCards: sql<number>`count(distinct ${collectionsTable.cardId})`.as("unique_cards"),
    netWorth: sql<number>`sum(${collectionsTable.count} * ${cardsTable.worthValue})`.as("net_worth"),
  })
    .from(collectionsTable)
    .innerJoin(cardsTable, eq(collectionsTable.cardId, cardsTable.id))
    .where(eq(collectionsTable.guildId, guildId))
    .groupBy(collectionsTable.userId)
    .orderBy(sql`net_worth desc`)
    .limit(10);
}

// ── Currency (DN Shards) ──────────────────────────────────────────────────────
export async function getOrCreateCurrency(guildId: string, userId: string) {
  const [row] = await db.select().from(userCurrencyTable)
    .where(and(eq(userCurrencyTable.guildId, guildId), eq(userCurrencyTable.userId, userId)));
  if (row) return row;
  const [created] = await db.insert(userCurrencyTable).values({ guildId, userId }).returning();
  return created;
}

export async function addShards(guildId: string, userId: string, amount: number) {
  const currency = await getOrCreateCurrency(guildId, userId);
  await db.update(userCurrencyTable)
    .set({
      shards: currency.shards + amount,
      totalEarned: currency.totalEarned + Math.max(0, amount),
      updatedAt: new Date(),
    })
    .where(eq(userCurrencyTable.id, currency.id));
}

export async function spendShards(guildId: string, userId: string, amount: number): Promise<boolean> {
  const currency = await getOrCreateCurrency(guildId, userId);
  if (currency.shards < amount) return false;
  await db.update(userCurrencyTable)
    .set({ shards: currency.shards - amount, updatedAt: new Date() })
    .where(eq(userCurrencyTable.id, currency.id));
  return true;
}

// ── Burn a card ───────────────────────────────────────────────────────────────
export async function burnCard(guildId: string, userId: string, cardId: number): Promise<{ success: boolean; shardsGained: number; remaining: number }> {
  const [entry] = await db.select().from(collectionsTable)
    .where(and(
      eq(collectionsTable.guildId, guildId),
      eq(collectionsTable.userId, userId),
      eq(collectionsTable.cardId, cardId),
    ));

  if (!entry || entry.count < 1) return { success: false, shardsGained: 0, remaining: 0 };

  const [card] = await db.select({ burnValue: cardsTable.burnValue })
    .from(cardsTable).where(eq(cardsTable.id, cardId));
  if (!card) return { success: false, shardsGained: 0, remaining: 0 };

  const newCount = entry.count - 1;
  if (newCount === 0) {
    await db.delete(collectionsTable).where(eq(collectionsTable.id, entry.id));
  } else {
    await db.update(collectionsTable).set({ count: newCount }).where(eq(collectionsTable.id, entry.id));
  }

  await addShards(guildId, userId, card.burnValue);
  return { success: true, shardsGained: card.burnValue, remaining: newCount };
}

// ── Trades ────────────────────────────────────────────────────────────────────
export async function createTrade(
  guildId: string, initiatorId: string, targetId: string,
  offeredCardId: number, requestedCardId: number,
  channelId: string, messageId?: string,
) {
  const [trade] = await db.insert(tradesTable).values({
    guildId, initiatorId, targetId,
    offeredCardId, requestedCardId,
    channelId, messageId,
  }).returning();
  return trade;
}

export async function getTrade(tradeId: number): Promise<Trade | undefined> {
  const [row] = await db.select().from(tradesTable).where(eq(tradesTable.id, tradeId));
  return row;
}

export async function updateTradeStatus(tradeId: number, status: "accepted" | "declined" | "cancelled" | "expired", messageId?: string) {
  await db.update(tradesTable)
    .set({ status, resolvedAt: new Date(), ...(messageId ? { messageId } : {}) })
    .where(eq(tradesTable.id, tradeId));
}

export async function updateTradeMessageId(tradeId: number, messageId: string) {
  await db.update(tradesTable).set({ messageId }).where(eq(tradesTable.id, tradeId));
}

export async function getPendingTradesFor(guildId: string, userId: string) {
  return db.select({
    id: tradesTable.id,
    initiatorId: tradesTable.initiatorId,
    targetId: tradesTable.targetId,
    offeredCardName: sql<string>`offered.name`,
    requestedCardName: sql<string>`requested.name`,
    createdAt: tradesTable.createdAt,
  })
    .from(tradesTable)
    .leftJoin(sql`${cardsTable} offered`, sql`offered.id = ${tradesTable.offeredCardId}`)
    .leftJoin(sql`${cardsTable} requested`, sql`requested.id = ${tradesTable.requestedCardId}`)
    .where(and(
      eq(tradesTable.guildId, guildId),
      eq(tradesTable.status, "pending"),
      sql`(${tradesTable.initiatorId} = ${userId} OR ${tradesTable.targetId} = ${userId})`,
    ))
    .orderBy(desc(tradesTable.createdAt))
    .limit(10);
}

export async function executeTradeSwap(trade: Trade): Promise<boolean> {
  // Verify both parties still own the cards
  const initiatorEntry = await getCollectionEntry(trade.guildId, trade.initiatorId, trade.offeredCardId);
  const targetEntry = await getCollectionEntry(trade.guildId, trade.targetId, trade.requestedCardId);

  if (!initiatorEntry || initiatorEntry.count < 1) return false;
  if (!targetEntry || targetEntry.count < 1) return false;

  // Remove from both
  if (initiatorEntry.count === 1) {
    await db.delete(collectionsTable).where(eq(collectionsTable.id, initiatorEntry.id));
  } else {
    await db.update(collectionsTable).set({ count: initiatorEntry.count - 1 }).where(eq(collectionsTable.id, initiatorEntry.id));
  }

  if (targetEntry.count === 1) {
    await db.delete(collectionsTable).where(eq(collectionsTable.id, targetEntry.id));
  } else {
    await db.update(collectionsTable).set({ count: targetEntry.count - 1 }).where(eq(collectionsTable.id, targetEntry.id));
  }

  // Give each other's cards
  await catchCard(trade.guildId, trade.initiatorId, trade.requestedCardId);
  await catchCard(trade.guildId, trade.targetId, trade.offeredCardId);

  return true;
}

// ── Spawn Log ─────────────────────────────────────────────────────────────────
export async function logSpawn(guildId: string, channelId: string, cardId: number, isForced: boolean) {
  const [row] = await db.insert(spawnLogTable)
    .values({ guildId, channelId, cardId, isForced }).returning();
  return row;
}

export async function markCaught(spawnId: number, userId: string) {
  await db.update(spawnLogTable)
    .set({ caughtBy: userId, caughtAt: new Date() })
    .where(eq(spawnLogTable.id, spawnId));
}
