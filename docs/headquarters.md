# DN Cards — Player Headquarters (HQ)

A persistent, per-server **Headquarters**: every player's customizable home and
showcase, and the answer to *"what has this player accomplished?"* Cards stay the
centerpiece — the HQ is where you **display** them. Purely additive: four new
tables (`player_hq`, `hq_unlocks`, `hq_displays`, `hq_placements`) and one new
`/hq` command. HQ progression is **derived** from the systems you already play
(collection, battles, raids, achievements, daily streak), so nothing is
duplicated and existing players are back-filled the first time they open `/hq`.

**Phase 1** shipped the generic engine plus one polished **Trophy Hall**.
**Phase 2** builds on the same engine (no rewrite): more ways to earn
decorations, gradually-unlocking showcase rooms, slot-based decorating (you
choose the layout), and personalization (a custom HQ name + motto).

## Deployment (one step)

```bash
pnpm --filter @workspace/db push
```

On the hosted deployment the four tables are also created idempotently in
`runBootMigrations()` (`artifacts/api-server/src/index.ts`), so a republish
provisions them with no manual push.

## Commands (`/hq`)

- `/hq` — open **your** Headquarters (ephemeral, editable). Sections:
  **Overview**, **Trophy Hall**, **Decorations**, **Rooms**, **Theme**.
  - **Overview → Name your HQ** — set a custom HQ name (shown on the rendered
    banner) and a short motto. Stored in the additive `player_hq.stats` jsonb —
    no schema change.
  - **Decorations** — pick an earned decoration, then choose **which slot** it
    goes in (or *Auto* for the next free one). Picking an occupied slot swaps
    the two, so you arrange the room's layout however you like.
- `/hq user:@member` — visit another member's HQ, read-only.

## The engine is theme-agnostic (data-driven)

The engine knows only generic concepts — **theme**, **room**, **display**,
**decoration**, **placement**. What a "Military Base" or "Castle" looks like
lives entirely in data:

- `bot/hq/defs/themes.ts` — palette, lighting, ambient particles, asset prefix.
- `bot/hq/defs/rooms.ts` — pedestal count, decoration-slot count, unlock rule.
- `bot/hq/defs/decorations.ts` — rarity, category, unlock rule, earning story.
- `bot/hq/defs/unlock-rules.ts` — one declarative `UnlockRule` union + evaluator.

**Adding a theme/room/decoration = append to a registry.** No engine changes.

## The room is an isometric scene (Phase 3)

`bot/hq/render.ts` draws a true **isometric room**: two corner walls, a diamond
floor grid, and furniture placed on floor tiles / wall faces with depth-sorted
draw order (nearer objects overlap further ones). Card pedestals are upright
display cases on iso plinths. **Walls** and **floor** are their own data-driven,
unlockable style registries (`defs/walls.ts`, `defs/floors.ts`) — the theme sets
lighting/mood while walls + floor reskin the room itself:

- `defs/walls.ts` — two face colours, trim, optional procedural windows.
- `defs/floors.ts` — a two-tone tile checker + grout colour.

Change a wall/floor from **`/hq` → 🎨 Style**. New styles unlock as you play.

## Rendering is separated from assets

The whole scene is drawn **procedurally**, so the feature ships with **zero
art**. Every visual first asks the asset manager
(`bot/hq/assets.ts` → `spriteForPrefix(prefix, key)`); when a bundled or uploaded
PNG exists it transparently replaces the procedural drawing. Walls, floors and
furniture each resolve by their **own** `spritePrefix`, so an art pack can
replace any subset independently — a future theme pack (Military, Anime,
Fantasy, Vehicles, …) is **assets + config only**.

### Drop-in art specs (for uploaded 2D assets)

Put PNGs under `artifacts/api-server/assets/hq/` with a `manifest.json`
(`{ "sprites": { "<prefix>/<key>": "<file>.png" } }`). Furniture is the highest
-impact art:

- **Furniture / decorations** — square PNG, transparent background, ~256×256,
  key `deco/<id>` (see each decoration's `spriteKey`). Drawn ~108 px, base-
  anchored on the floor tile.
- **Wall faces** — key `<wallPrefix>/wall-left` · `/wall-right` (e.g.
  `wall/windowed/wall-left`). *(Wall/floor art blitting lands with the pack;
  procedural styles render today.)*
- **Floor tiles** — key `<floorPrefix>/tile`.

## How you get decorations

Most decorations are **earned** by playing (below). Phase 3b adds two more paths
that reuse existing systems — no new grind, no parallel currency:

- **🛒 Rotating shop** (`/hq → Shop`) — furniture priced in **shards** (the same
  economy the market uses). The stock is computed deterministically from the UTC
  date (`bot/hq/shop.ts`), so it **rotates daily** with no storage or cron, and
  some items are discounted. Buying debits shards atomically and grants the item
  into the same `hq_unlocks` ledger.
- **🎁 Catch drops** — a small chance (`bot/hq/drops.ts`, weighted so commons
  drop more often) that catching a card also yields a decoration, surfaced right
  on the catch card. Hooked best-effort into the catch flow — it never blocks or
  breaks a catch.

Shop/drop furniture is marked in data with `price` / `drop` and an
`unlock: { kind: "shop" }` (never auto-granted). Everything below is still
**earned**, and each carries the story of how it was earned:

| Earned from | Example decoration |
|---|---|
| First / 25 / 100 battle wins | First Blood Banner · Veteran Medals · Champion's Banner |
| Defeat a raid boss | Commander's Trophy |
| Clear the raid campaign | Hall of Heroes Monument |
| 50 / 100 unique cards | Curator's Plinth · Collector's Statue |
| Complete a card set | Set Display Case |
| Own a shiny | Shiny Prism |
| 7 / 30 / 100-day login streak | Streak Lantern · Dedication Brazier · Eternal Flame |
| Account level 25 | Founder's Obelisk |
| Own a limited-edition card | Limited Pedestal |
| 25 / 250 cards owned (with duplicates) | Welcome Rug · Archive Stacks |
| 25K / 100K-shard collection value | Treasury Crystal · Sovereign's Hoard |
| Own 10 shinies | Shiny Constellation |
| Win 250 battles | Warlord's Standard |
| Achievements (all Legendaries · first trade · Master Collector) | Sovereign's Crown · Diplomat's Seal · Collector's Crest |

Decorations use the game's own rarity tiers/colours and are **cosmetic only** —
they never affect gameplay balance. New earning conditions are just new
`UnlockRule` kinds (`totalCards`, `netWorth`, `achievement`, …) evaluated against
the same derived snapshot — no new grind and no call-site edits.

## How progression works (no new grind)

`bot/hq/engine.ts` builds one `HqProgress` snapshot by reusing the existing
readers (`getPlayerProfile`, `getUserCollection`, `getCompletedSetIds`,
`getCampaignProgress`, `getUnlockedKeys`) and idempotently records every earned
cosmetic into `hq_unlocks` on each `/hq` open — the same self-backfilling,
pull-based pattern as achievements and giveaway progress. `hq_level` is a derived
cache that rewards the breadth of what you've accomplished.

## Trophy Hall

Pin **3 featured cards** on lit pedestals in glass display cases. Opening a
featured card shows the normal DN Card view (the `/info` reveal canvas + your
level). Everyone who visits your HQ sees your pinned cards first.

## Rooms

Rooms unlock gradually as you play, giving a reason to return:

| Room | Unlocks at | Purpose |
|---|---|---|
| 🚪 Entrance | from the start | The welcome hall — always open. |
| 🏆 Trophy Hall | 10 unique cards | Pin featured cards on pedestals. |
| 🌿 Atrium | 25 unique cards | A decoration-only gallery for your favourite mementos. |
| 🏅 Hall of Fame | account level 15 | Where your hardest-won trophies stand together. |

Featured-card pedestals live in the Trophy Hall (displays are indexed by slot,
not room). The other rooms are decorating canvases — decoration placements are
stored **per room**, so each room keeps its own layout and personality.

## Future phases (same engine, no rewrite)

Mystery crates · visitors & companions · free-form grid move/rotate · per-room
featured-card pedestals · admin-uploaded & community art packs via
`spriteForPrefix` (walls/floors/furniture) · guild HQ · weather / day-night ·
animated HQ reveals.
