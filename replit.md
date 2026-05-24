# Discord Trading Card Bot

A Discord bot where members collect trading cards that spawn at random intervals. Cards have 5 rarities with weighted drop chances. Members type the card name to catch it. Admins control everything via commands.

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
- DB: PostgreSQL + Drizzle ORM
- Discord: discord.js v14
- Validation: Zod (`zod/v4`), `drizzle-zod`
- Build: esbuild (CJS bundle)

## Where things live

- DB schema: `lib/db/src/schema/cards.ts`
- Bot entry: `artifacts/api-server/src/bot/index.ts`
- Spawn manager: `artifacts/api-server/src/bot/spawn-manager.ts`
- Admin commands: `artifacts/api-server/src/bot/commands/admin.ts`
- User commands: `artifacts/api-server/src/bot/commands/user.ts`
- Default card data: `artifacts/api-server/src/bot/cards-data.ts`

## Architecture decisions

- Bot runs inside the same Express server process (startBot() called from index.ts) — keeps infra simple, one workflow to manage.
- Weighted random card drops: each card has a `dropWeight`; higher = more common. Total weight is dynamic so adding cards doesn't break percentages.
- One active spawn per guild at a time — prevents flooding; forced drops restart the normal timer afterward.
- Catch detection: any non-command message is checked against the active spawn name (case-insensitive exact match).
- Server owner + Discord Administrators always have admin access; additional bot admins stored in DB.

## Product

- **Card spawning**: Cards spawn automatically in a configured channel at a fixed or random interval. Members type the exact card name to catch it within a time window.
- **5 rarities**: Common (60), Uncommon (25), Rare (10), Epic (4), Legendary (1) — weighted drop pool.
- **16 default cards** seeded on first boot across all rarities.
- **Collections**: Each user has a per-guild collection tracking count and first/last caught timestamps.
- **Leaderboard**: Top 10 collectors by total cards.
- **Admin commands**: Full control over spawn channel, interval (fixed or random range), catch window, enable/disable, force drops, add/remove cards, add/remove bot admins.

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Gotchas

- The bot requires `MESSAGE_CONTENT` intent — enable it in the Discord Developer Portal (Bot → Privileged Gateway Intents → Message Content Intent).
- The bot requires `SERVER MEMBERS` intent — also enable in the portal.
- After changing the DB schema, always run `pnpm --filter @workspace/db run push`.
- `!card admin` is an alias prefix — e.g. `!card admin drop` works the same as `!card drop`.

## Bot Commands Reference

### User Commands
| Command | Description |
|---|---|
| `!card help` | Show command list |
| `!card collection [@user]` | View your or someone's collection |
| `!card info <Name>` | Card details and drop chance |
| `!card list` | All cards in pool grouped by rarity |
| `!card top` | Top 10 leaderboard |

### Admin Commands (Server Owner / Discord Admin / Bot Admin)
| Command | Description |
|---|---|
| `!card setchannel [#channel]` | Set the spawn channel |
| `!card setinterval <time>` | Fixed spawn interval (e.g. `30m`, `1h`, `90s`) |
| `!card setinterval random <min> <max>` | Random interval range (e.g. `10m 60m`) |
| `!card setwindow <time>` | Catch window before card expires |
| `!card enable` / `!card disable` | Toggle auto spawning |
| `!card drop [Card Name]` | Force-drop a card (random or specific) |
| `!card addcard <rarity> <Name> \| <desc>` | Add a custom card |
| `!card removecard <Name>` | Remove a card from the pool |
| `!card addadmin @User` | Grant bot admin access |
| `!card removeadmin @User` | Revoke bot admin access |
| `!card listadmins` | List bot admins |
| `!card settings` | View current server settings |

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
