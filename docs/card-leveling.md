# DN Cards — Card Leveling & Frames

Per-user, per-card battle progression with cosmetic frames. Fielding a card in
`/battle` earns it XP; leveling up unlocks decorative **frames** you can equip to
show the card off. **Cosmetic only** — leveling never touches battle stats, so it
can't unbalance combat. Purely additive: one new `card_progress` table and two
commands.

## Deployment (one step)

```bash
pnpm --filter @workspace/db push
```

## Commands

- `/cards level [name]` — with a card name, shows that card's level, an XP
  progress bar, battle record, equipped frame, and all frames (unlocked +
  locked). With no name, lists your most-leveled cards.
- `/cards frame name:<card> [style:<frame>]` — lists a card's frames, or equips
  one you've unlocked. The card-name option autocompletes to cards you own.

## How it works

- **XP** is earned only in battles by the card you field: win **+120**, draw
  **+60**, loss **+45**. Both real players' cards gain XP (AI doesn't).
- **Levels** run 1→20 on a gently increasing curve (`xpToNext = 100 + (L-1)·40`).
- **Frames**: each rarity has three frames — a default (Lv 1) plus two extras
  that unlock at **Lv 5** and **Lv 10**. A frame styles the card's showcase in
  `/cards level`: an accent color and a decorative title wrap. Equipping the
  rarity default is stored as "no override" so the registry can evolve safely.
- Frames are validated on display and on equip: an equipped frame that no longer
  fits the card's rarity or level gracefully falls back to the rarity default.

## Source (`src/bot/cards/`)

| Module | Responsibility |
| --- | --- |
| `frames` | Frame registry (3 per rarity) + resolution/unlock helpers |
| `leveling` | XP curve, `grantCardBattleXp`, progress access, frame equip |
| `level-command` | `/cards level` and `/cards frame` handlers |

XP is granted from the battle reward-engine's end-of-battle settlement
(best-effort — a leveling failure never blocks battle rewards).
