---
name: One-time tokens must consume atomically
description: Setup links / magic links / invite tokens — always flip the "used" flag in a conditional UPDATE before doing any work, not after.
---

# One-time tokens must consume atomically

If a token is "one-time use," the SELECT-then-UPDATE pattern is wrong. Two parallel requests both pass the `usedAt IS NULL` check, both do the work (create user, grant access, send email), then both flip the flag. The link becomes N-time-use under load.

**The rule:** consume in a single conditional UPDATE first, then do the side effects only if a row came back.

```ts
const [row] = await db.update(setupTokensTable)
  .set({ usedAt: new Date() })
  .where(and(
    eq(setupTokensTable.token, token),
    isNull(setupTokensTable.usedAt),
    gt(setupTokensTable.expiresAt, new Date()),
  ))
  .returning();
if (!row) return res.status(404).json({ error: "Invalid or expired" });
// ...now safe to create the user / grant access / etc.
```

**Why:** Reads aren't serialized with writes across separate statements; the database only enforces atomicity inside one statement. Same pattern as the `/pack` and `/daily` atomic claims already in this codebase — same trap, same fix.

**How to apply:** Any flow with "this can only happen once" (password reset, magic link, invite, email verification, single-use coupon). Also keep a release path that nulls `usedAt` back on validation failure so a typo doesn't burn the link.
