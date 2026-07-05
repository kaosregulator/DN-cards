---
name: Discord ephemeral auto-delete
description: Bot can delete its own ephemeral interaction replies after a timeout; useful for temporary lookups.
---

## Rule
Ephemeral replies to slash commands can be removed by the bot that posted them. Use `interaction.deleteReply()` inside a scheduled timeout; failures are safe to ignore (message may already be gone or user dismissed it).

**Why:** Users often want sensitive or transient data (e.g., live market values, search results) to vanish automatically without leaving a trail in the channel. Ephemeral-only visibility still leaves the message in the user's client; explicit deletion removes it.

**How to apply:**
- Create a helper that always adds `MessageFlags.Ephemeral` to the reply and then calls `setTimeout(() => interaction.deleteReply().catch(() => {}), ms)`.
- Do not try to delete follow-up messages with `deleteReply()`; use `deleteFollowUp()` or message references if you need to clean up follow-ups.
- Swallow deletion errors — they usually mean the message was already deleted or the interaction token expired.
