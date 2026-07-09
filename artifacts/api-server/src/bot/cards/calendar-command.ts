import type { ChatInputCommandInteraction } from "discord.js";
import { EmbedBuilder } from "discord.js";
import { db, dailyClaimsTable } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { cycleDay, renderGrid, nextMilestone, milestoneFor, MILESTONES } from "./calendar.js";

const COOLDOWN_MS = 20 * 60 * 60 * 1000;

export async function handleCalendar(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!interaction.guild) return;
  const guildId = interaction.guild.id;
  const userId = interaction.user.id;

  const [row] = await db.select().from(dailyClaimsTable)
    .where(and(eq(dailyClaimsTable.guildId, guildId), eq(dailyClaimsTable.userId, userId))).limit(1);

  const streak = row?.streak ?? 0;
  const day = cycleDay(streak);
  const claimedToday = row ? (Date.now() - row.lastClaimedAt.getTime()) < COOLDOWN_MS : false;
  const next = nextMilestone(day);
  const todayMilestone = milestoneFor(day);

  const milestoneList = MILESTONES.map(m => {
    const reached = day >= m.day;
    const pack = m.packTier ? ` + 📦 ${m.packTier} pack` : "";
    return `${reached ? "🏆" : "🎁"} **Day ${m.day}** — 💠 ${m.shards.toLocaleString()}${pack}${reached ? " ✅" : ""}`;
  }).join("\n");

  const embed = new EmbedBuilder()
    .setTitle(`📅 ${interaction.user.username}'s Login Calendar`)
    .setColor(0xf1c40f)
    .setDescription(
      `🔥 Streak: **${streak} day${streak === 1 ? "" : "s"}**  ·  Calendar day **${day}/30**\n` +
      (claimedToday ? "✅ Claimed today — come back tomorrow!" : "🎁 Your daily reward is ready — run `/cards daily`!") +
      "\n\n" + renderGrid(day),
    )
    .addFields({ name: "🏆 Milestone rewards", value: milestoneList, inline: false })
    .setFooter({
      text: next
        ? `Next milestone: Day ${next.day} (${next.day - day} day${next.day - day === 1 ? "" : "s"} away)`
        : "You've hit every milestone this cycle!",
    });

  if (todayMilestone && day > 0) {
    embed.addFields({ name: "🎉 Today", value: `Day ${day} is a milestone — claim \`/cards daily\` for the bonus if you haven't!`, inline: false });
  }

  await interaction.editReply({ embeds: [embed] });
}
