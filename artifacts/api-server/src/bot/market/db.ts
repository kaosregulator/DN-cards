// Marketplace data-access layer. All escrow-sensitive operations (list, buy,
// bid, cancel, resolve) run in transactions with atomic conditional updates so
// concurrent buyers/bidders can never double-spend a card or shards.

import {
  db, marketListingsTable, collectionsTable, userCurrencyTable,
} from "@workspace/db";
import type { MarketListing } from "@workspace/db";
import { and, eq, sql, desc, lte } from "drizzle-orm";
import { getOrCreateCurrency } from "../db.js";

// Sale/auction fee (percent of the final price) burned as a shard sink.
export const MARKET_FEE_PCT = 5;
export const MIN_BID_INCREMENT = 10;

export function feeFor(price: number): number {
  return Math.floor((price * MARKET_FEE_PCT) / 100);
}
export function proceedsFor(price: number): number {
  return price - feeFor(price);
}

export type ListResult =
  | { ok: true; listing: MarketListing }
  | { ok: false; reason: "not_owned" };

// ── Create a listing (escrow one card copy from the seller) ──────────────────
export async function createListing(args: {
  guildId: string; sellerId: string; cardId: number;
  kind: "sale" | "auction"; price: number; buyout?: number | null;
  expiresAt?: Date | null;
}): Promise<ListResult> {
  return await db.transaction(async (tx) => {
    // Atomic escrow: remove one normal copy, only if the seller owns one.
    const dec = await tx.update(collectionsTable)
      .set({ count: sql`${collectionsTable.count} - 1` })
      .where(and(
        eq(collectionsTable.guildId, args.guildId),
        eq(collectionsTable.userId, args.sellerId),
        eq(collectionsTable.cardId, args.cardId),
        sql`${collectionsTable.count} >= 1`,
      ))
      .returning({ id: collectionsTable.id, newCount: collectionsTable.count, shinyCount: collectionsTable.shinyCount });
    if (dec.length === 0) return { ok: false as const, reason: "not_owned" as const };
    if (dec[0]!.newCount === 0 && dec[0]!.shinyCount === 0) {
      await tx.delete(collectionsTable).where(eq(collectionsTable.id, dec[0]!.id));
    }

    const [listing] = await tx.insert(marketListingsTable).values({
      guildId: args.guildId, sellerId: args.sellerId, cardId: args.cardId,
      kind: args.kind, price: args.price, buyout: args.buyout ?? null,
      expiresAt: args.expiresAt ?? null,
    }).returning();
    return { ok: true as const, listing: listing! };
  });
}

// ── Queries ──────────────────────────────────────────────────────────────────
export async function getListing(id: number): Promise<MarketListing | null> {
  const [row] = await db.select().from(marketListingsTable).where(eq(marketListingsTable.id, id)).limit(1);
  return row ?? null;
}

export async function getActiveListings(guildId: string, opts?: {
  sellerId?: string; kind?: "sale" | "auction"; limit?: number;
}): Promise<MarketListing[]> {
  const conds = [eq(marketListingsTable.guildId, guildId), eq(marketListingsTable.status, "active")];
  if (opts?.sellerId) conds.push(eq(marketListingsTable.sellerId, opts.sellerId));
  if (opts?.kind) conds.push(eq(marketListingsTable.kind, opts.kind));
  return db.select().from(marketListingsTable)
    .where(and(...conds))
    .orderBy(desc(marketListingsTable.createdAt))
    .limit(opts?.limit ?? 25);
}

export async function getUserListings(guildId: string, sellerId: string): Promise<MarketListing[]> {
  return db.select().from(marketListingsTable)
    .where(and(
      eq(marketListingsTable.guildId, guildId),
      eq(marketListingsTable.sellerId, sellerId),
      eq(marketListingsTable.status, "active"),
    ))
    .orderBy(desc(marketListingsTable.createdAt));
}

export async function getUserBids(guildId: string, bidderId: string): Promise<MarketListing[]> {
  return db.select().from(marketListingsTable)
    .where(and(
      eq(marketListingsTable.guildId, guildId),
      eq(marketListingsTable.currentBidderId, bidderId),
      eq(marketListingsTable.status, "active"),
    ))
    .orderBy(desc(marketListingsTable.createdAt));
}

// ── Buy a fixed-price sale (or auction buyout) ───────────────────────────────
export type BuyResult =
  | { ok: true; price: number; sellerId: string; cardId: number }
  | { ok: false; reason: "gone" | "own_listing" | "insufficient" | "not_buyable" };

export async function buyListing(guildId: string, buyerId: string, listingId: number, price: number, opts?: { isBuyout?: boolean }): Promise<BuyResult> {
  await getOrCreateCurrency(guildId, buyerId);
  return await db.transaction(async (tx) => {
    // Atomic claim: transition active→sold, capturing seller/card.
    const claimed = await tx.update(marketListingsTable)
      .set({ status: "sold", buyerId, soldPrice: price, resolvedAt: new Date() })
      .where(and(eq(marketListingsTable.id, listingId), eq(marketListingsTable.status, "active")))
      .returning();
    if (claimed.length === 0) return { ok: false as const, reason: "gone" as const };
    const listing = claimed[0]!;
    if (listing.sellerId === buyerId) throw new Error("own_listing");

    // Atomic shard debit from the buyer.
    const debit = await tx.update(userCurrencyTable)
      .set({ shards: sql`${userCurrencyTable.shards} - ${price}`, updatedAt: new Date() })
      .where(and(
        eq(userCurrencyTable.guildId, guildId),
        eq(userCurrencyTable.userId, buyerId),
        sql`${userCurrencyTable.shards} >= ${price}`,
      ))
      .returning({ id: userCurrencyTable.id });
    if (debit.length === 0) throw new Error("insufficient");

    // If this was an auction with a standing bid, refund that escrow — even if
    // the buyer IS the top bidder (they're now paying the buyout instead, so
    // their held bid must come back).
    if (listing.currentBidderId && listing.currentBid) {
      await refundTx(tx, guildId, listing.currentBidderId, listing.currentBid);
    }

    // Pay the seller (minus fee) and grant the card to the buyer.
    await getOrCreateCurrencyTx(tx, guildId, listing.sellerId);
    await tx.update(userCurrencyTable)
      .set({ shards: sql`${userCurrencyTable.shards} + ${proceedsFor(price)}`, totalEarned: sql`${userCurrencyTable.totalEarned} + ${proceedsFor(price)}`, updatedAt: new Date() })
      .where(and(eq(userCurrencyTable.guildId, guildId), eq(userCurrencyTable.userId, listing.sellerId)));
    await grantCardTx(tx, guildId, buyerId, listing.cardId);

    return { ok: true as const, price, sellerId: listing.sellerId, cardId: listing.cardId };
  }).catch((err: unknown) => {
    const msg = err instanceof Error ? err.message : "";
    if (msg === "own_listing") return { ok: false as const, reason: "own_listing" as const };
    if (msg === "insufficient") return { ok: false as const, reason: "insufficient" as const };
    throw err;
  });
}

// ── Place a bid on an auction (escrow shards, refund previous bidder) ─────────
export type BidResult =
  | { ok: true; listing: MarketListing }
  | { ok: false; reason: "gone" | "own_listing" | "too_low" | "insufficient" | "ended" | "not_auction"; min?: number };

export async function placeBid(guildId: string, bidderId: string, listingId: number, amount: number): Promise<BidResult> {
  await getOrCreateCurrency(guildId, bidderId);
  return await db.transaction(async (tx) => {
    const [listing] = await tx.select().from(marketListingsTable)
      .where(eq(marketListingsTable.id, listingId)).limit(1).for("update");
    if (!listing || listing.status !== "active") return { ok: false as const, reason: "gone" as const };
    if (listing.kind !== "auction") return { ok: false as const, reason: "not_auction" as const };
    if (listing.sellerId === bidderId) return { ok: false as const, reason: "own_listing" as const };
    if (listing.expiresAt && listing.expiresAt.getTime() <= Date.now()) return { ok: false as const, reason: "ended" as const };

    const min = listing.currentBid != null ? listing.currentBid + MIN_BID_INCREMENT : listing.price;
    if (amount < min) return { ok: false as const, reason: "too_low" as const, min };

    // Escrow the new bid from the bidder.
    const debit = await tx.update(userCurrencyTable)
      .set({ shards: sql`${userCurrencyTable.shards} - ${amount}`, updatedAt: new Date() })
      .where(and(
        eq(userCurrencyTable.guildId, guildId),
        eq(userCurrencyTable.userId, bidderId),
        sql`${userCurrencyTable.shards} >= ${amount}`,
      ))
      .returning({ id: userCurrencyTable.id });
    if (debit.length === 0) return { ok: false as const, reason: "insufficient" as const };

    // Refund the previous bidder's escrow.
    if (listing.currentBidderId && listing.currentBid) {
      await refundTx(tx, guildId, listing.currentBidderId, listing.currentBid);
    }

    const [updated] = await tx.update(marketListingsTable)
      .set({ currentBid: amount, currentBidderId: bidderId })
      .where(eq(marketListingsTable.id, listingId))
      .returning();
    return { ok: true as const, listing: updated! };
  });
}

// ── Cancel a listing (return card to seller, refund any bidder) ──────────────
export type CancelResult =
  | { ok: true; cardId: number; refundedBidder?: string }
  | { ok: false; reason: "gone" | "not_seller" | "has_bids" };

export async function cancelListing(guildId: string, sellerId: string, listingId: number): Promise<CancelResult> {
  return await db.transaction(async (tx) => {
    const [listing] = await tx.select().from(marketListingsTable)
      .where(eq(marketListingsTable.id, listingId)).limit(1).for("update");
    if (!listing || listing.status !== "active") return { ok: false as const, reason: "gone" as const };
    if (listing.sellerId !== sellerId) return { ok: false as const, reason: "not_seller" as const };

    await tx.update(marketListingsTable)
      .set({ status: "cancelled", resolvedAt: new Date() })
      .where(eq(marketListingsTable.id, listingId));

    // Return the escrowed card to the seller.
    await grantCardTx(tx, guildId, sellerId, listing.cardId);

    // Refund a standing bidder if any.
    let refundedBidder: string | undefined;
    if (listing.currentBidderId && listing.currentBid) {
      await refundTx(tx, guildId, listing.currentBidderId, listing.currentBid);
      refundedBidder = listing.currentBidderId;
    }
    return { ok: true as const, cardId: listing.cardId, refundedBidder };
  });
}

// ── Resolve expired auctions (sweeper) ───────────────────────────────────────
export interface ResolvedAuction {
  listing: MarketListing;
  outcome: "sold" | "returned";
}

export async function resolveDueAuctions(now = new Date(), limit = 25): Promise<ResolvedAuction[]> {
  // Find due auctions first (cheap), then resolve each in its own transaction.
  const due = await db.select().from(marketListingsTable)
    .where(and(
      eq(marketListingsTable.status, "active"),
      eq(marketListingsTable.kind, "auction"),
      lte(marketListingsTable.expiresAt, now),
    ))
    .limit(limit);

  const resolved: ResolvedAuction[] = [];
  for (const d of due) {
    const r = await resolveOneAuction(d.id);
    if (r) resolved.push(r);
  }
  return resolved;
}

async function resolveOneAuction(listingId: number): Promise<ResolvedAuction | null> {
  return await db.transaction(async (tx) => {
    const [listing] = await tx.select().from(marketListingsTable)
      .where(eq(marketListingsTable.id, listingId)).limit(1).for("update");
    if (!listing || listing.status !== "active") return null;

    if (listing.currentBidderId && listing.currentBid) {
      // Winner already paid (escrowed). Pay seller minus fee, hand over the card.
      await tx.update(marketListingsTable)
        .set({ status: "sold", buyerId: listing.currentBidderId, soldPrice: listing.currentBid, resolvedAt: new Date() })
        .where(eq(marketListingsTable.id, listingId));
      await getOrCreateCurrencyTx(tx, listing.guildId, listing.sellerId);
      await tx.update(userCurrencyTable)
        .set({ shards: sql`${userCurrencyTable.shards} + ${proceedsFor(listing.currentBid)}`, totalEarned: sql`${userCurrencyTable.totalEarned} + ${proceedsFor(listing.currentBid)}`, updatedAt: new Date() })
        .where(and(eq(userCurrencyTable.guildId, listing.guildId), eq(userCurrencyTable.userId, listing.sellerId)));
      await grantCardTx(tx, listing.guildId, listing.currentBidderId, listing.cardId);
      return { listing, outcome: "sold" as const };
    }

    // No bids — return the card to the seller.
    await tx.update(marketListingsTable)
      .set({ status: "expired", resolvedAt: new Date() })
      .where(eq(marketListingsTable.id, listingId));
    await grantCardTx(tx, listing.guildId, listing.sellerId, listing.cardId);
    return { listing, outcome: "returned" as const };
  });
}

// ── Startup recovery: cards escrowed by a crashed process ────────────────────
// Any auction whose expiry has passed while the bot was down is resolved on the
// next sweep. Nothing else to recover — sales hold the card in the listing row,
// which is durable, and bids are escrowed atomically.

// ── tx helpers ───────────────────────────────────────────────────────────────
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

async function getOrCreateCurrencyTx(tx: Tx, guildId: string, userId: string): Promise<void> {
  await tx.insert(userCurrencyTable).values({ guildId, userId }).onConflictDoNothing();
}

async function refundTx(tx: Tx, guildId: string, userId: string, amount: number): Promise<void> {
  await getOrCreateCurrencyTx(tx, guildId, userId);
  await tx.update(userCurrencyTable)
    .set({ shards: sql`${userCurrencyTable.shards} + ${amount}`, updatedAt: new Date() })
    .where(and(eq(userCurrencyTable.guildId, guildId), eq(userCurrencyTable.userId, userId)));
}

// Mint-neutral card credit (a move, not a mint) — mirrors restoreCardToUser.
async function grantCardTx(tx: Tx, guildId: string, userId: string, cardId: number): Promise<void> {
  await tx.insert(collectionsTable)
    .values({ guildId, userId, cardId, count: 1 })
    .onConflictDoUpdate({
      target: [collectionsTable.guildId, collectionsTable.userId, collectionsTable.cardId],
      set: { count: sql`${collectionsTable.count} + 1`, lastCaughtAt: new Date() },
    });
}

