import type { ChatInputCommandInteraction } from "discord.js";
import { EmbedBuilder, MessageFlags } from "discord.js";
import { getEnabledBosses } from "./db.js";
import { starString, levelForStars } from "../cards/leveling.js";
import { startRaid } from "./manager.js";

export async function handleRaidCommand(interaction: ChatInputCommandInteraction): Promise<void> {
  const sub = interaction.options.getSubcommand();
  if (sub === "start") {
    await startRaid(interaction, interaction.options.getString("boss", true));
    return;
  }
  if (sub === "bosses") {
    if (!interaction.guild) { await interaction.reply({ content: "Server only.", flags: MessageFlags.Ephemeral }); return; }
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const bosses = await getEnabledBosses(interaction.guild.id);
    if (bosses.length === 0) {
      await interaction.editReply("No raid bosses are available yet. Ask an admin to create one with `/raid_admin create`.");
      return;
    }
    const embed = new EmbedBuilder()
      .setTitle("🐉 Available Raid Bosses")
      .setColor(0xc0392b)
      .setDescription(bosses.map(b =>
        `**${b.name}** — ${b.minPlayers}-${b.maxPlayers} players\n` +
        `Entry: ${starString(b.minStars)} card (Lv ${levelForStars(b.minStars)}+)` +
        (b.minPlayerLevel > 1 ? ` · battle level ${b.minPlayerLevel}+` : "") + "\n" +
        `Reward: 💠 ${b.rewardShards.toLocaleString()} + ${b.rewardCardXp} card XP\n` +
        (b.description ? `*${b.description}*` : ""),
      ).join("\n\n").slice(0, 4000))
      .setFooter({ text: "Start one with /raid start boss:<name>" });
    await interaction.editReply({ embeds: [embed] });
    return;
  }
}
