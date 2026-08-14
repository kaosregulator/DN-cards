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
   client (one bot token → one Discord Activity).

The Theater's own code (`addons/theater/src/**`) is imported at runtime and is
**never bundled** into the DN-Cards api-server build, so its dependencies
(Express 4, `ws`, `@discord/embedded-app-sdk`, its own `@napi-rs/canvas`, …) stay
fully isolated in `addons/theater/node_modules`.

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
2. Set env vars for the DN-Cards process (in addition to the existing
   `HOME_GUILD_ID`):
   ```
   THEATER_ADDON_ENABLED=1
   THEATER_PORT=8080                 # a publicly-exposed port for the Activity
   DISCORD_CLIENT_ID=…               # same Application as the DN-Cards bot
   DISCORD_CLIENT_SECRET=…
   PUBLIC_BASE_URL=https://…         # the public HTTPS URL that maps to THEATER_PORT
   SESSION_SECRET=…
   MEDIA_DIR=…                       # where movies live (see .env.example)
   ```
   See `addons/theater/.env.example` for the full list and defaults.
3. In the Discord Developer Portal, enable Activities for the Application and set
   the URL mapping (`/` → your `PUBLIC_BASE_URL`).
4. Restart DN-Cards. The Theater commands appear in the home guild; everything
   else is unchanged.

## Disable it

Unset `THEATER_ADDON_ENABLED` (or set it to anything other than `1`) and restart.
The Theater web server, commands, and handlers are not started, and the home
guild's next command registration drops the Theater commands automatically.

## Standalone mode

The add-on can still run entirely on its own (its own bot + Application) exactly
as it always did — see `README.md`, `SETUP.md`, and `ADDON.md` in this folder.
Those files describe the original project unchanged.
