// Card leveling engine. Cards gain XP from battles; XP maps to a level, and
// levels unlock cosmetic frames (see frames.ts). Cosmetic-only — no stat impact.

import { db, cardProgressTable } from "@workspace/db";
import type { CardProgress } from "@workspace/db";
import type { Rarity } from "../cards-data.js";
import { and, eq } from "drizzle-orm";
import { logger } from "../../lib/logger.js";
import { framesForRarity, type Frame } from "./frames.js";

export const MAX_LEVEL = 20;

// Star rating (1–5) derived from level. A card hits a new star at each of these
// level milestones — so a fully-maxed (Lv 20) card is 5 stars. Used as the
// prestige gate for co-op boss raids.
export const STAR_LEVELS = [1, 5, 10, 15, 20] as const;
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
    const newXp = oldXp + gained;
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

    const newlyUnlocked = newLevel > oldLevel
      ? framesForRarity(rarity).filter(f => f.unlockLevel > oldLevel && f.unlockLevel <= newLevel)
      : [];
    return { leveledUp: newLevel > oldLevel, oldLevel, newLevel, newlyUnlocked };
  } catch (err) {
    logger.warn({ err, guildId, userId, cardId }, "grantCardBattleXp failed (non-fatal)");
    return null;
  }
}
