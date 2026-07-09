# DN Cards — Co-op Boss Raids

An end-game **team** mode: 2–4 players gang up on an **admin-created boss** with
a shared, party-scaled health pool. Unlike the AI battle (1v1 vs the computer),
a raid is genuinely cooperative and strategic — the boss focuses the weakest
fighter and periodically **sweeps** the whole party, so players must coordinate
attacks, defends, and charges to survive.

Purely additive: one new `raid_bosses` table and two commands (`/raid`,
`/raidadmin`). Live raids run in memory (like live battles) since raids never
risk a player's cards. Combat **reuses the existing battle engine** (stat
derivation, damage/crit/dodge, statuses) so it behaves exactly like a battle.

## Deployment (one step)

```bash
pnpm --filter @workspace/db push
```

## Entry gates (the "5-star" requirement)

To join a raid a player must bring a card that meets the boss's **star gate**
and be at (or above) its **battle-level gate**:

- **Card stars** come from card leveling — a card earns a star at levels
  **1 / 5 / 10 / 15 / 20**, so a fully-maxed card is **5 stars** (see
  `/cards level`). Bosses default to a **5-star** requirement.
- **Battle level** is the player's `/battle profile` level.

Both gates are per-boss and admin-tunable.

## Player commands (`/raid`)

- `/raid bosses` — list the raid bosses available on the server.
- `/raid start boss:<name>` — open a raid lobby. Players click **Join**, pick an
  eligible card, and the starter clicks **Begin** once enough have joined. Each
  round every living fighter picks **Attack / Special / Defend / Charge**; the
  round resolves when all have acted (or after 60s). Clear the boss for rewards;
  a wipe or the round cap ends it.

## Admin commands (`/raidadmin`)

- `create name:<n> …` — make a boss. Tunables: `description`, `image`,
  `archetype`, `rarity`, `health`, `attack`, `defense`, `minstars`, `minlevel`,
  `minplayers`, `maxplayers`, `enrage`, `reward`, `cardxp`.
- `edit name:<n> …` — change any of the above.
- `list` — all bosses (enabled + disabled).
- `enable name:<n> enabled:<bool>` — toggle availability.
- `delete name:<n>` — remove a boss.

## Boss scaling

The admin's `baseHealth` is **per-player oriented**; the live boss HP scales with
who actually shows up:

```
effectiveHP = baseHealth × partySize × (0.8 + avgRank·0.04 + avgLevel·0.008) × healthScalingPct/100
effectiveATK = baseAttack × (1 + avgRank·0.05)
```

so a bigger, higher-level, higher-rarity party faces a proportionally tougher
boss — the fight stays a challenge no matter the team. After `enrage` rounds the
boss's attack ramps each round (capped) to prevent infinite stalling.

## Rewards

Every survivor of a clear earns the boss's `reward` shards and a `cardxp` bonus
on their fielded card (plus normal win XP); downed members still get consolation
card XP. Clears also count toward "win a battle" quests.

## Source (`src/bot/raid/`)

| Module | Responsibility |
| --- | --- |
| `db` | Boss-definition CRUD + eligibility queries |
| `engine` | Boss/player combatant building, party scaling, round resolution (reuses combat-engine) |
| `manager` | In-memory sessions + lobby/fight Discord interactions + rewards |
| `admin` | `/raidadmin` boss management |
| `command` | `/raid start` + `/raid bosses` |
