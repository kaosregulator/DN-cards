// ─────────────────────────────────────────────────────────────────────────────
// /quote slash command + "Make it a Quote" message context menu definitions.
// ─────────────────────────────────────────────────────────────────────────────

import {
  ApplicationCommandType,
  ContextMenuCommandBuilder,
  SlashCommandBuilder,
} from "discord.js";
import { styleChoices } from "./styles.js";

export function buildQuoteCommandJson() {
  return new SlashCommandBuilder()
    .setName("quote")
    .setDescription("Make it a Quote — turn a Discord message (or your own text) into a card")
    .setDMPermission(false)
    .addStringOption(o => o
      .setName("message_id")
      .setDescription("Quote a specific message by ID (right-click → Copy Message ID)")
      .setRequired(false))
    .addUserOption(o => o
      .setName("user")
      .setDescription("Pick from this member's last messages, or use their avatar for custom text")
      .setRequired(false))
    .addStringOption(o => o
      .setName("text")
      .setDescription("Custom quote text (skip message pick)")
      .setRequired(false)
      .setMaxLength(500))
    .addStringOption(o => o
      .setName("style")
      .setDescription("Start on a style (you can still switch)")
      .setRequired(false)
      .addChoices(...styleChoices().slice(0, 25)))
    .toJSON();
}

export function buildQuoteContextMenuJson() {
  return new ContextMenuCommandBuilder()
    .setName("Make it a Quote")
    .setType(ApplicationCommandType.Message)
    .setDMPermission(false)
    .toJSON();
}
