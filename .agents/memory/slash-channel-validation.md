---
name: Slash command channel validation
description: Restrict channel options to text-capable types and re-validate at runtime before storing channel IDs.
---

When a slash command accepts a Discord channel (e.g., to set a spawn channel), restrict it at registration with `addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)` and validate at runtime with `channel.isTextBased()` before persisting the channel ID. Spawn routes and other message-sending code assume a text-capable channel; letting the user pick a voice, category, or forum channel silently breaks posting later.

**Why:** Discord UI will still show invalid channel types if the option is unconstrained, and a stored bad channel ID leads to confusing runtime failures ("Unknown Channel" or permission errors) that look like bot bugs.

**How to apply:** Any new command that stores a channel ID for later bot messages must filter the option type in the `SlashCommandBuilder` and guard the resolved channel with `.isTextBased()` before writing it to guild settings or state.
