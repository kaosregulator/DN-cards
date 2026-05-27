# Threat Model

## Project Overview

DN Cards is a publicly deployed Node.js/TypeScript application for a Discord-based collectible card game. The production deployment exposes an Express API used by a public website at `dncards.com`, while the Discord bot runs in the same server process and shares a PostgreSQL database with the website.

The website has two distinct roles: a public showcase for cards, news, leaderboards, and player profiles, and a password-protected dashboard for staff actions such as card display overrides, news management, suggestion triage, and dashboard user management. Gameplay state remains owned by Discord-side commands and bot handlers.

Production-relevant code lives primarily under `artifacts/api-server/src/`, `artifacts/dashboard/src/`, and `lib/db/src/`. `artifacts/mockup-sandbox/` is development-only and out of scope unless production reachability is proven. Assume `NODE_ENV=production` in production and TLS termination by the platform.

## Assets

- **Dashboard administrator accounts and sessions** — dashboard usernames, password hashes, session cookies, owner status, and one-time setup/reset tokens. Compromise gives an attacker administrative control over the website-facing management surface and user-management workflows.
- **Break-glass administrative secret** — `ADMIN_TOKEN` can authenticate directly to privileged API routes and owner-only actions. Exposure would bypass normal dashboard account controls.
- **Gameplay and economy data** — collections, currency balances, achievements, trades, rarity configuration, and spawn settings in PostgreSQL. Integrity matters because the bot is the source of truth for the game economy.
- **Global shared card and set definitions** — card rows and first-class set definitions are reused across guilds. Unauthorized mutation or deletion affects every server that relies on the shared roster.
- **Website-managed content** — card display overrides, news posts, suggestions, and admin notes. Unauthorized changes could deface the public site or expose private staff workflows.
- **Application secrets and infrastructure credentials** — `DATABASE_URL`, `SESSION_SECRET`, Discord bot token, and object-storage credentials mediated through the Replit sidecar.
- **Player-linked metadata** — Discord user IDs, usernames, guild-scoped collection state, suggestion submissions, and hashed submitter IPs.

## Trust Boundaries

- **Public browser / API boundary** — all website requests to `/api/**` cross from an untrusted client into the Express server. Public routes must not expose data beyond intended product behavior, and admin routes must authenticate and authorize every request server-side.
- **Dashboard session / admin boundary** — the dashboard distinguishes unauthenticated visitors, authenticated dashboard users, and owner-level users. The legacy `ADMIN_TOKEN` path is an alternate privileged boundary that must be controlled carefully.
- **Discord user / Discord admin boundary** — the bot accepts both public player commands and privileged moderation/setup commands. Discord-side authorization must be enforced server-side rather than relying only on slash-command visibility.
- **Guild-local admin / global data boundary** — some Discord admin actions are authorized per guild, but certain underlying tables are global rather than guild-scoped. The scan must verify that guild-local privileges cannot mutate globally shared cards, sets, or other cross-guild assets.
- **Application / database boundary** — the API server and bot have direct write access to PostgreSQL. Injection or broken authorization in either surface can directly alter game state or dashboard users.
- **Application / object storage boundary** — the server can upload and stream stored objects. Public object reads and admin-only uploads must stay scoped to intended content.
- **Production / dev-only boundary** — mockups, artifacts not mounted by the production router, and rollback-only code paths should be ignored unless reachable from production entry points.

## Scan Anchors

- **Production entry points:** `artifacts/api-server/src/app.ts`, `artifacts/api-server/src/index.ts`, `artifacts/api-server/src/routes/*.ts`, `artifacts/api-server/src/bot/index.ts`.
- **Highest-risk code areas:** dashboard auth and user management (`routes/auth.ts`, `routes/dashboard-users.ts`, `middlewares/dashboard-auth.ts`), admin content routes (`routes/admin.ts`, `routes/news.ts`, `routes/suggestions.ts`, `routes/storage.ts`), and Discord admin/economy handlers under `artifacts/api-server/src/bot/commands/` plus `bot/db.ts`.
- **Public surfaces:** `/api/cards`, `/api/news*`, `/api/suggestions`, `/api/guilds/:guildId/**`, public object fetches, and Discord player commands.
- **Authenticated/admin surfaces:** dashboard session routes, `/api/admin/**`, `/api/dashboard/users/**`, and Discord admin/setup commands.
- **Dev-only areas to usually skip:** `artifacts/mockup-sandbox/`, dist outputs, and unmounted rollback routers mentioned in `routes/index.ts`.

## Threat Categories

### Spoofing

The application relies on dashboard sessions, one-time setup links, Discord identity, and a break-glass `ADMIN_TOKEN`. The system must ensure dashboard sessions are signed with a strong secret, setup/reset tokens are single-use and unguessable, and privileged routes never trust client-side UI gating alone. Discord admin commands must validate administrator status in handlers, not just in slash-command registration metadata.

### Tampering

Attackers could target admin APIs, Discord command handlers, or state-changing database paths to alter card metadata, economy balances, rarity settings, trades, or public site content. All state-changing routes and commands must validate inputs, perform authorization checks server-side, and use race-safe database operations where concurrent requests could duplicate rewards, bypass limits, or consume one-time tokens multiple times.

### Information Disclosure

The public website intentionally exposes some gameplay data, but the application still handles admin accounts, setup/reset tokens, hashed IP-based abuse controls, and staff-only content. Public APIs must not leak secrets, raw IP-derived data, private moderation notes, or internal admin-only state beyond intended product behavior. Logs and error responses must not expose cookies, setup tokens, or other credentials.

### Denial of Service

The public deployment exposes unauthenticated routes and a Discord bot that performs database work and external API calls. The application must prevent cheap brute-force or spam attacks against dashboard authentication and public submission endpoints, and must bound expensive operations such as uploads, external fetches, or repeated guild/member lookups so attackers cannot cheaply exhaust resources.

### Elevation of Privilege

The highest-impact failures are unauthorized access to dashboard admin routes, owner-only user management, privileged Discord commands, or direct database-backed game actions. The application must enforce admin and owner boundaries on every privileged route, use parameterized database access, and reject insecure fallback behaviors that let production continue with predictable secrets or bypass normal authentication guarantees.

Role changes must also take effect immediately: password resets, account deletion, and owner demotion should revoke existing sessions instead of leaving cached session privileges valid for the cookie lifetime. Likewise, guild-scoped admin checks must not be allowed to control globally shared bot data.