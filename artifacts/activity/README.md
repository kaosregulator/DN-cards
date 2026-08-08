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

## What Phase 1 deliberately does NOT do

No HQ world, no battle/raid/pack scenes, no new DB columns, no changes to any
existing command. Those are Phases 2–12. The presentation-mode / per-guild
config (`/config experience`) lands in Phase 11 via additive boot migrations.
