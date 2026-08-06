---
name: HQ concurrency and derived state
description: Release-safety rules for Player Headquarters siege, placement, and progression state.
---

HQ gameplay mutations must be atomic: eligibility checks for siege cooldown/shields and room or base placement caps cannot be separated from the write that claims the action. Otherwise rapid Discord interactions can duplicate rewards, captures, or decorations. An in-memory lock keyed only by attacker/user is insufficient for siege because different attackers can target the same base concurrently.

**Why:** The HQ interaction flow performs read-check-write operations across multiple database calls, so concurrent button clicks can both pass the same guard before either update is visible.

**How to apply:** Serialize siege by guild + defender (or use a transaction/database advisory lock) so the target's shield/cooldown state is rechecked immediately before reward/capture writes. Serialize placement by guild + user or enforce database uniqueness/cap semantics. When reconciliation computes a derived HQ level, persist it to the HQ row before rendering or return and apply the updated row consistently.