---
name: HQ concurrency and derived state
description: Release-safety rules for Player Headquarters siege, placement, and progression state.
---

HQ gameplay mutations must be atomic: eligibility checks for siege cooldown/shields, tribute claims, and room or base placement caps cannot be separated from the write that claims the action. Otherwise rapid Discord interactions can duplicate rewards, captures, or decorations. An in-memory lock keyed only by attacker/user is insufficient for siege because different attackers can target the same base concurrently.

**Why:** The HQ interaction flow performs read-check-write operations across multiple database calls, so concurrent button clicks can both pass the same guard before either update is visible.

**How to apply:** Serialize siege by guild + defender and tribute collection by guild + holder (or use a transaction/database advisory lock) so state is rechecked immediately before reward writes. Only advance a tribute clock after the shard award succeeds. Interactive sieges also need an in-process target reservation for their full session, and non-interactive attacks must reject reserved targets. Serialize placement and defense purchases/upgrades by guild + user or enforce database uniqueness/cap semantics. If a purchase charges before a later save, refund on save failure. When reconciliation computes a derived HQ level, persist it to the HQ row before rendering or return and apply the updated row consistently.