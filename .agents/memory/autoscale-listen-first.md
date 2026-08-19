---
name: Autoscale startup probe — listen before migrations
description: Why boot migrations must run after app.listen() on Autoscale, and what happens when they don't.
---

On Autoscale rolling deploys, the old instance stays live while the new one boots. If the new instance awaits DDL (`ALTER TABLE`, `CREATE INDEX`) before calling `app.listen()`, those statements block waiting for an exclusive lock held by the old instance's connections. The health probe (`GET /api/healthz`) times out because Express hasn't started yet, and the deployment fails.

**Rule:** always call `app.listen()` first, then fire migrations and the bot as non-blocking `.catch()` chains.

**Why migrations are safe to run after listen:** every statement uses `IF NOT EXISTS` / `DO $$ IF EXISTS` guards, so they're idempotent no-ops once the first deploy applied them. A lock-timeout failure just means the column was already there.

**How to apply:** wrap `app.listen` in a `Promise<void>`, resolve on success, then kick off `runBootMigrations().catch(log)` and `startBot().catch(log)` without `await`.

**Symptom pattern:** build logs end at "Waiting for service to be ready" with no error; two or more consecutive failures after a codebase change that added a new boot migration.

**Distinguishing a transient platform failure:** if listen-first is already in place, the production bundle serves 200 on /api/healthz instantly when run locally, AND `fetchDeploymentLogs` shows zero runtime logs in the promote window (the new VM never even started logging), the failure is on Replit's side — just republish; don't chase code changes.
