// ─────────────────────────────────────────────────────────────────────────────
// DN Cards — Star Rank + Card Fusion economy
//
// Star Rank (`card_progress.star_rank`, 0..MAX_STAR) is the SINGLE progression
// axis for a card. It is separate from rarity and from the battle level/XP
// track (which lives in the same row but is driven only by battles). Battles
// read star_rank directly (see battle/stat-engine.ts `applyStarBonus`).
//
// Two player actions feed the loop:
//   • ♻️ Recycle  — consume spendable duplicate copies → earn Scrap.
//   • 🌟 Fuse     — spend duplicates + Scrap → raise the card's Star Rank by 1.
//
// Both are consumption-first with atomic conditional guards so double-clicks /
// concurrent interactions can never double-spend (see
// .agents/memory/economy-optimistic-lock.md).
// ─────────────────────────────────────────────────────────────────────────────

import { db, cardProgressTable, collectionsTable, userCurrencyTable } from "@workspace/db";
import type { GuildSettings } from "@workspace/db";
import { and, eq, sql } from "drizzle-orm";
import { getOrCreateGuildSettings, getOrCreateCurrency } from "../db.js";
import { logger } from "../../lib/logger.js";
import type { Rarity } from "../cards-data.js";

export const MAX_STAR = 5;

// Compact "★★★☆☆" string for a star rank.
export function starRankString(star: number): string {
  const s = Math.max(0, Math.min(MAX_STAR, star));
  return "★".repeat(s) + "☆".repeat(MAX_STAR - s);
}

// Battle stat multiplier from star rank. +8% per star (5★ = +40%). Battles use
// their own applyStarBonus; this is kept for previews/tooltips.
export function starStatMultiplier(star: number): number {
  return 1 + Math.max(0, Math.min(MAX_STAR, star)) * 0.08;
}

// Read the owned card's current Star Rank (0 if no progression row yet).
export async function getStarRank(guildId: string, userId: string, cardId: number): Promise<number> {
  const [row] = await db.select({ starRank: cardProgressTable.starRank }).from(cardProgressTable)
    .where(and(
      eq(cardProgressTable.guildId, guildId),
      eq(cardProgressTable.userId, userId),
      eq(cardProgressTable.cardId, cardId),
    )).limit(1);
  return row?.starRank ?? 0;
}

// Batch star ranks for a set of cards (collection/search display). Missing = 0.
export async function getStarRanks(guildId: string, userId: string): Promise<Map<number, number>> {
  const rows = await db.select({ cardId: cardProgressTable.cardId, starRank: cardProgressTable.starRank })
    .from(cardProgressTable)
    .where(and(eq(cardProgressTable.guildId, guildId), eq(cardProgressTable.userId, userId)));
  const map = new Map<number, number>();
  for (const r of rows) if (r.starRank > 0) map.set(r.cardId, r.starRank);
  return map;
}

// Batch star ranks (raw map incl. 0) for hub dropdowns.
export async function getStarRankMap(guildId: string, userId: string): Promise<Map<number, number>> {
  const rows = await db.select({ cardId: cardProgressTable.cardId, starRank: cardProgressTable.starRank })
    .from(cardProgressTable)
    .where(and(eq(cardProgressTable.guildId, guildId), eq(cardProgressTable.userId, userId)));
  const map = new Map<number, number>();
  for (const r of rows) map.set(r.cardId, r.starRank);
  return map;
}

async function baseCopies(guildId: string, userId: string, cardId: number): Promise<number> {
  const [row] = await db.select({ count: collectionsTable.count }).from(collectionsTable)
    .where(and(
      eq(collectionsTable.guildId, guildId),
      eq(collectionsTable.userId, userId),
      eq(collectionsTable.cardId, cardId),
    )).limit(1);
  return row?.count ?? 0;
}

async function setStarRank(guildId: string, userId: string, cardId: number, star: number): Promise<void> {
  await db.insert(cardProgressTable)
    .values({ guildId, userId, cardId, starRank: star })
    .onConflictDoUpdate({
      target: [cardProgressTable.guildId, cardProgressTable.userId, cardProgressTable.cardId],
      set: { starRank: star, updatedAt: new Date() },
    });
}

// ── Recycle / Fusion config ─────────────────────────────────────────────────
// Guild-level overrides. Defaults keep the bot-wide balance; admins can tune
// per rarity and apply global multipliers via /config.

const DEFAULT_SCRAP_VALUES: Record<Rarity, number> = {
  common: 5, uncommon: 15, rare: 40, epic: 100, legendary: 250, mythic: 500,
};

// Fusion base cost for the 0★→1★ step; higher steps scale ×(star+1).
// Duplicates are the scarce resource (fewer for higher rarities); Scrap does the
// heavy lifting for the top tiers — and Scrap is earned by recycling anything.
const DEFAULT_FUSE_DUPES: Record<Rarity, number> = {
  common: 3, uncommon: 3, rare: 2, epic: 2, legendary: 2, mythic: 1,
};
const DEFAULT_FUSE_SCRAP: Record<Rarity, number> = {
  common: 25, uncommon: 75, rare: 200, epic: 500, legendary: 1200, mythic: 3000,
};

const SCRAP_VALUE_KEY: Record<Rarity, keyof GuildSettings> = {
  common: "recycleScrapCommon", uncommon: "recycleScrapUncommon", rare: "recycleScrapRare",
  epic: "recycleScrapEpic", legendary: "recycleScrapLegendary", mythic: "recycleScrapMythic",
};
const FUSE_DUPES_KEY: Record<Rarity, keyof GuildSettings> = {
  common: "fuseDupesCommon", uncommon: "fuseDupesUncommon", rare: "fuseDupesRare",
  epic: "fuseDupesEpic", legendary: "fuseDupesLegendary", mythic: "fuseDupesMythic",
};
const FUSE_SCRAP_KEY: Record<Rarity, keyof GuildSettings> = {
  common: "fuseScrapCommon", uncommon: "fuseScrapUncommon", rare: "fuseScrapRare",
  epic: "fuseScrapEpic", legendary: "fuseScrapLegendary", mythic: "fuseScrapMythic",
};

export interface RecycleSettings {
  enabled: boolean;
  scrapMultiplier: number;            // Scrap EARNED per recycle (1.0 = 100%)
  scrapValues: Record<Rarity, number>;
  fuseCostMultiplier: number;         // Applied to fusion dupe + scrap cost (1.0 = 100%)
  fuseDupes: Record<Rarity, number>;  // Base duplicate cost (0★→1★)
  fuseScrap: Record<Rarity, number>;  // Base scrap cost (0★→1★)
}

function resolveTable(
  s: GuildSettings, keys: Record<Rarity, keyof GuildSettings>, defaults: Record<Rarity, number>,
): Record<Rarity, number> {
  const out: Record<Rarity, number> = { ...defaults };
  for (const r of Object.keys(keys) as Rarity[]) {
    const override = s[keys[r]] as number | null | undefined;
    if (override != null && override >= 0) out[r] = override;
  }
  return out;
}

export async function getRecycleSettings(guildId: string): Promise<RecycleSettings> {
  const s = await getOrCreateGuildSettings(guildId);
  return {
    enabled: s.recycleEnabled ?? true,
    scrapMultiplier: Math.max(0, (s.recycleScrapMultiplier ?? 100) / 100),
    scrapValues: resolveTable(s, SCRAP_VALUE_KEY, DEFAULT_SCRAP_VALUES),
    fuseCostMultiplier: Math.max(0, (s.fuseCostMultiplier ?? 100) / 100),
    fuseDupes: resolveTable(s, FUSE_DUPES_KEY, DEFAULT_FUSE_DUPES),
    fuseScrap: resolveTable(s, FUSE_SCRAP_KEY, DEFAULT_FUSE_SCRAP),
  };
}

// Scrap earned per duplicate copy recycled. Scales with rarity tier × log of MTT
// worth, then the guild multiplier / override applies.
export function scrapValueForCard(rarity: Rarity, worthValue: number, settings: RecycleSettings): number {
  const base = settings.scrapValues[rarity] ?? DEFAULT_SCRAP_VALUES[rarity] ?? 5;
  const multiplier = Math.log10(Math.max(10, worthValue) + 1);
  return Math.max(1, Math.round(base * multiplier * settings.scrapMultiplier));
}

// Duplicate copies needed to fuse FROM `star` to `star+1`. Scales ×(star+1).
export function fuseDupeCost(rarity: Rarity, star: number, settings: RecycleSettings): number {
  const base = settings.fuseDupes[rarity] ?? DEFAULT_FUSE_DUPES[rarity] ?? 2;
  return Math.max(1, Math.round(base * (star + 1) * settings.fuseCostMultiplier));
}

// Scrap needed to fuse FROM `star` to `star+1`. Scales ×(star+1).
export function fuseScrapCost(rarity: Rarity, star: number, settings: RecycleSettings): number {
  const base = settings.fuseScrap[rarity] ?? DEFAULT_FUSE_SCRAP[rarity] ?? 200;
  return Math.max(0, Math.round(base * (star + 1) * settings.fuseCostMultiplier));
}

// ── ♻️ Recycle: duplicates → Scrap ──────────────────────────────────────────

export type RecycleForScrapResult =
  | { ok: true; consumed: number; scrapEarned: number }
  | { ok: false; reason: "no_duplicates" | "error" };

// Converts ALL spendable dupes (count − 1) into Scrap. Consumption-first with an
// exact-match optimistic lock: count is set to 1 only if it still matches the
// reading; Scrap is awarded ONLY after the update confirms rows were affected.
export async function recycleForScrap(
  guildId: string, userId: string, cardId: number, rarity: Rarity, worthValue: number,
): Promise<RecycleForScrapResult> {
  try {
    const copies = await baseCopies(guildId, userId, cardId);
    const spendable = Math.max(0, copies - 1);
    if (spendable === 0) return { ok: false, reason: "no_duplicates" };

    const affected = await db.update(collectionsTable)
      .set({ count: 1 })
      .where(and(
        eq(collectionsTable.guildId, guildId),
        eq(collectionsTable.userId, userId),
        eq(collectionsTable.cardId, cardId),
        eq(collectionsTable.count, copies),   // exact-match optimistic lock
      ))
      .returning({ count: collectionsTable.count });
    if (affected.length === 0) return { ok: false, reason: "no_duplicates" };

    const settings = await getRecycleSettings(guildId);
    const scrapEarned = spendable * scrapValueForCard(rarity, worthValue, settings);
    const { addScrap } = await import("../db.js");
    await addScrap(guildId, userId, scrapEarned);
    return { ok: true, consumed: spendable, scrapEarned };
  } catch (err) {
    logger.error({ err, guildId, userId, cardId }, "recycleForScrap failed");
    return { ok: false, reason: "error" };
  }
}

// ── 🌟 Fuse: duplicates + Scrap → +1 Star ───────────────────────────────────

export interface FuseQuote {
  star: number;
  atMax: boolean;
  dupeCost: number;
  scrapCost: number;
  spendableDupes: number;   // owned copies beyond the one kept
  scrapBalance: number;
  canFuse: boolean;
  reason?: "max_star" | "insufficient_dupes" | "insufficient_scrap";
}

// What it costs / whether the player can fuse the card up one star right now.
// One normal copy is always preserved as "the card"; only extras are spendable.
export async function fuseStarQuote(
  guildId: string, userId: string, cardId: number, rarity: Rarity,
): Promise<FuseQuote> {
  const [star, copies, settings] = await Promise.all([
    getStarRank(guildId, userId, cardId),
    baseCopies(guildId, userId, cardId),
    getRecycleSettings(guildId),
  ]);
  const scrapBalance = await getScrapBalance(guildId, userId);
  const atMax = star >= MAX_STAR;
  const dupeCost = fuseDupeCost(rarity, star, settings);
  const scrapCost = fuseScrapCost(rarity, star, settings);
  const spendableDupes = Math.max(0, copies - 1);

  let reason: FuseQuote["reason"];
  if (atMax) reason = "max_star";
  else if (spendableDupes < dupeCost) reason = "insufficient_dupes";
  else if (scrapBalance < scrapCost) reason = "insufficient_scrap";

  return {
    star, atMax, dupeCost, scrapCost, spendableDupes, scrapBalance,
    canFuse: !reason, reason,
  };
}

async function getScrapBalance(guildId: string, userId: string): Promise<number> {
  const row = await getOrCreateCurrency(guildId, userId);
  return (row as Record<string, unknown>)["scrap"] as number ?? 0;
}

export type FuseStarResult =
  | { ok: true; fromStar: number; toStar: number; consumedDupes: number; scrapSpent: number }
  | { ok: false; reason: "max_star" | "insufficient_dupes" | "insufficient_scrap" | "error" };

// Atomic fuse: spend duplicates + Scrap to raise Star Rank by one.
// Consumption-first with conditional guards (WHERE count/scrap >= cost), so two
// concurrent interactions can never both succeed and over-spend. If the Scrap
// deduction fails after the dupe deduction, the dupes are credited back.
export async function fuseStar(
  guildId: string, userId: string, cardId: number, rarity: Rarity,
): Promise<FuseStarResult> {
  try {
    await getOrCreateCurrency(guildId, userId); // ensure a currency row exists
    const [star, settings] = await Promise.all([
      getStarRank(guildId, userId, cardId),
      getRecycleSettings(guildId),
    ]);
    if (star >= MAX_STAR) return { ok: false, reason: "max_star" };

    const dupeCost = fuseDupeCost(rarity, star, settings);
    const scrapCost = fuseScrapCost(rarity, star, settings);

    // Step 1: consume duplicates — keep at least one copy (count ≥ dupeCost + 1).
    const dupAffected = await db.update(collectionsTable)
      .set({ count: sql`${collectionsTable.count} - ${dupeCost}` })
      .where(and(
        eq(collectionsTable.guildId, guildId),
        eq(collectionsTable.userId, userId),
        eq(collectionsTable.cardId, cardId),
        sql`${collectionsTable.count} >= ${dupeCost + 1}`,
      ))
      .returning({ count: collectionsTable.count });
    if (dupAffected.length === 0) return { ok: false, reason: "insufficient_dupes" };

    // Step 2: consume Scrap — conditional on sufficient balance.
    if (scrapCost > 0) {
      const scrapAffected = await db.update(userCurrencyTable)
        .set({ scrap: sql`${userCurrencyTable.scrap} - ${scrapCost}`, updatedAt: new Date() })
        .where(and(
          eq(userCurrencyTable.guildId, guildId),
          eq(userCurrencyTable.userId, userId),
          sql`${userCurrencyTable.scrap} >= ${scrapCost}`,
        ))
        .returning({ scrap: userCurrencyTable.scrap });
      if (scrapAffected.length === 0) {
        // Compensate the duplicates we already consumed, then abort.
        await db.update(collectionsTable)
          .set({ count: sql`${collectionsTable.count} + ${dupeCost}` })
          .where(and(
            eq(collectionsTable.guildId, guildId),
            eq(collectionsTable.userId, userId),
            eq(collectionsTable.cardId, cardId),
          ));
        return { ok: false, reason: "insufficient_scrap" };
      }
    }

    // Step 3: both consumptions confirmed — raise the star.
    const toStar = star + 1;
    await setStarRank(guildId, userId, cardId, toStar);
    return { ok: true, fromStar: star, toStar, consumedDupes: dupeCost, scrapSpent: scrapCost };
  } catch (err) {
    logger.error({ err, guildId, userId, cardId }, "fuseStar failed");
    return { ok: false, reason: "error" };
  }
}
