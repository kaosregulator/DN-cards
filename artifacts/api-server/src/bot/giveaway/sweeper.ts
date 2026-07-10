// Giveaway maintenance loop. Every minute it:
//   1. closes giveaways whose timer elapsed (draws winners, rewrites the message,
//      announces) — mirrors the marketplace auction sweeper.
//   2. rerolls winners who let their claim window lapse, keeping prizes flowing
//      to active players.
//
// Best-effort and idempotent: a boot-time kick recovers anything that expired
// while the bot was down.

import { getDueGiveaways, getExpiredWinners, getGiveaway } from "./db.js";
import { endGiveaway, rerollWinner } from "./manager.js";
import { getBotClient } from "../client-holder.js";
import { logger } from "../../lib/logger.js";

const SWEEP_INTERVAL_MS = 60_000;
let started = false;

export function startGiveawayMaintenance(): void {
  if (started) return;
  started = true;
  setTimeout(() => { void sweepOnce(); }, 20_000);
  setInterval(() => { void sweepOnce(); }, SWEEP_INTERVAL_MS);
}

async function sweepOnce(): Promise<void> {
  const client = getBotClient();
  if (!client) return;
  try {
    // 1. End due giveaways.
    const due = await getDueGiveaways();
    for (const g of due) {
      try {
        await endGiveaway(g, client);
        logger.info({ giveawayId: g.id }, "giveaway auto-ended");
      } catch (err) {
        logger.warn({ err, giveawayId: g.id }, "giveaway auto-end failed");
      }
    }

    // 2. Reroll expired, unclaimed winners.
    const expired = await getExpiredWinners();
    for (const w of expired) {
      try {
        const g = await getGiveaway(w.giveawayId);
        if (!g) continue;
        await rerollWinner(g, w, client, "expired");
        logger.info({ giveawayId: g.id, userId: w.userId }, "giveaway winner claim expired → rerolled");
      } catch (err) {
        logger.warn({ err, winnerId: w.id }, "giveaway reroll failed");
      }
    }
  } catch (err) {
    logger.warn({ err }, "giveaway sweep failed");
  }
}
