# DN Cards — Quests / Missions

A retention loop layered directly onto the existing `/cards daily` command.
Players get rotating **daily** and **weekly** objectives that span the whole
game — catching, packs, trades, battles, burning — and earn 💠 shards (and the
occasional free pack) automatically as they play.

Purely additive: one new per-guild/per-user table (`quest_progress`) and one new
command. Nothing existing changes.

## Deployment (one step)

```bash
pnpm --filter @workspace/db push
```

## Command

- `/cards quests` — shows your current daily and weekly objectives with live
  progress bars, rewards, and which are already completed.

Rewards are granted the **moment a quest completes** (no manual claim step), and
the flow that triggered the completion (catch, pack, burn, battle, daily) shows
a short "Quest complete!" notice.

## How it works

- **Daily** set: 3 objectives, resets at midnight UTC.
- **Weekly** set: 3 objectives, resets Monday (ISO week, UTC).
- Each player's set is chosen deterministically from a template pool seeded by
  `(userId + periodKey)`, so quests rotate each period and vary between players
  but stay stable within a period.
- Objective types and where they're tracked (all best-effort — a tracking
  failure never breaks the underlying action):

  | Type | Tracked in |
  | --- | --- |
  | `catch` (rarity-aware) | wild-spawn catch + pack pulls |
  | `pack_open` | `/cards pack` |
  | `trade` | `/cards trade` accept (both participants) |
  | `battle_win` | battle reward settlement (winner only) |
  | `burn` | `/cards burn` + catch→burn button |
  | `daily` | `/cards daily` claim |

- Catch quests can require a **minimum rarity** (e.g. "Catch 3 Rare-or-better
  cards"); rarity is compared on the common→mythic ladder.

## Source (`src/bot/quests/`)

| Module | Responsibility |
| --- | --- |
| `engine` | Templates, per-period generation, `recordQuestEvent`, reward grants |
| `command` | `/cards quests` view |

Reward grants reuse the existing shard economy (`addShards`) and free-pack path
(`grantFreePack`), so no new economy surface is introduced.
