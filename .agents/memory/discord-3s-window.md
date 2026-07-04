---
name: Discord 3s interaction window
description: Never do network RTTs (members.fetch, multiple DB calls) before ACKing a Discord interaction or you'll hit DiscordAPIError[10062] "Unknown interaction".
---

Discord requires the bot to acknowledge any interaction (slash command,
button, select) within **3 seconds** of receiving it. Missing the window
returns `DiscordAPIError[10062] "Unknown interaction"` and the user sees
the generic red "something went wrong, please try again" toast.

**Why:** under deployment cold start, a single `guild.members.fetch()`
RTT plus one DB query reliably blew the budget across every admin panel
(`/config`, `/adminhub`, `/setup`, `/sethub`, `/setchannels`).

**How to apply:**
- For admin checks, use `interaction.memberPermissions?.has("Administrator")`
  — it's delivered **inline** in the gateway payload, zero RTT. Never use
  `interaction.guild.members.fetch(userId).then(m => m.permissions.has(...))`.
- If the handler has any non-trivial work (DB read, building 5+ embeds),
  ACK first: `await interaction.deferReply({flags: Ephemeral})` for slash,
  `await interaction.deferUpdate()` for button/select. Then `editReply()`.
- `interaction.showModal()` is itself a response — it cannot follow a defer.
  Handlers that may end in a modal must NOT defer.
- For button handlers that show modals: use **inline-only** (`memberPermissions`)
  permission check before `showModal()`. The authoritative DB `isAdmin()` check
  belongs in the modal *submit* handler, after `deferUpdate()` (which is safe
  there since modal submit is a separate interaction with its own 3s window).
- Central dispatchers (e.g. `admin.ts`) that defer before branching mean
  every sub-handler must use `editReply`, not `reply`. Double-defer also
  surfaces as "Unknown interaction" / "Interaction already acknowledged".
