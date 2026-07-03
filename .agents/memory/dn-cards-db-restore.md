---
name: DN Cards DB restore flow
description: How to safely extract and run the restore-prod-data.ts SQL export; pitfalls with the DO $$ wrapper and psql semicolon splitting.
---

The restore-prod-data.ts file contains a large SQL string wrapped in a TypeScript export. The SQL itself has a `DO $$ BEGIN IF (SELECT COUNT(*) FROM collections) = 0 THEN ... END IF; END $$;` guard.

**Extraction pattern:**
```python
with open('restore-prod-data.ts', 'rb') as f:
    raw = f.read().decode('utf-8', errors='replace')
# Extract lines that start with INSERT INTO only
lines = sql.split('\n')
inserts = [line.strip() + ('' if line.strip().endswith(';') else ';')
           for line in lines if line.strip().startswith('INSERT INTO')]
```

**Why:** Splitting on semicolons (`sql.split(';')`) captures `END IF` and `END $$` fragments as standalone "statements". When wrapped in `BEGIN/COMMIT`, any syntax error rolls back the entire transaction including the valid INSERTs.

**How to apply:** Write pure INSERTs to a .sql file, wrap in `BEGIN;\n...\nCOMMIT;\n`, run with `psql $DATABASE_URL -f`.

**The IF guard:** The production SQL only runs if `COUNT(*) FROM collections = 0`. If collections already has rows (e.g. from a previous backup import), the DO $$ approach silently skips everything. Extract the raw INSERTs instead — they all use `ON CONFLICT DO UPDATE` / `WHERE NOT EXISTS`, so they're idempotent.
