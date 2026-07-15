import type { ChatInputCommandInteraction } from "discord.js";
import { EmbedBuilder, MessageFlags } from "discord.js";
import { db, dailyClaimsTable } from "@workspace/db";
import { and, eq, sql } from "drizzle-orm";
import { addShards, getOrCreateCurrency } from "../db.js";
import { applyEmbedOverride } from "../embed-overrides.js";
import { ACHIEVEMENTS, checkAchievements, formatUnlockLine, getUnlockedKeys } from "../achievements.js";
import { runPaginator, type PaginatorView } from "../components/paginator.js";
import { chunkLines } from "../components/field-chunker.js";

// Build one or more embed screens from a base factory plus a list of fields,
// capping at `fieldsPerScreen` per embed (Discord allows 25).
function buildEmbedScreens(
  baseEmbed: () => EmbedBuilder,
  fields: { name: string; value: string; inline: false }[],
  fieldsPerScreen = 24,
): EmbedBuilder[] {
  if (fields.length === 0) return [baseEmbed()];
  const screens: EmbedBuilder[] = [];
  for (let i = 0; i < fields.length; i += fieldsPerScreen) {
    screens.push(baseEmbed().addFields(fields.slice(i, i + fieldsPerScreen)));
  }
  return screens;
}

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

// Result of attempting a daily claim — shared by the /daily command and the
// /user-hub "Daily" section's Claim button.
export interface DailyClaimResult {
  ok: boolean;             // true = claimed now, false = still on cooldown
  embed: EmbedBuilder;     // reward embed (ok) or cooldown notice (!ok)
  followUps: string[];     // quest/achievement notices to post after the reply
}

// Core daily-claim logic with NO interaction I/O — safe to call from a slash
// command or a button handler. Performs the atomic claim, credits shards +
// milestone rewards, and returns the presentation embed + any follow-up notes.
export async function claimDailyReward(
  guildId: string, userId: string, username: string, guildName: string,
): Promise<DailyClaimResult> {
  const now = new Date();
  const followUps: string[] = [];

  // Atomic first-ever insert. Survives concurrent claims thanks to the
  // unique (guild_id, user_id) index — only one insert can win.
  const inserted = await db.insert(dailyClaimsTable)
    .values({ guildId, userId, lastClaimedAt: now, streak: 1 })
    .onConflictDoNothing()
    .returning({ streak: dailyClaimsTable.streak });

  let newStreak: number;
  if (inserted.length > 0) {
    newStreak = 1;
  } else {
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
      const cooldownEmbed = new EmbedBuilder()
        .setTitle("⏳ Daily Already Claimed")
        .setColor(0x95a5a6)
        .setDescription(
          `Come back in **${formatRemaining(remaining)}**.\n` +
          `Current streak: **${cur?.streak ?? 0}** 🔥`,
        );
      return { ok: false, embed: cooldownEmbed, followUps };
    }
    newStreak = updated[0].streak;
  }

  const bonus = Math.min(MAX_STREAK_BONUS, (newStreak - 1) * STREAK_BONUS);
  const reward = BASE_REWARD + bonus;
  await addShards(guildId, userId, reward);

  // Unified account XP: one award per successful daily claim (best-effort).
  try {
    const { awardPlayerXp, XP } = await import("../player/xp.js");
    await awardPlayerXp(guildId, userId, "daily", XP.daily);
  } catch { /* non-fatal */ }

  // ── Login-calendar milestone bonus ─────────────────────────────────────────
  const { cycleDay, milestoneFor } = await import("../cards/calendar.js");
  const calDay = cycleDay(newStreak);
  const milestone = milestoneFor(calDay);
  let milestoneNote = "";
  if (milestone) {
    await addShards(guildId, userId, milestone.shards);
    if (milestone.packTier) {
      const { grantFreePack } = await import("../battle/pack-grant.js");
      await grantFreePack(guildId, userId, milestone.packTier).catch(() => undefined);
    }
    milestoneNote =
      `\n\n🏆 **Day ${calDay} milestone!** +💠 **${milestone.shards.toLocaleString()}**` +
      (milestone.packTier ? ` and a 📦 **${milestone.packTier} pack**` : "") + "!";
  }

  const currency = await getOrCreateCurrency(guildId, userId);

  const embed = new EmbedBuilder()
    .setTitle("🎁 Daily Reward Claimed!")
    .setColor(0xf1c40f)
    .setDescription(
      `You earned 💠 **${reward.toLocaleString()} shards**!\n` +
      `Base: ${BASE_REWARD} · Streak bonus: +${bonus}\n\n` +
      `🔥 Streak: **${newStreak} day${newStreak === 1 ? "" : "s"}**  ·  📅 Calendar day **${calDay}/30**\n` +
      `Balance: 💠 **${currency.shards.toLocaleString()}**` +
      milestoneNote,
    )
    .setFooter({ text: "Come back tomorrow to keep your streak alive! · /calendar · /quests" });

  await applyEmbedOverride(embed, {
    guildId, key: "daily",
    ctx: { userId, username, streak: newStreak, amount: reward, balance: currency.shards, guild: guildName },
  });

  // Quest progress — claiming daily counts toward any "claim daily" quest.
  try {
    const { recordQuestEvent, formatQuestCompletions } = await import("../quests/engine.js");
    const done = await recordQuestEvent(guildId, userId, "daily", 1);
    const note = formatQuestCompletions(done);
    if (note) followUps.push(note);
  } catch { /* non-fatal */ }

  // Achievement: streak_7 needs the live streak value
  const newly = await checkAchievements(guildId, userId, { dailyStreak: newStreak });
  if (newly.length > 0) {
    followUps.push("🏆 **Achievement unlocked!**\n" + newly.map(formatUnlockLine).join("\n"));
  }

  return { ok: true, embed, followUps };
}

export async function handleDaily(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!interaction.guild) return;
  const guildId = interaction.guild.id;
  const userId = interaction.user.id;

  const result = await claimDailyReward(guildId, userId, interaction.user.username, interaction.guild.name);

  // Merge in today's battle challenges as a second embed so /daily is the single
  // place a player checks their daily loop (login reward + battle challenges).
  const embeds = [result.embed];
  try {
    const { buildBattleDailyEmbed } = await import("./battle.js");
    embeds.push(await buildBattleDailyEmbed(guildId, userId));
  } catch { /* non-fatal — battle system may be disabled */ }

  await interaction.editReply({ embeds });
  for (const note of result.followUps) {
    await interaction.followUp({ content: note, flags: MessageFlags.Ephemeral }).catch(() => {});
  }
}

export async function handleAchievementsCommand(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!interaction.guild) return;
  const target = interaction.options.getUser("user") ?? interaction.user;
  const unlocked = await getUnlockedKeys(interaction.guild.id, target.id);

  const unlockedAchs = ACHIEVEMENTS.filter(a => unlocked.has(a.key));
  const lockedAchs = ACHIEVEMENTS.filter(a => !unlocked.has(a.key));
  const earnedShards = unlockedAchs.reduce((s, a) => s + a.reward, 0);
  const lockedShards = lockedAchs.reduce((s, a) => s + a.reward, 0);
  const totalRewards = earnedShards + lockedShards;
  const pct = ACHIEVEMENTS.length
    ? Math.round((unlockedAchs.length / ACHIEVEMENTS.length) * 100)
    : 0;

  const overview = new EmbedBuilder()
    .setTitle(`🏆 ${target.username}'s Achievements`)
    .setColor(0xe67e22)
    .setThumbnail(target.displayAvatarURL())
    .setDescription(
      `Progress: **${unlockedAchs.length}** / ${ACHIEVEMENTS.length}  ·  **${pct}%**\n` +
      `💠 Earned from achievements: **${earnedShards.toLocaleString()}** of **${totalRewards.toLocaleString()}**\n` +
      `🔒 Locked: **${lockedAchs.length}**  ·  💠 still available: **${lockedShards.toLocaleString()}**`,
    )
    .setFooter({ text: "Use the menu below to view unlocked or locked achievements" });

  const views: PaginatorView[] = [{
    key: "overview",
    label: "Overview",
    emoji: "🏠",
    description: `${unlockedAchs.length}/${ACHIEVEMENTS.length} unlocked`,
    screens: [overview],
  }];

  if (unlockedAchs.length > 0) {
    const lines = unlockedAchs.map(a =>
      `✅ ${a.emoji} **${a.name}** — ${a.description}  *(+💠 ${a.reward.toLocaleString()})*`,
    );
    const baseUnlocked = () => new EmbedBuilder()
      .setTitle(`✅ ${target.username}'s Unlocked Achievements`)
      .setColor(0x2ecc71)
      .setThumbnail(target.displayAvatarURL())
      .setDescription(
        `**${unlockedAchs.length}** of ${ACHIEVEMENTS.length} unlocked · 💠 **${earnedShards.toLocaleString()}** earned`,
      );
    const { fields } = chunkLines(lines, { baseName: "Unlocked", maxFields: 1000 });
    views.push({
      key: "unlocked",
      label: "Unlocked",
      emoji: "✅",
      description: `${unlockedAchs.length} unlocked · 💠 ${earnedShards.toLocaleString()}`,
      screens: buildEmbedScreens(baseUnlocked, fields),
    });
  }

  if (lockedAchs.length > 0) {
    const lines = lockedAchs.map(a =>
      `🔒 ${a.emoji} **${a.name}** — ${a.description}  *(+💠 ${a.reward.toLocaleString()})*`,
    );
    const baseLocked = () => new EmbedBuilder()
      .setTitle(`🔒 ${target.username}'s Locked Achievements`)
      .setColor(0x95a5a6)
      .setThumbnail(target.displayAvatarURL())
      .setDescription(
        `**${lockedAchs.length}** still to unlock · 💠 **${lockedShards.toLocaleString()}** in rewards available`,
      );
    const { fields } = chunkLines(lines, { baseName: "Locked", maxFields: 1000 });
    views.push({
      key: "locked",
      label: "Locked",
      emoji: "🔒",
      description: `${lockedAchs.length} locked · 💠 ${lockedShards.toLocaleString()}`,
      screens: buildEmbedScreens(baseLocked, fields),
    });
  }

  await runPaginator({
    interaction,
    views,
    ownerId: interaction.user.id,
  });
}
