import {
  db,
  cardsTable, collectionsTable, guildSettingsTable,
  adminUsersTable, spawnLogTable, userCurrencyTable, tradesTable,
  wishlistsTable, userTimeoutsTable,
} from "@workspace/db";
import { eq, and, sql, desc, inArray } from "drizzle-orm";
import type { Card, GuildSettings, Trade } from "@workspace/db";
import { DEFAULT_CARDS } from "./cards-data.js";
import { logger } from "../lib/logger.js";

// ── Seed / resync default cards ───────────────────────────────────────────────
export const DEFAULTS_SET_NAME = "defaults";

// Seed defaults ONLY on a completely empty database — never re-sync or re-add
// after unload, so admin removals are permanent.
export async function seedDefaultCards() {
  await backfillSetNames();
  const existing = await db.select({ id: cardsTable.id }).from(cardsTable).limit(1);
  if (existing.length > 0) return;
  logger.info("Seeding DN Cards default roster (DB is empty)...");
  for (const card of DEFAULT_CARDS) {
    await db.insert(cardsTable).values({ ...card, setName: DEFAULTS_SET_NAME }).onConflictDoNothing();
  }
  logger.info(`Seeded ${DEFAULT_CARDS.length} cards.`);
}

// One-time backfill so legacy cards (added before set_name existed) get tagged.
// Default-roster names → "defaults"; anything else → "legacy".
async function backfillSetNames() {
  const untagged = await db.select({ id: cardsTable.id, name: cardsTable.name })
    .from(cardsTable).where(sql`${cardsTable.setName} IS NULL`);
  if (untagged.length === 0) return;
  const defaultNames = new Set(DEFAULT_CARDS.map(c => c.name));
  for (const c of untagged) {
    const tag = defaultNames.has(c.name) ? DEFAULTS_SET_NAME : "legacy";
    await db.update(cardsTable).set({ setName: tag }).where(eq(cardsTable.id, c.id));
  }
  logger.info({ count: untagged.length }, "Backfilled set_name for legacy cards");
}

// Force-add default cards (used by /loadset defaults). Skips names already in DB.
export async function loadDefaultCards(): Promise<{ added: number; skipped: number }> {
  let added = 0, skipped = 0;
  for (const card of DEFAULT_CARDS) {
    const existing = await getCardByName(card.name);
    if (existing) { skipped++; continue; }
    await db.insert(cardsTable).values({ ...card, setName: DEFAULTS_SET_NAME }).onConflictDoNothing();
    added++;
  }
  return { added, skipped };
}

// Remove all default-roster cards (and their FK dependents).
export async function unloadDefaultCards(): Promise<{ removed: number }> {
  return deleteSetByName(DEFAULTS_SET_NAME);
}

// ── Card Sets ─────────────────────────────────────────────────────────────────
// List all distinct set names with card counts.
export async function listSets(): Promise<Array<{ setName: string; cardCount: number }>> {
  const rows = await db.select({
    setName: sql<string>`coalesce(${cardsTable.setName}, 'untagged')`.as("set_name"),
    cardCount: sql<number>`count(*)::int`.as("card_count"),
  }).from(cardsTable).groupBy(cardsTable.setName);
  return rows.map(r => ({ setName: r.setName, cardCount: Number(r.cardCount) }));
}

// Delete every card in a set, cascading through collections/spawn_log/trades.
export async function deleteSetByName(setName: string): Promise<{ removed: number }> {
  const cards = await db.select({ id: cardsTable.id }).from(cardsTable)
    .where(eq(cardsTable.setName, setName));
  if (cards.length === 0) return { removed: 0 };
  const ids = cards.map(c => c.id);

  await db.delete(collectionsTable).where(inArray(collectionsTable.cardId, ids));
  await db.delete(spawnLogTable).where(inArray(spawnLogTable.cardId, ids));
  await db.delete(tradesTable).where(
    sql`${tradesTable.offeredCardId} IN ${ids} OR ${tradesTable.requestedCardId} IN ${ids}`,
  );
  await db.delete(cardsTable).where(inArray(cardsTable.id, ids));
  logger.info({ setName, removed: ids.length }, "Deleted card set");
  return { removed: ids.length };
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

// ── User Catch Timeouts ───────────────────────────────────────────────────────
export async function setUserTimeout(
  guildId: string, userId: string, expiresAt: Date, issuedBy: string, reason?: string,
): Promise<void> {
  // Clear any existing timeout for this user, then insert the new one.
  await db.delete(userTimeoutsTable)
    .where(and(eq(userTimeoutsTable.guildId, guildId), eq(userTimeoutsTable.userId, userId)));
  await db.insert(userTimeoutsTable).values({
    guildId, userId, expiresAt, issuedBy, reason: reason ?? null,
  });
}

export async function clearUserTimeout(guildId: string, userId: string): Promise<void> {
  await db.delete(userTimeoutsTable)
    .where(and(eq(userTimeoutsTable.guildId, guildId), eq(userTimeoutsTable.userId, userId)));
}

/** Returns the active timeout row if the user is currently timed-out, else null. */
export async function getUserTimeout(guildId: string, userId: string) {
  const [row] = await db.select().from(userTimeoutsTable)
    .where(and(
      eq(userTimeoutsTable.guildId, guildId),
      eq(userTimeoutsTable.userId, userId),
      sql`${userTimeoutsTable.expiresAt} > NOW()`,
    ))
    .limit(1);
  return row ?? null;
}

/** All active (non-expired) timeouts in a guild. */
export async function listActiveTimeouts(guildId: string) {
  return db.select().from(userTimeoutsTable)
    .where(and(
      eq(userTimeoutsTable.guildId, guildId),
      sql`${userTimeoutsTable.expiresAt} > NOW()`,
    ))
    .orderBy(userTimeoutsTable.expiresAt);
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
  setName?: string;
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

export async function updateCard(cardId: number, values: Partial<{
  name: string; description: string; rarity: string; cardType: string;
  dropWeight: number; worthValue: number; burnValue: number;
  isLimitedEdition: boolean; isEventExclusive: boolean;
  maxCopies: number | null; imageUrl: string | null; flavor: string | null; droppable: boolean;
}>) {
  const [updated] = await db.update(cardsTable).set(values as any).where(eq(cardsTable.id, cardId)).returning();
  return updated;
}

// ── Weighted Random Card Pick (with optional guild rarity weight overrides) ────
export async function pickRandomCard(rarityWeights?: Record<string, number>): Promise<Card | undefined> {
  const cards = (await getAllCards()).filter(c => c.droppable && !c.isArchived);
  if (cards.length === 0) return undefined;

  const getWeight = (card: Card) => rarityWeights
    ? (rarityWeights[card.rarity] ?? card.dropWeight)
    : card.dropWeight;

  const totalWeight = cards.reduce((sum, c) => sum + getWeight(c), 0);
  let rand = Math.random() * totalWeight;
  for (const card of cards) {
    rand -= getWeight(card);
    if (rand <= 0) return card;
  }
  return cards[cards.length - 1];
}

// ── Collections ───────────────────────────────────────────────────────────────
export async function catchCard(guildId: string, userId: string, cardId: number) {
  // Atomic upsert — the (guild_id, user_id, card_id) unique index makes this
  // race-safe so two simultaneous catches of the same card can never create
  // duplicate collection rows.
  await db.insert(collectionsTable)
    .values({ guildId, userId, cardId, count: 1 })
    .onConflictDoUpdate({
      target: [collectionsTable.guildId, collectionsTable.userId, collectionsTable.cardId],
      set: {
        count: sql`${collectionsTable.count} + 1`,
        lastCaughtAt: new Date(),
      },
    });

  await db.update(cardsTable)
    .set({ totalMinted: sql`${cardsTable.totalMinted} + 1` })
    .where(eq(cardsTable.id, cardId));
}

/**
 * Restore a card copy to a user's collection WITHOUT touching the global
 * `totalMinted` counter. Use this when refunding a card that was previously
 * removed by `removeCardFromUser` (e.g. a failed /tradein) — the card was
 * never destroyed from the world's perspective, so the mint count shouldn't
 * move. For genuine new mints (drops, packs, admin gives) use `catchCard`.
 */
export async function restoreCardToUser(guildId: string, userId: string, cardId: number) {
  await db.insert(collectionsTable)
    .values({ guildId, userId, cardId, count: 1 })
    .onConflictDoUpdate({
      target: [collectionsTable.guildId, collectionsTable.userId, collectionsTable.cardId],
      set: {
        count: sql`${collectionsTable.count} + 1`,
        lastCaughtAt: new Date(),
      },
    });
}

export async function removeCardFromUser(
  guildId: string, userId: string, cardId: number,
): Promise<{ success: boolean; remaining: number }> {
  const [entry] = await db.select().from(collectionsTable)
    .where(and(
      eq(collectionsTable.guildId, guildId),
      eq(collectionsTable.userId, userId),
      eq(collectionsTable.cardId, cardId),
    ));
  if (!entry || entry.count < 1) return { success: false, remaining: 0 };

  const newCount = entry.count - 1;
  if (newCount === 0) {
    await db.delete(collectionsTable).where(eq(collectionsTable.id, entry.id));
  } else {
    await db.update(collectionsTable).set({ count: newCount }).where(eq(collectionsTable.id, entry.id));
  }
  return { success: true, remaining: newCount };
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
export async function getLeaderboard(guildId: string, sortBy: "worth" | "cards" = "worth", limit = 10) {
  const orderExpr = sortBy === "cards" ? sql`total_cards desc` : sql`net_worth desc`;
  return db.select({
    userId: collectionsTable.userId,
    totalCards: sql<number>`sum(${collectionsTable.count})::int`.as("total_cards"),
    uniqueCards: sql<number>`count(distinct ${collectionsTable.cardId})::int`.as("unique_cards"),
    netWorth: sql<number>`sum(${collectionsTable.count} * ${cardsTable.worthValue})::int`.as("net_worth"),
  })
    .from(collectionsTable)
    .innerJoin(cardsTable, eq(collectionsTable.cardId, cardsTable.id))
    .where(eq(collectionsTable.guildId, guildId))
    .groupBy(collectionsTable.userId)
    .orderBy(orderExpr)
    .limit(limit);
}

// ── Currency (DN Shards) ──────────────────────────────────────────────────────
export async function getOrCreateCurrency(guildId: string, userId: string) {
  const [row] = await db.select().from(userCurrencyTable)
    .where(and(eq(userCurrencyTable.guildId, guildId), eq(userCurrencyTable.userId, userId)));
  if (row) return row;
  const [created] = await db.insert(userCurrencyTable).values({ guildId, userId }).returning();
  return created;
}

// Atomic: never lose increments under concurrent callers.
export async function addShards(guildId: string, userId: string, amount: number) {
  await getOrCreateCurrency(guildId, userId);
  const earnedDelta = Math.max(0, amount);
  await db.update(userCurrencyTable)
    .set({
      shards: sql`${userCurrencyTable.shards} + ${amount}`,
      totalEarned: sql`${userCurrencyTable.totalEarned} + ${earnedDelta}`,
      updatedAt: new Date(),
    })
    .where(and(eq(userCurrencyTable.guildId, guildId), eq(userCurrencyTable.userId, userId)));
}

// Atomic: never goes below 0 even under concurrency.
export async function deductShards(guildId: string, userId: string, amount: number): Promise<{ success: boolean; remaining: number }> {
  await getOrCreateCurrency(guildId, userId);
  const [row] = await db.update(userCurrencyTable)
    .set({
      shards: sql`GREATEST(0, ${userCurrencyTable.shards} - ${amount})`,
      updatedAt: new Date(),
    })
    .where(and(eq(userCurrencyTable.guildId, guildId), eq(userCurrencyTable.userId, userId)))
    .returning({ shards: userCurrencyTable.shards });
  if (!row) return { success: false, remaining: 0 };
  return { success: row.shards >= 0, remaining: row.shards };
}

// Atomic: only deducts if balance >= amount. Returns false if insufficient.
export async function spendShards(guildId: string, userId: string, amount: number): Promise<boolean> {
  await getOrCreateCurrency(guildId, userId);
  const rows = await db.update(userCurrencyTable)
    .set({
      shards: sql`${userCurrencyTable.shards} - ${amount}`,
      updatedAt: new Date(),
    })
    .where(and(
      eq(userCurrencyTable.guildId, guildId),
      eq(userCurrencyTable.userId, userId),
      sql`${userCurrencyTable.shards} >= ${amount}`,
    ))
    .returning({ id: userCurrencyTable.id });
  return rows.length > 0;
}

// Atomic refund — credit shards back without affecting totalEarned.
export async function refundShards(guildId: string, userId: string, amount: number) {
  await getOrCreateCurrency(guildId, userId);
  await db.update(userCurrencyTable)
    .set({
      shards: sql`${userCurrencyTable.shards} + ${amount}`,
      updatedAt: new Date(),
    })
    .where(and(eq(userCurrencyTable.guildId, guildId), eq(userCurrencyTable.userId, userId)));
}

// ── Burn a card ───────────────────────────────────────────────────────────────
export async function incrementCardsBurned(guildId: string, userId: string, by: number = 1) {
  await getOrCreateCurrency(guildId, userId);
  await db.update(userCurrencyTable)
    .set({ cardsBurned: sql`${userCurrencyTable.cardsBurned} + ${by}` })
    .where(and(eq(userCurrencyTable.guildId, guildId), eq(userCurrencyTable.userId, userId)));
}

export async function burnCard(guildId: string, userId: string, cardId: number): Promise<{ success: boolean; shardsGained: number; remaining: number }> {
  // Atomic conditional decrement — only one concurrent burn can win the row,
  // preventing button-spam shard duplication.
  const [card] = await db.select({ burnValue: cardsTable.burnValue })
    .from(cardsTable).where(eq(cardsTable.id, cardId));
  if (!card) return { success: false, shardsGained: 0, remaining: 0 };

  const updated = await db.update(collectionsTable)
    .set({ count: sql`${collectionsTable.count} - 1` })
    .where(and(
      eq(collectionsTable.guildId, guildId),
      eq(collectionsTable.userId, userId),
      eq(collectionsTable.cardId, cardId),
      sql`${collectionsTable.count} >= 1`,
    ))
    .returning({ id: collectionsTable.id, newCount: collectionsTable.count });
  if (updated.length === 0) return { success: false, shardsGained: 0, remaining: 0 };

  const row = updated[0]!;
  if (row.newCount === 0) {
    await db.delete(collectionsTable).where(eq(collectionsTable.id, row.id));
  }
  await addShards(guildId, userId, card.burnValue);
  await incrementCardsBurned(guildId, userId, 1);
  return { success: true, shardsGained: card.burnValue, remaining: row.newCount };
}

// ── Trades ────────────────────────────────────────────────────────────────────
export async function createTrade(args: {
  guildId: string;
  initiatorId: string;
  targetId: string;
  offeredCardId?: number | null;
  requestedCardId?: number | null;
  offeredShards?: number;
  requestedShards?: number;
  channelId: string;
  messageId?: string;
}) {
  const [trade] = await db.insert(tradesTable).values({
    guildId: args.guildId,
    initiatorId: args.initiatorId,
    targetId: args.targetId,
    offeredCardId: args.offeredCardId ?? null,
    requestedCardId: args.requestedCardId ?? null,
    offeredShards: args.offeredShards ?? 0,
    requestedShards: args.requestedShards ?? 0,
    channelId: args.channelId,
    messageId: args.messageId,
  }).returning();
  return trade;
}

export async function getTrade(tradeId: number): Promise<Trade | undefined> {
  const [row] = await db.select().from(tradesTable).where(eq(tradesTable.id, tradeId));
  return row;
}

export async function updateTradeStatus(tradeId: number, status: "accepted" | "declined" | "cancelled" | "expired") {
  await db.update(tradesTable)
    .set({ status, resolvedAt: new Date() })
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
    offeredCardName: sql<string | null>`offered.name`,
    requestedCardName: sql<string | null>`requested.name`,
    offeredShards: tradesTable.offeredShards,
    requestedShards: tradesTable.requestedShards,
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

// ── Gift shards (atomic transfer) ────────────────────────────────────────────
export async function giftShards(
  guildId: string, fromUserId: string, toUserId: string, amount: number,
): Promise<{ success: boolean; remaining: number }> {
  if (amount <= 0) {
    const cur = await getOrCreateCurrency(guildId, fromUserId);
    return { success: false, remaining: cur.shards };
  }
  // Ensure both currency rows exist BEFORE entering the transaction so the
  // upsert side-effect doesn't get rolled back on a debit failure.
  await getOrCreateCurrency(guildId, fromUserId);
  await getOrCreateCurrency(guildId, toUserId);

  const success = await db.transaction(async (tx) => {
    const debited = await tx.update(userCurrencyTable)
      .set({
        shards: sql`${userCurrencyTable.shards} - ${amount}`,
        updatedAt: new Date(),
      })
      .where(and(
        eq(userCurrencyTable.guildId, guildId),
        eq(userCurrencyTable.userId, fromUserId),
        sql`${userCurrencyTable.shards} >= ${amount}`,
      ))
      .returning({ id: userCurrencyTable.id });
    if (debited.length === 0) {
      // Transaction rolls back automatically — sender keeps their shards.
      throw new Error("insufficient_shards");
    }
    await tx.update(userCurrencyTable)
      .set({
        shards: sql`${userCurrencyTable.shards} + ${amount}`,
        totalEarned: sql`${userCurrencyTable.totalEarned} + ${amount}`,
        updatedAt: new Date(),
      })
      .where(and(
        eq(userCurrencyTable.guildId, guildId),
        eq(userCurrencyTable.userId, toUserId),
      ));
    return true;
  }).catch((err) => {
    if (err instanceof Error && err.message === "insufficient_shards") return false;
    throw err;
  });

  const cur = await getOrCreateCurrency(guildId, fromUserId);
  return { success, remaining: cur.shards };
}

export async function executeTradeSwap(trade: Trade): Promise<boolean> {
  // Guard: trades created before validation tightening may carry negatives.
  if (trade.offeredShards < 0 || trade.requestedShards < 0) return false;

  // Pre-create currency rows so the on-conflict upsert can't be rolled back
  // alongside the swap. Inside the txn we use atomic conditional UPDATEs so
  // concurrent accepts/burns can't lead to double-spend.
  if (trade.offeredShards > 0) await getOrCreateCurrency(trade.guildId, trade.initiatorId);
  if (trade.requestedShards > 0) await getOrCreateCurrency(trade.guildId, trade.targetId);
  if (trade.requestedCardId) await getOrCreateCurrency(trade.guildId, trade.initiatorId);
  if (trade.offeredCardId) await getOrCreateCurrency(trade.guildId, trade.targetId);

  return await db.transaction(async (tx) => {
    // 1) Atomic card debits — single SQL per side ensures only one concurrent
    //    trade can claim the last copy.
    if (trade.offeredCardId) {
      const dec = await tx.update(collectionsTable)
        .set({ count: sql`${collectionsTable.count} - 1` })
        .where(and(
          eq(collectionsTable.guildId, trade.guildId),
          eq(collectionsTable.userId, trade.initiatorId),
          eq(collectionsTable.cardId, trade.offeredCardId),
          sql`${collectionsTable.count} >= 1`,
        ))
        .returning({ id: collectionsTable.id, newCount: collectionsTable.count });
      if (dec.length === 0) throw new Error("initiator_lacks_card");
      if (dec[0]!.newCount === 0) {
        await tx.delete(collectionsTable).where(eq(collectionsTable.id, dec[0]!.id));
      }
    }
    if (trade.requestedCardId) {
      const dec = await tx.update(collectionsTable)
        .set({ count: sql`${collectionsTable.count} - 1` })
        .where(and(
          eq(collectionsTable.guildId, trade.guildId),
          eq(collectionsTable.userId, trade.targetId),
          eq(collectionsTable.cardId, trade.requestedCardId),
          sql`${collectionsTable.count} >= 1`,
        ))
        .returning({ id: collectionsTable.id, newCount: collectionsTable.count });
      if (dec.length === 0) throw new Error("target_lacks_card");
      if (dec[0]!.newCount === 0) {
        await tx.delete(collectionsTable).where(eq(collectionsTable.id, dec[0]!.id));
      }
    }

    // 2) Atomic shard debits.
    if (trade.offeredShards > 0) {
      const debit = await tx.update(userCurrencyTable)
        .set({ shards: sql`${userCurrencyTable.shards} - ${trade.offeredShards}`, updatedAt: new Date() })
        .where(and(
          eq(userCurrencyTable.guildId, trade.guildId),
          eq(userCurrencyTable.userId, trade.initiatorId),
          sql`${userCurrencyTable.shards} >= ${trade.offeredShards}`,
        ))
        .returning({ id: userCurrencyTable.id });
      if (debit.length === 0) throw new Error("initiator_lacks_shards");
    }
    if (trade.requestedShards > 0) {
      const debit = await tx.update(userCurrencyTable)
        .set({ shards: sql`${userCurrencyTable.shards} - ${trade.requestedShards}`, updatedAt: new Date() })
        .where(and(
          eq(userCurrencyTable.guildId, trade.guildId),
          eq(userCurrencyTable.userId, trade.targetId),
          sql`${userCurrencyTable.shards} >= ${trade.requestedShards}`,
        ))
        .returning({ id: userCurrencyTable.id });
      if (debit.length === 0) throw new Error("target_lacks_shards");
    }

    // 3) Card credits — trades are MOVES, not new mints, so do not bump
    //    cardsTable.totalMinted (otherwise limited-editions would deplete
    //    on every trade). Mirrors restoreCardToUser semantics.
    if (trade.requestedCardId) await restoreCardToUserTx(tx, trade.guildId, trade.initiatorId, trade.requestedCardId);
    if (trade.offeredCardId) await restoreCardToUserTx(tx, trade.guildId, trade.targetId, trade.offeredCardId);

    // 4) Shard credits — bump totalEarned alongside shards so the
    //    leaderboard / lifetime-earned stat reflects trade income.
    if (trade.requestedShards > 0) {
      await tx.update(userCurrencyTable)
        .set({
          shards: sql`${userCurrencyTable.shards} + ${trade.requestedShards}`,
          totalEarned: sql`${userCurrencyTable.totalEarned} + ${trade.requestedShards}`,
          updatedAt: new Date(),
        })
        .where(and(
          eq(userCurrencyTable.guildId, trade.guildId),
          eq(userCurrencyTable.userId, trade.initiatorId),
        ));
    }
    if (trade.offeredShards > 0) {
      await tx.update(userCurrencyTable)
        .set({
          shards: sql`${userCurrencyTable.shards} + ${trade.offeredShards}`,
          totalEarned: sql`${userCurrencyTable.totalEarned} + ${trade.offeredShards}`,
          updatedAt: new Date(),
        })
        .where(and(
          eq(userCurrencyTable.guildId, trade.guildId),
          eq(userCurrencyTable.userId, trade.targetId),
        ));
    }

    return true;
  }).catch((err) => {
    if (err instanceof Error && [
      "initiator_lacks_card", "target_lacks_card",
      "initiator_lacks_shards", "target_lacks_shards",
    ].includes(err.message)) return false;
    logger.error({ err, tradeId: trade.id }, "executeTradeSwap failed");
    return false;
  });
}

// Transaction-safe variant of restoreCardToUser — credits one copy to the
// user's collection WITHOUT touching cardsTable.totalMinted. Used by trade
// swaps, which are moves (no new card is minted into the world).
async function restoreCardToUserTx(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  guildId: string, userId: string, cardId: number,
) {
  await tx.insert(collectionsTable)
    .values({ guildId, userId, cardId, count: 1 })
    .onConflictDoUpdate({
      target: [collectionsTable.guildId, collectionsTable.userId, collectionsTable.cardId],
      set: {
        count: sql`${collectionsTable.count} + 1`,
        lastCaughtAt: new Date(),
      },
    });
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

// ── Wishlists ─────────────────────────────────────────────────────────────────
export async function addWishlist(guildId: string, userId: string, cardId: number): Promise<boolean> {
  const inserted = await db.insert(wishlistsTable)
    .values({ guildId, userId, cardId })
    .onConflictDoNothing()
    .returning({ id: wishlistsTable.id });
  return inserted.length > 0;
}

export async function removeWishlist(guildId: string, userId: string, cardId: number): Promise<boolean> {
  const deleted = await db.delete(wishlistsTable)
    .where(and(
      eq(wishlistsTable.guildId, guildId),
      eq(wishlistsTable.userId, userId),
      eq(wishlistsTable.cardId, cardId),
    ))
    .returning({ id: wishlistsTable.id });
  return deleted.length > 0;
}

export async function getUserWishlist(
  guildId: string, userId: string,
): Promise<Array<{ cardId: number; name: string; rarity: string; worthValue: number }>> {
  const rows = await db.select({
    cardId: cardsTable.id,
    name: cardsTable.name,
    rarity: cardsTable.rarity,
    worthValue: cardsTable.worthValue,
  })
    .from(wishlistsTable)
    .innerJoin(cardsTable, eq(cardsTable.id, wishlistsTable.cardId))
    .where(and(eq(wishlistsTable.guildId, guildId), eq(wishlistsTable.userId, userId)))
    .orderBy(desc(cardsTable.worthValue));
  return rows;
}

export async function getCardWishlisters(guildId: string, cardId: number): Promise<string[]> {
  const rows = await db.select({ userId: wishlistsTable.userId })
    .from(wishlistsTable)
    .where(and(eq(wishlistsTable.guildId, guildId), eq(wishlistsTable.cardId, cardId)));
  return rows.map(r => r.userId);
}
