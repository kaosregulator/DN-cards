// ─────────────────────────────────────────────────────────────────────────────
// DN Cards — Unified Player XP (account-level progression writer)
//
// This is the WRITE half of the PlayerProfile source-of-truth. It owns the new
// account-wide XP/level (stored in `player_progression`) that every activity
// contributes to. It intentionally imports NOTHING from the individual game
// systems (catch/pack/battle/raid/…), so those systems can call `awardPlayerXp`
// without creating an import cycle with the aggregator in `profile.ts`.
//
// Design rules honoured here:
//   • Additive only — never touches card XP, battle XP, economy, etc.
//   • Best-effort — every award is wrapped so a progression failure can NEVER
//     break the gameplay action that triggered it.
//   • Balanced — per-source amounts live in one table (`XP`) so no single
//     activity can dominate account progression.
// ─────────────────────────────────────────────────────────────────────────────

import { db, playerProgressionTable, collectionsTable, type PlayerProgression, type XpSource } from "@workspace/db";
import { and, eq, sql } from "drizzle-orm";
import { logger } from "../../lib/logger.js";

export const ACCOUNT_MAX_LEVEL = 100;

// Account XP curve. Deliberately steeper than the per-card curve (many systems
// feed it) so account levels stay meaningful. Level 1→2 costs 200, growing by
// 120 per level.
export function accountXpToNext(level: number): number {
  if (level >= ACCOUNT_MAX_LEVEL) return Infinity;
  return 200 + (level - 1) * 120;
}

function totalXpForLevel(level: number): number {
  let sum = 0;
  for (let l = 1; l < level; l++) sum += accountXpToNext(l);
  return sum;
}

export function accountLevelFromXp(totalXp: number): number {
  let level = 1;
  while (level < ACCOUNT_MAX_LEVEL && totalXp >= totalXpForLevel(level + 1)) level++;
  return level;
}

export function accountLevelProgress(totalXp: number, level: number): { into: number; needed: number } {
  if (level >= ACCOUNT_MAX_LEVEL) return { into: 0, needed: 0 };
  const base = totalXpForLevel(level);
  return { into: totalXp - base, needed: accountXpToNext(level) };
}

// ── Balanced per-source XP amounts ───────────────────────────────────────────
// One knob per activity. Tuned so casual play across systems out-earns grinding
// any single one: high-effort/rare events (achievements, collection milestones,
// raid clears) pay the most; spammy events (catch) pay the least.
export const XP = {
  catch: 5,
  pack: 15,           // per pack opened (not per card)
  battleWin: 40,
  battleLoss: 15,
  raidClear: 60,
  raidParticipate: 20,
  trade: 20,          // per completed trade, each side
  economy: 10,        // per market sale/purchase
  daily: 25,          // per daily claim
  quest: 30,          // per quest completed
  achievement: 50,    // per achievement unlocked
  reputation: 10,     // per reputation point received
  collectionMilestone: 100, // per milestone tier crossed
} as const;

// Collection-size milestones (unique cards owned). Crossing a tier grants
// `XP.collectionMilestone` once. Stored high-water mark on the row prevents
// re-awarding.
export const COLLECTION_MILESTONES = [10, 25, 50, 100, 200, 350, 500, 750, 1000] as const;

export interface XpAward {
  source: XpSource;
  amount: number;
  previousLevel: number;
  newLevel: number;
  leveledUp: boolean;
  totalXp: number;
}

async function ensureRow(guildId: string, userId: string): Promise<void> {
  await db.insert(playerProgressionTable)
    .values({ guildId, userId })
    .onConflictDoNothing();
}

// Core award. Atomically increments total XP and the per-source breakdown, then
// reconciles the stored level. Returns null (never throws) on any failure.
export async function awardPlayerXp(
  guildId: string,
  userId: string,
  source: XpSource,
  amount: number,
): Promise<XpAward | null> {
  if (!guildId || !userId || amount <= 0) return null;
  try {
    await ensureRow(guildId, userId);
    // Atomic bump of total XP + per-source counter (jsonb). Concurrency-safe for
    // the total, which is what drives the level.
    const [row] = await db.update(playerProgressionTable)
      .set({
        xp: sql`${playerProgressionTable.xp} + ${amount}`,
        xpBySource: sql`jsonb_set(
          coalesce(${playerProgressionTable.xpBySource}, '{}'::jsonb),
          array[${source}],
          to_jsonb(coalesce((${playerProgressionTable.xpBySource} ->> ${source})::int, 0) + ${amount})
        )`,
        updatedAt: new Date(),
      })
      .where(and(eq(playerProgressionTable.guildId, guildId), eq(playerProgressionTable.userId, userId)))
      .returning();
    if (!row) return null;

    const previousLevel = row.level;
    const newLevel = accountLevelFromXp(row.xp);
    if (newLevel !== previousLevel) {
      await db.update(playerProgressionTable)
        .set({ level: newLevel })
        .where(and(eq(playerProgressionTable.guildId, guildId), eq(playerProgressionTable.userId, userId)));
    }
    return {
      source, amount, previousLevel, newLevel,
      leveledUp: newLevel > previousLevel,
      totalXp: row.xp,
    };
  } catch (err) {
    logger.debug({ err, guildId, userId, source, amount }, "awardPlayerXp failed (non-fatal)");
    return null;
  }
}

// Collection-milestone award. Given the player's current unique-card count,
// grants milestone XP for every newly-crossed tier exactly once by advancing the
// stored high-water mark. Best-effort; returns total XP granted (0 if none).
export async function awardCollectionMilestones(
  guildId: string,
  userId: string,
  uniqueCards: number,
): Promise<number> {
  if (!guildId || !userId || uniqueCards <= 0) return 0;
  try {
    await ensureRow(guildId, userId);
    const [row] = await db.select().from(playerProgressionTable)
      .where(and(eq(playerProgressionTable.guildId, guildId), eq(playerProgressionTable.userId, userId)))
      .limit(1);
    if (!row) return 0;
    const already = row.collectionMilestone;
    // Highest milestone tier the player now qualifies for.
    const reached = COLLECTION_MILESTONES.filter(m => uniqueCards >= m).length;
    if (reached <= already) return 0;
    const tiersGained = reached - already;
    // Advance the high-water mark first (idempotency), then award the XP.
    const [claimed] = await db.update(playerProgressionTable)
      .set({ collectionMilestone: reached, updatedAt: new Date() })
      .where(and(
        eq(playerProgressionTable.guildId, guildId),
        eq(playerProgressionTable.userId, userId),
        eq(playerProgressionTable.collectionMilestone, already), // guard against concurrent advance
      ))
      .returning();
    if (!claimed) return 0; // someone else advanced it — they awarded the XP
    const total = tiersGained * XP.collectionMilestone;
    await awardPlayerXp(guildId, userId, "collection", total);
    return total;
  } catch (err) {
    logger.debug({ err, guildId, userId }, "awardCollectionMilestones failed (non-fatal)");
    return 0;
  }
}

// Convenience wrapper: look up the player's current unique-card count and award
// any newly-crossed collection milestones. Best-effort.
export async function awardCollectionMilestoneXp(guildId: string, userId: string): Promise<number> {
  try {
    const [row] = await db.select({ unique: sql<number>`count(*)::int` })
      .from(collectionsTable)
      .where(and(
        eq(collectionsTable.guildId, guildId),
        eq(collectionsTable.userId, userId),
        sql`(${collectionsTable.count} + ${collectionsTable.shinyCount}) > 0`,
      ));
    return await awardCollectionMilestones(guildId, userId, row?.unique ?? 0);
  } catch (err) {
    logger.debug({ err, guildId, userId }, "awardCollectionMilestoneXp failed (non-fatal)");
    return 0;
  }
}

export type { PlayerProgression };
