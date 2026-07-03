---
name: Rarity defaults and seed overrides
description: Changing RARITY_LABELS defaults also requires checking boot-seed UPSERTs into rarity_display_overrides.
---

The canonical player-facing labels for built-in rarities live in `RARITY_LABELS` (cards-data.ts). However, the production boot sequence in `artifacts/api-server/src/index.ts` explicitly UPSERTs rows into `rarity_display_overrides` for the home guild. If you change the default labels but leave the seed overrides untouched, the server will keep reverting the home guild to the old labels on every restart.

**Why:** `rarityLabel()` resolves display overrides (from `rarity_display_overrides`) before falling back to `RARITY_LABELS`. The boot seed writes those overrides, so it wins over the code default.

**How to apply:** Any time you change a built-in rarity label, search for `INSERT INTO rarity_display_overrides` in the boot seed and update the corresponding home-guild display names (or remove the override if the code default is now sufficient). Also verify `RARITY_ORDER`, `UI_RARITY_ORDER`, and `BUILTIN_POSITIONS` still match the intended display order.
