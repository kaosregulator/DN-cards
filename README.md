# DN Cards

DarkNight's collectible military trading card game for the Roblox + Discord community. Members collect cards through random drops, packs, daily rewards, trading, admin giveaways, and limited-time events.

## Quick start

```bash
pnpm install
pnpm --filter @workspace/db run push       # apply schema to your Postgres
pnpm --filter @workspace/api-server run dev # run the API + Discord bot
```

Required environment:
- `DATABASE_URL` — Postgres connection string
- `DISCORD_BOT_TOKEN` — bot token (enable `MESSAGE_CONTENT` + `SERVER MEMBERS` intents in the Developer Portal)

## Stack

pnpm workspaces · Node 24 · TypeScript 5.9 · Express 5 · PostgreSQL + Drizzle ORM · discord.js v14 · Zod.

## Project layout

- `artifacts/api-server` — Express server + Discord bot (slash + `!` prefix commands)
- `artifacts/dashboard` — admin dashboard (embed customization, etc.)
- `lib/db` — Drizzle schema + migrations
- `lib/api-spec` — OpenAPI contract + generated clients/schemas

## Docs

See [`replit.md`](./replit.md) for the full feature reference: command list, card system, pack store, achievements, ranks, architecture decisions, and gotchas.
