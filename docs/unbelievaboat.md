# UnbelievaBoat addon

Addon for DN Cards — does **not** replace shards, packs, or the existing bot. Public messages from this addon post **as UnbelievaBoat** (channel webhook with their name + avatar) so members can see it is powered by the UnbelievaBoat API token you authorized.

## What you get

1. **Discord dashboard** — `/unbelievaboat` (Administrator)
   - Live cash leaderboard (sort total / cash / bank)
   - Adjust cash (delta) or **set** absolute cash
   - Toggle API link, pet spend, **mini-games**, **perk store**
   - **Add perk** — pick a Discord role, price, description, optional icon GIF/URL + purchase message
   - Pets summary + pet tools
   - Optional website mirror still at `/admin/unbelievaboat`

2. **Cash Check-In** — `/cashcheck`
   - Daily UnbelievaBoat cash claim (stacks with UnbelievaBoat’s own rewards)
   - Animated coin spin using the guild currency symbol from the API

3. **Mini-games** (UnbelievaBoat cash, GIF results, webhook-posted)
   - `/cashgames` — hub
   - `/roulette` — red / black / green
   - `/blackjack` — beat the dealer
   - `/russian` — AI avatar duel or live challenge
   - `/rob` — stick-figure stickup
   - `/slut` — PG dramatic beg (command name blurred in embeds)

4. **Perk store** — `/cashstore`
   - Browse admin-linked role perks
   - Buy with UnbelievaBoat cash → grant role + optional purchase embed

5. **Tamagotchi pets** — `/pet` · `/petadmin` (unchanged; spends UnbelievaBoat cash when enabled)

## Railway secrets

| Variable | Notes |
| --- | --- |
| `UNBELIEVABOAT_TOKEN` | From https://unbelievaboat.com/applications — raw token in `Authorization` (no Bearer). Alias: `UNB_TOKEN`. |
| `HOME_GUILD_ID` | Website hub scoped to the home guild. |

Bot also needs **Manage Webhooks** in channels where games/store post publicly (falls back to normal bot messages if missing).

## Discord commands

| Command | Who | Purpose |
| --- | --- | --- |
| `/unbelievaboat` | Admins | Discord economy dashboard |
| `/cashcheck` | Everyone | Cash Check-In (daily) |
| `/cashgames` | Everyone | Games hub |
| `/cashstore` | Everyone | Role perk storefront |
| `/roulette` · `/blackjack` · `/russian` · `/rob` · `/slut` | Everyone | Cash mini-games |
| `/pet` · `/petadmin` | Everyone / admins | Pets addon |

## Schema

- `lib/db/src/schema/unbelievaboat.ts` — settings, role links, catalog, audit, **game state**
- `lib/db/src/schema/pets.ts` — pets tables

Boot migrations create `ub_*` / `pet_*` / `ub_game_state` and add `games_enabled`, `store_enabled`, `daily_min`, `daily_max` on `ub_settings`.
