# DN Cards — Battle System

A Discord-first, turn-based card battle mini-game bolted **directly onto the
existing project**. It reuses the current database, card ownership, inventory,
rarity, packs, DN Shards economy, user profiles, per-guild architecture, and bot
framework. Nothing existing is replaced — the battle system only adds new tables
and new commands.

## Deployment (one step)

The feature is purely additive. After pulling this branch, create the new tables
with the existing Drizzle push workflow — **no data migration, no server
migration**:

```bash
pnpm --filter @workspace/db push
```

Existing cards, collections, shards, and profiles are untouched. Every battle
table is keyed by `guild_id`, so each server is isolated. On any server that
already has the bot, `/battle` and `/battleadmin` appear automatically; battles
stay locked until an admin runs the **Setup Wizard** (`/battleadmin` → Setup
Wizard), which flips `setup_complete` and enables play with sensible defaults.

## Player commands (`/battle`)

- `/battle fight [opponent]` — challenge a player, or leave empty to battle the
  **AI** (Easy → Nightmare). The whole battle runs inside **one live-updating
  message**: challenge → prep (pick card, optional special support card, coin
  call, optional stake) → cinematic intro → turn-based combat (Attack, Special,
  Defend, Special Card, Charge, Skip, Ultimate) → winner screen → automatic
  rewards.
- `/battle profile [user]` — record, rank, win rate, damage, crits, favorite
  card, streaks, titles.
- `/battle leaderboard [scope] [sort]` — per-guild or opt-in global rankings.
- `/battle achievements [user]` — First Blood, Centurion, Collector, Legend,
  Lucky Strike, Unstoppable, Perfect Victory, Comeback, Critical Master, Battle
  King.
- `/battle daily` — three daily objectives that auto-reward on completion.

## Admin (`/battleadmin`)

A single ephemeral, button-driven hub: Setup Wizard, enable/disable, channels,
combat **Rules** and stat **Formulas** (all configurable), **Rewards** (shards,
XP, daily caps, free-pack streak), **Cards** (min/max rarity, allowed types,
special-card & staking toggles, per-card enable/disable + stat/effect overrides),
and management (leaderboard reset, new season, global-leaderboard opt-in). Every
setting saves per guild.

## Architecture (`src/bot/battle/`)

Modular engines so future modes (2v2, boss raids, tower, tournaments, …) can be
layered on without rewriting the core:

| Module | Responsibility |
| --- | --- |
| `config-engine` | Per-guild `battle_settings` (Configuration Engine) |
| `stat-engine` | Derives the battle-stat layer from existing card data (Stat Engine) |
| `special-cards` | Support-card effect registry (Special Card Engine) |
| `combat-engine` | Turn resolution + random events (Battle Engine) |
| `ai-engine` | Difficulty-scaled computer opponent (AI Engine) |
| `reward-engine` | Shards/XP/rank/stake settlement (Reward Engine + Inventory Integration) |
| `achievement-engine` | Battle achievements, badges, titles (Achievement Engine) |
| `leaderboard-engine` | Rankings + stat views (Leaderboard Engine) |
| `season-engine` | Seasonal resets (Season Engine) |
| `daily-engine` | Daily challenges |
| `embeds` | HP/energy/ultimate bars, intro frames, victory screen (Animation Engine) |
| `logging-engine` | Posts results to the guild log channel (Logging Engine) |
| `battle-manager` | State machine + Discord interactions (ties it together) |
| `db` | Battle data-access layer |

## Database safety

- **Multiple-battle prevention / card locking:** `battle_locks` has a unique
  `(guild_id, user_id)` index — a player can't be in two battles at once, and
  the staked card id is locked on the row.
- **Ownership validation & no double-transfer:** staked cards settle via the
  existing `removeCardFromUser` + `restoreCardToUser` helpers with an ownership
  re-check at settle time, so a card can't be duplicated or moved twice.
- **Reward protection:** a per-day rewarded-battle cap throttles farming; shards
  flow through the existing atomic `addShards`.
- **Race protection:** an in-memory per-move processing guard plus a stale-lock
  sweep for crash recovery.
