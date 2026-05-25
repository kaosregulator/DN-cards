---
name: Discord slash command visibility
description: How admin/user commands are gated in the Discord client UI vs at runtime.
---

Discord slash commands have two independent permission layers, and we need both:

1. **`setDefaultMemberPermissions(...)` on the SlashCommandBuilder** — controls who *sees the command in the slash menu*. Without it, every member sees every command. With `Administrator`, non-admins don't see it, and server owners can re-grant per-role via Server Settings → Integrations → DN Cards → Command Permissions.

2. **Inline runtime check** in the handler (server owner OR Discord Administrator perm OR DB-table bot-admin via `!addadmin`) — actual enforcement. Required because (1) is a UI hint only; a determined client can still try to invoke a hidden command.

**Why:** before this was set, the bot rejected non-admin attempts but the commands still cluttered the slash menu for normal users, and the Discord Integrations panel couldn't categorize admin vs user commands for per-role overrides.

**How to apply:** in `register.ts`, use the `adminCmd()` helper (sets `Administrator` default) for admin commands, plain `cmd()` for user commands. Keep `ADMIN_COMMAND_NAMES` / `CARDSET_COMMAND_NAMES` aligned with whichever helper is used.
