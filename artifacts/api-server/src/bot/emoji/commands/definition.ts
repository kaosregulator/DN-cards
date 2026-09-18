// ─────────────────────────────────────────────────────────────────────────────
// /emoji and /postboard slash-command definitions.
//
// `/emoji` is option-free: it opens a private interactive dashboard.
// `/postboard` is staff-only: it posts that same opening board into a channel
// so the whole server can share one entry point (each user still gets a private
// session when they tap it).
// ─────────────────────────────────────────────────────────────────────────────

import { ChannelType, PermissionFlagsBits, SlashCommandBuilder } from "discord.js";

/** `/emoji` — consumed by commands/register.ts. */
export function buildEmojiCommandJson() {
  // Deliberately option-free. Everything — target, style, size, speed, format —
  // is chosen in the interactive dashboard the command opens, so the slash
  // surface stays a single, obvious entry point.
  return new SlashCommandBuilder()
    .setName("emoji")
    .setDescription("Make an animated emoji from any avatar, image, or server icon")
    .setDMPermission(false)
    .toJSON();
}

/** `/postboard` — admin posts the shared emoji board into a channel. */
export function buildPostboardCommandJson() {
  return new SlashCommandBuilder()
    .setName("postboard")
    .setDescription("Post a shared emoji maker board in a channel (anyone can use it)")
    .setDMPermission(false)
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addChannelOption(o => o
      .setName("channel")
      .setDescription("Channel to post the emoji board in")
      .setRequired(true)
      .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement))
    .addRoleOption(o => o
      .setName("allow_role")
      .setDescription("Optional: only this role may use the live board (admins always can)")
      .setRequired(false))
    .addRoleOption(o => o
      .setName("block_role")
      .setDescription("Optional: this role may not use the live board")
      .setRequired(false))
    .toJSON();
}
