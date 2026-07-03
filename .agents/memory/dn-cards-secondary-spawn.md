---
name: DN Cards secondary spawn stream
description: Schema, config, and wiring for the secondary spawn stream (Stream 2) feature added in the June 2026 ZIP export.
---

**Schema columns added to guild_settings:**
```sql
ALTER TABLE guild_settings 
  ADD COLUMN IF NOT EXISTS spawn_channel_id_secondary TEXT,
  ADD COLUMN IF NOT EXISTS active_set_id_secondary INTEGER REFERENCES sets(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS spawn_enabled_secondary BOOLEAN NOT NULL DEFAULT FALSE;
```
Applied via raw SQL because drizzle-kit push requires a TTY terminal.

**Drizzle schema definition** (lib/db/src/schema/cards.ts):
```ts
spawnChannelIdSecondary: text("spawn_channel_id_secondary"),
activeSetIdSecondary: integer("active_set_id_secondary").references(() => setsTable.id, { onDelete: "set null" }),
spawnEnabledSecondary: boolean("spawn_enabled_secondary").notNull().default(false),
```

**Bot functions:**
- `scheduleNextSpawnSecondary(guildId)` / `clearSpawnTimerSecondary(guildId)` in spawn-manager.ts
- `getActiveSetSecondary` / `setActiveSetSecondary` / `clearActiveSetSecondary` in db.ts
- Config UI toggle: config-panel.ts handles `action === "toggle" && arg === "spawn2"`

**Register.ts:** `/setadmin active` and `/setadmin deactivate` both have `.addBooleanOption(o => o.setName("secondary")...)` to target Stream 2.

**Why:** Stream 2 lets a guild run two independent spawn pools (different channels, different active sets) simultaneously — useful for separating event cards from regular spawns.
