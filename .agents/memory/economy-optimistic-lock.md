---
name: Economy optimistic lock pattern
description: How to safely consume inventory before awarding currency or XP to prevent double-spend under concurrent Discord interactions.
---

# Economy optimistic lock pattern

## The rule
When a bot action consumes inventory to award a reward (Scrap, XP, Shards), always:
1. **Read** the current count/state.
2. **Update inventory first** with an exact-match WHERE clause (optimistic lock).
3. **Check affected rows** — if zero, abort and return "no_duplicates" / "insufficient".
4. **Award the reward** only after step 3 confirms success.

Never award currency or XP before the inventory decrement is confirmed.

## Why
Discord buttons can be double-clicked. Multiple interactions for the same user can arrive within milliseconds. Without an exact-match guard, two requests can both read `count = 5`, both compute `spendable = 4`, and both award scrap — spending 4 copies once but awarding rewards twice.

## How to apply
```typescript
// Step 1: read
const copies = await baseCopies(guildId, userId, cardId);
const spendable = copies - 1;
if (spendable === 0) return { ok: false, reason: "no_duplicates" };

// Step 2: conditional update with exact-match lock
const affected = await db.update(collectionsTable)
  .set({ count: 1 })
  .where(and(
    eq(collectionsTable.guildId, guildId),
    eq(collectionsTable.userId, userId),
    eq(collectionsTable.cardId, cardId),
    eq(collectionsTable.count, copies),  // ← exact match, not just > 1
  ))
  .returning({ count: collectionsTable.count });

// Step 3: verify
if (affected.length === 0) return { ok: false, reason: "no_duplicates" };

// Step 4: award
await addScrap(guildId, userId, spendable * scrapValueForCard(rarity, worthValue));
```

## Files
- `artifacts/api-server/src/bot/cards/stars.ts` — `recycleForScrap`, `fuseCard` (both implement this pattern)
- Pattern also applies to any future "spend X to get Y" action in the bot economy.
