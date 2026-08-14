# DarkNight Theater — DN-Cards add-on integration

This folder is a **self-contained, optional add-on**. DN-Cards runs exactly as
before with it present; the Theater only turns on when you explicitly enable it.
Nothing in DN-Cards' commands, database, UI, or core architecture was changed to
add it.

## How it's wired (the whole surface)

The entire host-side integration lives in **one** adapter module —
`artifacts/api-server/src/bot/integrations/theater-addon.ts` — plus a small,
flag-gated hook in `artifacts/api-server/src/bot/index.ts`. When
`THEATER_ADDON_ENABLED` is unset, all of it is inert and DN-Cards is byte-for-byte
unchanged.

When enabled, at bot startup the host:

1. Adds the non-privileged `GuildVoiceStates` intent to the shared bot client.
2. Registers the Theater's 5 slash commands **to the home guild only**
   (`HOME_GUILD_ID`) — never globally, never to other guilds.
3. Starts the Theater's **own** Express server + WebSocket sync on its own port
   (`THEATER_PORT`) and attaches the Theater's interaction handlers to the shared
   DN-Cards bot client.

The Theater's own code (`addons/theater/src/**`) is imported at runtime and is
**never bundled** into the DN-Cards api-server build, so its dependencies
(Express 4, `ws`, `@discord/embedded-app-sdk`, its own `@napi-rs/canvas`, …) stay
fully isolated in `addons/theater/node_modules`.

## Credentials & the embedded Activity (important)

The add-on **reuses the existing DN-Cards infrastructure and credentials** — you
do not re-enter any tokens. The shared bot gateway, `DISCORD_BOT_TOKEN`, and
`SESSION_SECRET` already in the Replit environment are used as-is.

The one thing it deliberately does **not** reuse is the DN-Cards Discord
**Application** for the embedded Activity iframe. A Discord Application can own
only **one** embedded Activity, and DN-Cards already uses its Application for the
Phaser game Activity. So the Theater runs in add-on mode (`THEATER_ADDON=1`, set
automatically) which means:

- The Theater **never** targets the DN-Cards Application for its Activity. Until
  a separate Theater Application is configured, `/theater` still posts its live
  control panel, seating, sync, and `/host` uploader — it just omits the
  "Open Theater" embedded-launch button. **The Phaser Activity and the website
  are never touched.**
- To turn the embedded Activity on later, create **one** new Discord Application
  (keep the existing DN-Cards bot token), enable Activities on it, map its
  Activity URL to the Theater's own endpoint, and set:
  ```
  THEATER_CLIENT_ID=…            # the NEW Application's Client ID
  THEATER_CLIENT_SECRET=…        # the NEW Application's Client Secret
  THEATER_PUBLIC_BASE_URL=https://…   # the Theater's own public URL (its port)
  ```
  That is the only additional configuration needed; the DN-Cards bot posts the
  invite that launches the new Application's Activity.

Standalone mode (running this folder on its own, no `THEATER_ADDON`) is
unchanged: it still reads `DISCORD_CLIENT_ID` / `DISCORD_CLIENT_SECRET` /
`PUBLIC_BASE_URL` exactly as it always did.

Commands / custom-id prefixes the add-on owns: `watch`, `join`, `theater`,
`library`, `theater-settings` and `w:`, `ps:`, `t:ctl:`, `set:`, `join:`.
A Theater interaction arriving from any non-home guild gets a safe-guard reply
instead of running.

## Enable it

1. Install + build the add-on (its own toolchain):
   ```bash
   cd addons/theater
   npm install
   npm run build          # builds the Activity → addons/theater/dist/public
   ```
2. Set env vars for the DN-Cards process. Existing DN-Cards values
   (`DISCORD_BOT_TOKEN`, `SESSION_SECRET`, `HOME_GUILD_ID`) are reused
   automatically — you only add:
   ```
   THEATER_ADDON_ENABLED=1
   THEATER_PORT=8080                 # a publicly-exposed port for the Theater
   MEDIA_DIR=…                       # where movies live (see .env.example)
   ```
   The embedded Activity stays off until you also add a separate Theater
   Application (see "Credentials & the embedded Activity" above):
   ```
   THEATER_CLIENT_ID=…               # NEW Application's Client ID
   THEATER_CLIENT_SECRET=…           # NEW Application's Client Secret
   THEATER_PUBLIC_BASE_URL=https://… # the Theater's own public URL
   ```
3. Restart DN-Cards. The Theater commands appear in the home guild; the website
   and Phaser Activity are unchanged.

## Disable it

Unset `THEATER_ADDON_ENABLED` (or set it to anything other than `1`) and restart.
The Theater web server, commands, and handlers are not started, and the home
guild's next command registration drops the Theater commands automatically.

## Standalone mode

The add-on can still run entirely on its own (its own bot + Application) exactly
as it always did — see `README.md`, `SETUP.md`, and `ADDON.md` in this folder.
Those files describe the original project unchanged.
