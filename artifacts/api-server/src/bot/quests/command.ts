import type { ChatInputCommandInteraction } from "discord.js";
import { EmbedBuilder } from "discord.js";
import type { Quest } from "@workspace/db";
import { getQuestView } from "./engine.js";
import { getOrCreateCurrency } from "../db.js";

function bar(progress: number, goal: number, width = 10): string {
  const filled = goal > 0 ? Math.round((Math.min(progress, goal) / goal) * width) : width;
  return "▰".repeat(filled) + "▱".repeat(Math.max(0, width - filled));
}

function renderQuest(q: Quest): string {
  const pack = q.rewardPackTier ? ` + 📦 ${q.rewardPackTier}` : "";
  const reward = `💠 ${q.rewardShards.toLocaleString()}${pack}`;
  if (q.done) {
    return `${q.emoji} ~~${q.label}~~ ✅\n\`${bar(q.goal, q.goal)}\` **${q.goal}/${q.goal}** · claimed ${reward}`;
  }
  return `${q.emoji} **${q.label}**\n\`${bar(q.progress, q.goal)}\` **${q.progress}/${q.goal}** · reward ${reward}`;
}

function sectionValue(quests: Quest[]): string {
  if (quests.length === 0) return "*No quests today — check back soon.*";
  return quests.map(renderQuest).join("\n\n");
}

export async function handleQuests(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!interaction.guild) return;
  const guildId = interaction.guild.id;
  const userId = interaction.user.id;

  const [{ daily, weekly }, currency] = await Promise.all([
    getQuestView(guildId, userId),
    getOrCreateCurrency(guildId, userId),
  ]);

  const dailyDone = daily.quests.filter(q => q.done).length;
  const weeklyDone = weekly.quests.filter(q => q.done).length;

  const embed = new EmbedBuilder()
    .setTitle(`🎯 ${interaction.user.username}'s Quests`)
    .setColor(0x9b59b6)
    .setDescription(
      `Complete objectives to earn 💠 shards and packs. Progress is tracked automatically — rewards are granted the moment a quest completes.\n` +
      `Balance: 💠 **${currency.shards.toLocaleString()}**`,
    )
    .addFields(
      { name: `📅 Daily — ${dailyDone}/${daily.quests.length} done (resets midnight UTC)`, value: sectionValue(daily.quests), inline: false },
      { name: `🗓️ Weekly — ${weeklyDone}/${weekly.quests.length} done (resets Monday UTC)`, value: sectionValue(weekly.quests), inline: false },
    )
    .setFooter({ text: "Quests rotate each day and week." });

  await interaction.editReply({ embeds: [embed] });
}
