---
name: Rarity display overlay threading
description: How per-guild rarity display overrides (displayMap) must be threaded to every rarity-label surface in the bot.
---

When adding a new cosmetic overlay layer (like `rarity_display_overrides`), EVERY file that renders a rarity label, emoji, or color must be updated. The full list of surfaces for DN Cards:

- `spawn-manager.ts` — spawn/claimed/post-decision embeds
- `user.ts` — /collection, /info, /list, /catalog, /burn
- `pack.ts` — buildSummaryEmbed
- `trading.ts` — trade proposal embed
- `tradein.ts` — buildLadder helper (the `{ rarestFirst }` opts object also accepts `displayMap`)
- `sets-user.ts` — /sets view tier headers + rarity weight lines ← easy to miss

**Why:** sets-user.ts and tradein.ts are separate command files, not part of user.ts, so grep for `RARITY_EMOJI[` or raw rarity enum strings across ALL `commands/*.ts` files — not just user.ts — before declaring threading complete.

**How to apply:** grep for `RARITY_EMOJI\[` and `RARITY_LABELS\[` direct lookups across the whole bot directory; any remaining hits after threading are likely missed surfaces.
