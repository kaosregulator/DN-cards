---
name: Multi-tenant boot migrations
description: How to safely migrate global unique constraints to per-guild composite indexes when adding guild_id to shared tables.
---

When adding a `guild_id` column and switching from global unique names to per-guild unique names, the boot migration must:

1. Fail fast if `HOME_GUILD_ID` is missing, instead of writing `NULL` and then attempting `ALTER COLUMN ... SET NOT NULL`.
2. Backfill existing rows with the parameterized home guild ID (`UPDATE ... SET guild_id = $1 WHERE guild_id IS NULL`), not string interpolation.
3. Create the new per-guild composite unique index (`CREATE UNIQUE INDEX ... ON cards (guild_id, name)`).
4. Drop the legacy global unique constraint with `ALTER TABLE ... DROP CONSTRAINT IF EXISTS ...`, not `DROP INDEX`, because the index may be owned by a constraint and cannot be dropped independently.
5. Never re-add the old global constraint in a later migration step, even inside a transaction, because it would break the intended multi-tenant semantics and fail once different guilds have the same name.

**Why:** A global unique constraint is incompatible with the goal of letting each guild have its own "M1 Abrams". The constraint-vs-index distinction matters because PostgreSQL treats a unique constraint and its backing index as a single dependency; dropping the index directly can fail with `2BP01`.

**How to apply:** If you ever extend ownership isolation to another shared table, follow the same sequence: add column, backfill with home guild, create per-tenant unique index, drop legacy constraint, and verify no later migration re-adds the global constraint.
