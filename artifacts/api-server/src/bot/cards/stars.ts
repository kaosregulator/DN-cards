// ─────────────────────────────────────────────────────────────────────────────
// DN Cards — Star Rank (Card Recycle progression)
//
// ADDITIVE single property (`card_progress.star_rank`) on an owned card. It is
// SEPARATE from rarity and from the level→frame stars, and it does NOT change
// how collections count owned copies — the existing inventory stays the source
// of truth.
//
// Card Recycle consumes duplicate copies from the player's existing collection
// (collections.count, via the normal removeCardFromUser path) to raise the
// selected card's Star Rank by one, up to MAX_STAR. Rarity is never changed.
// Every existing card defaults to 0★, fully compatible.
// ─────────────────────────────────────────────────────────────────────────────

import { db, cardProgressTable, collectionsTable } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { removeCardFromUser } from "../db.js";
import { logger } from "../../lib/logger.js";

export const MAX_STAR = 5;
// Duplicate copies consumed to advance FROM star `n` to `n+1`. Scales so higher
// stars are a meaningful long-term investment: 5 → 10 → 15 → 20 → 25 (75 total).
export function recycleCost(fromStar: number): number {
  return 5 * (fromStar + 1);
}

// Compact "★★★☆☆" string for a star rank.
export function starRankString(star: number): string {
  const s = Math.max(0, Math.min(MAX_STAR, star));
  return "★".repeat(s) + "☆".repeat(MAX_STAR - s);
}

// Battle stat multiplier from star rank. +8% per star (5★ = +40%) — a meaningful
// long-term investment that stays within balance. Applied on top of level/config.
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

// Batch star ranks for a set of cards (collection/search display). Missing =0.
export async function getStarRanks(guildId: string, userId: string): Promise<Map<number, number>> {
  const rows = await db.select({ cardId: cardProgressTable.cardId, starRank: cardProgressTable.starRank })
    .from(cardProgressTable)
    .where(and(eq(cardProgressTable.guildId, guildId), eq(cardProgressTable.userId, userId)));
  const map = new Map<number, number>();
  for (const r of rows) if (r.starRank > 0) map.set(r.cardId, r.starRank);
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

export interface RecycleQuote {
  star: number;         // current star rank
  atMax: boolean;
  cost: number;         // duplicates needed for the next star
  // Duplicates available to spend = normal copies beyond the one kept as the card itself.
  spendable: number;
  canRecycle: boolean;
}

// How much it costs / whether the player can recycle the card once more. One
// normal copy is always preserved as "the card"; only extras are recyclable.
export async function recycleQuote(guildId: string, userId: string, cardId: number): Promise<RecycleQuote> {
  const [star, copies] = await Promise.all([
    getStarRank(guildId, userId, cardId),
    baseCopies(guildId, userId, cardId),
  ]);
  const atMax = star >= MAX_STAR;
  const cost = recycleCost(star);
  const spendable = Math.max(0, copies - 1);
  return { star, atMax, cost, spendable, canRecycle: !atMax && spendable >= cost };
}

export type RecycleResult =
  | { ok: true; fromStar: number; toStar: number; consumed: number }
  | { ok: false; reason: "max_star" | "not_enough" | "error" };

export interface MergeAllSource {
  cardId: number;
  name: string;
  consumed: number;
  remaining: number;
}
export type MergeAllResult =
  | { ok: true; targetCardId: number; targetName: string; fromStar: number; toStar: number; consumed: number; sources: MergeAllSource[] }
  | { ok: false; reason: "no_duplicates" | "max_star" | "no_progress" | "error" };

// Consume `recycleCost(star)` duplicate copies from the existing collection and
// raise the card's Star Rank by one. Keeps one normal copy as the card itself.
export async function recycleCard(guildId: string, userId: string, cardId: number): Promise<RecycleResult> {
  try {
    const q = await recycleQuote(guildId, userId, cardId);
    if (q.atMax) return { ok: false, reason: "max_star" };
    if (!q.canRecycle) return { ok: false, reason: "not_enough" };
    let consumed = 0;
    for (let i = 0; i < q.cost; i++) {
      const res = await removeCardFromUser(guildId, userId, cardId);
      if (!res.success) break;
      consumed++;
    }
    if (consumed < q.cost) {
      logger.warn({ guildId, userId, cardId, consumed, cost: q.cost }, "recycle consumed fewer than cost");
      return { ok: false, reason: "not_enough" };
    }
    const toStar = q.star + 1;
    await setStarRank(guildId, userId, cardId, toStar);
    return { ok: true, fromStar: q.star, toStar, consumed };
  } catch (err) {
    logger.error({ err, guildId, userId, cardId }, "recycleCard failed");
    return { ok: false, reason: "error" };
  }
}

// Consume spendable duplicate copies from ALL eligible cards and funnel them into
// the user's highest-starred (then highest-count) card, leveling it as far as
// the available duplicates allow. Always preserves one copy of every card.
export async function mergeAllRecycle(guildId: string, userId: string): Promise<MergeAllResult> {
  try {
    const { getUserCollection } = await import("../db.js");
    const collection = await getUserCollection(guildId, userId);
    const stars = await getStarRanks(guildId, userId);
    const eligible = collection
      .filter(c => c.count > 1)
      .map(c => ({
        cardId: c.id,
        name: c.name,
        count: c.count,
        star: stars.get(c.id) ?? 0,
        spendable: c.count - 1,
      }));

    if (eligible.length === 0) return { ok: false, reason: "no_duplicates" };

    // Target: highest star, then highest count (so we always merge INTO the best card).
    eligible.sort((a, b) => b.star - a.star || b.count - a.count);
    const target = eligible[0]!;
    if (target.star >= MAX_STAR) return { ok: false, reason: "max_star" };

    // Simulate how many copies we can actually spend and how far that takes the target.
    let currentStar = target.star;
    let remainingSpendable = eligible.reduce((sum, c) => sum + c.spendable, 0);
    let neededForNext = recycleCost(currentStar);
    while (currentStar < MAX_STAR && remainingSpendable >= neededForNext) {
      remainingSpendable -= neededForNext;
      currentStar++;
      neededForNext = recycleCost(currentStar);
    }
    const toConsume = eligible.reduce((sum, c) => sum + c.spendable, 0) - remainingSpendable;
    if (toConsume === 0 || currentStar === target.star) return { ok: false, reason: "no_progress" };

    // Allocate consumption across sources. Sacrifice the weakest cards first,
    // then the target's own duplicates if still needed.
    const sources: MergeAllSource[] = [];
    let stillNeeded = toConsume;
    const nonTarget = eligible.slice(1).sort((a, b) => a.star - b.star || b.count - a.count);
    for (const c of nonTarget) {
      if (stillNeeded <= 0) break;
      const take = Math.min(c.spendable, stillNeeded);
      if (take > 0) {
        sources.push({ cardId: c.cardId, name: c.name, consumed: take, remaining: c.count - take });
        stillNeeded -= take;
      }
    }
    if (stillNeeded > 0) {
      const take = Math.min(target.spendable, stillNeeded);
      if (take > 0) {
        sources.push({ cardId: target.cardId, name: target.name, consumed: take, remaining: target.count - take });
        stillNeeded -= take;
      }
    }

    if (stillNeeded > 0) {
      // Math says we had enough, but something shifted; treat it as partial progress.
      logger.warn({ guildId, userId, targetCardId: target.cardId, stillNeeded }, "mergeAllRecycle shortfall after allocation");
    }

    // Persist the consumption.
    for (const s of sources) {
      for (let i = 0; i < s.consumed; i++) {
        const res = await removeCardFromUser(guildId, userId, s.cardId);
        if (!res.success) {
          logger.warn({ guildId, userId, cardId: s.cardId, i }, "mergeAllRecycle failed to consume a copy");
        }
      }
    }

    await setStarRank(guildId, userId, target.cardId, currentStar);
    return {
      ok: true,
      targetCardId: target.cardId,
      targetName: target.name,
      fromStar: target.star,
      toStar: currentStar,
      consumed: toConsume - stillNeeded,
      sources,
    };
  } catch (err) {
    logger.error({ err, guildId, userId }, "mergeAllRecycle failed");
    return { ok: false, reason: "error" };
  }
}
