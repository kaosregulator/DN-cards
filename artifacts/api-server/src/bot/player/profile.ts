// ─────────────────────────────────────────────────────────────────────────────
// DN Cards — PlayerProfile aggregator (READ half of the source of truth)
//
// Composes the EXISTING per-system tables into one unified view for the User
// Hub. It reads through the systems' own accessors/tables — it never owns or
// duplicates their data. Every domain read is isolated so one failing subsystem
// degrades to a safe default instead of breaking the whole profile.
//
// Paired with `xp.ts`, which owns the additive account-level XP writes.
// ─────────────────────────────────────────────────────────────────────────────

import {
  db, collectionsTable, userReputationTable, dailyClaimsTable,
  playerProgressionTable, type XpSource,
} from "@workspace/db";
import { and, eq, sql } from "drizzle-orm";
import { logger } from "../../lib/logger.js";
import { getOrCreateCurrency } from "../db.js";
import { getOrCreateProfile } from "../battle/db.js";
import { getUnlockedKeys } from "../achievements.js";
import { getQuestView } from "../quests/engine.js";
import {
  accountLevelFromXp, accountLevelProgress, ACCOUNT_MAX_LEVEL,
} from "./xp.js";

export interface PlayerProfile {
  guildId: string;
  userId: string;
  account: {
    xp: number;
    level: number;
    into: number;        // XP into the current level
    needed: number;      // XP needed for the next level (0 at max)
    maxLevel: number;
    isMax: boolean;
    xpBySource: Partial<Record<XpSource, number>>;
  };
  economy: { shards: number; totalEarned: number };
  collection: { unique: number; total: number };
  battles: {
    wins: number; losses: number; total: number;
    level: number; xp: number; rankPoints: number; currentStreak: number;
  };
  reputation: { rep: number };
  daily: { streak: number; lastClaimedAt: Date | null };
  quests: { dailyDone: number; dailyTotal: number; weeklyDone: number; weeklyTotal: number };
  achievements: { unlocked: number };
}

// Read each domain independently; a thrown subsystem yields its default block.
async function safe<T>(label: string, fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    logger.debug({ err, label }, "PlayerProfile sub-read failed (using fallback)");
    return fallback;
  }
}

export async function getPlayerProfile(guildId: string, userId: string): Promise<PlayerProfile> {
  const [account, economy, collection, battles, reputation, daily, quests, achievements] = await Promise.all([
    safe("account", async () => {
      const [row] = await db.select().from(playerProgressionTable)
        .where(and(eq(playerProgressionTable.guildId, guildId), eq(playerProgressionTable.userId, userId)))
        .limit(1);
      const xp = row?.xp ?? 0;
      const level = row?.level ?? accountLevelFromXp(xp);
      const { into, needed } = accountLevelProgress(xp, level);
      return {
        xp, level, into, needed,
        maxLevel: ACCOUNT_MAX_LEVEL,
        isMax: level >= ACCOUNT_MAX_LEVEL,
        xpBySource: (row?.xpBySource as Partial<Record<XpSource, number>>) ?? {},
      };
    }, {
      xp: 0, level: 1, into: 0, needed: 200, maxLevel: ACCOUNT_MAX_LEVEL, isMax: false,
      xpBySource: {} as Partial<Record<XpSource, number>>,
    }),

    safe("economy", async () => {
      const c = await getOrCreateCurrency(guildId, userId);
      return { shards: c?.shards ?? 0, totalEarned: c?.totalEarned ?? 0 };
    }, { shards: 0, totalEarned: 0 }),

    safe("collection", async () => {
      const [row] = await db.select({
        unique: sql<number>`count(*)::int`,
        total: sql<number>`coalesce(sum(${collectionsTable.count} + ${collectionsTable.shinyCount}), 0)::int`,
      }).from(collectionsTable)
        .where(and(
          eq(collectionsTable.guildId, guildId),
          eq(collectionsTable.userId, userId),
          sql`(${collectionsTable.count} + ${collectionsTable.shinyCount}) > 0`,
        ));
      return { unique: row?.unique ?? 0, total: row?.total ?? 0 };
    }, { unique: 0, total: 0 }),

    safe("battles", async () => {
      const p = await getOrCreateProfile(guildId, userId);
      return {
        wins: p.wins, losses: p.losses, total: p.totalBattles,
        level: p.level, xp: p.xp, rankPoints: p.rankPoints, currentStreak: p.currentStreak,
      };
    }, { wins: 0, losses: 0, total: 0, level: 1, xp: 0, rankPoints: 1000, currentStreak: 0 }),

    safe("reputation", async () => {
      const [row] = await db.select().from(userReputationTable)
        .where(and(eq(userReputationTable.guildId, guildId), eq(userReputationTable.userId, userId)))
        .limit(1);
      return { rep: row?.rep ?? 0 };
    }, { rep: 0 }),

    safe<{ streak: number; lastClaimedAt: Date | null }>("daily", async () => {
      const [row] = await db.select().from(dailyClaimsTable)
        .where(and(eq(dailyClaimsTable.guildId, guildId), eq(dailyClaimsTable.userId, userId)))
        .limit(1);
      return { streak: row?.streak ?? 0, lastClaimedAt: row?.lastClaimedAt ?? null };
    }, { streak: 0, lastClaimedAt: null }),

    safe("quests", async () => {
      const v = await getQuestView(guildId, userId);
      const done = (qs: { done: boolean }[]) => qs.filter(q => q.done).length;
      return {
        dailyDone: done(v.daily.quests), dailyTotal: v.daily.quests.length,
        weeklyDone: done(v.weekly.quests), weeklyTotal: v.weekly.quests.length,
      };
    }, { dailyDone: 0, dailyTotal: 0, weeklyDone: 0, weeklyTotal: 0 }),

    safe("achievements", async () => {
      const keys = await getUnlockedKeys(guildId, userId);
      return { unlocked: keys.size };
    }, { unlocked: 0 }),
  ]);

  return { guildId, userId, account, economy, collection, battles, reputation, daily, quests, achievements };
}
