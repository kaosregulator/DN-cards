import { db, achievementsTable, collectionsTable, cardsTable, tradesTable, userCurrencyTable } from "@workspace/db";
import { and, eq, sql } from "drizzle-orm";

export interface AchievementDef {
  key: string;
  name: string;
  emoji: string;
  description: string;
  reward: number;
}

export const ACHIEVEMENTS: AchievementDef[] = [
  { key: "first_catch",      name: "First Catch",        emoji: "🎣", description: "Catch your first card",            reward: 50 },
  { key: "rookie",           name: "Rookie Collector",   emoji: "📦", description: "Own 10 unique cards",              reward: 100 },
  { key: "elite",            name: "Elite Collector",    emoji: "💼", description: "Own 50 unique cards",              reward: 500 },
  { key: "master",           name: "Master Collector",   emoji: "🏆", description: "Own 100 unique cards",             reward: 1500 },
  { key: "legendary_hunter", name: "Legendary Hunter",   emoji: "🌟", description: "Own at least 1 Legendary card",    reward: 750 },
  { key: "all_legendaries",  name: "Legendary Sovereign", emoji: "👑", description: "Own every Legendary card",        reward: 5000 },
  { key: "pyromaniac",       name: "Pyromaniac",         emoji: "🔥", description: "Burn 50 cards",                    reward: 500 },
  { key: "trader",           name: "Diplomat",           emoji: "🤝", description: "Complete your first trade",        reward: 200 },
  { key: "pack_addict",      name: "Pack Addict",        emoji: "🎴", description: "Open 10 card packs",               reward: 1000 },
  { key: "streak_7",         name: "Devotee",            emoji: "📅", description: "Reach a 7-day daily streak",       reward: 1000 },
  // P6 — set-completion achievements. "Completion" = own every card in the
  // set's membership list (shinies don't matter; ownership = collections row).
  // Static tiers fire across ALL sets the user has finished, regardless of
  // each set's `awardsCompletion` flag. The flag only governs the dynamic
  // per-set achievement below.
  { key: "set_first_complete", name: "Set Completionist", emoji: "🧩", description: "Complete your first card set",  reward: 500 },
  { key: "set_collector",      name: "Set Collector",     emoji: "🗂️", description: "Complete 3 different card sets", reward: 1500 },
  { key: "set_master",         name: "Set Master",        emoji: "📚", description: "Complete 5 different card sets", reward: 4000 },
];

export function getAchievement(key: string): AchievementDef | undefined {
  return ACHIEVEMENTS.find(a => a.key === key);
}

export async function getUnlockedKeys(guildId: string, userId: string): Promise<Set<string>> {
  const rows = await db.select({ key: achievementsTable.achievementKey })
    .from(achievementsTable)
    .where(and(eq(achievementsTable.guildId, guildId), eq(achievementsTable.userId, userId)));
  return new Set(rows.map(r => r.key));
}

// Most recently unlocked achievement keys, newest first. Used by /collection
// to show a "last few unlocked" emoji strip in real chronological order.
export async function getRecentUnlocks(guildId: string, userId: string, limit = 6): Promise<string[]> {
  const rows = await db.select({ key: achievementsTable.achievementKey })
    .from(achievementsTable)
    .where(and(eq(achievementsTable.guildId, guildId), eq(achievementsTable.userId, userId)))
    .orderBy(sql`${achievementsTable.unlockedAt} DESC`)
    .limit(limit);
  return rows.map(r => r.key);
}

interface UserStats {
  uniqueCards: number;
  hasLegendary: boolean;
  ownsAllLegendaries: boolean;
  cardsBurned: number;
  packsOpened: number;
  completedTrades: number;
  dailyStreak: number;
  completedSetIds: number[];   // P6 — every set the user has fully completed
}

async function loadStats(guildId: string, userId: string, dailyStreak: number): Promise<UserStats> {
  const [coll] = await db.select({
    unique: sql<number>`count(distinct ${collectionsTable.cardId})::int`,
  }).from(collectionsTable)
    .where(and(eq(collectionsTable.guildId, guildId), eq(collectionsTable.userId, userId)));

  const legendaryOwned = await db.select({ cardId: cardsTable.id })
    .from(collectionsTable)
    .innerJoin(cardsTable, eq(collectionsTable.cardId, cardsTable.id))
    .where(and(
      eq(collectionsTable.guildId, guildId),
      eq(collectionsTable.userId, userId),
      eq(cardsTable.rarity, "legendary"),
    ));

  const legendaryTotal = await db.select({ id: cardsTable.id })
    .from(cardsTable).where(and(eq(cardsTable.rarity, "legendary"), eq(cardsTable.guildId, guildId)));

  const [currency] = await db.select({
    cardsBurned: userCurrencyTable.cardsBurned,
    packsOpened: userCurrencyTable.packsOpened,
  }).from(userCurrencyTable)
    .where(and(eq(userCurrencyTable.guildId, guildId), eq(userCurrencyTable.userId, userId)));

  const [trades] = await db.select({
    n: sql<number>`count(*)::int`,
  }).from(tradesTable)
    .where(and(
      eq(tradesTable.guildId, guildId),
      eq(tradesTable.status, "accepted"),
      sql`(${tradesTable.initiatorId} = ${userId} OR ${tradesTable.targetId} = ${userId})`,
    ));

  const { getCompletedSetIds } = await import("./db.js");
  const completedSetIds = await getCompletedSetIds(guildId, userId);

  return {
    uniqueCards: Number(coll?.unique ?? 0),
    hasLegendary: legendaryOwned.length > 0,
    ownsAllLegendaries: legendaryTotal.length > 0 && legendaryOwned.length >= legendaryTotal.length,
    cardsBurned: currency?.cardsBurned ?? 0,
    packsOpened: currency?.packsOpened ?? 0,
    completedTrades: Number(trades?.n ?? 0),
    dailyStreak,
    completedSetIds,
  };
}

function meets(key: string, s: UserStats): boolean {
  switch (key) {
    case "first_catch":      return s.uniqueCards >= 1;
    case "rookie":           return s.uniqueCards >= 10;
    case "elite":            return s.uniqueCards >= 50;
    case "master":           return s.uniqueCards >= 100;
    case "legendary_hunter": return s.hasLegendary;
    case "all_legendaries":  return s.ownsAllLegendaries;
    case "pyromaniac":       return s.cardsBurned >= 50;
    case "trader":           return s.completedTrades >= 1;
    case "pack_addict":      return s.packsOpened >= 10;
    case "streak_7":         return s.dailyStreak >= 7;
    case "set_first_complete": return s.completedSetIds.length >= 1;
    case "set_collector":      return s.completedSetIds.length >= 3;
    case "set_master":         return s.completedSetIds.length >= 5;
    default: return false;
  }
}

/**
 * Check every achievement for this user, unlock any newly-met ones, award
 * shards, and return the freshly-unlocked defs (empty if none).
 */
export async function checkAchievements(
  guildId: string,
  userId: string,
  opts?: { dailyStreak?: number },
): Promise<AchievementDef[]> {
  const stats = await loadStats(guildId, userId, opts?.dailyStreak ?? 0);
  const unlocked = await getUnlockedKeys(guildId, userId);
  const newly: AchievementDef[] = [];
  const { addShards, listShowcaseSets, getSetById } = await import("./db.js");

  // Static catalog — set_* keys included.
  for (const ach of ACHIEVEMENTS) {
    if (unlocked.has(ach.key)) continue;
    if (!meets(ach.key, stats)) continue;
    const inserted = await db.insert(achievementsTable)
      .values({ guildId, userId, achievementKey: ach.key })
      .onConflictDoNothing()
      .returning({ id: achievementsTable.id });
    if (inserted.length === 0) continue;
    if (ach.reward > 0) await addShards(guildId, userId, ach.reward);
    newly.push(ach);
  }

  // P6 — dynamic per-set "showcase" achievements. Only sets whose admin has
  // toggled `awardsCompletion` get a dedicated key (`set_complete:<setId>`).
  // We only generate keys for sets the user has actually completed, so the
  // hot path stays O(completed showcase sets) rather than O(all sets).
  if (stats.completedSetIds.length > 0) {
    const showcase = await listShowcaseSets(guildId);
    const showcaseIds = new Set(showcase.map(s => s.id));
    for (const setId of stats.completedSetIds) {
      if (!showcaseIds.has(setId)) continue;
      const key = `set_complete:${setId}`;
      if (unlocked.has(key)) continue;
      const set = await getSetById(setId, guildId);
      if (!set) continue;
      const inserted = await db.insert(achievementsTable)
        .values({ guildId, userId, achievementKey: key })
        .onConflictDoNothing()
        .returning({ id: achievementsTable.id });
      if (inserted.length === 0) continue;
      const reward = 1000;
      await addShards(guildId, userId, reward);
      newly.push({
        key,
        name: `${set.name} — Complete`,
        emoji: "✨",
        description: `Collect every card in the \`${set.name}\` set`,
        reward,
      });
    }
  }

  return newly;
}

export function formatUnlockLine(ach: AchievementDef): string {
  return `${ach.emoji} **${ach.name}** — ${ach.description} (+💠 ${ach.reward.toLocaleString()})`;
}
