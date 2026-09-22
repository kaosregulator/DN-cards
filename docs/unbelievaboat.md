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
   - Species: dragon, cat, dog, hamster (mystery — rolled when an egg finishes, not when you buy it)
   - Discoveries: normal, shiny (gold + sparkles), exotic (violet/cyan). Not DN Cards rarities.
   - Eggs are inventory: keep, incubate (wall-clock, works offline), hatch, sell, or trade
   - Eight shop eggs plus one daily **limited** egg. Supply is hardcoded at **3**. Admins cannot mint or raise it. Sold out or hatched means trade only.
   - `/pet replay` plays the hatch cinematic again (“hatched you on this day”)
   - Stable holds every companion; the newest hatch becomes active
   - A small UB trade tax is sunk so trading is not a free hatch loop
   - Stages: hatchling → juvenile → adult (real-time growth, optional UB skip)
   - Needs: hunger, cleanliness, happiness, health (decay while AFK)
   - Neglect cycles → eventual death (animated)
   - Shop spends UnbelievaBoat cash when the API token is set. Limited eggs require a real charge.
   - Competitive `/pet challenge` with optional wager + clash GIF
   - Frostwindz pixel eggs + Onocentaur crack frames (same canvas/GIF pipeline)

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
| `/pet` · hub / shop / eggs / hatch / dex / stable / replay / view / challenge / top | Everyone | Care hub, egg counter, petdex |
| `/petadmin` | Admins | Toggle + hatch cost / growth / neglect. Cannot mint limited eggs. |

## Schema

- `lib/db/src/schema/unbelievaboat.ts` — settings, role links, catalog, audit
- `lib/db/src/schema/pets.ts` — settings, pets, challenges, care log, owned eggs, dex, limited drops, trades

### Production (Railway) table creation

Existing Railway databases already have `guild_settings`, so `ensureBaseSchema`
skips `drizzle-kit push`. New addon tables are created automatically on every
deploy by the idempotent boot migration in
`artifacts/api-server/src/index.ts` (`CREATE TABLE IF NOT EXISTS` for `ub_*`
and `pet_*`). No Railway Shell or manual SQL is required — push to GitHub and
deploy; migrations run before the Discord bot starts handling `/pet`.
