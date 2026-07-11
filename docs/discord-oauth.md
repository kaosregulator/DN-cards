# Discord OAuth (website visitor login)

The website login for **visitors** (separate from the admin dashboard login) is
built and shipped, but **dormant** until you provide Discord app credentials.
While dormant, the "Login with Discord" button is hidden and every
`/api/oauth/*` endpoint reports "not configured" — nothing breaks.

It is a **read-only presentation feature**: it identifies the visitor, verifies
they're in the home guild, and reads *their own* collection to drive the
Owned/Unowned view in the Card Vault. It never writes game data.

## What it uses

- Scopes: `identify` (username + avatar) and `guilds.members.read` (verify home
  guild membership).
- Session: stored in the existing **HTTP-only** session cookie (`dn-dash`),
  `SameSite=Lax`, `Secure` in production — configured in
  `artifacts/api-server/src/app.ts`.

## Activate it (one-time)

1. Go to the **Discord Developer Portal** → your application → **OAuth2**.
2. Under **Redirects**, add your exact callback URL:
   `https://YOUR-DOMAIN/api/oauth/discord/callback`
   (for local dev: `http://localhost:PORT/api/oauth/discord/callback`).
3. Copy the **Client ID** and generate a **Client Secret**.
4. Set these environment variables on the API server:

   | Variable | Required | Notes |
   | --- | --- | --- |
   | `DISCORD_CLIENT_ID` | ✅ | OAuth2 application client id |
   | `DISCORD_CLIENT_SECRET` | ✅ | OAuth2 client secret — **never commit this** |
   | `DISCORD_OAUTH_REDIRECT_URI` | optional | Exact redirect from step 2. If unset, it is derived from the incoming request origin. Set it explicitly in production to avoid proxy/host mismatches. |
   | `HOME_GUILD_ID` | already set | Used to verify membership (`userenv.shared` in `.replit`). |
   | `SESSION_SECRET` | recommended | Keeps sessions stable across restarts. |

5. Restart the API server. The button appears automatically.

## Endpoints (all read-only)

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/oauth/status` | `{ configured, homeGuildId }` — drives UI visibility |
| GET | `/api/oauth/discord/login` | Redirect to Discord authorize |
| GET | `/api/oauth/discord/callback` | Code exchange + guild verify, sets session |
| GET | `/api/oauth/me` | Current visitor `{ id, username, avatar, inHomeGuild }` |
| POST | `/api/oauth/logout` | Clears visitor identity from the session |
| GET | `/api/oauth/collection` | The logged-in visitor's owned card ids (Owned/Unowned) |

## Security notes

- CSRF: a random `state` is stored in the session and verified on callback.
- The client secret is only read from env server-side; it is never sent to the
  browser.
- `/api/oauth/collection` uses the **server-side session** Discord user id, so a
  client cannot request another user's collection.
