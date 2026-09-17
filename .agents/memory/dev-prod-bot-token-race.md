---
name: Dev/Prod bot token race
description: Single Discord bot token + dev workflow + published deployment = two processes fighting for one gateway slot, each backed by a different DB. Default-disable Discord login in dev.
---

A single Discord bot token can only hold **one** gateway connection at a time. If the dev workflow and the published deployment both have `DISCORD_BOT_TOKEN` set to the same value, they keep stealing the gateway lease from each other. Slash commands then route to whichever is currently winning — and because dev and the deployment **use different `DATABASE_URL`s by default**, the same `/collection` call returns wildly different inventories depending on which process answers.

**Symptoms that diagnose this exactly:**
- Same Discord command in the same channel returns different counts seconds apart.
- Leaderboard "X of N" footer shows different N values across calls (different DBs ⇒ different user counts).
- Labels/wording differ between calls (one process runs newer code than the other).
- Deployment logs full of `DiscordAPIError[40060] "Interaction has already been acknowledged"` — though that error *can also* be a single-process double-ack bug, so confirm by checking whether the PIDs differ.

**Why:** Replit deployments get their own provisioned Postgres separate from the dev DB. Schemas are kept in sync (boot migrations + publish-time diff), but row data is not. So two bot processes sharing one token can transparently serve answers from two different worlds. The same applies when migrating to Railway while an old Replit deployment is still online.

**How to apply:** Default-skip `client.login(token)` unless this process is a published deployment:
- `REPLIT_DEPLOYMENT === "1"` (Replit), or
- `RAILWAY_ENVIRONMENT` / `RAILWAY_SERVICE_ID` set (Railway), or
- `DN_DEPLOYMENT === "1"` (generic host escape hatch)

Require an explicit `FORCE_DISCORD_LOGIN=1` env var to override in dev (and then only with a *separate* dev bot token). Print a startup banner with `processType`, `buildId`, `dbHost`, and on-ready `guildCount` + `pid` so future agents can tell at a glance which DB+token a process is talking to. Helpers live in `artifacts/api-server/src/lib/runtime-env.ts`.
