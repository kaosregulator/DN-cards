// Daily Challenge Engine — per-guild, per-user daily objectives.
//
// Generates a deterministic set of 3 daily objectives (seeded by user+day so
// everyone's list is stable through the day). Progress is advanced after each
// battle and rewards auto-credit the moment an objective completes.

import type { DailyChallenge } from "@workspace/db";
import { addShards } from "../db.js";
import { getOrCreateProfile, updateProfile, getDailyRow, upsertDailyRow } from "./db.js";
import { utcDayKey } from "./reward-engine.js";

type ChallengeTemplate = {
  key: string;
  label: (goal: number) => string;
  goals: number[];
  rewardShards: number;
  rewardXp: number;
  // Advance amount given a battle summary.
  progress: (s: BattleSummary) => number;
};

export interface BattleSummary {
  won: boolean;
  vsAi: boolean;
  damageDealt: number;
  perfect: boolean;      // took no damage
  cardRarity: string;    // rarity of the card the user fought with
  crits: number;
}

const TEMPLATES: ChallengeTemplate[] = [
  { key: "win_battles", label: (g) => `Win ${g} battles`, goals: [2, 3, 5], rewardShards: 120, rewardXp: 40,
    progress: (s) => (s.won ? 1 : 0) },
  { key: "deal_damage", label: (g) => `Deal ${g.toLocaleString()} total damage`, goals: [1000, 2000, 3500], rewardShards: 100, rewardXp: 35,
    progress: (s) => s.damageDealt },
  { key: "beat_ai", label: (g) => `Defeat the AI ${g} time(s)`, goals: [1, 2, 3], rewardShards: 90, rewardXp: 30,
    progress: (s) => (s.won && s.vsAi ? 1 : 0) },
  { key: "flawless", label: (g) => `Win ${g} battle(s) without losing HP`, goals: [1, 2], rewardShards: 150, rewardXp: 60,
    progress: (s) => (s.won && s.perfect ? 1 : 0) },
  { key: "rare_duelist", label: (g) => `Fight ${g} battles with a Rare+ card`, goals: [2, 3], rewardShards: 110, rewardXp: 40,
    progress: (s) => (["rare", "epic", "legendary", "mythic"].includes(s.cardRarity) ? 1 : 0) },
  { key: "critical", label: (g) => `Land ${g} critical hits`, goals: [3, 5, 8], rewardShards: 100, rewardXp: 35,
    progress: (s) => s.crits },
];

// Deterministic seed from user id + day so the roster is stable per day.
function seedPick(userId: string, dayKey: string, n: number): number[] {
  let h = 2166136261;
  const str = userId + dayKey;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  const picks: number[] = [];
  const pool = TEMPLATES.map((_, i) => i);
  for (let k = 0; k < n && pool.length > 0; k++) {
    h ^= h >>> 13; h = Math.imul(h, 16777619);
    const idx = (h >>> 0) % pool.length;
    picks.push(pool.splice(idx, 1)[0]!);
    // vary goal tier by day too
  }
  return picks;
}

export async function getOrCreateDaily(guildId: string, userId: string): Promise<DailyChallenge[]> {
  const dayKey = utcDayKey();
  const existing = await getDailyRow(guildId, userId, dayKey);
  if (existing) return existing.challenges;
  const picks = seedPick(userId, dayKey, 3);
  let h = 0;
  for (const c of userId + dayKey) h = (h + c.charCodeAt(0)) % 997;
  const challenges: DailyChallenge[] = picks.map((ti, i) => {
    const t = TEMPLATES[ti]!;
    const goal = t.goals[(h + i) % t.goals.length]!;
    return {
      key: t.key, label: t.label(goal), goal, progress: 0,
      rewardShards: t.rewardShards, rewardXp: t.rewardXp, claimed: false,
    };
  });
  await upsertDailyRow(guildId, userId, dayKey, challenges);
  return challenges;
}

// Advance progress after a battle; auto-credit completed objectives.
// Returns the challenges that were newly completed (for a toast).
export async function advanceDaily(
  guildId: string, userId: string, summary: BattleSummary,
): Promise<DailyChallenge[]> {
  const dayKey = utcDayKey();
  const challenges = await getOrCreateDaily(guildId, userId);
  const templatesByKey = new Map(TEMPLATES.map(t => [t.key, t]));
  const completed: DailyChallenge[] = [];

  for (const ch of challenges) {
    if (ch.claimed) continue;
    const tmpl = templatesByKey.get(ch.key);
    if (!tmpl) continue;
    ch.progress = Math.min(ch.goal, ch.progress + tmpl.progress(summary));
    if (ch.progress >= ch.goal && !ch.claimed) {
      ch.claimed = true;
      completed.push(ch);
    }
  }

  if (completed.length > 0) {
    let xpGain = 0, shardGain = 0;
    for (const c of completed) { xpGain += c.rewardXp; shardGain += c.rewardShards; }
    await addShards(guildId, userId, shardGain);
    const prof = await getOrCreateProfile(guildId, userId);
    await updateProfile(guildId, userId, { xp: prof.xp + xpGain });
  }
  await upsertDailyRow(guildId, userId, dayKey, challenges);
  return completed;
}
