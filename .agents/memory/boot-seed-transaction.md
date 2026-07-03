---
name: Boot seed transaction pattern
description: Seed/correction migrations that DROP+re-add UNIQUE constraints must be wrapped in a single pg client transaction.
---

## Rule
Any boot migration that does `DROP CONSTRAINT` followed by upserts and then `ADD CONSTRAINT` must use a **single `pool.connect()` client** with `BEGIN`/`COMMIT`/`ROLLBACK`. Using `pool.query()` for each statement sends them on different connections — if one fails, the constraint stays dropped permanently.

**Why:** The `pool.query()` shorthand picks any available connection per call. A mid-migration error means the DROP has committed but the re-add never runs, silently removing data integrity guarantees.

**How to apply:**
```typescript
const client = await pool.connect();
try {
  await client.query("BEGIN");
  await client.query("ALTER TABLE cards DROP CONSTRAINT IF EXISTS cards_name_unique;");
  for (const stmt of migrationStmts) { await client.query(stmt); }
  await client.query("ALTER TABLE cards ADD CONSTRAINT cards_name_unique UNIQUE (name);");
  await client.query("COMMIT");
} catch (err) {
  await client.query("ROLLBACK");
  throw err;
} finally {
  client.release();
}
```

Note: `ALTER TABLE ... ADD CONSTRAINT IF NOT EXISTS` is **not valid PostgreSQL syntax**. Since we always DROP first, just unconditionally ADD at the end inside the same transaction.
