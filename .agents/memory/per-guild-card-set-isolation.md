---
name: Per-guild card/set isolation
description: Cards and sets are owned per-guild with no cross-guild visibility fallback; every guild sees/touches only its own records.
---

# Per-guild card/set isolation

The data model treats every Discord server as a separate tenant. `cards` and `sets` both carry a `guildId`, and all visibility/mutation helpers enforce that a guild can only see or mutate records whose `guildId` matches its own.

**Rule:**
- `isVisibleTo(record, viewerGuildId)` returns true only when `record.guildId === viewerGuildId`.
- `isOwnedBy(record, actorGuildId)` returns true only when `record.guildId === actorGuildId`.
- `getCardByName`, `getSetByName`, `cardVisibilityFilter`, and `setVisibilityFilter` do **not** fall back to the home guild for non-home viewers.

**Why:** The previous model allowed home-guild cards/sets to be shared/visible to every guild. That let a new server edit cards that belonged to another set (or the home guild) as soon as the name matched, because lookups fell back to the home guild. The user wanted each new server to be a fresh start: own cards, own sets, no cross-guild access.

**How to apply:**
- When adding a new card/set lookup or mutation in a command, always pass the actor's `guildId` to the DB helper and verify the result belongs to that guild before mutating.
- The dashboard remains home-guild-only and uses `HOME_GUILD_ID` directly; it does not rely on the bot visibility helpers to reach other guilds' data.
- Home-guild cards are preserved because their existing rows are already tagged with `HOME_GUILD_ID`; they simply stop being visible to other guilds.
