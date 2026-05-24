import type { ChatInputCommandInteraction } from "discord.js";
import { EmbedBuilder, MessageFlags } from "discord.js";
import { db, dailyClaimsTable } from "@workspace/db";
import { and, eq, sql } from "drizzle-orm";
import { addShards, getOrCreateCurrency } from "../db.js";
import { ACHIEVEMENTS, checkAchievements, formatUnlockLine, getUnlockedKeys } from "../achievements.js";

const COOLDOWN_MS = 20 * 60 * 60 * 1000;     // 20h — slight grace
const STREAK_RESET_MS = 48 * 60 * 60 * 1000; // miss a day → reset
const BASE_REWARD = 50;
const STREAK_BONUS = 10;                     // per day of current streak
const MAX_STREAK_BONUS = 200;                // cap

function formatRemaining(ms: number): string {
  const hours = Math.floor(ms / (60 * 60 * 1000));
  const mins = Math.floor((ms % (60 * 60 * 1000)) / (60 * 1000));
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m`;
}

export async function handleDaily(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!interaction.guild) return;
  const guildId = interaction.guild.id;
  const userId = interaction.user.id;
  const now = new Date();

  // Atomic first-ever insert. Survives concurrent /daily calls thanks to the
  // unique (guild_id, user_id) index — only one insert can win.
  const inserted = await db.insert(dailyClaimsTable)
    .values({ guildId, userId, lastClaimedAt: now, streak: 1 })
    .onConflictDoNothing()
    .returning({ streak: dailyClaimsTable.streak });

  let newStreak: number;
  if (inserted.length > 0) {
    newStreak = 1;
  } else {
    // Atomic update gated by the cooldown predicate. If two callers race,
    // only one row is returned — the loser sees an empty result and is told
    // to wait. CASE handles streak reset vs increment inside the same SQL.
    const cooldownHours = COOLDOWN_MS / (60 * 60 * 1000);
    const resetHours = STREAK_RESET_MS / (60 * 60 * 1000);
    const updated = await db.update(dailyClaimsTable)
      .set({
        lastClaimedAt: now,
        streak: sql`CASE
          WHEN NOW() - ${dailyClaimsTable.lastClaimedAt} > (interval '1 hour' * ${resetHours})
            THEN 1
          ELSE ${dailyClaimsTable.streak} + 1
        END`,
      })
      .where(and(
        eq(dailyClaimsTable.guildId, guildId),
        eq(dailyClaimsTable.userId, userId),
        sql`NOW() - ${dailyClaimsTable.lastClaimedAt} >= (interval '1 hour' * ${cooldownHours})`,
      ))
      .returning({ streak: dailyClaimsTable.streak });

    if (updated.length === 0) {
      const [cur] = await db.select().from(dailyClaimsTable)
        .where(and(eq(dailyClaimsTable.guildId, guildId), eq(dailyClaimsTable.userId, userId)));
      const elapsed = cur ? now.getTime() - cur.lastClaimedAt.getTime() : 0;
      const remaining = Math.max(0, COOLDOWN_MS - elapsed);
      await interaction.editReply(
        `⏳ You've already claimed your daily reward. Come back in **${formatRemaining(remaining)}**.\n` +
        `Current streak: **${cur?.streak ?? 0}** 🔥`,
      );
      return;
    }
    newStreak = updated[0].streak;
  }

  const bonus = Math.min(MAX_STREAK_BONUS, (newStreak - 1) * STREAK_BONUS);
  const reward = BASE_REWARD + bonus;
  await addShards(guildId, userId, reward);
  const currency = await getOrCreateCurrency(guildId, userId);

  const embed = new EmbedBuilder()
    .setTitle("🎁 Daily Reward Claimed!")
    .setColor(0xf1c40f)
    .setDescription(
      `You earned 💠 **${reward.toLocaleString()} shards**!\n` +
      `Base: ${BASE_REWARD} · Streak bonus: +${bonus}\n\n` +
      `🔥 Streak: **${newStreak} day${newStreak === 1 ? "" : "s"}**\n` +
      `Balance: 💠 **${currency.shards.toLocaleString()}**`,
    )
    .setFooter({ text: "Come back tomorrow to keep your streak alive!" });

  await interaction.editReply({ embeds: [embed] });

  // Achievement: streak_7 needs the live streak value
  const newly = await checkAchievements(guildId, userId, { dailyStreak: newStreak });
  if (newly.length > 0) {
    await interaction.followUp({
      content: "🏆 **Achievement unlocked!**\n" + newly.map(formatUnlockLine).join("\n"),
      flags: MessageFlags.Ephemeral,
    });
  }
}

export async function handleAchievementsCommand(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!interaction.guild) return;
  const target = interaction.options.getUser("user") ?? interaction.user;
  const unlocked = await getUnlockedKeys(interaction.guild.id, target.id);

  const lines = ACHIEVEMENTS.map(ach => {
    const has = unlocked.has(ach.key);
    const status = has ? "✅" : "🔒";
    return `${status} ${ach.emoji} **${ach.name}** — ${ach.description}` +
           (has ? "" : `  *(+💠 ${ach.reward.toLocaleString()})*`);
  });

  const embed = new EmbedBuilder()
    .setTitle(`🏆 ${target.username}'s Achievements`)
    .setColor(0xe67e22)
    .setDescription(
      `Unlocked: **${unlocked.size}** / ${ACHIEVEMENTS.length}\n\n` +
      lines.join("\n"),
    )
    .setThumbnail(target.displayAvatarURL());
  await interaction.editReply({ embeds: [embed] });
}
