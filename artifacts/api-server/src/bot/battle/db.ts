// Battle data-access layer.
//
// All battle-table reads/writes live here. It also reads (never writes) the
// existing card/collection tables to resolve a player's owned, battle-eligible
// cards — so the battle system plugs into the current ownership + rarity data
// without duplicating it.

import {
  db,
  cardsTable, collectionsTable, cardProgressTable,
  battleCardConfigTable, battleProfilesTable, battleRecordsTable,
  battleAchievementsTable, battleSeasonsTable, battleDailyChallengesTable,
  battleLocksTable,
} from "@workspace/db";
import type {
  BattleCardConfig, BattleProfile, BattleSeason, BattleRecord, BattleDailyChallenges,
} from "@workspace/db";
import { and, eq, sql, desc } from "drizzle-orm";
import type { Rarity } from "./types.js";
import { getRarityContext } from "../db.js";
import { effectiveRarityKey, getCardDisplayRarity, type RarityContext } from "../rarity-runtime.js";

// ── Owned, battle-eligible cards ─────────────────────────────────────────────
export interface OwnedBattleCard {
  id: number;
  name: string;
  rarity: Rarity;
  cardType: string;
  worthValue: number;
  imageUrl: string | null;
  owned: number;      // normal + shiny copies
  // The owner's level for THIS card (from card_progress, 1..100). Drives
  // level-based stat scaling via get_scaled_stats. Defaults to 1 for pools that
  // aren't tied to a specific owner (e.g. the AI card pool).
  level: number;
  config: BattleCardConfig | null;
  // Source-of-truth rarity context (Stage-1 profile + Stage-2 custom tiers).
  // `effectiveRarityKey` is the built-in rarity key or `custom:<slug>` for a
  // custom tier; `displayRarity` is the label/emoji to show in the picker.
  effectiveRarityKey?: string;
  displayRarity?: { label: string; emoji: string };
}

export async function getBattleCardConfigMap(guildId: string): Promise<Map<number, BattleCardConfig>> {
  const rows = await db.select().from(battleCardConfigTable)
    .where(eq(battleCardConfigTable.guildId, guildId));
  const map = new Map<number, BattleCardConfig>();
  for (const r of rows) map.set(r.cardId, r);
  return map;
}

// Every card a user owns in this guild, with its per-guild battle config
// attached (null if none). Pass the rarity context to surface Stage-1 profile
// + Stage-2 custom tiers as the source-of-truth rarity in the picker.
export async function getOwnedBattleCards(
  guildId: string, userId: string, ctx?: RarityContext,
): Promise<OwnedBattleCard[]> {
  const [rows, cfgMap] = await Promise.all([
    db.select({
      id: cardsTable.id,
      name: cardsTable.name,
      rarity: cardsTable.rarity,
      cardType: cardsTable.cardType,
      worthValue: cardsTable.worthValue,
      imageUrl: cardsTable.imageUrl,
      count: collectionsTable.count,
      shinyCount: collectionsTable.shinyCount,
      // Left-joined so a card the user has never battled still returns (level 1).
      level: cardProgressTable.level,
    })
      .from(collectionsTable)
      .innerJoin(cardsTable, eq(collectionsTable.cardId, cardsTable.id))
      .leftJoin(cardProgressTable, and(
        eq(cardProgressTable.guildId, collectionsTable.guildId),
        eq(cardProgressTable.userId, collectionsTable.userId),
        eq(cardProgressTable.cardId, collectionsTable.cardId),
      ))
      .where(and(
        eq(collectionsTable.guildId, guildId),
        eq(collectionsTable.userId, userId),
        sql`(${collectionsTable.count} + ${collectionsTable.shinyCount}) > 0`,
      )),
    getBattleCardConfigMap(guildId),
  ]);
  const rarityCtx = ctx ?? await getRarityContext(guildId);
  return rows.map(r => {
    const effectiveKey = effectiveRarityKey({ id: r.id, rarity: r.rarity }, rarityCtx);
    const display = getCardDisplayRarity({ id: r.id, rarity: r.rarity }, rarityCtx);
    return {
      id: r.id,
      name: r.name,
      rarity: r.rarity as Rarity,
      cardType: r.cardType,
      worthValue: r.worthValue,
      imageUrl: r.imageUrl,
      owned: r.count + r.shinyCount,
      level: r.level ?? 1,
      config: cfgMap.get(r.id) ?? null,
      effectiveRarityKey: effectiveKey,
      displayRarity: { label: display.label, emoji: display.emoji },
    };
  });
}

// The full pool of enabled cards in the guild (used by AI to pick from). Reads
// every card, not just owned ones. Pass the rarity context so the AI follows the
// same source-of-truth rarities as /rarity.
export async function getAllBattleCards(guildId: string, ctx?: RarityContext): Promise<OwnedBattleCard[]> {
  const [rows, cfgMap] = await Promise.all([
    db.select({
      id: cardsTable.id, name: cardsTable.name, rarity: cardsTable.rarity,
      cardType: cardsTable.cardType, worthValue: cardsTable.worthValue, imageUrl: cardsTable.imageUrl,
      isArchived: cardsTable.isArchived,
    }).from(cardsTable),
    getBattleCardConfigMap(guildId),
  ]);
  const rarityCtx = ctx ?? await getRarityContext(guildId);
  return rows.filter(r => !r.isArchived).map(r => {
    const effectiveKey = effectiveRarityKey({ id: r.id, rarity: r.rarity }, rarityCtx);
    const display = getCardDisplayRarity({ id: r.id, rarity: r.rarity }, rarityCtx);
    return {
      id: r.id, name: r.name, rarity: r.rarity as Rarity, cardType: r.cardType,
      worthValue: r.worthValue, imageUrl: r.imageUrl, owned: 0, level: 1, config: cfgMap.get(r.id) ?? null,
      effectiveRarityKey: effectiveKey,
      displayRarity: { label: display.label, emoji: display.emoji },
    };
  });
}

export async function getBattleCardConfig(guildId: string, cardId: number): Promise<BattleCardConfig | null> {
  const [row] = await db.select().from(battleCardConfigTable)
    .where(and(eq(battleCardConfigTable.guildId, guildId), eq(battleCardConfigTable.cardId, cardId))).limit(1);
  return row ?? null;
}

// Clear all battle overrides for a card (reset it to fully auto/derived).
export async function resetBattleCardConfig(guildId: string, cardId: number): Promise<void> {
  await db.delete(battleCardConfigTable)
    .where(and(eq(battleCardConfigTable.guildId, guildId), eq(battleCardConfigTable.cardId, cardId)));
}

export async function upsertBattleCardConfig(
  guildId: string, cardId: number, patch: Partial<BattleCardConfig>, updatedBy?: string,
): Promise<void> {
  await db.insert(battleCardConfigTable)
    .values({ guildId, cardId, ...patch, updatedAt: new Date(), updatedBy: updatedBy ?? null })
    .onConflictDoUpdate({
      target: [battleCardConfigTable.guildId, battleCardConfigTable.cardId],
      set: { ...patch, updatedAt: new Date(), updatedBy: updatedBy ?? null },
    });
}

// ── Profiles ─────────────────────────────────────────────────────────────────
export async function getOrCreateProfile(guildId: string, userId: string): Promise<BattleProfile> {
  const [row] = await db.select().from(battleProfilesTable)
    .where(and(eq(battleProfilesTable.guildId, guildId), eq(battleProfilesTable.userId, userId))).limit(1);
  if (row) return row;
  const [created] = await db.insert(battleProfilesTable).values({ guildId, userId }).returning();
  return created!;
}

export async function updateProfile(
  guildId: string, userId: string, patch: Partial<BattleProfile>,
): Promise<void> {
  await getOrCreateProfile(guildId, userId);
  await db.update(battleProfilesTable)
    .set({ ...patch, updatedAt: new Date() })
    .where(and(eq(battleProfilesTable.guildId, guildId), eq(battleProfilesTable.userId, userId)));
}

// ── Records ──────────────────────────────────────────────────────────────────
export async function insertBattleRecord(
  rec: Omit<BattleRecord, "id" | "createdAt">,
): Promise<BattleRecord> {
  const [row] = await db.insert(battleRecordsTable).values(rec).returning();
  return row!;
}

export async function getRecentRecords(guildId: string, userId: string, limit = 5): Promise<BattleRecord[]> {
  return db.select().from(battleRecordsTable)
    .where(and(
      eq(battleRecordsTable.guildId, guildId),
      sql`(${battleRecordsTable.challengerId} = ${userId} OR ${battleRecordsTable.opponentId} = ${userId})`,
    ))
    .orderBy(desc(battleRecordsTable.createdAt))
    .limit(limit);
}

// ── Achievements ─────────────────────────────────────────────────────────────
export async function getUnlockedAchievementKeys(guildId: string, userId: string): Promise<Set<string>> {
  const rows = await db.select({ key: battleAchievementsTable.achievementKey })
    .from(battleAchievementsTable)
    .where(and(eq(battleAchievementsTable.guildId, guildId), eq(battleAchievementsTable.userId, userId)));
  return new Set(rows.map(r => r.key));
}

// Returns true if newly inserted (i.e. first unlock).
export async function unlockAchievement(guildId: string, userId: string, key: string): Promise<boolean> {
  const res = await db.insert(battleAchievementsTable)
    .values({ guildId, userId, achievementKey: key })
    .onConflictDoNothing()
    .returning({ id: battleAchievementsTable.id });
  return res.length > 0;
}

// ── Seasons ──────────────────────────────────────────────────────────────────
export async function getActiveSeason(guildId: string): Promise<BattleSeason | null> {
  const [row] = await db.select().from(battleSeasonsTable)
    .where(and(eq(battleSeasonsTable.guildId, guildId), eq(battleSeasonsTable.isActive, true)))
    .orderBy(desc(battleSeasonsTable.seasonNumber)).limit(1);
  return row ?? null;
}

export async function startNewSeason(guildId: string, name?: string): Promise<BattleSeason> {
  const current = await getActiveSeason(guildId);
  const nextNumber = (current?.seasonNumber ?? 0) + 1;
  if (current) {
    await db.update(battleSeasonsTable)
      .set({ isActive: false, endedAt: new Date() })
      .where(eq(battleSeasonsTable.id, current.id));
  }
  const [row] = await db.insert(battleSeasonsTable)
    .values({ guildId, seasonNumber: nextNumber, name: name ?? `Season ${nextNumber}`, isActive: true })
    .returning();
  return row!;
}

// ── Daily challenges ─────────────────────────────────────────────────────────
export async function getDailyRow(guildId: string, userId: string, dayKey: string): Promise<BattleDailyChallenges | null> {
  const [row] = await db.select().from(battleDailyChallengesTable)
    .where(and(
      eq(battleDailyChallengesTable.guildId, guildId),
      eq(battleDailyChallengesTable.userId, userId),
      eq(battleDailyChallengesTable.dayKey, dayKey),
    )).limit(1);
  return row ?? null;
}

export async function upsertDailyRow(
  guildId: string, userId: string, dayKey: string, challenges: BattleDailyChallenges["challenges"],
): Promise<void> {
  await db.insert(battleDailyChallengesTable)
    .values({ guildId, userId, dayKey, challenges, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: [battleDailyChallengesTable.guildId, battleDailyChallengesTable.userId, battleDailyChallengesTable.dayKey],
      set: { challenges, updatedAt: new Date() },
    });
}

// ── Locks (multiple-battle + card-lock protection) ───────────────────────────
// Atomic acquire: the (guild,user) unique index means a second concurrent
// battle attempt fails to insert. Returns false if the user is already locked.
export async function acquireBattleLock(
  guildId: string, userId: string, battleId: string, cardId: number | null, staked: boolean,
): Promise<boolean> {
  const res = await db.insert(battleLocksTable)
    .values({ guildId, userId, battleId, cardId, staked })
    .onConflictDoNothing()
    .returning({ id: battleLocksTable.id });
  return res.length > 0;
}

export async function releaseBattleLock(guildId: string, userId: string, battleId?: string): Promise<void> {
  const where = battleId
    ? and(eq(battleLocksTable.guildId, guildId), eq(battleLocksTable.userId, userId), eq(battleLocksTable.battleId, battleId))
    : and(eq(battleLocksTable.guildId, guildId), eq(battleLocksTable.userId, userId));
  await db.delete(battleLocksTable).where(where);
}

export async function getUserLock(guildId: string, userId: string) {
  const [row] = await db.select().from(battleLocksTable)
    .where(and(eq(battleLocksTable.guildId, guildId), eq(battleLocksTable.userId, userId))).limit(1);
  return row ?? null;
}

// Clear locks older than `maxAgeMs` (crash/stuck-battle recovery).
export async function sweepStaleLocks(maxAgeMs: number): Promise<void> {
  const cutoff = new Date(Date.now() - maxAgeMs);
  await db.delete(battleLocksTable).where(sql`${battleLocksTable.createdAt} < ${cutoff}`);
}

// Every lock row (used by startup escrow recovery — at a cold start there are no
// in-memory battles, so any surviving row is from a crashed process).
export async function getAllLocks() {
  return db.select().from(battleLocksTable);
}

export async function deleteAllLocks(): Promise<void> {
  await db.delete(battleLocksTable);
}

// ── Leaderboard ──────────────────────────────────────────────────────────────
export async function getBattleLeaderboard(
  guildId: string, sortBy: "rank" | "wins" | "streak" = "rank", limit = 10,
): Promise<BattleProfile[]> {
  const order =
    sortBy === "wins" ? desc(battleProfilesTable.wins)
    : sortBy === "streak" ? desc(battleProfilesTable.highestStreak)
    : desc(battleProfilesTable.rankPoints);
  return db.select().from(battleProfilesTable)
    .where(eq(battleProfilesTable.guildId, guildId))
    .orderBy(order, desc(battleProfilesTable.wins))
    .limit(limit);
}

// Cross-guild leaderboard — only includes guilds that opted in (checked by the
// caller). Aggregates by user across guilds that opted in.
export async function getGlobalLeaderboard(guildIds: string[], limit = 10): Promise<BattleProfile[]> {
  if (guildIds.length === 0) return [];
  return db.select().from(battleProfilesTable)
    .where(sql`${battleProfilesTable.guildId} IN ${guildIds}`)
    .orderBy(desc(battleProfilesTable.rankPoints))
    .limit(limit);
}
