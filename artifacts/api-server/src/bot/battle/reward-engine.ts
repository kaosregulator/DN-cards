// Reward Engine — end-of-battle payouts and ranking.
//
// Uses the EXISTING DN Shards economy (addShards) so battle rewards flow through
// the same money plumbing as the rest of the bot. Handles shards, XP/levels,
// ELO rank points, streaks, the daily reward cap, and free packs; it also
// records the win/loss card counters. The actual staked-card MOVEMENT is owned
// by the battle-manager's escrow (cards are held out of both collections for the
// whole battle, then the winner receives both) — so a card can never be
// duplicated or moved twice.

import type { BattleSettings, BattleProfile, BattleRecord, BattleSeason } from "@workspace/db";
import { addShards } from "../db.js";
import {
  updateProfile, getOrCreateProfile, insertBattleRecord,
} from "./db.js";
import { checkBattleAchievements, type BattleAchievementDef, type BattleContext } from "./achievement-engine.js";
import type { Rarity } from "../cards-data.js";

export interface CardLevelUp {
  userId: string;
  cardName: string;
  newLevel: number;
  oldStars: number;
  newStars: number;
  newFrames: string[];
}

export interface ParticipantResult {
  userId: string;
  isAi: boolean;
  cardId: number;
  cardName: string;
  damageDealt: number;
  damageTaken: number;
  crits: number;
  perfect: boolean;    // took no damage
  comeback: boolean;   // dropped below 15% then survived to win
}

export interface RewardOutcome {
  userId: string;
  isAi: boolean;
  won: boolean;
  draw: boolean;
  shards: number;
  xp: number;
  streakBonus: number;
  rankDelta: number;
  newRank: number;
  level: number;
  leveledUp: boolean;
  cardWonId: number | null;
  cardLostId: number | null;
  freePackTier: string | null;
  throttled: boolean;
  achievements: BattleAchievementDef[];
}

export function utcDayKey(d = new Date()): string {
  return d.toISOString().slice(0, 10);
}

function levelForXp(xp: number): number {
  return 1 + Math.floor(xp / 200);
}

const ELO_K = 32;
function eloDelta(mine: number, theirs: number, score: number): number {
  const expected = 1 / (1 + Math.pow(10, (theirs - mine) / 400));
  return Math.round(ELO_K * (score - expected));
}

export async function processBattleRewards(args: {
  guildId: string;
  settings: BattleSettings;
  season: BattleSeason | null;
  staked: boolean;
  isAi: boolean;
  aiDifficulty: string | null;
  challenger: ParticipantResult;
  opponent: ParticipantResult;
  winnerId: string | null;   // null = draw; "AI" if the AI won
  turns: number;
  endedReason: string;
  grantPack?: (guildId: string, userId: string, tier: string) => Promise<unknown>;
}): Promise<{ record: BattleRecord; outcomes: RewardOutcome[]; levelUps: CardLevelUp[] }> {
  const { guildId, settings, staked } = args;
  const dayKey = utcDayKey();

  // Pre-fetch existing rank points for ELO (before we mutate).
  const [chalProfile, oppProfile] = await Promise.all([
    args.challenger.isAi ? null : getOrCreateProfile(guildId, args.challenger.userId),
    args.opponent.isAi ? null : getOrCreateProfile(guildId, args.opponent.userId),
  ]);
  const chalRank = chalProfile?.rankPoints ?? 1000;
  const oppRank = oppProfile?.rankPoints ?? 1000;

  const outcomes: RewardOutcome[] = [];

  const process = async (
    me: ParticipantResult, foe: ParticipantResult,
    myProfile: BattleProfile | null, myRank: number, foeRank: number,
  ): Promise<RewardOutcome | null> => {
    if (me.isAi || !myProfile) return null;
    const won = args.winnerId === me.userId;
    const draw = args.winnerId === null;
    const lost = !won && !draw;

    // Daily reward throttle.
    const sameDay = myProfile.rewardDayKey === dayKey;
    const usedToday = sameDay ? myProfile.rewardBattlesToday : 0;
    const throttled = usedToday >= settings.dailyRewardLimit;

    // Streak.
    const newStreak = won ? myProfile.currentStreak + 1 : 0;
    const highestStreak = Math.max(myProfile.highestStreak, newStreak);

    // Shards + XP (scaled for AI battles, zeroed when throttled).
    const aiScale = args.isAi ? settings.aiRewardPct / 100 : 1;
    let shards = 0, xp = 0, streakBonus = 0;
    if (!throttled) {
      const baseShards = won ? settings.rewardWinShards : draw ? settings.rewardDrawShards : settings.rewardLossShards;
      xp = Math.round((won ? settings.rewardWinXp : settings.rewardLossXp) * aiScale);
      streakBonus = won ? Math.min(settings.streakBonusMax, settings.streakBonusShards * Math.max(0, newStreak - 1)) : 0;
      shards = Math.round((baseShards + streakBonus) * aiScale);
    }

    // Rank (PvP only).
    let rankDelta = 0;
    if (!args.isAi) {
      const score = won ? 1 : draw ? 0.5 : 0;
      rankDelta = eloDelta(myRank, foeRank, score);
    }
    const newRank = Math.max(0, myRank + rankDelta);

    // Card usage / favorite tracking.
    const usage = { ...(myProfile.cardUsage ?? {}) };
    usage[String(me.cardId)] = (usage[String(me.cardId)] ?? 0) + 1;

    const newXp = myProfile.xp + xp;
    const prevLevel = myProfile.level;
    const level = levelForXp(newXp);

    // Stake transfer settled below (needs both sides). Track counters here.
    let cardWonId: number | null = null;
    let cardLostId: number | null = null;
    if (staked && !draw && !args.isAi) {
      if (won) cardWonId = foe.cardId;
      else if (lost) cardLostId = me.cardId;
    }

    await updateProfile(guildId, me.userId, {
      wins: myProfile.wins + (won ? 1 : 0),
      losses: myProfile.losses + (lost ? 1 : 0),
      draws: myProfile.draws + (draw ? 1 : 0),
      totalBattles: myProfile.totalBattles + 1,
      damageDealt: myProfile.damageDealt + me.damageDealt,
      damageTaken: myProfile.damageTaken + me.damageTaken,
      criticalHits: myProfile.criticalHits + me.crits,
      currentStreak: newStreak,
      highestStreak,
      xp: newXp,
      level,
      rankPoints: newRank,
      cardUsage: usage,
      cardsWon: myProfile.cardsWon + (cardWonId ? 1 : 0),
      cardsLost: myProfile.cardsLost + (cardLostId ? 1 : 0),
      rewardBattlesToday: throttled ? usedToday : usedToday + 1,
      rewardDayKey: dayKey,
      lastBattleAt: new Date(),
    });

    if (shards > 0) await addShards(guildId, me.userId, shards);

    // Free pack on win streak.
    let freePackTier: string | null = null;
    if (won && !throttled && settings.freePackStreak > 0 && newStreak > 0 && newStreak % settings.freePackStreak === 0) {
      freePackTier = settings.freePackTier;
      if (args.grantPack) {
        await args.grantPack(guildId, me.userId, settings.freePackTier).catch(() => { /* best effort */ });
      }
    }

    // Achievements (needs the just-updated profile).
    const updated = await getOrCreateProfile(guildId, me.userId);
    const ctx: BattleContext = {
      won, draw, perfect: won && me.perfect, comeback: won && me.comeback,
      critsThisBattle: me.crits, cardsWonThisBattle: cardWonId ? 1 : 0, vsAi: args.isAi,
    };
    const achievements = await checkBattleAchievements(guildId, me.userId, updated, ctx);

    return {
      userId: me.userId, isAi: false, won, draw,
      shards, xp, streakBonus, rankDelta, newRank,
      level, leveledUp: level > prevLevel,
      cardWonId, cardLostId, freePackTier, throttled, achievements,
    };
  };

  const chalOutcome = await process(args.challenger, args.opponent, chalProfile, chalRank, oppRank);
  const oppOutcome = await process(args.opponent, args.challenger, oppProfile, oppRank, chalRank);
  if (chalOutcome) outcomes.push(chalOutcome);
  if (oppOutcome) outcomes.push(oppOutcome);

  // Quest progress — the winner (a real player, not the AI / not a draw) gets
  // "win a battle" credit. Best-effort; never blocks reward settlement.
  if (args.winnerId && args.winnerId !== "AI") {
    try {
      const { recordQuestEvent } = await import("../quests/engine.js");
      await recordQuestEvent(guildId, args.winnerId, "battle_win", 1);
    } catch { /* non-fatal */ }
  }

  // Giveaway progress — winner gets "battle_win" credit; every real participant
  // (a valid, non-forfeit battle only) gets "battle_played". Best-effort.
  if (args.endedReason !== "forfeit") {
    try {
      const { recordGiveawayEvent } = await import("../giveaway/engine.js");
      if (args.winnerId && args.winnerId !== "AI") {
        await recordGiveawayEvent(guildId, args.winnerId, "battle_win", 1);
      }
      for (const p of [args.challenger, args.opponent]) {
        if (!p.isAi) await recordGiveawayEvent(guildId, p.userId, "battle_played", 1);
      }
    } catch { /* non-fatal */ }
  }

  // Card leveling — each real participant's fielded card earns battle XP
  // (cosmetic frames only, no stat impact). Best-effort. Collect level-ups so
  // the battle-manager can surface them on the winner screen.
  const levelUps: CardLevelUp[] = [];
  try {
    const { grantCardBattleXp, starsForLevel } = await import("../cards/leveling.js");
    const { getAllCardsCached } = await import("../db.js");
    const allCards = await getAllCardsCached();
    const cardOf = (id: number) => allCards.find(c => c.id === id);
    const outcomeFor = (p: ParticipantResult): "win" | "loss" | "draw" =>
      args.winnerId === null ? "draw" : args.winnerId === p.userId ? "win" : "loss";
    for (const p of [args.challenger, args.opponent]) {
      if (p.isAi) continue;
      const card = cardOf(p.cardId);
      const grant = await grantCardBattleXp(guildId, p.userId, p.cardId, (card?.rarity ?? "common") as Rarity, outcomeFor(p));
      if (grant?.leveledUp) {
        levelUps.push({
          userId: p.userId,
          cardName: card?.name ?? `Card #${p.cardId}`,
          newLevel: grant.newLevel,
          oldStars: starsForLevel(grant.oldLevel),
          newStars: starsForLevel(grant.newLevel),
          newFrames: grant.newlyUnlocked.map(f => f.name),
        });
      }
    }
  } catch { /* non-fatal */ }

  // NOTE: the actual staked-card movement is handled by the battle-manager's
  // escrow (cards are held out of both collections for the whole battle, then
  // the winner receives both). Here we only record the win/loss counters via
  // the cardWonId / cardLostId flags computed above — no DB card transfer, so a
  // card can never be duplicated or moved twice.

  const record = await insertBattleRecord({
    guildId,
    seasonId: args.season?.id ?? null,
    challengerId: args.challenger.userId,
    opponentId: args.opponent.isAi ? "AI" : args.opponent.userId,
    isAi: args.isAi,
    aiDifficulty: args.aiDifficulty,
    challengerCardId: args.challenger.cardId,
    opponentCardId: args.opponent.cardId,
    winnerId: args.winnerId,
    staked,
    turns: args.turns,
    challengerDamage: args.challenger.damageDealt,
    opponentDamage: args.opponent.damageDealt,
    endedReason: args.endedReason,
  });

  return { record, outcomes, levelUps };
}
