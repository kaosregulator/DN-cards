---
name: Operations Center module
description: Live-ops broadcast system added as isolated module in src/bot/operations/; architecture, DB tables, command names, and wiring points.
---

## Rule
The Operations Center is an ADD-ON module. Never modify it while touching cards/economy/battle/echo. It lives entirely in `artifacts/api-server/src/bot/operations/` and `lib/db/src/schema/operations.ts`.

## Architecture
- 10-file module: `types.ts`, `db.ts`, `embeds.ts`, `buttons.ts`, `runtime.ts`, `permissions.ts`, `command.ts`, `admin.ts`, `router.ts`
- CustomId prefix: `ops:` (all interactions routed through `router.ts`)
- 7 new DB tables: `ops_guild_config`, `ops_type_config`, `ops_boards`, `ops_active`, `ops_queue`, `ops_responders`, `ops_history`

## Commands
- `/support` — user command (in USER_HUB_COMMANDS)
- `/ops_admin` (internal: `opsadmin`) — admin command; COMMAND_RENAMES maps `opsadmin → ops_admin`
- Dispatched from `index.ts` as `cmd === "support"` and `cmd === "opsadmin"`

## Op keys (NEVER change)
`staff_request`, `combat_support`, `base_defense`, `convoy_escort`, `event_support`, `custom`

## Key design
- One permanent embed per op type (edited in-place via `refreshBoard`)
- Queue auto-promotes when active op completes
- Auto-timeout maintenance ticker every 2 min (`startOpsMaintenance`)
- Feature is disabled until `/ops_admin setup` runs (checks `ops_guild_config.enabled`)

**Why:** Spec says "one operation type = one permanent embed, never spam new embeds."

## After schema changes to operations.ts
Run `pnpm --filter @workspace/db run push` then `pnpm --filter @workspace/db exec tsc -p tsconfig.json --emitDeclarationOnly` before running api-server typecheck.
