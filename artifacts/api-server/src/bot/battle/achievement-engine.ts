// Achievement Engine — battle achievements, badges & titles.
//
// Achievements are data-driven defs with a predicate over the post-battle
// profile + this battle's context. Unlocking is idempotent (DB unique index).
// Some achievements also grant a cosmetic title the player can equip.

import type { BattleProfile } from "@workspace/db";
import { getUnlockedAchievementKeys, unlockAchievement, updateProfile } from "./db.js";

export interface BattleContext {
  won: boolean;
  draw: boolean;
  perfect: boolean;      // won without losing any HP
  comeback: boolean;     // won after dropping below 15% HP
  critsThisBattle: number;
  cardsWonThisBattle: number;
  vsAi: boolean;
}

export interface BattleAchievementDef {
  key: string;
  name: string;
  emoji: string;
  description: string;
  title?: string;        // cosmetic title granted on unlock
  check: (p: BattleProfile, c: BattleContext) => boolean;
}

export const BATTLE_ACHIEVEMENTS: BattleAchievementDef[] = [
  { key: "first_blood", name: "First Blood", emoji: "🩸", description: "Win your first battle.",
    title: "the Bold", check: (p, c) => c.won && p.wins >= 1 },
  { key: "wins_100", name: "Centurion", emoji: "💯", description: "Win 100 battles.",
    title: "the Relentless", check: (p) => p.wins >= 100 },
  { key: "collector", name: "Collector", emoji: "🎴", description: "Win 10 cards from staked battles.",
    title: "the Raider", check: (p) => p.cardsWon >= 10 },
  { key: "legend", name: "Legend", emoji: "🏆", description: "Reach 1600 rank points.",
    title: "the Legend", check: (p) => p.rankPoints >= 1600 },
  { key: "lucky_strike", name: "Lucky Strike", emoji: "🍀", description: "Win a battle with a last-stand comeback.",
    check: (_p, c) => c.won && c.comeback },
  { key: "unstoppable", name: "Unstoppable", emoji: "🔥", description: "Reach a 10-win streak.",
    title: "the Unstoppable", check: (p) => p.highestStreak >= 10 },
  { key: "perfect_victory", name: "Perfect Victory", emoji: "✨", description: "Win without taking any damage.",
    check: (_p, c) => c.won && c.perfect },
  { key: "comeback", name: "Comeback King", emoji: "📈", description: "Win after dropping below 15% HP.",
    check: (_p, c) => c.won && c.comeback },
  { key: "critical_master", name: "Critical Master", emoji: "💥", description: "Land 5+ critical hits in one battle.",
    check: (_p, c) => c.critsThisBattle >= 5 },
  { key: "battle_king", name: "Battle King", emoji: "👑", description: "Win 250 battles.",
    title: "the Battle King", check: (p) => p.wins >= 250 },
];

export async function checkBattleAchievements(
  guildId: string, userId: string, profile: BattleProfile, ctx: BattleContext,
): Promise<BattleAchievementDef[]> {
  const already = await getUnlockedAchievementKeys(guildId, userId);
  const newlyUnlocked: BattleAchievementDef[] = [];
  const grantedTitles: string[] = [];

  for (const def of BATTLE_ACHIEVEMENTS) {
    if (already.has(def.key)) continue;
    if (!def.check(profile, ctx)) continue;
    const inserted = await unlockAchievement(guildId, userId, def.key);
    if (inserted) {
      newlyUnlocked.push(def);
      if (def.title) grantedTitles.push(def.title);
    }
  }

  if (grantedTitles.length > 0) {
    const titles = Array.from(new Set([...(profile.titles ?? []), ...grantedTitles]));
    await updateProfile(guildId, userId, { titles });
  }
  return newlyUnlocked;
}

export function formatAchievementLine(def: BattleAchievementDef): string {
  return `${def.emoji} **${def.name}** — ${def.description}` + (def.title ? ` _(Title: “${def.title}”)_` : "");
}
