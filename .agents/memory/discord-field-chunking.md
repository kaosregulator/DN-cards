---
name: Discord embed field chunking
description: Per-rarity (or per-group) field builders that pack many lines into one Discord embed field will silently break above 1024 chars; chunk defensively.
---

When packing N items into Discord embed fields (`.addFields`), always chunk:

- Discord caps each field `value` at **1024 chars** and the whole embed at **6000 chars / 25 fields**.
- A single oversized field value makes the entire embed `.editReply` fail — the user sees nothing or an empty response, looking exactly like "my data vanished" (this is what caused the `/collection`/`/list` "missing inventory" bug).

**Rules for any chunker:**

1. Threshold at ~1000 chars (not 1024) to leave headroom for emoji width quirks.
2. Guard the overflow branch with `if (chunk)` — otherwise a first line that is itself >1000 chars pushes an empty `value: ""` (also rejected by Discord).
3. Cap at 25 fields per embed; set an overflow flag and surface a user-visible note pointing to a narrower command (`/catalog`, `/inventory`) instead of silently truncating.
4. Per-group "(cont.)" suffix on continuation fields so the user can tell it's still the same rarity/category.

**Why:** users assumed the bot was broken when overflows occurred — they had no signal that data was being clipped. Silent truncation is worse than a smaller view with a clear pointer.

**How to apply:** any new handler that builds fields from a user-controlled collection (cards, trades, achievements, history) needs the same chunker pattern. `/top` is safe because line counts are bounded; `/tradehistory` already uses a 3900-char description budget.
