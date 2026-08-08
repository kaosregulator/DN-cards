# DN Cards Activity (Phaser 4 · Discord Embedded App)

The **single reusable game client** for DN Cards, run as a Discord Activity
inside Discord. Phase 1 ships the foundation only:

```
Discord → Activity (iframe) → Phaser 4 → /api/activity → real player data
```

It is **presentation-only** and **non-authoritative**. It sends a Discord OAuth
access token; the backend (`artifacts/api-server/src/routes/activity.ts`) decides
who the caller is and returns their authoritative snapshot. The existing bot,
PNG renderers, embeds, and database are untouched.

## Structure

```
src/
  main.ts                # entry: Discord handshake → start Phaser
  discord/
    env.ts               # in-Discord detection (frame_id)
    sdk.ts               # Embedded App SDK init + auth handshake
  net/
    api.ts               # the ONE backend client (proxy-aware)
  core/
    game.ts              # Phaser game bootstrap (scene host)
    context.ts           # GameContext seam shared by every scene
  state/
    playerState.ts       # authoritative-snapshot read model
  scenes/
    BootScene.ts         # loads /api/activity/@me
    HandshakeScene.ts    # Phase-1 test scene: renders real data
```

Later phases add `HqScene`, `BattleScene`, `RaidScene`, `PackScene`, plus the
asset / animation / audio / input managers slotted into `core/`.

## Local development

```bash
pnpm --filter @workspace/activity run dev
```

Outside Discord there is no `frame_id`, so the client runs in **dev bypass**:
it starts Phaser and shows a "open from Discord" notice instead of faking a
login. Point `VITE_API_BASE` at a running api-server if you want to exercise the
endpoints directly.

## Discord Developer Portal setup (to run in-frame)

1. Reuse the **existing** DN Cards Discord application (the one already using
   `DISCORD_CLIENT_ID` / `DISCORD_CLIENT_SECRET`).
2. **Activities → Enable Activities.**
3. **URL Mappings:**
   - `/` → the deployed Activity host (this package).
   - `/api` → the api-server host. The client calls it via `/.proxy/api`.
4. **OAuth2 redirect** already covered by the shared app; scopes used:
   `identify`, `guilds.members.read`.
5. Build-time env for this package: `VITE_DISCORD_CLIENT_ID` = the app's client id.

## Backend env (already used by routes/oauth.ts)

`DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET`, `HOME_GUILD_ID`. The Activity
backend is dormant until the first two are set — identical to the website OAuth.

## Scenes (all sharing the Core Runtime)

- **HqScene** — the live isometric HQ. Real Kenney-pack sprites, per-room tiled
  floors + rear walls, depth-sorted objects, pan/zoom, click-select, drag-move,
  rotate/duplicate/delete, undo/redo, build-mode grid + placement ghost, an
  owned-only object palette, a subtle animated blue perimeter shield, ambient
  motes, and idle NPC wander. Saves round-trip to the server, which validates
  every object against the player's unlocks and returns the sanitised layout.
- **BattleScene** — Street-Fighter choreography (approach → strike → impact →
  recoil → return) over the player's real card-derived line-up.
- **RaidScene** — the real campaign ladder + this player's clear progress, a big
  boss with live HP, team assault, and enrage past the enrage turn.
- **PackScene** — crate shake → burst → sequential rarity-coloured reveals using
  the guild's real drop odds. Presentation only — grants nothing.

A shared **NavDock** switches HQ ⇄ Battle ⇄ Raid ⇄ Packs on every scene.

## Authority & fallback

The client is never authoritative. Identity is re-verified server-side on every
request; placement, currency, ownership and combat resolution stay in the bot.
Each experience's presentation is a **per-guild** admin choice (`/config` →
🎞️ Reveals → 🎬 Experiences) with a **primary** mode and a **fallback**; when the
Activity can't run, the existing PNG/embed/animated render stands. Defaults
preserve the current server-rendered behaviour, so enabling the Activity is
strictly opt-in per guild.

## Backend surface (`/api/activity/*`)

`status`, `token`, `@me`, `assets/manifest`, `assets/hq/*`, `hq`, `hq/layout`
(POST), `battle`, `raid`, `packs`. Extra env for launching: `ACTIVITY_URL` (the
deployed Activity host) enables the "Open Live HQ" button from `/hq`.
