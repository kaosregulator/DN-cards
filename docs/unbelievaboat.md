# UnbelievaBoat addon

Addon for DN Cards — does **not** replace shards, packs, or the existing bot. Public results post **as UnbelievaBoat** (channel webhook).

## Money

Bets and store purchases spend **cash first, then bank** via the UnbelievaBoat API. Wins credit **cash**.

## Cooldowns

UnbelievaBoat’s Discord `set-cooldown` / `set-game-cooldown` settings are **not** on their public REST API. We mirror FAQ defaults in `/unbelievaboat` → **Cooldowns** (editable):

| Kind | Default |
| --- | --- |
| Cash Check-In | 20h |
| Work / Crime / Beg | 4h |
| Rob | 24h |
| Games | 4 plays / 5 minutes |

## Discord dashboard — `/unbelievaboat`

Leaderboard · adjust/set cash · toggles · add perk · **cooldowns** · pets tools.

## Player commands

| Command | Notes |
| --- | --- |
| `/cashcheck` | Daily Cash Check-In (coin spin) |
| `/cashwork` · `/cashcrime` | Income (safe / risky) |
| `/blackjack` | **Interactive 21** — Hit / Stand / Double Down |
| `/higherlower` | Guess next card |
| `/redblack` | Color flip ×2 |
| `/roulette` | Felt-table spin |
| `/slots` | Three-reel machine |
| `/russian` · `/rob` · `/slut` | Challenge / stick-up / PG beg |
| `/cashgames` | Hub |
| `/cashstore` | Role perk store |

## Schema

`ub_settings.cooldowns` jsonb · `ub_game_state` (+ `last_work_at`, `last_crime_at`) · boot ALTERs included.

## Secrets

`UNBELIEVABOAT_TOKEN` · bot needs **Manage Webhooks** for public UnbelievaBoat posting.
