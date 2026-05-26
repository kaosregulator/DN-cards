---
name: Discord 5-row action component limit
description: Discord caps a message at 5 ActionRows total; exceeding it throws "Interaction has already been acknowledged" on the next update.
---

Discord messages support **at most 5 ActionRows**, and each ActionRow supports at most 5 buttons or 1 select menu. Going over either limit doesn't fail at build time — it fails on the **next** `interaction.update`/`reply` with a misleading "Interaction has already been acknowledged" error, because Discord rejects the payload after the ack window closes.

**Why:** the API accepts the malformed payload, then the client never gets a valid update, so the next interaction on the stale message acks twice.

**How to apply:**
- When a sub-panel needs 5 selects (one per rarity, tier, etc.), there is **zero room** for buttons on the same message. Put related buttons on the **parent** panel instead.
- If you need both a control button (e.g. open a modal) and 5 selects, the button belongs on the panel that launches the sub-panel, not inside it.
- Modals are the escape hatch for "I need more inputs than fit" — they support 5 text inputs, separately from the message's component budget.
