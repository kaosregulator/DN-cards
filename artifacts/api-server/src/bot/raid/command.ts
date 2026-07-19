import type { ChatInputCommandInteraction } from "discord.js";
import { EmbedBuilder, MessageFlags } from "discord.js";
import { getCampaignProgress } from "./db.js";
import { starString, levelForStars } from "../cards/leveling.js";
import { startRaid } from "./manager.js";

// The campaign map for one player: cleared ✅ / next ➡️ / later ⚪ (no hard lock —
// every listed boss is still /raid start-able, preserving replay + helping
// friends). Shared by `/raid bosses` and the end-screen "🏠 Raid Hub" button.
export async function buildCampaignEmbed(guildId: string, userId: string): Promise<EmbedBuilder> {
  const p = await getCampaignProgress(guildId, userId);
  if (p.total === 0) {
    return new EmbedBuilder()
      .setTitle("🐉 Raid Campaign")
      .setColor(0xc0392b)
      .setDescription("No raid bosses are available yet. Ask an admin to create one with `/raid_admin create`.");
  }
  const bar = "█".repeat(p.defeated) + "░".repeat(Math.max(0, p.total - p.defeated));
  const header = p.isComplete
    ? "🏅 **Campaign Complete** — every boss defeated!"
    : `**${p.defeated} / ${p.total} Defeated**${p.next ? ` · Next: **${p.next.name}**` : ""}`;

  const lines = p.ordered.map((b, i) => {
    const cleared = p.defeatedIds.has(b.id);
    const isNext = p.next?.id === b.id;
    const mark = cleared ? "✅" : isNext ? "➡️" : "⚪";
    const finale = i === p.ordered.length - 1 ? " 👑" : "";
    return `${mark} **${b.name}**${finale}\n` +
      `   Entry: ${starString(b.minStars)} (Lv ${levelForStars(b.minStars)}+)` +
      (b.minPlayerLevel > 1 ? ` · battle lvl ${b.minPlayerLevel}+` : "") +
      ` · ${b.minPlayers}-${b.maxPlayers}p\n` +
      `   Reward: 💠 ${b.rewardShards.toLocaleString()} + ${b.rewardCardXp} card XP` +
      (cleared ? "  ·  *cleared — replayable*" : "");
  });

  return new EmbedBuilder()
    .setTitle("🐉 Raid Campaign")
    .setColor(p.isComplete ? 0xf1c40f : 0xc0392b)
    .setDescription(`${header}\n\`${bar}\`\n\n${lines.join("\n\n")}`.slice(0, 4000))
    .setFooter({ text: "Start any unlocked boss with /raid start boss:<name> — cleared bosses stay replayable." });
}

export async function handleRaidCommand(interaction: ChatInputCommandInteraction): Promise<void> {
  const sub = interaction.options.getSubcommand();
  if (sub === "start") {
    await startRaid(interaction, interaction.options.getString("boss", true));
    return;
  }
  if (sub === "bosses") {
    if (!interaction.guild) { await interaction.reply({ content: "Server only.", flags: MessageFlags.Ephemeral }); return; }
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const embed = await buildCampaignEmbed(interaction.guild.id, interaction.user.id);
    await interaction.editReply({ embeds: [embed] });
    return;
  }
}
