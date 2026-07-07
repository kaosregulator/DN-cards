---
name: Set membership ownership checks
description: Centralize cross-guild ownership and visibility checks in card/set membership helpers, not just command handlers.
---

Card-set membership helpers (`addCardToSet`, `removeCardFromSet`, `moveCardBetweenSets`, `bulkAddCardsToSet`, `bulkRemoveCardsFromSet`) are the right place to enforce cross-guild safety because they are reused by multiple paths:

- Discord slash commands
- Prefix commands
- Bulk import flows (`/setadmin load`, `/loadset`, `!import`)
- Card creation with an optional set assignment

Each mutator should take an `actorGuildId` (or `viewerGuildId`) and verify:

1. The target set is owned by the actor guild (or the home guild is acting).
2. The card is visible to the actor guild (home guild cards are shared, actor guild cards are local).
3. A non-home set can only contain home-guild cards or cards from the same guild; it must never contain cards from a third guild.

**Why:** Command-level admin checks ensure the caller is an admin of their own server, but they do not prevent an import or bulk path from accidentally linking a card that belongs to another non-home guild into the actor's set. Centralizing the check in the helper closes that gap for all callers.

**How to apply:** When adding a new membership-like operation, require the actor guild ID, resolve both records through the visibility helpers, and assert compatibility before touching the pivot table. Return clear errors rather than silently no-oping or failing with a raw DB constraint violation.
