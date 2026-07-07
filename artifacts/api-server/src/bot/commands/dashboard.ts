import type { ChatInputCommandInteraction } from "discord.js";
import { EmbedBuilder } from "discord.js";
import { createSetupLink } from "../../lib/setup-link.js";
import { logger } from "../../lib/logger.js";
import { isHomeGuild, GLOBAL_ONLY_MSG } from "../home-guild.js";

// /dashboard — DM the requesting admin a fresh one-time login link.
// Reply is ephemeral; the link itself goes to DMs so it's not visible in
// channel even if the user is on shared screens.
// The dashboard is home-guild-only; non-home servers get a clear explanation.
export async function handleDashboardCommand(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!interaction.guild) return;
  if (!isHomeGuild(interaction.guild.id)) {
    await interaction.editReply(`❌ ${GLOBAL_ONLY_MSG}`);
    return;
  }

  const { url, expiresAt } = await createSetupLink({
    discordUserId: interaction.user.id,
    guildId: interaction.guild.id,
    ttlHours: 24,
  });

  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle("🔐 Dashboard Setup")
    .setDescription(
      `Open this link in your browser to set up (or reset) your dashboard login:\n\n` +
      `🔗 ${url}\n\n` +
      `**Expires:** <t:${Math.floor(expiresAt.getTime() / 1000)}:R>\n` +
      `One-time use. Don't share it.`,
    );

  try {
    await interaction.user.send({ embeds: [embed] });
    await interaction.editReply("📬 Check your DMs for your one-time dashboard setup link.");
  } catch (err) {
    // DMs disabled — fall back to ephemeral reply with the link.
    logger.warn({ err, userId: interaction.user.id }, "Failed to DM dashboard setup link");
    await interaction.editReply({ embeds: [embed] });
  }
}
