# DN Cards

DN Cards is DarkNight's collectible military trading card game for the Roblox + Discord community. Members collect cards through random drops, event drops, admin giveaways, and special events. Cards represent military vehicles, ships, aircraft, bosses, community members, and exclusive collectibles.

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
- Card/rank data: `artifacts/api-server/src/bot/cards-data.ts`
- DB helpers: `artifacts/api-server/src/bot/db.ts`

## Architecture decisions

- Bot runs inside the same Express server process (startBot() called from index.ts) — keeps infra simple, one workflow to manage.
- **Command split:** Setup/config commands use `!` prefix (text commands). Quick admin actions + all user commands use slash commands.
- Weighted random card drops: each card has a `dropWeight`; guild-specific rarity weights override per-rarity (stored as nullable ints in guild_settings).
- Multi-card spawns: `cardsPerSpawn` (1/3/5/-1=random) fires N independent spawn events with 5s gaps. `activeSpawns` is `Map<guildId, Map<spawnId, ActiveSpawn>>` to support multiple simultaneous spawns.
- Catch detection: any non-`!` message is checked against ALL active spawns for the guild (case-insensitive).
- Server owner + Discord Administrators always have admin access; additional bot admins stored in DB.
- Collector rank is based on unique cards owned (9 ranks: Recruit → Dark Commander).
- Net worth = sum of (worthValue × count) across all owned cards — used for leaderboard ranking.
- Trading is a propose/accept flow: initiator creates a DB record, target accepts/declines with the trade ID.
- Limited Edition cards have maxCopies; once totalMinted hits the cap, they cannot spawn. Admin-drop only.
- Event Exclusive cards are droppable=false and dropWeight=0 — never appear in random draws, admin-drop only.
- Burn system: destroys one copy, awards burnValue shards to user's DN Shards balance.
- `!setup` wizard: interactive multi-step setup — choose_type → channel → cooldown_number → cooldown_unit → cards_per_spawn → rarity_choice → (5 rarity steps) → test_card. Sessions stored in memory per `guildId:userId`, 5-min timeout.

## Product

### Card Acquisition
- **Random drops**: Cards spawn at configured intervals in the spawn channel
- **Event drops**: Admin force-drops specific cards with `/drop name:<Name>`
- **Admin giveaways**: `/give user:@User name:<Card Name>` — direct award
- **Trading**: Members trade cards 1-for-1 with `/trade user:@User offer:<card> want:<card>`

### Card System
- **5 rarities**: Common (weight 60), Uncommon (25), Rare (10), Epic (4), Legendary (1)
- **Worth values**: Common 10 → Legendary 2500 DN Shards
- **Burn values**: Common 5 → Legendary 1250 DN Shards (50% of worth)
- **Limited Edition**: Admin-created, capped at a set number of copies (4× worth/burn)
- **Event Exclusive**: Admin-drop only, never appear in random spawns (3× worth/burn)
- **Card Types**: tank, aircraft, ship, vehicle, infantry, boss, community, event, achievement, limited

### Economy (DN Shards 💠)
- Earned by burning duplicate cards
- Balance tracked per user per guild
- All-time earned tracked separately from current balance
- Admins can award shards directly with `/giveshards`

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

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Bot Commands Reference

Card catching is text-based — when a card spawns, type its name exactly to catch it.

### User Slash Commands
| Command | Description |
|---|---|
| `/help` | Full command reference |
| `/collection [user]` | View collection with rank and net worth |
| `/rank [user]` | Collector rank and progression |
| `/info name:<Name>` | Card details, worth, burn value, drop chance |
| `/list` | Full roster grouped by rarity |
| `/top` | Leaderboard by net worth |
| `/burn name:<Name>` | Burn a card for DN Shards |
| `/shards [user]` | Check shard balance |
| `/trade user:@User offer:<card> want:<card>` | Propose a trade |
| `/trades` | View pending trades |
| `/accept id:<ID>` | Accept a trade |
| `/decline id:<ID>` | Decline or cancel a trade |

### Admin Quick Actions (Slash Commands)
| Command | Description |
|---|---|
| `/drop [name:<Name>]` | Force-drop a card for events/giveaways |
| `/give user:@User name:<Name>` | Give a card directly to a member |
| `/giveshards user:@User amount:<n>` | Give DN Shards to a member |
| `/takeback user:@User name:<Name>` | Remove a card from a member |
| `/takeshards user:@User amount:<n>` | Deduct DN Shards from a member |

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
