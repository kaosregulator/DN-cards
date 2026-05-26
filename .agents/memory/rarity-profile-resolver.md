---
name: Per-guild rarity profile resolver
description: How per-server overrides for worth/burn/dropWeight are layered on top of card defaults without forking the card row.
---

# Pattern

Per-server economic rebalancing is done via a small `(guildId, rarity)` overrides table, NOT by duplicating cards per guild.

- One row per `(guildId, rarity)`. Each of `worthValue / burnValue / dropWeight` is nullable — null = "use the card's stored value".
- Loaded once per request path via `getRarityProfile(guildId)` → `Map<Rarity, RarityProfileRow>`.
- Applied via `applyRarityProfile(card, profile)` which returns a shallow-clone with overrides patched in. `applyRarityProfileAll(cards, profile)` for lists.
- Cache is per-guild with a short TTL (5s) — small dataset, but worth caching because spawn/pack/info hit it on every call. **Always invalidate explicitly** on PUT/DELETE from the dashboard route, not by TTL alone, or admins see stale values for 5s after saving.
- Empty profile (`profile.size === 0`) short-circuits early so guilds without overrides pay zero cost.

# Drop-weight precedence

When picking a random card the order is:

1. `profile.dropWeight` (per-guild rarity override) — strongest knob, only set if admin chose to override.
2. `guildSettings.rarityWeights` (legacy `!setrarity` per-rarity weights).
3. `card.dropWeight` (card's own stored weight).

**Why:** keeps the new profile system additive — existing `!setrarity` configs keep working, and a single card can still be promoted above its tier via `/event` boosts which multiply AFTER this resolution.

# How to apply

Any read path that surfaces worth / burn / drop chance, or that computes them server-side, MUST:

1. Fetch the profile once per request: `const profile = await getRarityProfile(guildId)`.
2. Apply it before display or calculation: `const card = applyRarityProfile(rawCard, profile)`.
3. For aggregates (leaderboard net worth, collection sums) — do the grouping in JS using profile-overridden `worthValue`, NOT a SQL SUM on `cards.worthValue`. SQL-side overrides would need a 3-way join + COALESCE per column, and the dataset is small.

Write paths (`/give`, `/trade-accept`, `/tradein`) do NOT need the profile applied because they don't store worth — they only move card rows between users.

# Anti-patterns

- Don't fork cards per guild. The whole point is to keep one `cards` row driving all guilds, with a tiny overrides table on top.
- Don't apply the profile inside `getAllCardsCached()` — the cache is global, and baking guild-specific data into it cross-contaminates servers.
- Don't forget `invalidateRarityProfileCache(guildId)` in any new write route that touches `rarity_profiles`.
