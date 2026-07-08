// Leaderboard Engine — persistent battle rankings + profile stat views.
//
// Reads battle_profiles and formats guild + (opt-in) global leaderboards. Also
// derives the "favorite card" from the per-profile usage map.

import type { BattleProfile } from "@workspace/db";
import { getCardById } from "../db.js";
import { getBattleLeaderboard, getGlobalLeaderboard } from "./db.js";

export { getBattleLeaderboard, getGlobalLeaderboard };

export function winRate(p: Pick<BattleProfile, "wins" | "losses" | "draws">): number {
  const total = p.wins + p.losses + p.draws;
  if (total === 0) return 0;
  return Math.round((p.wins / total) * 100);
}

export function favoriteCardId(p: Pick<BattleProfile, "cardUsage">): number | null {
  const usage = p.cardUsage ?? {};
  let best: number | null = null, bestN = 0;
  for (const [id, n] of Object.entries(usage)) {
    if (n > bestN) { bestN = n; best = Number(id); }
  }
  return best;
}

export async function favoriteCardName(p: Pick<BattleProfile, "cardUsage">): Promise<string> {
  const id = favoriteCardId(p);
  if (id == null) return "—";
  const card = await getCardById(id).catch(() => undefined);
  return card?.name ?? `#${id}`;
}

export function rankTitle(rankPoints: number): { name: string; emoji: string } {
  if (rankPoints >= 1800) return { name: "Grandmaster", emoji: "🌌" };
  if (rankPoints >= 1600) return { name: "Master", emoji: "💠" };
  if (rankPoints >= 1400) return { name: "Diamond", emoji: "💎" };
  if (rankPoints >= 1250) return { name: "Platinum", emoji: "🔷" };
  if (rankPoints >= 1100) return { name: "Gold", emoji: "🥇" };
  if (rankPoints >= 950) return { name: "Silver", emoji: "🥈" };
  if (rankPoints >= 800) return { name: "Bronze", emoji: "🥉" };
  return { name: "Unranked", emoji: "⚪" };
}

const MEDALS = ["🥇", "🥈", "🥉"];

export function formatLeaderboard(rows: BattleProfile[]): string {
  if (rows.length === 0) return "_No battles fought yet. Be the first — `/battle`!_";
  return rows.map((p, i) => {
    const medal = MEDALS[i] ?? `**${i + 1}.**`;
    const rt = rankTitle(p.rankPoints);
    return `${medal} <@${p.userId}> — ${rt.emoji} **${p.rankPoints}** · ${p.wins}W/${p.losses}L · 🔥${p.currentStreak}`;
  }).join("\n");
}
