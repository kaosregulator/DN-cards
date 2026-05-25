---
name: Last-owner guards must cover every removal path
description: "Owner-only" privilege systems need lockout guards on BOTH delete and demote, not just delete.
---

# Last-owner guards must cover every removal path

When the dashboard has an "owner" role that's required to manage users, a `DELETE` guard alone isn't enough — `POST /users/:id/promote { isOwner: false }` is a second way to reach "zero owners" and lock everyone out.

**The rule:** every code path that can reduce owner count by one (delete, demote, deactivate, soft-delete, account-merge, role-revoke) needs the same `if last-owner → 409` check.

**Why:** Designers think of "delete the owner" as the lockout path because it's obvious. The demote/role-change path is the same outcome with different verb. The break-glass `ADMIN_TOKEN` may save you, but assume it's the recovery path of last resort, not the daily fallback.

**How to apply:** When adding a role-management endpoint, audit it against the matrix of "ways to reach zero {role}s" — delete, demote, transfer, expire, suspend. Each gets the same guard. Mirror error messages so users learn the workaround once.
