// /battle — the player entry point.
//
// Subcommands (kept under one command like the rest of the bot's hubs):
//   fight [opponent]   → start a challenge (empty opponent = battle the AI)
//   profile [user]     → battle stats card
//   leaderboard [scope]→ guild or opt-in global rankings
//   achievements [user]→ unlocked battle achievements
//   daily              → today's challenges + progress
//
// The heavy lifting (the live battle) lives in the battle-manager; this file is
// the thin command surface + the read-only stat views.

import {
  EmbedBuilder, MessageFlags,
  type ChatInputCommandInteraction,
} from "discord.js";
import { db, battleSettingsTable, battleAchievementsTable } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { getBattleSettings } from "../battle/config-engine.js";
import { startChallenge } from "../battle/battle-manager.js";
import { getOrCreateProfile } from "../battle/db.js";
import {
  getBattleLeaderboard, getGlobalLeaderboard, formatLeaderboard,
  winRate, favoriteCardName, rankTitle,
} from "../battle/leaderboard-engine.js";
import { BATTLE_ACHIEVEMENTS, formatAchievementLine } from "../battle/achievement-engine.js";
import { getOrCreateDaily } from "../battle/daily-engine.js";
import { bar } from "../battle/embeds.js";

export async function handleBattlesWelcome(interaction: ChatInputCommandInteraction): Promise<void> {
  const embed = new EmbedBuilder()
    .setColor(0xed4245)
    .setTitle("⚔️ Welcome to DN Cards Battles")
    .setDescription("A quick guide to fighting with your cards. Battles are turn-based and played in one message — pick a card, choose moves, and win rewards.")
    .addFields(
      { name: "🎴 How to start", value: "Use **/battle fight** to battle the AI.\nUse **/battle fight @user** to challenge a real player.\nUse **/battle profile** to see your stats and **/battle leaderboard** to see rankings.", inline: false },
      { name: "⚔️ Picking your fighter", value: "Press **Prepare** to choose a card from your collection. Higher level = stronger stats. You can also pick a second owned card as a **Special Support Card** that gives a bonus effect.", inline: false },
      { name: "🕹️ Moves", value: "**Attack** — basic strike.\n**Special** — your card's signature move (costs energy).\n**Defend** — raise a shield and reduce incoming damage.\n**Charge** — refill energy and boost your next attack.\n**Special Card** — use your support card's effect (has a cooldown).\n**Ultimate** — a powerful guaranteed hit once your meter is full.", inline: false },
      { name: "🏆 Rewards", value: "Win battles to earn **DN Shards** 💠 and **XP** ✨. Winning streaks give bonus shards. Every fight also earns rank points in PvP battles. There is a daily reward cap, so you can't farm forever.", inline: false },
      { name: "🤖 AI Arenas", value: "Fighting the AI lets you pick an arena. Higher arenas have tougher AI and bigger rewards. Picking an arena too hard for your card level is a fast way to lose — level up first!", inline: false },
      { name: "💰 Staking (PvP)", value: "If staking is enabled, both players can stake their battle card. The winner takes both cards. Only stake what you're willing to lose!", inline: false },
    )
    .setFooter({ text: "Tip: level up your cards with /daily and card battles to climb arenas faster!" });

  await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral }).catch(() => {});
}

export async function handleBattleCommand(
  interaction: ChatInputCommandInteraction, sub: string,
): Promise<void> {
  if (!interaction.guild) {
    await interaction.reply({ content: "Battles only work inside a server.", flags: MessageFlags.Ephemeral });
    return;
  }
  switch (sub) {
    case "fight": return void await cmdFight(interaction);
    case "profile": return void await cmdProfile(interaction);
    case "leaderboard": return void await cmdLeaderboard(interaction);
    case "achievements": return void await cmdAchievements(interaction);
    case "daily": return void await cmdDaily(interaction);
    default:
      await interaction.reply({ content: "Unknown battle command.", flags: MessageFlags.Ephemeral });
  }
}

async function cmdFight(interaction: ChatInputCommandInteraction) {
  const opponent = interaction.options.getUser("opponent");
  await startChallenge(interaction, opponent);
}

async function cmdProfile(interaction: ChatInputCommandInteraction) {
  await interaction.deferReply();
  const guildId = interaction.guild!.id;
  const target = interaction.options.getUser("user") ?? interaction.user;
  const p = await getOrCreateProfile(guildId, target.id);
  const rt = rankTitle(p.rankPoints);
  const fav = await favoriteCardName(p);
  const nextLevelXp = p.level * 200;
  const intoLevel = p.xp - (p.level - 1) * 200;

  const embed = new EmbedBuilder()
    .setColor(0xed4245)
    .setTitle(`⚔️ Battle Profile — ${target.username}`)
    .setThumbnail(target.displayAvatarURL())
    .addFields(
      { name: "Rank", value: `${rt.emoji} **${rt.name}** · ${p.rankPoints} RP`, inline: true },
      { name: "Level", value: `**${p.level}** ${p.currentTitle ? `· *${p.currentTitle}*` : ""}`, inline: true },
      { name: "XP", value: `\`${bar(intoLevel, 200, 10)}\` ${intoLevel}/${nextLevelXp - (p.level - 1) * 200}`, inline: false },
      { name: "Record", value: `✅ ${p.wins}W · ❌ ${p.losses}L · 🤝 ${p.draws}D`, inline: true },
      { name: "Win Rate", value: `**${winRate(p)}%**`, inline: true },
      { name: "Battles", value: `${p.totalBattles}`, inline: true },
      { name: "🔥 Streak", value: `${p.currentStreak} (best ${p.highestStreak})`, inline: true },
      { name: "💥 Crits", value: `${p.criticalHits}`, inline: true },
      { name: "🎴 Favorite", value: fav, inline: true },
      { name: "⚔️ Damage Dealt", value: p.damageDealt.toLocaleString(), inline: true },
      { name: "🛡️ Damage Taken", value: p.damageTaken.toLocaleString(), inline: true },
      { name: "🃏 Cards Won / Lost", value: `${p.cardsWon} / ${p.cardsLost}`, inline: true },
    );
  if (p.titles && p.titles.length > 0) {
    embed.addFields({ name: "🏷️ Titles", value: p.titles.map(t => `“${t}”`).join(", ").slice(0, 1024) });
  }
  await interaction.editReply({ embeds: [embed] });
}

async function cmdLeaderboard(interaction: ChatInputCommandInteraction) {
  await interaction.deferReply();
  const guildId = interaction.guild!.id;
  const scope = interaction.options.getString("scope") ?? "guild";
  const sortBy = (interaction.options.getString("sort") ?? "rank") as "rank" | "wins" | "streak";

  if (scope === "global") {
    const settings = await getBattleSettings(guildId);
    if (!settings.globalLeaderboardOptIn) {
      await interaction.editReply("🌐 This server hasn't opted into the global leaderboard. An admin can enable it in **/battle_admin**.");
      return;
    }
    const optedRows = await db.select({ guildId: battleSettingsTable.guildId })
      .from(battleSettingsTable).where(eq(battleSettingsTable.globalLeaderboardOptIn, true));
    const rows = await getGlobalLeaderboard(optedRows.map(r => r.guildId), 10);
    await interaction.editReply({
      embeds: [new EmbedBuilder().setColor(0x5865f2).setTitle("🌐 Global Battle Leaderboard")
        .setDescription(formatLeaderboard(rows))],
    });
    return;
  }

  const rows = await getBattleLeaderboard(guildId, sortBy, 10);
  await interaction.editReply({
    embeds: [new EmbedBuilder().setColor(0xed4245)
      .setTitle(`🏆 Battle Leaderboard — ${sortBy === "wins" ? "Most Wins" : sortBy === "streak" ? "Best Streak" : "Ranked"}`)
      .setDescription(formatLeaderboard(rows))
      .setFooter({ text: "Sort with the sort option · rank · wins · streak" })],
  });
}

async function cmdAchievements(interaction: ChatInputCommandInteraction) {
  await interaction.deferReply();
  const guildId = interaction.guild!.id;
  const target = interaction.options.getUser("user") ?? interaction.user;
  const rows = await db.select({ key: battleAchievementsTable.achievementKey })
    .from(battleAchievementsTable)
    .where(and(eq(battleAchievementsTable.guildId, guildId), eq(battleAchievementsTable.userId, target.id)));
  const unlocked = new Set(rows.map(r => r.key));

  const lines = BATTLE_ACHIEVEMENTS.map(a =>
    unlocked.has(a.key)
      ? `✅ ${formatAchievementLine(a)}`
      : `🔒 ${a.emoji} **${a.name}** — ||${a.description}||`);

  await interaction.editReply({
    embeds: [new EmbedBuilder().setColor(0xfaa61a)
      .setTitle(`🎖️ Battle Achievements — ${target.username}`)
      .setDescription(`${unlocked.size}/${BATTLE_ACHIEVEMENTS.length} unlocked\n\n${lines.join("\n")}`)],
  });
}

async function cmdDaily(interaction: ChatInputCommandInteraction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const guildId = interaction.guild!.id;
  const challenges = await getOrCreateDaily(guildId, interaction.user.id);
  const lines = challenges.map(c => {
    const done = c.claimed || c.progress >= c.goal;
    const barStr = bar(Math.min(c.progress, c.goal), c.goal, 10);
    return `${done ? "✅" : "▫️"} **${c.label}**\n\`${barStr}\` (${Math.min(c.progress, c.goal)}/${c.goal}) — 💠${c.rewardShards} · ✨${c.rewardXp} XP`;
  });
  await interaction.editReply({
    embeds: [new EmbedBuilder().setColor(0x2ecc71)
      .setTitle("📅 Daily Battle Challenges")
      .setDescription(lines.join("\n\n"))
      .setFooter({ text: "Resets daily (UTC). Rewards auto-credit on completion." })],
  });
}
