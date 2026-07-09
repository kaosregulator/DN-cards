# DN Cards — Marketplace

A player-driven shard economy built alongside the existing trade system. Players
list owned cards for **DN Shards** — either a fixed-price **sale** or a timed
**auction** with bids — and other players buy or bid. A small fee on each sale
acts as a shard **sink**. Purely additive: one new `market_listings` table and
one new `/market` command; the existing `/cards trade` flow is untouched.

## Deployment (one step)

```bash
pnpm --filter @workspace/db push
```

## Commands (`/market`)

- `sell name:<card> price:<shards> [hours:<1-168>] [buyout:<shards>]` — list a
  card. With `hours` it becomes a timed auction (optional instant-buy `buyout`);
  without, a fixed-price sale.
- `browse [seller] [kind]` — see active listings (posts publicly so others can
  buy). Filter by seller or sale/auction.
- `buy id:<#>` — buy a fixed-price listing, or take an auction's buyout.
- `bid id:<#> amount:<shards>` — bid on an auction.
- `cancel id:<#>` — cancel your own listing (returns the card, refunds the top
  bidder).
- `mine` — your active listings and the auctions you're currently winning.

## Safety model (mirrors the trade/battle escrow)

- **Card escrow:** listing a card removes one copy from the seller's collection
  (mint-neutral — a move, not a mint) and holds it on the listing, so it can't
  be burned, traded, or double-sold while listed. It's returned on
  cancel/expiry and handed to the buyer/winner on completion. Only normal copies
  can be listed (shinies are protected).
- **Bid escrow:** placing a bid immediately deducts the bidder's shards; being
  outbid (or a cancel/buyout) refunds them automatically. So the winning bidder
  has already paid when the auction resolves — there's no "winner can't afford
  it" failure.
- **Atomic settlement:** buy, bid, cancel, and auction resolution each run in a
  transaction with `SELECT … FOR UPDATE` + conditional updates, so concurrent
  buyers/bidders can never double-spend a card or shards.
- **Fee sink:** a **5%** fee (`MARKET_FEE_PCT`) is taken from the seller's
  proceeds on every completed sale and burned — a much-needed shard sink.
- **Crash recovery:** auctions whose timer elapsed while the bot was down are
  settled on the next sweep; sale escrow lives in the durable listing row and
  bids are escrowed atomically, so nothing is lost.

## Source (`src/bot/market/`)

| Module | Responsibility |
| --- | --- |
| `db` | Listings + escrow (create/buy/bid/cancel/resolve), all transactional |
| `commands` | `/market` subcommand handlers |
| `sweeper` | Minute-interval auction resolution + best-effort DM notices |

Shards move through the existing currency plumbing (`spendShards`-style atomic
debits and `addShards` credits); no parallel economy is introduced.
