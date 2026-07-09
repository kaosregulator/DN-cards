// Marketplace maintenance: periodically resolve auctions whose timer has
// elapsed. Card + shard settlement happens atomically in resolveDueAuctions;
// this loop just drives it and sends best-effort DM notifications.

import { resolveDueAuctions, proceedsFor, MARKET_FEE_PCT } from "./db.js";
import { getBotClient } from "../client-holder.js";
import { getAllCardsCached } from "../db.js";
import { logger } from "../../lib/logger.js";

const SWEEP_INTERVAL_MS = 60_000; // check every minute

let started = false;

export function startMarketMaintenance(): void {
  if (started) return;
  started = true;
  // Kick once shortly after boot (resolves anything that expired while down),
  // then on a steady interval.
  setTimeout(() => { void sweepOnce(); }, 15_000);
  setInterval(() => { void sweepOnce(); }, SWEEP_INTERVAL_MS);
}

async function sweepOnce(): Promise<void> {
  try {
    const resolved = await resolveDueAuctions();
    if (resolved.length === 0) return;
    logger.info({ count: resolved.length }, "Resolved due marketplace auctions");

    const client = getBotClient();
    if (!client) return;
    const cards = await getAllCardsCached();
    const nameOf = (id: number) => cards.find(c => c.id === id)?.name ?? `Card #${id}`;

    for (const r of resolved) {
      const l = r.listing;
      const cardName = nameOf(l.cardId);
      try {
        if (r.outcome === "sold" && l.currentBidderId && l.currentBid) {
          await dm(client, l.currentBidderId,
            `🔨 You won the auction for **${cardName}** with a bid of 💠 ${l.currentBid.toLocaleString()}! It's in your collection.`);
          await dm(client, l.sellerId,
            `💰 Your auction for **${cardName}** sold for 💠 ${l.currentBid.toLocaleString()}. You received 💠 ${proceedsFor(l.currentBid).toLocaleString()} (after ${MARKET_FEE_PCT}% fee).`);
        } else {
          await dm(client, l.sellerId,
            `⌛ Your auction for **${cardName}** ended with no bids — the card has been returned to your collection.`);
        }
      } catch { /* DMs disabled — non-fatal */ }
    }
  } catch (err) {
    logger.warn({ err }, "Marketplace sweep failed (non-fatal)");
  }
}

async function dm(client: NonNullable<ReturnType<typeof getBotClient>>, userId: string, content: string): Promise<void> {
  const user = await client.users.fetch(userId).catch(() => null);
  if (user) await user.send({ content }).catch(() => undefined);
}
