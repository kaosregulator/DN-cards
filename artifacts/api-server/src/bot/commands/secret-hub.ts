// /secret — Echo send hub (whisper + staff secret). /echo stays as config.
// Modals + reveal buttons (whisper_modal, adminsecret_modal, reveal_*) unchanged.

import {
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
} from "discord.js";
import { handleWhisperCommand, handleAdminSecretCommand } from "../secret/commands.js";

export function buildSecretCommandJson() {
  return new SlashCommandBuilder()
    .setName("secret")
    .setDescription("Encrypted Echo messages — whisper a member or post a staff secret")
    .setDMPermission(false)
    .addSubcommand(sc => sc
      .setName("whisper")
      .setDescription("Send an encrypted whisper only a chosen member can read")
      .addUserOption(o => o.setName("user").setDescription("The member who can read this").setRequired(true)))
    .addSubcommand(sc => sc
      .setName("staff")
      .setDescription("Post an encrypted staff message (viewer roles / admin override)"))
    .toJSON();
}

export async function handleSecretCommand(interaction: ChatInputCommandInteraction): Promise<void> {
  const sub = interaction.options.getSubcommand(true);
  if (sub === "whisper") {
    await handleWhisperCommand(interaction);
    return;
  }
  if (sub === "staff") {
    await handleAdminSecretCommand(interaction);
  }
}
