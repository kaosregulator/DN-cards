import {
  pgTable, text, serial, integer, timestamp, index,
} from "drizzle-orm/pg-core";
import { cardsTable } from "./cards";

// ─────────────────────────────────────────────────────────────────────────────
// DN Cards — Marketplace (shard economy on top of the existing trade system)
//
// Players list owned cards for shards — either a fixed-price SALE or a timed
// AUCTION with bids — and other players buy or bid. Purely additive: one table.
//
// Card escrow: when a card is listed, one copy is removed from the seller's
// collection (mint-neutral, like the battle/trade escrow) and held by the
// listing, so it can't be burned, traded, or double-sold while listed. It's
// returned on cancel/expiry and handed to the buyer/winner on completion.
//
// Bid escrow: a bid immediately deducts the bidder's shards (held as
// `currentBid`); being outbid refunds them. So the winning bidder has already
// paid when an auction resolves — no "winner can't afford it" failure.
//
// A sale/auction fee (a % of the final price) is burned as a shard SINK.
// ─────────────────────────────────────────────────────────────────────────────

export const marketListingsTable = pgTable("market_listings", {
  id: serial("id").primaryKey(),
  guildId: text("guild_id").notNull(),
  sellerId: text("seller_id").notNull(),
  cardId: integer("card_id").notNull().references(() => cardsTable.id),
  kind: text("kind").notNull(),            // "sale" | "auction"
  // sale: fixed buy price. auction: starting minimum bid.
  price: integer("price").notNull(),
  // auction only: optional instant-buy price (null = none).
  buyout: integer("buyout"),
  // auction only: highest bid so far (escrowed from currentBidderId).
  currentBid: integer("current_bid"),
  currentBidderId: text("current_bidder_id"),
  status: text("status").notNull().default("active"), // active | sold | cancelled | expired
  buyerId: text("buyer_id"),               // set on sale/auction win
  soldPrice: integer("sold_price"),        // final price paid
  expiresAt: timestamp("expires_at"),      // auctions only
  createdAt: timestamp("created_at").notNull().defaultNow(),
  resolvedAt: timestamp("resolved_at"),
}, (t) => ({
  byGuildStatus: index("market_listings_guild_status_idx").on(t.guildId, t.status),
  byExpiry: index("market_listings_expiry_idx").on(t.status, t.expiresAt),
}));

export type MarketListing = typeof marketListingsTable.$inferSelect;
