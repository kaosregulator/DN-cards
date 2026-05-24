---
name: DN Cards architecture
description: Key decisions and gotchas for the DN Cards Discord bot project.
---

# DN Cards Architecture

**Why:** DarkNight military collectible card game for Roblox/Discord community. Long-term Pokémon-style TCG.

## Bot process
- Bot runs inside the Express server process via `startBot()` in `src/index.ts` — one workflow, no separate service.
- `initAllGuilds()` re-schedules all active guild spawn timers on every restart.

## DB enums
- Schema uses Drizzle `pgEnum` for `rarity`, `card_type`, and `trade_status`.
- Adding new enum values requires `pnpm --filter @workspace/db run push-force` (not plain push).
- Composite libs must be rebuilt first: `pnpm run typecheck:libs`.

## Card droppability
- `droppable: false` + `dropWeight: 0` = event/limited cards never appear in random draws.
- Admin force-drops with `!card drop <Name>` bypass droppability.
- `maxCopies` on limited edition cards: spawn manager checks `totalMinted >= maxCopies` and skips.

## Economy
- DN Shards tracked in `user_currency` table, per guild per user.
- `totalEarned` is append-only; `shards` is current spendable balance.
- Burn value = 50% of worth for standard cards; 4× worth/burn for limited, 3× for event exclusives.

## Trading
- Propose/accept flow. Trade stored in `trades` table with status enum.
- `executeTradeSwap` verifies both parties still own cards before swapping. Returns false if stale.
- Trades auto-expire after 24h (setTimeout in trading.ts — non-persistent across restarts; acceptable for now).

## Collector ranks
- 9 ranks from Recruit (0) to Dark Commander (200 unique cards).
- Rank based on unique cards, not total. Net worth (worthValue × count sum) used for leaderboard.

## How to apply
- Always rebuild libs before pushing schema: `pnpm run typecheck:libs && pnpm --filter @workspace/db run push-force`
- New card types or rarities need enum updates → push-force.
- Bot admin check order: guild owner → Discord Administrator permission → `admin_users` DB table.
