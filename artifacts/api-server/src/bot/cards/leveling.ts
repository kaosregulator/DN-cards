// Card leveling engine. Cards gain XP from battles; XP maps to a level, and
// levels unlock cosmetic frames (see frames.ts). Cosmetic-only — no stat impact.

import { db, cardProgressTable } from "@workspace/db";
import type { CardProgress } from "@workspace/db";
import type { Rarity } from "../cards-data.js";
import { and, eq } from "drizzle-orm";
import { logger } from "../../lib/logger.js";
import { framesForRarity, type Frame } from "./frames.js";

// Cards now level to 100. Level scales BATTLE STATS (see stat-engine
// get_scaled_stats) — a maxed Lv 100 card is at full strength — and unlocks
// cosmetic frames spread evenly across the ladder. Leveling is a real grind
// with a real payoff, not cosmetic-only.
export const MAX_LEVEL = 100;

// Star rating (1–5) derived from level, spread evenly across the 1–100 ladder
// so a fully-maxed (Lv 100) card is 5 stars. Used as the prestige gate for
// co-op boss raids (their 1–5⭐ system is unchanged).
export const STAR_LEVELS = [1, 25, 50, 75, 100] as const;
export const MAX_STARS = STAR_LEVELS.length;

export function starsForLevel(level: number): number {
  let stars = 0;
  for (const threshold of STAR_LEVELS) if (level >= threshold) stars++;
  return stars;
}

// Level needed to reach a given star count (for "needs N stars" messaging).
export function levelForStars(stars: number): number {
  const idx = Math.max(1, Math.min(MAX_STARS, stars)) - 1;
  return STAR_LEVELS[idx];
}

export function starString(stars: number): string {
  return "★".repeat(stars) + "☆".repeat(Math.max(0, MAX_STARS - stars));
}

// Battle XP awards.
const XP_WIN = 120;
const XP_DRAW = 60;
const XP_LOSS = 45;

// XP required to advance FROM `level` to `level + 1`. Gently increasing curve.
export function xpToNext(level: number): number {
  if (level >= MAX_LEVEL) return Infinity;
  return 100 + (level - 1) * 40;
}

// Total cumulative XP required to be AT `level` (level 1 = 0 XP).
function totalXpForLevel(level: number): number {
  let sum = 0;
  for (let l = 1; l < level; l++) sum += xpToNext(l);
  return sum;
}

// Public alias — cumulative XP to reach `level` (used by scrap→XP + overflow).
export function xpForLevel(level: number): number { return totalXpForLevel(level); }

// Derive level from total accumulated XP.
export function levelFromXp(totalXp: number): number {
  let level = 1;
  while (level < MAX_LEVEL && totalXp >= totalXpForLevel(level + 1)) level++;
  return level;
}

// Progress within the current level, for a progress bar.
export function levelProgress(totalXp: number, level: number): { into: number; needed: number } {
  if (level >= MAX_LEVEL) return { into: 0, needed: 0 };
  const base = totalXpForLevel(level);
  return { into: totalXp - base, needed: xpToNext(level) };
}

// ── Data access ──────────────────────────────────────────────────────────────
export async function getCardProgress(
  guildId: string, userId: string, cardId: number,
): Promise<CardProgress | null> {
  const [row] = await db.select().from(cardProgressTable)
    .where(and(
      eq(cardProgressTable.guildId, guildId),
      eq(cardProgressTable.userId, userId),
      eq(cardProgressTable.cardId, cardId),
    )).limit(1);
  return row ?? null;
}

// Batch progress (star + level + xp) for a user's cards, for hub/collection
// canvases. Missing rows are simply absent (caller defaults to star 0 / Lv 1).
export async function getCardProgressBatch(
  guildId: string, userId: string,
): Promise<Map<number, { starRank: number; level: number; xp: number }>> {
  const rows = await db.select({
    cardId: cardProgressTable.cardId,
    starRank: cardProgressTable.starRank,
    level: cardProgressTable.level,
    xp: cardProgressTable.xp,
  }).from(cardProgressTable)
    .where(and(eq(cardProgressTable.guildId, guildId), eq(cardProgressTable.userId, userId)));
  const map = new Map<number, { starRank: number; level: number; xp: number }>();
  for (const r of rows) map.set(r.cardId, { starRank: r.starRank ?? 0, level: r.level ?? 1, xp: r.xp ?? 0 });
  return map;
}

// Admin: force a card to a specific level (jump/fix a user). Clamps to
// [1, MAX_LEVEL] and syncs xp to that level's cumulative total so the card's
// progress bar and stars line up. Used by the /edituser Battle Profile view.
export async function setCardLevel(
  guildId: string, userId: string, cardId: number, level: number,
): Promise<{ level: number; xp: number }> {
  const lvl = Math.max(1, Math.min(MAX_LEVEL, Math.round(level) || 1));
  const xp = totalXpForLevel(lvl);
  await db.insert(cardProgressTable)
    .values({ guildId, userId, cardId, level: lvl, xp })
    .onConflictDoUpdate({
      target: [cardProgressTable.guildId, cardProgressTable.userId, cardProgressTable.cardId],
      set: { level: lvl, xp, updatedAt: new Date() },
    });
  return { level: lvl, xp };
}

export async function setEquippedFrame(
  guildId: string, userId: string, cardId: number, frameId: string | null,
): Promise<void> {
  await db.insert(cardProgressTable)
    .values({ guildId, userId, cardId, equippedFrame: frameId })
    .onConflictDoUpdate({
      target: [cardProgressTable.guildId, cardProgressTable.userId, cardProgressTable.cardId],
      set: { equippedFrame: frameId, updatedAt: new Date() },
    });
}

export interface XpGrant {
  leveledUp: boolean;
  oldLevel: number;
  newLevel: number;
  newlyUnlocked: Frame[];   // frames unlocked by this level-up (for the rarity)
}

// Award battle XP to a card. Best-effort; callers ignore failures.
export async function grantCardBattleXp(
  guildId: string, userId: string, cardId: number, rarity: Rarity, outcome: "win" | "loss" | "draw",
  bonusXp = 0,
): Promise<XpGrant | null> {
  try {
    const gained = (outcome === "win" ? XP_WIN : outcome === "draw" ? XP_DRAW : XP_LOSS) + Math.max(0, bonusXp);
    const existing = await getCardProgress(guildId, userId, cardId);
    const oldXp = existing?.xp ?? 0;
    const oldLevel = existing?.level ?? 1;
    // Cap stored XP at Lv100; XP that would overshoot becomes Scrap (a currency
    // used only to level OTHER cards — see cards/stars.ts spendScrapForXp). So a
    // maxed card keeps earning value from battles instead of dead XP.
    const cap = totalXpForLevel(MAX_LEVEL);
    const rawXp = oldXp + gained;
    const newXp = Math.min(rawXp, cap);
    const overflow = Math.max(0, rawXp - cap);
    const newLevel = levelFromXp(newXp);

    await db.insert(cardProgressTable)
      .values({
        guildId, userId, cardId,
        xp: newXp, level: newLevel,
        battlesFought: 1, battlesWon: outcome === "win" ? 1 : 0,
      })
      .onConflictDoUpdate({
        target: [cardProgressTable.guildId, cardProgressTable.userId, cardProgressTable.cardId],
        set: {
          xp: newXp,
          level: newLevel,
          battlesFought: (existing?.battlesFought ?? 0) + 1,
          battlesWon: (existing?.battlesWon ?? 0) + (outcome === "win" ? 1 : 0),
          updatedAt: new Date(),
        },
      });

    if (overflow > 0) {
      try {
        const { getOrCreateGuildSettings, addScrap } = await import("../db.js");
        const s = await getOrCreateGuildSettings(guildId);
        const rate = Math.max(0, (s as { xpOverflowScrapRate?: number }).xpOverflowScrapRate ?? 100) / 100;
        const scrap = Math.floor(overflow * rate);
        if (scrap > 0) await addScrap(guildId, userId, scrap);
      } catch { /* non-fatal */ }
    }

    const newlyUnlocked = newLevel > oldLevel
      ? framesForRarity(rarity).filter(f => f.unlockLevel > oldLevel && f.unlockLevel <= newLevel)
      : [];
    return { leveledUp: newLevel > oldLevel, oldLevel, newLevel, newlyUnlocked };
  } catch (err) {
    logger.warn({ err, guildId, userId, cardId }, "grantCardBattleXp failed (non-fatal)");
    return null;
  }
}
