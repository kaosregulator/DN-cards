---
name: Discord modal label length
description: TextInput.setLabel() enforces ≤45 chars; dynamically constructed labels crash at runtime if over limit.
---

## Rule
`TextInputBuilder.setLabel()` throws `ExpectedConstraintError: Invalid string length` if the label exceeds 45 characters. This is a Discord-side constraint enforced by `@sapphire/shapeshift` inside `@discordjs/builders`.

**Why:** Any descriptive label that includes dynamic content (card field name, guild name, tier name, etc.) can quietly exceed 45 chars when the dynamic part is long. The error surfaces only at runtime and produces "Something went wrong. Please try again." to the user.

**How to apply:**
- Keep all static TextInput labels to ≤35 chars to leave room for any prefix/suffix.
- Preferred fix: write static, concise labels and put the dynamic context in `setPlaceholder()` (which has a 100-char limit) or in the modal title.
- If dynamic content must appear in the label, always `.slice(0, 45)` it before calling `setLabel()`.
- When reviewing new edit-card / config-panel field definitions, count the label length explicitly.
