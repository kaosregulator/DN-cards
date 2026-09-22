# UnbelievaBoat addon

Addon for DN Cards — does **not** replace shards, packs, Bob, or the existing bot.

## What you get

1. **Admin hub** — dashboard at `/admin/unbelievaboat`
   - Live UnbelievaBoat leaderboard (cash / bank / total)
   - Edit users: relative **patch** or absolute **set** for cash/bank (move someone up or down)
   - Role links stored locally; optionally create a UB store item that grants the Discord role
   - Local store catalog (including pet-shop goods) with one-click **Sync** to UnbelievaBoat
   - Pet game tuning + living-pet power board
   - Audit log of hub actions

2. **Discord Tamagotchi** — `/pet` + `/petadmin`
   - Species: dragon, cat, dog, hamster
   - Stages: egg → hatchling → juvenile → adult (real-time growth)
   - Needs: hunger, cleanliness, happiness, health (decay while AFK)
   - Neglect cycles → eventual death (animated)
   - Shop spends UnbelievaBoat cash when the API token is set
   - Competitive `/pet challenge` with optional wager + clash GIF
   - Procedural animated GIFs (same canvas/GIF pipeline as pack/battle/`/emoji`)

## Railway secrets

| Variable | Notes |
| --- | --- |
| `UNBELIEVABOAT_TOKEN` | From https://unbelievaboat.com/applications — put the raw token in `Authorization` (no Bearer). Alias: `UNB_TOKEN`. |
| `HOME_GUILD_ID` | Dashboard hub is scoped to the home guild. |

Create the application token at UnbelievaBoat, authorize it for your Discord server, then paste it into Railway. Schema tables (`ub_*`, `pet_*`) are pushed with the normal Drizzle boot path (`AUTO_DB_PUSH` / first-boot push).

## API surface (server)

All under `/api/admin/ub/*` (dashboard auth required). Client: `artifacts/api-server/src/lib/unbelievaboat/client.ts` wrapping https://unbelievaboat.com/api/v1 — see https://api-docs.unbelievaboat.com/reference/reference.

## Discord commands

| Command | Who | Purpose |
| --- | --- | --- |
| `/pet` · hub / hatch / view / challenge / top | Everyone | Care hub + competitive pet game |
| `/petadmin` | Admins | Toggle + hatch cost / growth / neglect |

## Schema

- `lib/db/src/schema/unbelievaboat.ts` — settings, role links, catalog, audit
- `lib/db/src/schema/pets.ts` — settings, pets, challenges, care log

### Production (Railway) table creation

Existing Railway databases already have `guild_settings`, so `ensureBaseSchema`
skips `drizzle-kit push`. New addon tables are created automatically on every
deploy by the idempotent boot migration in
`artifacts/api-server/src/index.ts` (`CREATE TABLE IF NOT EXISTS` for `ub_*`
and `pet_*`). No Railway Shell or manual SQL is required — push to GitHub and
deploy; migrations run before the Discord bot starts handling `/pet`.
