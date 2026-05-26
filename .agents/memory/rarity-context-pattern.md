---
name: Rarity context resolver pattern
description: How per-guild rarity overrides (Stage 1 profiles + Stage 2 custom tiers) are resolved and threaded through every read path in the DN Cards bot.
---

# Rarity context resolver

DN Cards has two layers of per-guild rarity customization that must compose deterministically across spawns, packs, /info, /list, /collection, /catalog, /burn, /trade fairness, leaderboard net worth, and /tradein:

1. **Stage 1 — rarity_profiles**: per-rarity overrides of worth / burn / dropWeight, keyed by built-in `(guildId, rarity)`.
2. **Stage 2 — custom_rarities + card_rarity_overrides**: new tiers BEYOND the six built-ins. Assigning a card to a custom tier means the custom tier's values **fully replace** the card's values (no further layering with the Stage 1 profile for that card).

The bot collapses both into a single object — the **rarity context** — and threads that one object through every read path. The two principles that matter:

**1. One resolver, one cache, one invalidation point.**
`getRarityContext(guildId)` returns `{ profile, customBySlug, customByCard }` from a 5s per-guild cache. Every mutation route (`PUT/DELETE /api/rarity-profiles`, `/api/custom-rarities`, `/api/card-rarity-overrides`) calls `invalidateRarityContextCache(guildId)`. Never split into separate caches for the two layers — they MUST be consistent within a single read of the bot, otherwise a spawn can pick a card under a custom tier's drop weight but display the built-in's emoji.

**Why:** the symptoms of inconsistency are silent and hard to reproduce — a card claimed mid-rotation can show a stale emoji / wrong worth in the claim embed.

**2. Custom tier REPLACES — it does not layer.**
`applyRarityContext(card, ctx)` is the single chokepoint that decides:
- if `ctx.customByCard.has(card.id)` → swap in the custom tier's worth/burn/dropWeight, ignore the Stage-1 profile entirely for that card.
- else → fall through to `applyRarityProfile(card, ctx.profile)`.

**Why:** the spec is that a card assigned to "Prismatic" has Prismatic's economy, period. If Stage-1 also overrode Legendary, you would otherwise double-dip.

**How to apply:**
- Every new read path that reads `card.worthValue`, `card.burnValue`, or `card.dropWeight` MUST go through `applyRarityContext` / `applyRarityContextAll`. Searching for `applyRarityProfile` usages and bulk-replacing them is the way to migrate.
- For grouping (e.g. /tradein ladder), use `effectiveRarityKey(card, ctx)` — returns the custom slug if assigned, else the built-in `c.rarity` string. The position-ordered ladder is `getDisplayRarities(ctx, settings, {rarestFirst:false})`.
- Packs default to excluding custom-tier cards (`customTier.inPacks=false` filters them out in `drawPack`). Admins can opt a custom tier into pack pools by toggling `inPacks` true.
- The `pickRandomCard` weight precedence is: custom tier dropWeight → Stage-1 profile dropWeight → guildSettings rarityWeights → card's own dropWeight. Custom tiers with `droppable=false` are filtered out entirely before weighting.
