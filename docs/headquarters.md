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
  - **Decorations** — pick a decoration, then choose **which floor tile or wall
    spot** it goes on (or *Auto*). Placement is grid-precise: the tile is encoded
    in `hq_placements.slot` (`gy*GRID+gx` for floor, `100+i` for walls — no schema
    change), so items land exactly where you put them and picking an occupied
    spot swaps. Each room caps how many items you can display at once.
  - **🛒 Shop** — buy furniture with shards (rotates daily) or crack a **Mystery
    Crate** for a random piece. Stock includes **rugs & lighting** and the
    **Portrait Frame**.
  - **🖼️ Card wall-art** — buy the **Portrait Frame** once, then *frame any card
    you own* and hang its **real art (shrunk into a rarity-tinted frame)** on a
    wall spot. A framed card is stored as a compound placement id
    `portrait-frame:<cardId>` (so no schema change; the base id `portrait-frame`
    is what ownership/prune checks resolve to). Pick a card → pick a wall spot;
    the renderer pulls the card's live art via `drawCardPortrait`.
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
- `defs/backdrops.ts` — a **backdrop** is the scene painted _behind_ the room
  (meadow, forest, autumn, desert, castle vista). Some are default; others are
  **earned** (account level, battle wins, achievements — not just drops), the
  same unlock-rule contract as walls/floors, reconciled into `hq_unlocks` as
  `itemType: "backdrop"`. The backdrop PNG cover-fits the canvas with a soft
  dark overlay; `none` renders the plain themed backdrop.
- **Wallpaper** — the same backdrop art can instead be painted _onto the wall
  faces_ (`stats.wallpaperId`, reusing the backdrop unlock ledger). Pick an
  outdoor scene and the walls stay **up** but look like the outdoors — this is
  the everyday "make it feel outside" control; `none` = the plain wall style.
  Walls-off + backdrop is the fuller open-air variant.

Everything in the Style section persists to the additive `player_hq.stats` jsonb
(no schema change): `backdropId`, plus two room-shell toggles — `wallsOff`
("outside": the walls open onto the backdrop) and `glassOff` (hide the pedestal
display cases). **Inside/Outside presets** set both in one tap (going outside also
drops the glass for an open-air showcase). Small (≤48 px) sprites render with
image-smoothing off so pixel-art figures stay crisp.

Change a wall/floor/backdrop, toggle walls/glass, or hit an Inside/Outside preset
from **`/hq` → 🎨 Style**. New styles unlock as you play.

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
- **🎁 Mystery crates** — a fixed-price shard sink (`/hq → Shop → Open Mystery
  Crate`) that grants a random furniture piece you don't own, rarity-weighted.
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

## The exterior town base (`/hq → 🏰 Base`)

The **base** is a **separate outdoor town view**, distinct from the interior
showcase rooms: an isometric ground slab with a **keep, walls, camps and huts**,
and the player's **stationed defender cards** rendered as upright **standee
figures** out front. It's drawn by its own leaf renderer, `renderBase` (queue
label `hq-base`) in `bot/hq/render.ts`:

- Buildings are placed by **role** (keep centre-back, camps/huts on the flanks,
  wall/gate at the front) and blit their art base-anchored to a target height,
  with a **per-role procedural fallback** when no art is present — so the scene
  renders with or without an art pack.
- Everything (buildings + defenders) is **depth-sorted by screen-y** so nearer
  objects overlap further ones.

`/hq → 🏰 Base` lets a player station cards to guard the town (up to
`HQ_DEFENDER_SLOTS`), persisted in the additive `hq_defenders` table (one row per
post). **Visiting** another player renders their exterior base — *that's what an
attacker scouts*. This is the defence half; the attack/capture side
(raid-/gym-style, solo or clan co-op, reusing `bot/battle/*`) reads these
defenders and adds its own state in a later phase without changing this table.

### Art licensing note

Bundled art under `assets/hq/` is **CC0 (Kenney)** — furniture, medals and the
defender base plates — and safe to redistribute. The **`buildings/` sprites**
(keep, wall, camp, hut) are from a third-party isometric pack and are **not
CC0**; they are included **with the project owner's stated permission** and must
not be treated as freely redistributable. The renderer never depends on them —
every building has a procedural fallback — so they can be removed at any time
without breaking the base view. See `assets/hq/manifest.json` `_credits`.

## Base siege (attack / capture mini-game)

Scout another player with `/hq user:@member` — the visit shows their **exterior
base** and stationed defenders — then **⚔️ Attack** it. The attacker's strongest
cards storm the stationed defenders in a **real battle** and must knock out every
one to **capture** the base (its banner flips red and it's **shielded** for an
hour so it can't be farmed); if the assault is broken, the walls hold.

**Combat runs the actual battle engine.** `bot/hq/siege-battle.ts`
(`simulateSiegeBattle`) drives the same turn-based combat as `/battle` —
headlessly, no click-through — over a **gauntlet**: the attacker's active card
fights the defender's active card; whoever is knocked out is replaced by their
side's next card (the survivor keeps its HP) until one side is wiped. True stats,
movesets, specials, passives, statuses, crits and KOs all apply — stats come from
the single `get_scaled_stats` entry point (level, star rank, config, and the
guild strength ladder `rarityLadderRank`), the same source of truth `/battle`
uses, so there's no separate balance surface. A turn-cap standoff is decided by
attrition progress, with a dead-even standoff favouring the defender. If the
battle system is disabled or a squad can't be built, it falls back to the power
auto-resolver (`bot/hq/siege.ts`, `resolveSiege`). A per-target attacker
**cooldown** limits repeat hits; captures lazily revert to the owner when the
shield expires.

Every siege renders **on the castle base scene** (castle + defender cards +
castle health) — never a separate VS screen. Three ways to watch:

- **Classic** — animated on the castle with **move-by-move captions**
  ("X used <Move>!") and hit flashes as defenders fall.
- **Static** — a single final frame on the base scene.
- **Live** — the clean animated siege (health drains, defenders ✕, attacker
  storms the gate) via the shared `encodeAnimation` engine.

**World Map** (`/hq → 🗺️ World Map`) shows the guild's other bases as castles on
an isometric map (banner + health + name; 🚩 = held), and lets you pick one to
raid. **Captures persist until reclaimed** — the owner gets a Reclaim button once
the conqueror's shield lapses.

**Shards while you hold.** Every base you hold pays a passive **hold-tribute** of
`TRIBUTE_PER_HOUR` (5) 💠/hr, minted — never drained from anyone. It's collected
**pull-based**: opening the 🗺️ World Map pays out everything owed across the
bases you hold and restarts the clock. Accrual is capped at `TRIBUTE_CAP_HOURS`
(48h) so a base left unvisited doesn't dump a jackpot (`tributeOwed`, `siege.ts`).

**Longest-hold leaderboard + Sovereign title.** Each hold is timed; when a reign
ends (recaptured or reclaimed) it's logged to `hq_base_reigns`. The World Map
shows a **👑 Longest hold** board — each holder's best single reign, combined at
read time with any still-running reign (`now − held_since`) so a current holder
ranks live (🚩) — and crowns the #1 as the guild's **Sovereign** (`getReignLeaders`).

State is additive: `hq_base_state` (holder + shield + hold clock), `hq_base_attacks`
(log + cooldown) and `hq_base_reigns` (completed reigns → leaderboard). *Clan
co-op attacks are the next step and slot in behind the same `resolveSiege`
interface.*

## Companions & visitors (living HQ)

Two touches make a Headquarters feel alive; both render in the interior room AND
the exterior base.

- **Companions** are EARNED pets. `bot/hq/defs/companions.ts` is a data-driven
  registry (mirrors the decoration/theme registries): each companion's `kind`
  picks the procedural creature the renderer draws (`drawCompanion`) and its
  `body`/`accent` colour it, so a future asset pack can drop in real sprites with
  no code change. They're granted by the same pull-based `reconcileUnlocks`
  (itemType `"companion"` in `hq_unlocks`) as every other cosmetic — e.g. the
  **Scout Pup** for 10 battle wins, the **Wise Owl** for a 50-card collection, the
  **Ember Drake** from a raid boss. Pick your active pet in **Overview → 🐾 Choose
  a companion…** (or send it away); the choice lives in the additive
  `player_hq.stats.companionId` (no schema change) and the pet then stands in your
  room and roams your grounds.
- **Visitors** are ambient NPC guests — purely DERIVED, never stored or earned.
  The count grows with HQ prestige (`visitorCount(hqLevel)`, 0 → 4) so a
  well-developed Headquarters visibly draws a crowd; the renderer scatters that
  many procedural figures (`drawVisitor`) at out-of-the-way spots. They stay out
  of a live siege so combat stays readable.

Set-completion also feeds the earned decorations: finishing **3 / 5 / 10** whole
card sets unlocks the **Set Collector's Plinth**, **Curator's Gallery** and
**Master Archive** (`setComplete` milestones in `defs/decorations.ts`).

## Admin editor (`/hqadmin`)

Admin-gated (same check as `/admin` / `/edit-user`). `/hqadmin user:@member`
opens a panel to fix or reset a member's HQ — all HQ-only data, never the base
game: **Set HQ level**, **Unlock everything** / **Revoke all unlocks**,
**Re-sync from progress** (runs the reconcile), **Reset base capture** (clears a
stuck flag/shield), **Clear defenders**, and **Wipe layout** (placements +
defenders). Accessors live in `bot/hq/db.ts`; the command is `bot/commands/hq-admin.ts`.

## Addon boundaries (ties in without changing the base game)

This whole feature is an **addon**: it only **adds** tables, **reads** existing
systems (collection/battles/raids/achievements/rarity ladder) to derive
progress, and **reuses** the battle/animation engines. Original files are touched
only at small, additive integration seams — command registration + dispatch, one
best-effort catch-drop hook, help text, and boot migrations. Content is all
registries under `bot/hq/defs/*` and art is drop-in via the manifest, so it stays
easy to extend or tweak.

## Future phases (same engine, no rewrite)

Mystery crates · visitors & companions · free-form grid move/rotate · per-room
featured-card pedestals · admin-uploaded & community art packs via
`spriteForPrefix` (walls/floors/furniture) · guild HQ · weather / day-night ·
animated HQ reveals.
