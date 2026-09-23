# Deploy DN Cards on Railway

This guide gets the Discord bot + API onto Railway with **only** a linked
Postgres database and your usual secrets (bot token, guild id, session secret).

## What your current logs mean

| Log line | Cause | Fix in this change |
| --- | --- | --- |
| `Skipping Discord login: this is a dev process…` | Login only ran when `REPLIT_DEPLOYMENT=1` | Auto-detect Railway via `RAILWAY_*` (or set `DN_DEPLOYMENT=1`) |
| `Boot migrations failed — server continues` | Empty / unreachable DB, or missing `HOME_GUILD_ID` | TLS for Railway Postgres + auto schema push on first boot |
| `MemoryStore is not designed for a production environment` | Default express-session store | Postgres session store on published hosts |

## One-time Railway setup

1. **Create a Railway project** and add a **PostgreSQL** plugin.
2. **Create a service** from this GitHub repo (root of the monorepo).
3. Railway will pick up `railway.toml`:
   - Build: `pnpm install` + build `@workspace/api-server`
   - Start: `node artifacts/api-server/scripts/start-production.mjs`
   - Health: `GET /api/healthz`
4. **Variables** (service → Variables):

### Required

| Variable | Notes |
| --- | --- |
| `DATABASE_URL` | Auto-filled when you click **Connect** / **Variable reference** on the Postgres plugin. Prefer the **private/internal** URL when the bot and DB are in the same Railway project. |
| `DISCORD_BOT_TOKEN` | Bot token from the Discord Developer Portal |
| `HOME_GUILD_ID` | Your main Discord server (guild) snowflake ID |
| `SESSION_SECRET` | Long random string (dashboard cookies + suggestion hashing) |

### Strongly recommended

| Variable | Notes |
| --- | --- |
| `NODE_ENV` | `production` |
| `PUBLIC_BASE_URL` | `https://YOUR-SERVICE.up.railway.app` (or your custom domain). Used for setup links and absolute image URLs. |

`PORT` is set by Railway — do not hardcode it.

### Optional

| Variable | Notes |
| --- | --- |
| `DISCORD_CLIENT_ID` / `DISCORD_CLIENT_SECRET` | Website Discord OAuth + Activity |
| `DISCORD_OAUTH_REDIRECT_URI` | `https://YOUR-DOMAIN/api/oauth/discord/callback` |
| `ANTHROPIC_API_KEY` | Bob AI talk |
| `ADMIN_TOKEN` | Break-glass dashboard admin header |
| `UNBELIEVABOAT_TOKEN` | UnbelievaBoat API token from https://unbelievaboat.com/applications (raw token, no `Bearer`). Enables the `/admin/unbelievaboat` hub + pet shop cash spends. Alias: `UNB_TOKEN`. |
| `AFK_PRESENCE_INTENT` | `1` only if Presence Intent is enabled in the Developer Portal |
| `DATABASE_SSL` | Force `require` / `disable` if auto TLS detection is wrong. Prefer leaving unset — the app uses `rejectUnauthorized: false` for managed hosts (needed for Railway). |
| `AUTO_DB_PUSH` | Unset = push schema only when tables are missing. `1` = always push on start. `0` = never. |
| `DN_DEPLOYMENT` | `1` if you host somewhere that is not Replit/Railway |

### Quiet Mode audio (automatic on Railway)

Railway builds install **ffmpeg** + **flite** via `nixpacks.toml` `aptPkgs`.
Quiet Mode tables (`quiet_*`) are created automatically on start:

1. `start-production.mjs` creates them if `quiet_state` is missing
2. Boot migrations also `CREATE TABLE IF NOT EXISTS` for the same tables, and
   `ADD COLUMN IF NOT EXISTS quiet_role_id` for the quarantine role

No manual `drizzle-kit push` is required for Quiet Mode on an existing database.

After deploy, confirm logs show:

- `Quiet Mode tables ready` *(first boot after this change, if tables were missing)*
- or later: `Quiet recording prepared` / `Quiet native voice message succeeded`
- **not** `spawn ffmpeg ENOENT` or `relation "quiet_state" does not exist`

## First deploy checklist

1. Link Postgres → confirm `DATABASE_URL` is present on the **bot service**.
2. Set `DISCORD_BOT_TOKEN`, `HOME_GUILD_ID`, `SESSION_SECRET`, `NODE_ENV=production`.
3. Set `PUBLIC_BASE_URL` to the Railway public HTTPS URL.
4. Deploy. On a **fresh** database the start path runs `drizzle-kit push-force` once, then boots.
5. Confirm logs show:
   - `Applying database schema` / `Base schema is present` (first boot only)
   - `Bot startup banner` with `processType: "deployment"` and `willLogin: true`
   - `Dex N Cards bot ready` (or your `BRAND_NAME`) with a guild count
   - `Boot migrations applied` (not failed)
   - `Session store: Postgres`
6. **Turn off** any other process that uses the **same** bot token (old Replit deployment, local `FORCE_DISCORD_LOGIN=1`, etc.). One token = one gateway.

If you still see `relation "guild_settings" does not exist`, the service is not picking up the new start script — set the Railway start command to:

```bash
node artifacts/api-server/scripts/start-production.mjs
```

or set `AUTO_DB_PUSH=1` and redeploy.

If schema push fails at `Pulling schema from database…` with an SSL / `verify-full` warning, redeploy this SSL fix (host credentials + `rejectUnauthorized: false`). As a temporary workaround you can set `DATABASE_SSL=disable` when using the private `*.railway.internal` URL.

## Migrating data from Replit / local

If the Railway Postgres is empty and you already have cards/collections:

1. Dump the old DB (`pg_dump` / existing `db-backup.sql` in the repo).
2. Restore into Railway Postgres (`psql $DATABASE_URL < dump.sql` or Railway’s UI).
3. Set `AUTO_DB_PUSH=0` for that boot if you already restored a full schema, or leave unset so push is skipped when `guild_settings` exists.

## Discord Developer Portal

- Enable intents: **Message Content**, **Server Members**. Presence only if `AFK_PRESENCE_INTENT=1`.
- Invite URL still needs `bot` + `applications.commands`.
- If using OAuth for the website, add the Railway callback URL under OAuth2 → Redirects.

## Local / Cursor Cloud remotes

Unchanged: without Railway/Replit deployment markers the bot **skips** Discord login unless `FORCE_DISCORD_LOGIN=1` (use a **separate** dev token).
