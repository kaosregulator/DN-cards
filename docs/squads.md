# DN Cards — Squads (guilds)

Player-created squads with **combined, live stats** and a server-wide **squad
leaderboard** — a natural fit for the military theme. Purely additive: two new
tables (`squads`, `squad_members`). Every stat is **derived** by aggregating the
existing collection / currency / battle-profile tables, so a squad's numbers are
always current and nothing is duplicated.

## Deployment (one step)

```bash
pnpm --filter @workspace/db push
```

## Commands (`/squad`)

- `create name:<n> [tag] [description]` — found a squad; you become its leader.
- `join name:<n>` — join a squad (one squad per player per server).
- `leave` — leave your squad. If a leader leaves, leadership passes to the
  next-oldest member (or the squad disbands if they were the last one).
- `disband` — leader-only; removes the squad.
- `info [name]` — a squad's combined stats + roster (defaults to your squad).
- `list` — the server's squad leaderboard, ranked by Squad Score.

## Combined stats

`/squad info` aggregates across all members: **collection value** (Σ card worth ×
copies), cards held, shards, packs opened, battles won/lost, and cards burned.

**Squad Score** (the leaderboard ranking) = `collectionValue + wins×200 +
burns×5` — rewarding collecting, battling, and activity together.

## Source (`src/bot/squad/`)

| Module | Responsibility |
| --- | --- |
| `db` | Membership CRUD + live stat aggregation + leaderboard |
| `commands` | `/squad` subcommand handlers |

## Future extension

This ships **squads within a server**. True **server-vs-server** competition
(one whole server's aggregate score vs another's) needs the same cross-guild
opt-in plumbing as the global battle leaderboard; the aggregation helpers here
are structured so that can be layered on without a rewrite.
