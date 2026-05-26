---
name: Trade accept atomic status flip
description: Why a conditional `WHERE status='pending'` is required when accepting trades, even alongside atomic balance debits.
---

When a user holds ≥2 copies of the offered card, two concurrent Accept clicks
can both pass per-row `count >= 1` debits (count 2→1, then 1→0). Both swap
transactions commit, and the recipient ends up with two copies for a one-card
trade.

**Rule:** the trade's status transition must itself be the atomic gate.
Inside `executeTradeSwap`'s transaction, first do
`UPDATE trades SET status='accepted' WHERE id=? AND status='pending' RETURNING id`.
Zero rows returned → throw "trade_already_resolved" and roll back. Only one
concurrent accept can win the transition.

**Why:** per-row balance guards prevent over-spending of a single resource but
do nothing to enforce single-execution of a multi-step exchange. The trade row
itself is the only thing that uniquely represents "this swap, exactly once."

**How to apply:** for any multi-step exchange driven by a state machine
(trade, auction bid acceptance, redemption code), gate execution on a
conditional UPDATE of the state row, inside the same transaction as the
balance changes. Don't trust a SELECT-then-act pattern even if every
individual write is atomic.
