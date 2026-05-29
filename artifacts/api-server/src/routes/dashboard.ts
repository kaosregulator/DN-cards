import { Router, type IRouter, type Request, type Response } from "express";
import { db, cardsTable, cardDisplayOverridesTable, collectionsTable, userCurrencyTable, achievementsTable, setsTable, cardSetMembershipsTable, cardRarityOverridesTable, customRaritiesTable, rarityDisplayOverridesTable } from "@workspace/db";
import { and, eq, sql, desc } from "drizzle-orm";
import { z } from "zod/v4";
import { ACHIEVEMENTS } from "../bot/achievements";
import { getCollectorRank, getNextRank, SHINY_MULTIPLIER } from "../bot/cards-data";
import { getBotClient } from "../bot/spawn-manager";
import { getCardDisplayRarity, getEffectiveDropWeight, getGuildDropChanceRuntime, getRarityContext } from "../bot/db";

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

function slugifyDisplayCategory(raw: string): string {
  return raw.toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64) || "category";
}

// ── All cards (the public roster — excludes archived) ────────────────────────
// Reads `cards` LEFT JOIN `card_display_overrides`. The website applies the
// overrides BEFORE returning so the client never sees the raw gameplay name /
// image / description when an admin has set a display alias. Overrides also
// control website visibility (hiddenFromSite) and ordering (featured +
// sortWeight + id as final tiebreaker). Discord reads `cards` directly and is
// unaffected by anything in this endpoint.
// Also joins `sets` memberships so the client can display which set(s) a card
// belongs to without ever touching the removed `cards.set_name` column.
router.get("/cards", async (_req, res) => {
  const homeGuildId = process.env["HOME_GUILD_ID"] ?? null;

  const [rows, memberships, customOverrides, rarityLabels, rarityRuntime] = await Promise.all([
    db
      .select({ card: cardsTable, override: cardDisplayOverridesTable })
      .from(cardsTable)
      .leftJoin(cardDisplayOverridesTable, eq(cardDisplayOverridesTable.cardId, cardsTable.id))
      .where(eq(cardsTable.isArchived, false))
      .orderBy(cardsTable.id),
    db
      .select({ cardId: cardSetMembershipsTable.cardId, setId: setsTable.id, setName: setsTable.name })
      .from(cardSetMembershipsTable)
      .innerJoin(setsTable, eq(setsTable.id, cardSetMembershipsTable.setId)),
    homeGuildId
      ? db
          .select({
            cardId: cardRarityOverridesTable.cardId,
            slug: customRaritiesTable.slug,
            name: customRaritiesTable.name,
            dropWeight: customRaritiesTable.dropWeight,
          })
          .from(cardRarityOverridesTable)
          .innerJoin(
            customRaritiesTable,
            and(
              eq(customRaritiesTable.guildId, cardRarityOverridesTable.guildId),
              eq(customRaritiesTable.slug, cardRarityOverridesTable.customRaritySlug),
            ),
          )
          .where(eq(cardRarityOverridesTable.guildId, homeGuildId))
      : Promise.resolve([] as { cardId: number; slug: string; name: string; dropWeight: number }[]),
    // Built-in rarity rename overrides (e.g. "legendary" → "Exotic")
    homeGuildId
      ? db
          .select({ rarity: rarityDisplayOverridesTable.rarity, displayName: rarityDisplayOverridesTable.displayName })
          .from(rarityDisplayOverridesTable)
          .where(eq(rarityDisplayOverridesTable.guildId, homeGuildId))
      : Promise.resolve([] as { rarity: string; displayName: string | null }[]),
    // Active set + rarity context for the home guild — determines the live spawn pool.
    // This shared runtime includes rarity profiles, custom tiers, set overrides,
    // and active event boosts, matching the bot's spawn picker inputs.
    homeGuildId ? getGuildDropChanceRuntime(homeGuildId) : Promise.resolve(null),
  ]);

  const setsByCard = new Map<number, { id: number; name: string }[]>();
  for (const m of memberships) {
    if (!setsByCard.has(m.cardId)) setsByCard.set(m.cardId, []);
    setsByCard.get(m.cardId)!.push({ id: m.setId, name: m.setName });
  }

  const activeSetId = rarityRuntime?.settings.activeSetId ?? null;

  const customTierByCard = new Map<number, { slug: string; name: string; dropWeight: number }>();
  for (const o of customOverrides) {
    customTierByCard.set(o.cardId, { slug: o.slug, name: o.name, dropWeight: o.dropWeight });
  }

  // Map of built-in rarity enum → admin-chosen display name (e.g. "legendary" → "Exotic")
  const rarityLabelMap = new Map<string, string>();
  for (const r of rarityLabels) {
    if (r.displayName) rarityLabelMap.set(r.rarity, r.displayName);
  }

  const visible = rows
    .filter(r => !(r.override?.hiddenFromSite ?? false))
    .map(r => {
      const customTier = customTierByCard.get(r.card.id);
      const websiteCategoryLabel = r.override?.displayCategory?.trim() || null;
      const websiteCategory = websiteCategoryLabel ? `website:${slugifyDisplayCategory(websiteCategoryLabel)}` : null;
      // Gameplay display fallback: custom tier > renamed built-in > raw rarity
      const effectiveRarity = customTier?.slug ?? r.card.rarity;
      const effectiveRarityLabel = customTier?.name ?? rarityLabelMap.get(r.card.rarity) ?? r.card.rarity;
      const effectiveDropWeight = rarityRuntime
        ? getEffectiveDropWeight(r.card, {
            ctx: rarityRuntime.ctx,
            rarityWeights: rarityRuntime.rarityWeights,
            setRarityWeights: rarityRuntime.spawnPool.rarityWeights,
            eventBoosts: rarityRuntime.eventBoosts,
          })
        : customTier?.dropWeight ?? r.card.dropWeight;
      const dropChancePercent = rarityRuntime?.chanceSummary.cardPercentById.get(r.card.id) ?? null;
      const rarityDropChancePercent = rarityRuntime?.chanceSummary.rarityPercentByKey.get(
        customTier ? `custom:${customTier.slug}` : r.card.rarity,
      ) ?? null;
      const cardSets = setsByCard.get(r.card.id) ?? [];
      // inActiveSet: true only when a set is active AND this card belongs to it
      const inActiveSet = activeSetId !== null && cardSets.some(s => s.id === activeSetId);
      return {
        ...r.card,
        name: r.override?.displayName ?? r.card.name,
        description: r.override?.displayDescription ?? r.card.description,
        imageUrl: r.override?.displayImageUrl ?? r.card.imageUrl,
        flavor: r.override?.flavorText ?? r.card.flavor,
        featured: r.override?.featured ?? false,
        sortWeight: r.override?.sortWeight ?? 0,
        sets: cardSets,
        effectiveRarity,
        effectiveRarityLabel,
        websiteCategory,
        websiteCategoryLabel,
        effectiveDropWeight,
        dropChancePercent,
        rarityDropChancePercent,
        inActiveSet,
      };
    })
    .sort((a, b) => {
      if (a.featured !== b.featured) return a.featured ? -1 : 1;
      if (a.sortWeight !== b.sortWeight) return b.sortWeight - a.sortWeight;
      return a.id - b.id;
    });

  res.json({ cards: visible, activeSetId });
});

// ── Guild leaderboard (top 25 by net worth) ───────────────────────────────────
router.get("/guilds/:guildId/leaderboard", async (req, res) => {
  const params = parseParams(guildParams, req, res);
  if (!params) return;
  const { guildId } = params;
  // Net worth must use the same Setup Hub rarity context as the bot so
  // custom tier worth/profile overrides are reflected on the website.
  const [heldRows, ctx] = await Promise.all([
    db.select({
      userId: collectionsTable.userId,
      cardId: cardsTable.id,
      rarity: cardsTable.rarity,
      worthValue: cardsTable.worthValue,
      count: collectionsTable.count,
      shinyCount: collectionsTable.shinyCount,
    })
      .from(collectionsTable)
      .innerJoin(cardsTable, eq(collectionsTable.cardId, cardsTable.id))
      .where(eq(collectionsTable.guildId, guildId)),
    getRarityContext(guildId),
  ]);

  const byUser = new Map<string, { userId: string; uniqueCards: number; totalCards: number; shinyCards: number; netWorth: number }>();
  for (const row of heldRows) {
    const custom = ctx.customByCard.get(row.cardId);
    const worth = custom ? custom.worthValue : ctx.profile.get(row.rarity)?.worthValue ?? row.worthValue;
    let entry = byUser.get(row.userId);
    if (!entry) {
      entry = { userId: row.userId, uniqueCards: 0, totalCards: 0, shinyCards: 0, netWorth: 0 };
      byUser.set(row.userId, entry);
    }
    entry.uniqueCards += 1;
    entry.totalCards += row.count + row.shinyCount;
    entry.shinyCards += row.shinyCount;
    entry.netWorth += (row.count + row.shinyCount * SHINY_MULTIPLIER) * worth;
  }
  const rows = [...byUser.values()]
    .sort((a, b) => b.netWorth - a.netWorth)
    .slice(0, 25);

  // Enrich with Discord display names (best-effort; falls back to ID).
  const client = getBotClient();
  const guild = client?.guilds.cache.get(guildId);
  const names = new Map<string, string>();
  if (guild) {
    await Promise.all(rows.map(async (r) => {
      try {
        const member = guild.members.cache.get(r.userId) ?? await guild.members.fetch(r.userId);
        names.set(r.userId, member.displayName ?? member.user.username);
      } catch { /* user left guild or fetch failed — keep ID */ }
    }));
  }

  res.json({
    guildId,
    entries: rows.map((r, i) => ({
      rank: i + 1,
      userId: r.userId,
      username: names.get(r.userId) ?? null,
      uniqueCards: r.uniqueCards,
      totalCards: r.totalCards,
      shinyCards: r.shinyCards,
      netWorth: r.netWorth,
    })),
  });
});

// ── User profile (collection + currency + achievements + rank) ────────────────
router.get("/guilds/:guildId/users/:userId", async (req, res) => {
  const params = parseParams(guildUserParams, req, res);
  if (!params) return;
  const { guildId, userId } = params;

  const [rawCollectionRows, [currency], unlockedRows, runtime, profileDisplayMap] = await Promise.all([
    db.select({
      id: cardsTable.id,
      cardId: cardsTable.id,
      name: cardsTable.name,
      rarity: cardsTable.rarity,
      cardType: cardsTable.cardType,
      imageUrl: cardsTable.imageUrl,
      worthValue: cardsTable.worthValue,
      burnValue: cardsTable.burnValue,
      dropWeight: cardsTable.dropWeight,
      count: collectionsTable.count,
      shinyCount: collectionsTable.shinyCount,
      firstCaughtAt: collectionsTable.firstCaughtAt,
    })
      .from(collectionsTable)
      .innerJoin(cardsTable, eq(collectionsTable.cardId, cardsTable.id))
      .where(and(eq(collectionsTable.guildId, guildId), eq(collectionsTable.userId, userId))),
    db.select().from(userCurrencyTable)
      .where(and(eq(userCurrencyTable.guildId, guildId), eq(userCurrencyTable.userId, userId))),
    db.select().from(achievementsTable)
      .where(and(eq(achievementsTable.guildId, guildId), eq(achievementsTable.userId, userId))),
    getGuildDropChanceRuntime(guildId),
    db.select({ rarity: rarityDisplayOverridesTable.rarity, displayName: rarityDisplayOverridesTable.displayName, emoji: rarityDisplayOverridesTable.emoji, color: rarityDisplayOverridesTable.color })
      .from(rarityDisplayOverridesTable)
      .where(eq(rarityDisplayOverridesTable.guildId, guildId)),
  ]);

  const displayMap = new Map(profileDisplayMap.map(r => [r.rarity, { displayName: r.displayName, emoji: r.emoji, color: r.color }]));
  const collectionRows = rawCollectionRows.map(row => {
    const custom = runtime.ctx.customByCard.get(row.cardId);
    const profile = runtime.ctx.profile.get(row.rarity);
    const worthValue = custom ? custom.worthValue : profile?.worthValue ?? row.worthValue;
    const burnValue = custom ? custom.burnValue : profile?.burnValue ?? row.burnValue;
    const tier = getCardDisplayRarity(row, runtime.ctx, runtime.settings, displayMap);
    return {
      ...row,
      worthValue,
      burnValue,
      effectiveRarity: tier.key,
      effectiveRarityLabel: tier.label,
    };
  }).sort((a, b) => b.worthValue - a.worthValue);

  const unlockedKeys = new Set(unlockedRows.map(r => r.achievementKey));
  const unique = collectionRows.length;
  // Total = normal + shiny copies; net worth counts shinies at SHINY_MULTIPLIER.
  const total = collectionRows.reduce((s, r) => s + r.count + r.shinyCount, 0);
  const shinyTotal = collectionRows.reduce((s, r) => s + r.shinyCount, 0);
  const netWorth = collectionRows.reduce(
    (s, r) => s + (r.count + r.shinyCount * SHINY_MULTIPLIER) * r.worthValue,
    0,
  );
  const rank = getCollectorRank(unique);
  const next = getNextRank(unique);

  res.json({
    guildId,
    userId,
    stats: {
      uniqueCards: unique,
      totalCards: total,
      shinyCards: shinyTotal,
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
      cardsHeld: sql<number>`coalesce(sum(${collectionsTable.count} + ${collectionsTable.shinyCount})::int, 0)`,
      shinyCards: sql<number>`coalesce(sum(${collectionsTable.shinyCount})::int, 0)`,
    }).from(collectionsTable).where(eq(collectionsTable.guildId, guildId)),
    db.select({ total: sql<number>`count(*)::int` }).from(cardsTable).where(eq(cardsTable.isArchived, false)),
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
    shinyCards: collectorRow[0]?.shinyCards ?? 0,
    rosterSize: cardsRow[0]?.total ?? 0,
    packsOpened: burnRow[0]?.packs ?? 0,
    cardsBurned: burnRow[0]?.burns ?? 0,
    totalShardsEarned: burnRow[0]?.shards ?? 0,
  });
});

export default router;
