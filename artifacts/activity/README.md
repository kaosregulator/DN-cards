# DN Cards Activity (Phaser 4 · Discord Embedded App)

The DN Cards Discord Activity — a **true Yu-Gi-Oh style live duel** and a
**top-down open world**, run inside Discord as an Embedded App (iframe).

```
Discord → Activity (iframe) → Phaser 4 → /api/activity → real cards + player data
```

It uses **the server's own cards** (art + names) as the duel monsters, while the
rules, stats and moves are derived/played client-side. It is **presentation-only
and non-authoritative**: it sends a Discord OAuth access token and the backend
(`artifacts/api-server/src/routes/activity.ts`) decides who the caller is. The
authoritative `/battle` combat, economy, packs, sieges and database are
untouched — a duel here spends and grants nothing.

Launch it from Discord with **`/battle phaser`**.

## Structure

```
src/
  main.ts                # entry: Discord handshake → start Phaser
  discord/               # in-Discord detection + Embedded App SDK auth
  net/
    api.ts               # the ONE backend client (proxy-aware) + duel()/cardArtUrl()
  core/
    game.ts              # Phaser game bootstrap (Boot → Menu → Duel/World)
    context.ts           # GameContext seam shared by every scene
    viewport.ts          # responsive/mobile-touch awareness
  duel/                  # framework-free duel engine (the rules)
    types.ts             # cards, board, phases, events
    engine.ts            # phases, tribute summon, combat math, traps, effects
    ai.ts                # one-action-at-a-time opponent planner
  ui/
    card.ts              # card renderer (server art via proxy + procedural)
  scenes/
    BootScene.ts         # load the real player snapshot
    MenuScene.ts         # choose the duel or the open world
    DuelScene.ts         # the playable Yu-Gi-Oh board (+ AI loop)
    WorldScene.ts        # Battle City open world + duelist challenges
  demo/demo.ts           # `?demo` local harness (no Discord/backend)
```

## The duel

- **Turn structure:** Draw → Standby → Main 1 → Battle → Main 2 → End.
- **Summoning:** Normal Summon once per turn; Lv ≤4 free, Lv 5–6 one tribute,
  Lv 7+ two tributes; face-up Attack or face-down Set (Defense).
- **Combat:** attacker ATK vs target ATK (Attack pos) or DEF (Defense pos), with
  piercing damage and direct attacks; face-downs flip on contact.
- **Spells/Traps:** classic support (draw, team ATK boost, heal; Mirror Force,
  Reflect Cylinder, Trap Hole) drawn procedurally so nothing depends on an
  external image host (Discord's CSP blocks those).
- **Cards:** a monster's ATK/DEF/Level/Attribute are derived on the backend from
  each DN card's worth/rarity/type; the art is the card's own image, streamed
  through `/activity/card-art/:id` so it loads inside the iframe.

## Backend surface used

- `GET /activity/@me` — player snapshot (identity + economy).
- `GET /activity/duel` — the player's real-card deck + a scaled AI deck.
- `GET /activity/card-art/:id` — proxied card image (object-storage or external).

## Local dev

```
pnpm --filter @workspace/activity run dev     # vite dev server
# open http://localhost:5174/?demo            # menu, no Discord/backend
# open http://localhost:5174/?demo=duel       # jump straight into a duel
# open http://localhost:5174/?demo=world      # jump straight into the world
```

Outside Discord the app redirects to `/dashboard`; the `?demo` harness bypasses
that with a mock deck so the board, world, touch controls and responsive HUD can
be exercised on desktop and mobile viewports.
