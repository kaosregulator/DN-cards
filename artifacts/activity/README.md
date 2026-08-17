# DN Cards Activity (Phaser 4 · Discord Embedded App)

A full Yu-Gi-Oh style **game** that runs inside Discord as an Embedded App: an
explorable Game-Boy-style overworld, a walk-in Card Shop, and a true duel on a
tilted playmat.

```
Discord → Activity (iframe) → Phaser 4 → /api/activity → real cards + player data
```

Duels are played with **authentic Yu-Gi-Oh cards** — real names, real card text,
real Level / Attribute / Type / ATK / DEF and real effects — while the **artwork
is always your server's own card image**. Launch it from Discord with
**`/battle phaser`**.

It is **presentation-only and non-authoritative**: it sends a Discord OAuth
access token and the backend decides who the caller is. The authoritative
`/battle` combat, economy, packs, sieges and database are untouched — a duel
here spends and grants nothing.

## The game

**🗺 Adventure (overworld).** Six hand-authored maps — Battle City, Card Shop,
Battle Arena, Duel Dojo, Route 1, New City — as tile grids with solid-tile
collision, doors that swap rooms behind a screen wipe, and a camera that follows
you. Six duelists to beat and guides who teach the rules. Progress (who you've
beaten, where you stood) persists in localStorage.

**🏪 Card Shop.** Walk in the door, walk up to the shopkeeper, and the screen
becomes a scrollable, filterable catalogue of the server's real cards with their
Level/ATK/DEF, price and owned count, plus a full card inspector.

**⚔ Duel.** A tilted perspective playmat (as the reference client does it with
`perspective(1000px) rotateX(45deg)`), corner LP plates with draining bars, a
phase strip, Deck/Graveyard columns and a fanned hand. Monsters slam in through
a spawn animation; Fusion Summons spiral their materials into a vortex.

**👥 Local PvP** (hot-seat pass-and-play) and a **🌐 Babylon 3D** plaza are on
the title screen too.

## Duel rules

- **Phases:** Draw → Standby → Main 1 → Battle → Main 2 → End.
- **Summoning:** Normal Summon once per turn; Lv ≤4 free, Lv 5–6 one tribute,
  Lv 7+ two; face-up Attack or face-down Set; Flip Summon; Special Summon.
- **Fusion:** Polymerization fuses two monsters you control into the best Extra
  Deck Fusion their Levels allow (Flame Swordsman → Blue-Eyes Ultimate Dragon).
- **Combat:** ATK vs ATK / ATK vs DEF, piercing, direct attacks, one attack per
  monster, face-downs flip on contact.
- **Chain & response windows:** attack and summon declarations open a priority
  window; the defender may activate a set trap or pass. Negation supported.
- **Real cards:** 34 monsters (Blue-Eyes 3000/2500, Dark Magician, Summoned
  Skull, Jinzo, Man-Eater Bug, Sangan…), 12 spells (Pot of Greed, Dark Hole,
  Raigeki, MST, Monster Reborn, Polymerization, equips, continuous…) and 6 traps
  (Mirror Force, Magic Cylinder, Sakuretsu, Negate Attack, Trap Hole, Call of
  the Haunted) — each with its real card text.
- **Effects:** flip effects, search-on-death (Sangan/Witch), Jinzo's trap
  lockout, equip/continuous/field auras, targeted removal and revival.

Your cards bind to real cards **deterministically by card id and power tier**, so
the same DN card is always the same real card, and your strongest cards get the
strongest ones.

## Structure

```
src/
  main.ts                # entry: Discord handshake → start Phaser
  discord/               # in-Discord detection + Embedded App SDK auth
  net/api.ts             # the ONE backend client (proxy-aware)
  core/                  # Phaser bootstrap, shared context, viewport
  duel/                  # framework-free duel engine (the rules)
    types.ts  engine.ts  effects.ts  ai.ts
    ygo-cards.ts         # real Yu-Gi-Oh card database
    cards.ts             # binds your cards to real cards; builds decks
  world/                 # tiles.ts (procedural tileset) + maps.ts (the maps)
  ui/                    # card renderer, playmat projection, LP plates,
                         # dialogue box, touch pad
  world3d/               # Babylon 3D plaza (lazy-loaded)
  scenes/                # Boot → Menu → World → Shop → Duel
  demo/demo.ts           # `?demo` local harness (no Discord/backend)
```

Every tile, character sprite and card face is **drawn procedurally at runtime** —
the activity ships no image files, so there is nothing for Discord's iframe CSP
to block and no asset payload. The only images loaded are your card art, proxied
through `/activity/card-art/:id`.

## Backend surface used

- `GET /activity/@me` — player snapshot (identity + economy).
- `GET /activity/duel` — the player's real-card deck + a scaled AI deck.
- `GET /activity/shop` — the server's cards with prices and owned counts.
- `GET /activity/card-art/:id` — proxied card image.

## Tests

```
pnpm --filter @workspace/activity test     # 74 tests
```

- `duel/__tests__/engine` — phases, summon/tribute, full combat math.
- `duel/__tests__/effects` — every spell/trap/equip/field/chain/flip effect.
- `duel/__tests__/ygo` — real card data integrity, deterministic binding,
  Jinzo lockout, Fusion Summoning, search effects.
- `duel/__tests__/sim` — 150 full games; no crash, no stall, always terminates.
- `world/__tests__/maps` — flood-fills every map: doors and **every NPC**
  reachable, no NPC on solid scenery, the world fully connected.

## Local dev

```
pnpm --filter @workspace/activity run dev
# http://localhost:5174/?demo         title screen
#                      /?demo=world   the overworld
#                      /?demo=shop    the card shop
#                      /?demo=duel    a duel
#                      /?demo=pvp     hot-seat PvP
```

Outside Discord the app redirects to `/dashboard`; `?demo` bypasses that with
mock data so everything can be exercised on desktop and mobile viewports.
