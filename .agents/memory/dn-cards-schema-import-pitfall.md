---
name: DN Cards schema import pitfall
description: Pitfalls when copying lib/db/src/schema/cards.ts from a ZIP export — dropped local tables and missing pg-core imports.
---

**Problem:** Copying schema/cards.ts from a ZIP export silently drops any tables that were added locally (e.g. `userReputationTable`, `repLogTable`). The build succeeds but runtime fails with "No matching export" for those tables.

**Fix pattern:**
1. Copy the ZIP's schema file
2. Check git for locally-added tables: `git show HEAD:lib/db/src/schema/cards.ts | grep "^export const"`
3. Append the missing tables to the end of the new file
4. Verify all pg-core helper imports are present — the ZIP may use a different subset than what local tables need (e.g. `index` for `repLogTable`'s index definition was missing after copy)

**Missing import example:**
```ts
// ZIP's imports only had uniqueIndex, not index:
import { pgTable, text, serial, integer, timestamp, boolean, real, pgEnum, uniqueIndex, jsonb } from "drizzle-orm/pg-core";
// Needed to add:
import { ..., index } from "drizzle-orm/pg-core";
```

**Why:** The ZIP export reflects the production schema at export time; locally-added tables (rep system, etc.) were never in the ZIP.
