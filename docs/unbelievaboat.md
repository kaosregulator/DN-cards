# UnbelievaBoat addon

Addon for DN Cards — does **not** replace shards, packs, or the existing bot. Public results post **as UnbelievaBoat** (channel webhook).

## Money

Bets and store purchases spend **cash first, then bank** via the UnbelievaBoat API. Wins credit **cash**.

Casino vault:

| Command | Effect |
| --- | --- |
| `/casino deposit amount:` | Cash → bank |
| `/casino withdraw amount:` | Bank → cash |
| `/casino balance` | Wallet view |

## Cooldowns

UnbelievaBoat’s Discord `set-cooldown` / `set-game-cooldown` settings are **not** on their public REST API. We mirror FAQ defaults in `/unbelievaboat` → **Cooldowns** (editable):

| Kind | Default |
| --- | --- |
| Cash Check-In (`/casino daily`) | 20h |
| Role collect (`/casino collect`) | 24h |
| Work / Crime / Beg | 4h |
| Rob | 24h |
| Games | 4 plays / 5 minutes |

## Discord dashboard — `/unbelievaboat`

Leaderboard · adjust/set cash · toggles · add perk (with **collect income**) · cooldowns · **log channel** · **rob immunity roles** · pets tools.

## Player hub — `/casino`

All player economy/casino actions live under **`/casino`** (full floor dashboard).
**Also:** 18 short aliases ending in **`_ub`** (`/daily_ub`, `/slots_ub`, …) — Discord
forces lowercase, so the suffix avoids colliding with DN `/daily` (shards).

| Subcommand | Notes |
| --- | --- |
| `daily` | Animated Cash Check-In — coins reverse-collect into wallet |
| `collect` | Role income from owned perk roles (animated) |
| `deposit` / `withdraw` | Casino vault |
| `blackjack` | Interactive 21 — Hit / Stand / Double Down |
| `higherlower` · `redblack` | Card guesses |
| `roulette` · `slots` | Table games |
| `uno` | Mini UNO vs house — buttons, 2× pot |
| `russian` · `rob` · `beg` | Challenge / stick-up (honors immunity) / PG beg |
| `work` · `crime` | Income |
| `store` | Role perk store |
| `top` | Dex N Cards × UnbelievaBoat animated leaderboard |
| `games` | Menu |

Floor webhooks append `_▶️ Run \`/…_ub\` · all tables: \`/casino\`` so bystanders see the slash.

## Logs

`/unbelievaboat` → **Log channel** — universal economy/casino logs (avatar, timestamp, action). Categories: economy · games · trades · quiet · admin · bot.

## Rob immunity

`/unbelievaboat` → **Rob immunity** — pick Discord roles that `/casino rob` cannot target.

## Schema

`ub_settings` · `ub_game_state` · `ub_role_links` · `ub_store_catalog` · `ub_audit_log`
(plus columns like `log_channel_id`, `rob_immune_role_ids`, `cooldowns`, `income_amount`).

On Railway, `start-production.mjs` + boot migrations `CREATE TABLE IF NOT EXISTS` these
on every redeploy when drizzle push is skipped — no manual push needed. See `docs/railway.md`.

## Slash command budget

`/casino` hub + 18 `*_ub` shortcuts ≈ **78** chat-input (under Discord’s 100). Prefer new
games as `/casino` subcommands (max 25 per command) instead of more top-level names.
Slash registration runs automatically on bot login — redeploy is enough.

## Secrets

`UNBELIEVABOAT_TOKEN` · bot needs **Manage Webhooks** for public UnbelievaBoat posting.
