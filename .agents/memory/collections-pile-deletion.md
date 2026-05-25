---
name: Collections row deletion with multiple piles
description: When a collections row has multiple count columns (normal + shiny), row deletion must check ALL piles, not just the one being decremented.
---

# Collections row deletion rule

When the `collections` table tracks multiple parallel piles for the same `(guildId, userId, cardId)` (currently `count` for normal and `shinyCount` for shinies), any code path that decrements ONE pile and then deletes the row when that pile hits 0 will **silently erase** the other piles.

**Rule:** only `DELETE` the row when **every** pile column is 0. Otherwise `UPDATE` the decremented column and leave the row.

**Why:** the `(guildId, userId, cardId)` unique index means a deleted row cannot coexist with surviving shinies — once gone, the user's shiny inventory for that card is unrecoverable. We hit this in the shiny rollout where tradein / takeback / trade-swap all happily wiped shiny piles when the last normal copy was consumed.

**How to apply:** any new pile column added to `collections` must be added to the deletion guard in `removeCardFromUser` and both branches of `executeTradeSwap` (and to the `returning(...)` clauses there so the guard can see the value). Same rule for any future pile-aware decrement path.
