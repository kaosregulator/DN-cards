# DN Cards

DN Cards is DarkNight's collectible military trading card game for the Roblox + Discord community. Members collect cards through random drops, packs, daily rewards, trading, admin giveaways, and special events. Cards represent military vehicles, ships, aircraft, bosses, community members, and exclusive collectibles.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server + Discord bot (port 5000)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string
- Required secret: `DISCORD_BOT_TOKEN` — Discord bot token

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM (enums: rarity, card_type, trade_status)
- Discord: discord.js v14
- Validation: Zod (`zod/v4`), `drizzle-zod`
- Build: esbuild (CJS bundle)

## Where things live

- DB schema: `lib/db/src/schema/cards.ts`
- Bot entry: `artifacts/api-server/src/bot/index.ts`
- Spawn manager: `artifacts/api-server/src/bot/spawn-manager.ts`
- Admin commands: `artifacts/api-server/src/bot/commands/admin.ts`
- User commands: `artifacts/api-server/src/bot/commands/user.ts`
- Trading commands: `artifacts/api-server/src/bot/commands/trading.ts`
- Pack store: `artifacts/api-server/src/bot/commands/pack.ts`
- Daily reward + achievements: `artifacts/api-server/src/bot/commands/daily.ts`
- Achievement engine: `artifacts/api-server/src/bot/achievements.ts`
- Wishlist: `artifacts/api-server/src/bot/commands/wishlist.ts`
- Tradein (5→1 upgrade): `artifacts/api-server/src/bot/commands/tradein.ts`
- Visual config panel: `artifacts/api-server/src/bot/commands/config-panel.ts`
- Card/rank data: `artifacts/api-server/src/bot/cards-data.ts`
- DB helpers: `artifacts/api-server/src/bot/db.ts`
- Slash command registration: `artifacts/api-server/src/bot/commands/register.ts`

## Architecture decisions

- Bot runs inside the same Express server process (startBot() called from index.ts) — keeps infra simple, one workflow to manage.
- **Command split:** Setup/config commands use `!` prefix (text commands). Quick admin actions + all user commands use slash commands.
- Weighted random card drops: each card has a `dropWeight`; guild-specific rarity weights override per-rarity (stored as nullable ints in guild_settings).
- Multi-card spawns: `cardsPerSpawn` (1/3/5/-1=random) fires N independent spawn events with 5s gaps. `activeSpawns` is `Map<guildId, Map<spawnId, ActiveSpawn>>` to support multiple simultaneous spawns.
- Catch detection: any non-`!` message is checked against ALL active spawns for the guild (case-insensitive).
- Server owner + Discord Administrators always have admin access; additional bot admins stored in DB.
- Collector rank is based on unique cards owned (9 ranks: Recruit → Dark Commander).
- Net worth = sum of (worthValue × count) across all owned cards — used for leaderboard ranking.
- Trading is a propose/accept flow: initiator creates a DB record, target accepts/declines with the trade ID. Trades can be cards-only, shards-only, or mixed.
- Limited Edition cards have maxCopies; once totalMinted hits the cap, they cannot spawn. Admin-drop only.
- Event Exclusive cards are droppable=false and dropWeight=0 — never appear in random draws, admin-drop only.
- Burn system: destroys one copy, awards burnValue shards to user's DN Shards balance.
- `!setup` wizard: interactive multi-step setup — choose_type → channel → cooldown_number → cooldown_unit → cards_per_spawn → rarity_choice → (5 rarity steps) → test_card. Sessions stored in memory per `guildId:userId`, 5-min timeout.
- **Pack store atomic claim:** `/pack` open is a single conditional UPDATE that enforces shards ≥ cost, shared cooldown, and per-tier weekly cap (with Monday 00:00 UTC rollover applied inline via CASE). Zero rows = no state change; caller re-reads the row to explain why. Prevents TOCTOU races across concurrent opens. Failed-grant path calls `refundClaim()` to roll back shards + counters.
- **Daily atomic claim:** `/daily` uses `INSERT … ON CONFLICT DO NOTHING` for first-time, then a cooldown-gated UPDATE for repeats. Streak resets via SQL CASE when last claim > 48h ago.
- **Achievements** unlock check fires after catches, /burn, /pack, /trade-accept, /daily, /tradein. Stored in `achievements_unlocked` with a unique (guild, user, key) index so the insert is idempotent.

## Product

### Card Acquisition
- **Random drops**: Cards spawn at configured intervals in the spawn channel
- **Card packs**: `/pack tier:basic|premium|legendary` — buy with DN Shards, opens 5 cards
- **Daily reward**: `/daily` for shards with a 7-day streak bonus
- **Event drops**: Admin force-drops specific cards with `/drop name:<Name>`
- **Admin giveaways**: `/give user:@User name:<Card Name>` — direct award
- **Trading**: `/trade user:@User offer:<card>|shards want:<card>|shards`
- **Trade-in**: `/tradein <rarity>` — burn 5 of one rarity for 1 random card of the next tier up
- **Wishlists**: `/wishlist` — get pinged when wished-for cards spawn

### Card System
- **5 rarities**: Common (weight 60), Uncommon (25), Rare (10), Epic (4), Legendary (1)
- **Worth values**: Common 10 → Legendary 2500 DN Shards
- **Burn values**: Common 5 → Legendary 1250 DN Shards (50% of worth)
- **Limited Edition**: Admin-created, capped at a set number of copies (4× worth/burn)
- **Event Exclusive**: Admin-drop only, never appear in random spawns (3× worth/burn)
- **Card Types**: tank, aircraft, ship, vehicle, infantry, boss, community, event, achievement, limited

### Pack Store (3 tiers)
| Tier | Default Cost | Cards | Weekly Cap | Special |
|---|---|---|---|---|
| 🥉 Basic | 250 💠 | 5 | 50/week | Standard rates (60/25/11/3.5/0.5) |
| 🥈 Premium | 750 💠 | 5 | 20/week | Boosted rare/epic, 6× legendary chance |
| 🥇 Legendary | 2,000 💠 | 5 | 5/week | **No commons**, 20× legendary chance |

- Defaults are EV-tuned (~5% house edge vs. average card worth).
- **Shared cooldown** across all tiers (default 60s, configurable).
- **Separate per-tier weekly caps** — hit Legendary cap, you can still open Basics.
- **Weekly reset**: Monday 00:00 UTC for all three buckets.
- All four knobs (cost / size / cap / shared cooldown) configurable per server via `/config → 🎴 Packs`.
- Use `/packstats` to see your per-tier usage, cooldown remaining, and reset countdown.

### Economy (DN Shards 💠)
- **Earned by**: burning duplicate cards (`/burn`), `/daily` rewards (50 base + streak bonus up to +200), gifts (`/gift`), trade-in upgrades, admin awards (`/giveshards`), achievement unlocks
- **Spent on**: `/pack` openings, `/trade` offers, `/gift` to other members
- Balance + all-time-earned tracked per user per guild
- Admins can deduct with `/takeshards`

### Daily Reward
- 20h cooldown (slight grace so dailies don't drift later each day)
- 48h grace before streak resets to 1
- Base 50 💠 + (streak − 1) × 10, capped at +200 bonus
- 7-day streak unlocks the "Devotee" achievement (+1000 💠)

### Achievements (10 unlockable)
Auto-unlock with a shard reward and ephemeral notification on the triggering action.
- 🎣 First Catch (50) · 📦 Rookie 10 unique (100) · 💼 Elite 50 (500) · 🏆 Master 100 (1500)
- 🌟 Legendary Hunter — own ≥1 Legendary (750) · 👑 Sovereign — own every Legendary (5000)
- 🔥 Pyromaniac — burn 50 (500) · 🤝 Diplomat — first trade (200)
- 🎴 Pack Addict — open 10 packs (1000) · 📅 Devotee — 7-day daily streak (1000)

### Collector Progression (9 ranks)
| Rank | Emoji | Unique Cards Needed |
|---|---|---|
| Recruit | 🪖 | 0 |
| Private | ⭐ | 5 |
| Corporal | ⭐⭐ | 15 |
| Sergeant | 🎖️ | 30 |
| Lieutenant | 🔰 | 50 |
| Captain | 🏅 | 75 |
| Colonel | 🌟 | 100 |
| General | 💎 | 150 |
| Dark Commander | 👑 | 200 |

### Default Card Roster (27 cards)
Seeded on first boot. All military-themed.
- 8 Common: M4 Sherman, Jeep Willys, Dog Tags, M1 Helmet, Radio Set, Supply Truck, Recon Drone, Sandbag Bunker
- 6 Uncommon: M1 Abrams, AH-64 Apache, USS Arleigh Burke, F-16 Fighting Falcon, Bradley IFV, T-80 Objekat
- 6 Rare: F-22 Raptor, USS Nimitz, Leopard 2A7, T-14 Armata, B-2 Spirit, USS Virginia
- 4 Epic: SR-71 Blackbird, USS Gerald R. Ford, F-35 Lightning II, Night Stalker
- 3 Legendary: Darknight Titan, Operation Zero, The Warlord

## Gotchas

- The bot requires `MESSAGE_CONTENT` intent — enable in Discord Developer Portal (Bot → Privileged Gateway Intents).
- The bot requires `SERVER MEMBERS` intent — also enable in the portal.
- After changing the DB schema, always run `pnpm --filter @workspace/db run push` then `pnpm run typecheck:libs` to regenerate types before building.
- DB enums (rarity, card_type, trade_status) require `push-force` if enum values change.
- Slash commands are registered globally + per-guild on every restart. Guild commands take effect instantly; global propagation can take up to 1h on first deploy.
- Bot invite must include `applications.commands` scope so slash commands appear in the server.
- Card images for `!addcard`, `!addlimited`, `!addevent` are added via URL only (no attachment support in prefix commands). For guaranteed permanence use Imgur or similar; Discord CDN URLs are stable as long as the source message exists.
- Discord caps: 5 components per ActionRow, 5 rows per message, 4096 chars per embed description, 1024 chars per embed field value, 25 fields per embed — all enforced or budgeted in the codebase.
- `user_currency` has no unique `(guildId, userId)` index — preexisting. Race-only risk on a user's first-ever currency-creating action; new pack code uses atomic UPDATE which is safe once a row exists.

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

- Pack tier naming: **Basic / Premium / Legendary** (chosen May 2026)
- Weekly caps: **separate per tier** (not shared)
- Pack cooldown: **shared across all tiers**
- Default pricing: **EV-fair** (~5–10% house edge)

## Bot Commands Reference

Card catching is text-based — when a card spawns, type its name exactly to catch it.

### User Slash Commands
| Command | Description |
|---|---|
| `/help` | Full command reference |
| `/collection [user]` | Collection with rank, net worth, achievements summary |
| `/rank [user]` | Collector rank and progression |
| `/info name:<Name>` | Card details, worth, burn value, drop chance |
| `/list` | Full roster grouped by rarity |
| `/catalog` | Browse cards by category — see what you own and what's missing |
| `/top` | Top 10 net-worth leaderboard + top 5 pack openers |
| `/burn name:<Name>` | Burn a card for DN Shards |
| `/shards [user]` | Check shard balance |
| `/daily` | Claim daily shards (with streak bonus) |
| `/pack tier:<basic\|premium\|legendary>` | Open a pack |
| `/packstats` | Your pack costs, weekly caps, cooldown |
| `/tradein rarity:<r>` | Burn 5 of one rarity for 1 random card of the next tier |
| `/wishlist` | Manage your wishlist — get pinged on spawn |
| `/achievements [user]` | View unlocked achievements |
| `/trade user:@User offer want` | Propose a trade (cards, shards, or both) |
| `/gift user:@User amount:<n>` | Gift shards to another member |
| `/trades` | View pending trade offers |
| `/tradehistory [user]` | Recent completed trades, newest first |
| `/accept id:<ID>` | Accept a trade |
| `/decline id:<ID>` | Decline or cancel a trade |

### Admin Quick Actions (Slash Commands)
| Command | Description |
|---|---|
| `/config` | Visual config panel (toggles, intervals, rates, packs sub-panel) |
| `/adminhub` | Ephemeral admin hub — manage bot admins, catch timeouts, server state |
| `/adminhelp` | Show admin & setup command reference |
| `/drop [name:<Name>]` | Force-drop a card for events/giveaways |
| `/massdrop` | Drop a big batch of cards — mostly low tier with a few bangers |
| `/give user:@User name:<Name>` | Give a card directly to a member |
| `/giveshards user:@User amount:<n>` | Give DN Shards to a member |
| `/takeback user:@User name:<Name>` | Remove a card from a member |
| `/takeshards user:@User amount:<n>` | Deduct DN Shards from a member |
| `/loadset` | Upload a JSON card set to add to your roster |
| `/unloadset` | Remove a card set (cards + related collections/trades) |
| `/listsets` | List all loaded card sets and their sizes |

### Setup & Config Commands (`!` prefix — admin only)
| Command | Description |
|---|---|
| `!setup` | Interactive setup wizard (channel → interval → cards per drop → rarity → test card) |
| `!setchannel #channel` | Set spawn channel |
| `!setinterval <time>` | Fixed interval (e.g. `30m`, `1h`, `2h`) |
| `!setinterval random <min> <max>` | Random interval range (e.g. `10m 60m`) |
| `!setwindow <time>` | Catch window duration |
| `!setdrops 1\|3\|5\|random` | Cards per spawn batch |
| `!setrarity <rarity> <weight>` | Customize drop weight for a rarity tier |
| `!spawnenable` / `!spawndisable` | Toggle auto-spawning |
| `!tradingenable` / `!tradingdisable` | Toggle trading |
| `!settradechannel #channel` | Set dedicated trade channel |
| `!addcard <rarity> <Name> \| <desc>` | Add a standard card |
| `!addlimited <rarity> <maxcopies> <Name> \| <desc>` | Add limited edition card |
| `!addevent <rarity> <Name> \| <desc>` | Add event exclusive card |
| `!removecard <Name>` | Remove a card from the pool |
| `!addadmin @User` | Grant bot admin access |
| `!removeadmin @User` | Revoke bot admin access |
| `!listadmins` | List bot admins |
| `!settings` | View current server configuration |

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
