---
name: Thread guildId through every embed builder + caller
description: When you add per-guild override support to a shared embed builder, you must update EVERY call site, not just the ones near where the helper is defined.
---

When introducing per-guild customization to a shared embed-builder function:
- Make the `guildId` parameter required (or at minimum, audit `rg -n "buildFooEmbed\("` to find every caller) instead of defaulting it to `null`.
- A default of `null` makes overrides silently no-op on the call sites you forgot, which is invisible until a user complains "I customized the claimed embed but the burn/keep/trade buttons still show the default."

**Why:** Architect caught exactly this in the DN Cards embed-customization rollout — `buildPostDecisionEmbed` was updated in the spawn-manager flow but the three button handlers in `bot/index.ts` (catch_burn / catch_keep / catch_trade) still called it without guildId. The helper short-circuits on null guildId, so it typechecked and ran, but the customization was missing in the user-visible path.

**How to apply:** Whenever you widen a builder's signature with context (guildId, userId, channelId, etc.), grep the workspace for every call site and update them all in the same patch. Prefer required params over optional-with-null-default — the type system will then enforce the audit for you.
