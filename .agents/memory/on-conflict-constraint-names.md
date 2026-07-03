---
name: ON CONFLICT constraint names vs indexes
description: Drizzle creates unique indexes not constraints; ON CONFLICT ON CONSTRAINT fails. user_currency needed a manual unique index.
---

## Rule
`ON CONFLICT ON CONSTRAINT <name>` requires a formal UNIQUE CONSTRAINT (created with `ADD CONSTRAINT ... UNIQUE`). Drizzle's `uniqueIndex()` creates a **UNIQUE INDEX**, not a UNIQUE CONSTRAINT — they look the same in `\d` output but the named-constraint ON CONFLICT syntax rejects indexes.

**Fix:** Always use **column-based** `ON CONFLICT (col1, col2) DO NOTHING/UPDATE`. This works with both unique constraints AND unique indexes.

**Why user_currency was special:** `user_currency` had only a primary key on `id` — no unique index on `(guild_id, user_id)` at all. The seed's `ON CONFLICT(guild_id,user_id)` failed silently. Fix: add the index as a boot DDL migration before any seed/correction runs:
```sql
CREATE UNIQUE INDEX IF NOT EXISTS user_currency_guild_user_uniq 
ON user_currency(guild_id, user_id);
```

**How to apply:** Before writing any `ON CONFLICT` statement, verify the target columns have a unique index/constraint in the actual DB (`\d tablename`). If missing, add it in boot DDL first.
