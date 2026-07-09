// Season Engine — per-guild seasons with resettable ladders.
//
// A season groups battle activity into a window. Ending a season archives the
// current ranks (records keep their seasonId) and starts a fresh one. The
// engine is intentionally thin now but is the hook point for seasonal rewards,
// exclusive badges/titles, and cosmetics — the admin hub calls resetSeason and
// this is where end-of-season payouts will be layered in.

import { db, battleProfilesTable } from "@workspace/db";
import type { BattleSeason } from "@workspace/db";
import { eq } from "drizzle-orm";
import { getActiveSeason, startNewSeason, getBattleLeaderboard } from "./db.js";

export { getActiveSeason };

export async function ensureSeason(guildId: string): Promise<BattleSeason> {
  const existing = await getActiveSeason(guildId);
  if (existing) return existing;
  return startNewSeason(guildId);
}

export interface SeasonResetResult {
  endedSeason: BattleSeason | null;
  newSeason: BattleSeason;
  topThree: Array<{ userId: string; rankPoints: number; wins: number }>;
}

// End the active season, capture the podium (for seasonal rewards/cosmetics),
// soft-reset every profile's ladder (rank + streak) while KEEPING lifetime
// totals, and open a new season.
export async function resetSeason(guildId: string, name?: string): Promise<SeasonResetResult> {
  const ended = await getActiveSeason(guildId);
  const top = await getBattleLeaderboard(guildId, "rank", 3);
  const topThree = top.map(p => ({ userId: p.userId, rankPoints: p.rankPoints, wins: p.wins }));

  const newSeason = await startNewSeason(guildId, name);

  // Soft reset: rank points back to baseline and current streak cleared.
  // Lifetime wins/losses/damage/etc. are preserved on purpose.
  await db.update(battleProfilesTable)
    .set({ rankPoints: 1000, currentStreak: 0, updatedAt: new Date() })
    .where(eq(battleProfilesTable.guildId, guildId));

  return { endedSeason: ended, newSeason, topThree };
}
