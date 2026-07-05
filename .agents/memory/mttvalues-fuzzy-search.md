---
name: MTTValues fuzzy search
description: Users search game items by shorthand/acronym; match acronym, substring, compact name, description, rarity, and tags.
---

## Rule
Item-name searches in the MTTValues command should not rely on exact substring matches alone. Score matches across: exact name, name prefix, name substring, compact name (no punctuation), acronym of first letters, description, rarity, and tags. Add a tiny value-based tie-break so equal textual matches rank higher-value items slightly higher.

**Why:** Players remember items by abbreviations like `STM` for "Super Tiger Mech" or omit punctuation. A plain substring search fails for these inputs and returns "not found" even when the item exists.

**How to apply:**
- Compute `itemNameAcronym(item)` from the first letters of each word.
- Score exact/prefix matches highest, then substring, compact name, acronym, description, rarity/tags.
- Use the same scorer for `/mttvalues search`, `/mttvalues info` fallback, and autocomplete so behavior is consistent across all entry points.
- Preserve score ordering in search results; do not re-sort by value afterward unless the query is blank.
