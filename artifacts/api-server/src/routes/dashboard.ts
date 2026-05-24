import { Router, type IRouter, type Request, type Response } from "express";
import { db, cardsTable, collectionsTable, userCurrencyTable, achievementsTable } from "@workspace/db";
import { and, eq, sql, desc } from "drizzle-orm";
import { z } from "zod/v4";
import { ACHIEVEMENTS } from "../bot/achievements";
import { getCollectorRank, getNextRank } from "../bot/cards-data";

const router: IRouter = Router();

const snowflakeSchema = z.string().regex(/^\d{15,21}$/, "must be a Discord snowflake");
const guildParams = z.object({ guildId: snowflakeSchema });
const guildUserParams = z.object({ guildId: snowflakeSchema, userId: snowflakeSchema });

function parseParams<T extends z.ZodTypeAny>(schema: T, req: Request, res: Response): z.infer<T> | null {
  const result = schema.safeParse(req.params);
  if (!result.success) {
    res.status(400).json({ error: "Invalid parameters", details: result.error.issues });
    return null;
  }
  return result.data;
}

// ── All cards (the public roster) ─────────────────────────────────────────────
router.get("/cards", async (_req, res) => {
  const rows = await db.select().from(cardsTable).orderBy(cardsTable.id);
  res.json({ cards: rows });
});

// ── Guild leaderboard (top 25 by net worth) ───────────────────────────────────
router.get("/guilds/:guildId/leaderboard", async (req, res) => {
  const params = parseParams(guildParams, req, res);
  if (!params) return;
  const { guildId } = params;
  const rows = await db.select({
    userId: collectionsTable.userId,
    uniqueCards: sql<number>`count(distinct ${collectionsTable.cardId})::int`,
    totalCards: sql<number>`sum(${collectionsTable.count})::int`,
    netWorth: sql<number>`sum(${collectionsTable.count} * ${cardsTable.worthValue})::int`,
  })
    .from(collectionsTable)
    .innerJoin(cardsTable, eq(collectionsTable.cardId, cardsTable.id))
    .where(eq(collectionsTable.guildId, guildId))
    .groupBy(collectionsTable.userId)
    .orderBy(desc(sql`sum(${collectionsTable.count} * ${cardsTable.worthValue})`))
    .limit(25);

  res.json({
    guildId,
    entries: rows.map((r, i) => ({
      rank: i + 1,
      userId: r.userId,
      uniqueCards: r.uniqueCards,
      totalCards: r.totalCards,
      netWorth: r.netWorth,
    })),
  });
});

// ── User profile (collection + currency + achievements + rank) ────────────────
router.get("/guilds/:guildId/users/:userId", async (req, res) => {
  const params = parseParams(guildUserParams, req, res);
  if (!params) return;
  const { guildId, userId } = params;

  const [collectionRows, [currency], unlockedRows] = await Promise.all([
    db.select({
      cardId: cardsTable.id,
      name: cardsTable.name,
      rarity: cardsTable.rarity,
      cardType: cardsTable.cardType,
      imageUrl: cardsTable.imageUrl,
      worthValue: cardsTable.worthValue,
      count: collectionsTable.count,
      firstCaughtAt: collectionsTable.firstCaughtAt,
    })
      .from(collectionsTable)
      .innerJoin(cardsTable, eq(collectionsTable.cardId, cardsTable.id))
      .where(and(eq(collectionsTable.guildId, guildId), eq(collectionsTable.userId, userId)))
      .orderBy(desc(cardsTable.worthValue)),
    db.select().from(userCurrencyTable)
      .where(and(eq(userCurrencyTable.guildId, guildId), eq(userCurrencyTable.userId, userId))),
    db.select().from(achievementsTable)
      .where(and(eq(achievementsTable.guildId, guildId), eq(achievementsTable.userId, userId))),
  ]);

  const unlockedKeys = new Set(unlockedRows.map(r => r.achievementKey));
  const unique = collectionRows.length;
  const total = collectionRows.reduce((s, r) => s + r.count, 0);
  const netWorth = collectionRows.reduce((s, r) => s + r.count * r.worthValue, 0);
  const rank = getCollectorRank(unique);
  const next = getNextRank(unique);

  res.json({
    guildId,
    userId,
    stats: {
      uniqueCards: unique,
      totalCards: total,
      netWorth,
      rank: { name: rank.name, emoji: rank.emoji, min: rank.min },
      nextRank: next ? { name: next.name, emoji: next.emoji, min: next.min, cardsNeeded: next.min - unique } : null,
    },
    currency: currency ?? {
      shards: 0, totalEarned: 0, packsOpened: 0, cardsBurned: 0,
    },
    collection: collectionRows,
    achievements: ACHIEVEMENTS.map(a => ({
      key: a.key,
      name: a.name,
      emoji: a.emoji,
      description: a.description,
      reward: a.reward,
      unlocked: unlockedKeys.has(a.key),
      unlockedAt: unlockedRows.find(r => r.achievementKey === a.key)?.unlockedAt ?? null,
    })),
  });
});

// ── Guild summary (counts for dashboard hero) ─────────────────────────────────
router.get("/guilds/:guildId/summary", async (req, res) => {
  const params = parseParams(guildParams, req, res);
  if (!params) return;
  const { guildId } = params;
  const [collectorRow, cardsRow, burnRow] = await Promise.all([
    db.select({
      collectors: sql<number>`count(distinct ${collectionsTable.userId})::int`,
      cardsHeld: sql<number>`coalesce(sum(${collectionsTable.count})::int, 0)`,
    }).from(collectionsTable).where(eq(collectionsTable.guildId, guildId)),
    db.select({ total: sql<number>`count(*)::int` }).from(cardsTable),
    db.select({
      packs: sql<number>`coalesce(sum(${userCurrencyTable.packsOpened})::int, 0)`,
      burns: sql<number>`coalesce(sum(${userCurrencyTable.cardsBurned})::int, 0)`,
      shards: sql<number>`coalesce(sum(${userCurrencyTable.totalEarned})::int, 0)`,
    }).from(userCurrencyTable).where(eq(userCurrencyTable.guildId, guildId)),
  ]);

  res.json({
    guildId,
    collectors: collectorRow[0]?.collectors ?? 0,
    cardsHeld: collectorRow[0]?.cardsHeld ?? 0,
    rosterSize: cardsRow[0]?.total ?? 0,
    packsOpened: burnRow[0]?.packs ?? 0,
    cardsBurned: burnRow[0]?.burns ?? 0,
    totalShardsEarned: burnRow[0]?.shards ?? 0,
  });
});

export default router;
