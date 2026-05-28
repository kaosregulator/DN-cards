# Rarity and Spawn Percentage Flow

This project keeps stored card data stable and resolves server-specific spawn behavior at runtime. Do not migrate or rewrite card/inventory rows just to change visible rarity percentages.

## Authoritative stored values

These values are persisted and must remain backward compatible:

- `cards.rarity`: stable built-in enum key (`common`, `uncommon`, `rare`, `epic`, `legendary`, `mythic`).
- `cards.dropWeight`: per-card baseline spawn source value. The column name remains for compatibility.
- `rarity_profiles.dropWeight`: optional per-guild built-in rarity override.
- `custom_rarities.dropWeight`: per-guild custom tier spawn source value.
- `sets.rarityWeights`: optional per-active-set rarity override map.
- legacy `guild_settings.rarityWeight*`: older per-guild built-in rarity override fields.
- `card_rarity_overrides`: per-guild card assignment into a custom tier.
- inventories/collections reference card IDs and are not affected by rarity display changes.

## Runtime source of truth

Visible spawn percentages are generated at runtime from pure helpers in `artifacts/api-server/src/bot/rarity-runtime.ts`, with DB-backed loading in `artifacts/api-server/src/bot/db.ts`:

1. `getGuildDropChanceRuntime(guildId)` (`db.ts`)
   - loads guild settings
   - loads the rarity context (`rarity_profiles`, `custom_rarities`, `card_rarity_overrides`)
   - loads the active set spawn pool
   - loads active event boosts
   - returns `chanceSummary`
2. `getEffectiveDropWeight(card, opts)` (`rarity-runtime.ts`)
   - resolves the single effective spawn source value for a card.
3. `buildDropChanceSummary(cards, opts)` (`rarity-runtime.ts`)
   - normalizes effective weights into per-card and per-rarity percentages.

If a new command, route, or dashboard surface displays random-spawn odds, it should call `getGuildDropChanceRuntime()` or use its `chanceSummary`. Do not recompute percentages locally.

## Resolution order

For normal random spawns, effective weight resolves in this order:

1. Custom rarity tier assignment (`card_rarity_overrides` -> `custom_rarities.dropWeight`).
2. Active set rarity override (`sets.rarityWeights`) when the set supplies that rarity key.
3. Built-in per-guild rarity profile (`rarity_profiles.dropWeight`).
4. Legacy guild rarity fields (`guild_settings.rarityWeight*`).
5. Card baseline (`cards.dropWeight`).
6. Active event boost multiplier (`card_events.weightMultiplier`) multiplies the winning value.

Cards excluded from the active set, archived cards, non-droppable cards, and cards in non-droppable custom tiers do not contribute to normal spawn percentages.

## Custom rarities

Custom rarities are additive and per guild. They do not change the built-in rarity enum or existing card IDs.

When a card is assigned to a custom rarity:

- display grouping uses `custom:<slug>` internally
- custom tier worth/burn/drop source values replace the card/built-in values for that guild
- the card keeps its original `cards.rarity` for backend compatibility
- removing the custom tier clears assignments without deleting cards or inventory

## Display names versus IDs

Built-in visual names, emojis, and colors can be overridden by `rarity_display_overrides`.

These are cosmetic only:

- they do not change `cards.rarity`
- they do not change drop percentages
- they do not change worth/burn values
- they are safe to edit without breaking existing cards or inventories

## Current surfaces using shared runtime

- random spawn picker uses `getEffectiveDropWeight()`
- `/info` uses `getGuildDropChanceRuntime().chanceSummary`
- `/list` uses `getGuildDropChanceRuntime().chanceSummary`
- public dashboard `/cards` route uses `getGuildDropChanceRuntime().chanceSummary`
- roster/card UI displays server-provided percentages

## Intentional separate draws

`pack.ts` and `tradein.ts` perform separate reward-pool weighted draws. Those are not the same as normal active-set spawn percentages and should not be folded into the spawn runtime unless the game design changes.

## Migration guidance

For future Oracle/database migration work, keep the runtime resolver boundary intact:

- migrate stored tables/columns behind `getGuildDropChanceRuntime()` and keep pure math in `rarity-runtime.ts` database-agnostic
- preserve card IDs and collection foreign keys
- keep visual display overrides separate from gameplay IDs
- avoid baking guild-specific rarity values into global card caches
