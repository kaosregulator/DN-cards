// /tatsu — Discord dashboard for Tatsu score/points leaderboards + spam tools.
// Ephemeral, Administrator-only. No mini-games (unlike /unbelievaboat).
//
// What the Tatsu API can do: rankings (all/month/week), member points/score,
// add/remove points & score (≤100k/call, needs MANAGE_GUILD on the key owner),
// global user profile. What it cannot: persistence/spam rates, wipe economy,
// leveled roles — those stay on Tatsu's website / t@ menus.

import type {
  ChatInputCommandInteraction,
  ButtonInteraction,
  StringSelectMenuInteraction,
  UserSelectMenuInteraction,
  ChannelSelectMenuInteraction,
  ModalSubmitInteraction,
  TextChannel,
} from "discord.js";
import {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  MessageFlags,
  UserSelectMenuBuilder,
  ChannelSelectMenuBuilder,
  ChannelType,
} from "discord.js";
import {
  isTatsuConfigured,
  tatsuApi,
  type TatsuPeriod,
  TATSU_MODIFY_MAX,
} from "../../lib/tatsu/client.js";
import {
  getOrCreateTatsuSettings,
  updateTatsuSettings,
  writeTatsuAudit,
  listTatsuAudit,
  listWatchlist,
  upsertWatchlist,
  removeWatchlist,
  saveSnapshot,
  latestSnapshot,
} from "../../lib/tatsu/db.js";

const EPHEMERAL = { flags: MessageFlags.Ephemeral } as const;
const TATSU_COLOR = 0x5865f2;
const TATSU_ICON = "https://tatsu.gg/images/tatsu.png";

export function buildTatsuAdminCommandJson() {
  return new SlashCommandBuilder()
    .setName("tatsu")
    .setDescription("Tatsu Discord dashboard — leaderboard, points, score, spam watch")
    .setDMPermission(false)
    .setDefaultMemberPermissions(0x8)
    .toJSON();
}

function hubRows() {
  return [
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId("tatsu:overview").setLabel("Overview").setEmoji("📋").setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId("tatsu:leaderboard").setLabel("Leaderboard").setEmoji("🏆").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId("tatsu:lookup").setLabel("Lookup user").setEmoji("🔍").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId("tatsu:audit").setLabel("Audit log").setEmoji("📜").setStyle(ButtonStyle.Secondary),
    ),
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId("tatsu:points").setLabel("Adjust points").setEmoji("💠").setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId("tatsu:score").setLabel("Adjust score").setEmoji("⭐").setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId("tatsu:strip").setLabel("Strip spam").setEmoji("🪓").setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId("tatsu:watch").setLabel("Watchlist").setEmoji("👁️").setStyle(ButtonStyle.Primary),
    ),
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId("tatsu:snapshot").setLabel("Snapshot + climbers").setEmoji("📸").setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId("tatsu:toggle").setLabel("Toggle API link").setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId("tatsu:logs").setLabel("Log channel").setEmoji("📢").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId("tatsu:period").setLabel("Ranking period").setEmoji("📅").setStyle(ButtonStyle.Secondary),
    ),
  ];
}

function fmt(n: number) {
  return new Intl.NumberFormat().format(n);
}

function periodLabel(p: string): string {
  if (p === "month") return "this month";
  if (p === "week") return "this week";
  return "all-time";
}

async function buildOverviewEmbed(guildId: string): Promise<EmbedBuilder> {
  const settings = await getOrCreateTatsuSettings(guildId);
  const watch = await listWatchlist(guildId);
  const snap = await latestSnapshot(guildId, settings.rankingPeriod);
  let probe = "_API not queried_";
  let apiErr: string | null = null;

  if (isTatsuConfigured() && settings.enabled) {
    try {
      const board = await tatsuApi.getGuildRankings(settings.tatsuGuildId || guildId, settings.rankingPeriod as TatsuPeriod, 0);
      const n = board.rankings?.length ?? 0;
      const top = board.rankings?.[0];
      probe = top
        ? `Top #1 <@${top.user_id}> · score **${fmt(top.score)}** · page has **${n}** (max 100/page)`
        : `Leaderboard empty for **${periodLabel(settings.rankingPeriod)}**.`;
    } catch (err) {
      apiErr = err instanceof Error ? err.message : "Tatsu API error";
    }
  }

  return new EmbedBuilder()
    .setColor(TATSU_COLOR)
    .setAuthor({ name: "Tatsu Discord dashboard", iconURL: TATSU_ICON })
    .setTitle("Score · points · spam control")
    .setDescription(
      [
        `API key configured: **${isTatsuConfigured() ? "yes" : "no"}** *(create with \`t!apikey create\`)*`,
        `Tatsu API link: **${settings.enabled ? "on" : "off"}**`,
        `Ranking period: **${periodLabel(settings.rankingPeriod)}**`,
        `Log channel: **${settings.logChannelId ? `<#${settings.logChannelId}>` : "not set"}**`,
        `Watchlist: **${watch.length}** · spam score delta flag: **${fmt(settings.spamScoreDelta)}**`,
        `Linked guild id: \`${settings.tatsuGuildId || guildId}\``,
        snap ? `Last snapshot: <t:${Math.floor(snap.createdAt.getTime() / 1000)}:R> (${snap.rankings.length} rows)` : "Last snapshot: _none yet_",
        "",
        probe,
        apiErr ? `⚠️ ${apiErr}` : null,
        "",
        "**API can:** read boards · lookup points/score · add/remove points & score (≤100k/call).",
        "**API cannot:** persistence / msg rate (use `t@persistence` on Tatsu) · wipe economy · leveled roles.",
        "Key owner must be **in this server** with **Manage Server** for edits.",
      ].filter(Boolean).join("\n"),
    )
    .setFooter({ text: "Admin only · rate limit 60 req/min · docs: https://dev.tatsu.gg/" });
}

export async function handleTatsuAdminCommand(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!interaction.guildId) {
    await interaction.reply({ content: "Server only.", ...EPHEMERAL });
    return;
  }
  await interaction.deferReply(EPHEMERAL);
  const embed = await buildOverviewEmbed(interaction.guildId);
  await interaction.editReply({ embeds: [embed], components: hubRows() });
}

function rankingPeriodOf(settingsPeriod: string): TatsuPeriod {
  if (settingsPeriod === "month" || settingsPeriod === "week") return settingsPeriod;
  return "all";
}

async function renderLeaderboard(
  guildId: string,
  period: TatsuPeriod,
  offset: number,
): Promise<{ embed: EmbedBuilder; components: ActionRowBuilder<ButtonBuilder | StringSelectMenuBuilder>[] }> {
  const settings = await getOrCreateTatsuSettings(guildId);
  let lines = "_Configure `TATSU_API_KEY` and enable the Tatsu API link._";
  if (isTatsuConfigured() && settings.enabled) {
    try {
      const board = await tatsuApi.getGuildRankings(settings.tatsuGuildId || guildId, period, offset);
      const rows = board.rankings ?? [];
      lines = rows.length
        ? rows.map(r =>
          `**#${r.rank}.** <@${r.user_id}> — score **${fmt(r.score)}**`,
        ).join("\n")
        : "_No rankings on this page._";
    } catch (err) {
      lines = `⚠️ ${err instanceof Error ? err.message : "Leaderboard failed"}`;
    }
  }

  const embed = new EmbedBuilder()
    .setColor(TATSU_COLOR)
    .setAuthor({ name: "Tatsu leaderboard", iconURL: TATSU_ICON })
    .setTitle(`Top scores · ${periodLabel(period)} · offset ${offset}`)
    .setDescription(lines)
    .setFooter({ text: "Max 100 per page · use Next / Prev · period menu below" });

  const periodMenu = new StringSelectMenuBuilder()
    .setCustomId("tatsu:period_select")
    .setPlaceholder("Ranking period…")
    .addOptions(
      { label: "All-time", value: "all", default: period === "all" },
      { label: "This month", value: "month", default: period === "month" },
      { label: "This week", value: "week", default: period === "week" },
    );

  const nav = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`tatsu:lb_prev:${period}:${Math.max(0, offset - 100)}`).setLabel("Prev 100").setStyle(ButtonStyle.Secondary).setDisabled(offset <= 0),
    new ButtonBuilder().setCustomId(`tatsu:lb_next:${period}:${offset + 100}`).setLabel("Next 100").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId("tatsu:overview").setLabel("Home").setStyle(ButtonStyle.Primary),
  );

  return {
    embed,
    components: [
      new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(periodMenu),
      nav,
    ],
  };
}

export async function handleTatsuAdminComponent(
  interaction: ButtonInteraction | StringSelectMenuInteraction | UserSelectMenuInteraction | ChannelSelectMenuInteraction,
): Promise<void> {
  const guildId = interaction.guildId;
  if (!guildId) {
    await interaction.reply({ content: "Server only.", ...EPHEMERAL });
    return;
  }
  if (!interaction.memberPermissions?.has("Administrator")) {
    await interaction.reply({ content: "Administrator only.", ...EPHEMERAL });
    return;
  }

  const id = interaction.customId;
  const settings = await getOrCreateTatsuSettings(guildId);
  const tatsuGuild = settings.tatsuGuildId || guildId;

  if (id === "tatsu:overview" && interaction.isButton()) {
    await interaction.deferUpdate();
    const embed = await buildOverviewEmbed(guildId);
    await interaction.editReply({ embeds: [embed], components: hubRows() });
    return;
  }

  if ((id === "tatsu:leaderboard" || id.startsWith("tatsu:lb_")) && interaction.isButton()) {
    await interaction.deferUpdate();
    let period = rankingPeriodOf(settings.rankingPeriod);
    let offset = 0;
    if (id.startsWith("tatsu:lb_")) {
      const parts = id.split(":"); // tatsu:lb_next:all:100
      period = (parts[2] as TatsuPeriod) || period;
      offset = Number(parts[3] ?? 0) || 0;
    }
    const view = await renderLeaderboard(guildId, period, offset);
    await interaction.editReply({ embeds: [view.embed], components: view.components });
    return;
  }

  if (id === "tatsu:period_select" && interaction.isStringSelectMenu()) {
    await interaction.deferUpdate();
    const period = (interaction.values[0] ?? "all") as TatsuPeriod;
    await updateTatsuSettings(guildId, { rankingPeriod: period });
    const view = await renderLeaderboard(guildId, period, 0);
    await interaction.editReply({ embeds: [view.embed], components: view.components });
    return;
  }

  if (id === "tatsu:period" && interaction.isButton()) {
    await interaction.deferUpdate();
    const menu = new StringSelectMenuBuilder()
      .setCustomId("tatsu:period_home")
      .setPlaceholder("Default ranking period for this dashboard…")
      .addOptions(
        { label: "All-time", value: "all", default: settings.rankingPeriod === "all" },
        { label: "This month", value: "month", default: settings.rankingPeriod === "month" },
        { label: "This week", value: "week", default: settings.rankingPeriod === "week" },
      );
    await interaction.editReply({
      embeds: [
        new EmbedBuilder()
          .setColor(TATSU_COLOR)
          .setTitle("📅 Ranking period")
          .setDescription(`Current default: **${periodLabel(settings.rankingPeriod)}**`),
      ],
      components: [
        new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu),
        new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder().setCustomId("tatsu:overview").setLabel("Home").setStyle(ButtonStyle.Primary),
        ),
      ],
    });
    return;
  }

  if (id === "tatsu:period_home" && interaction.isStringSelectMenu()) {
    await interaction.deferUpdate();
    const period = interaction.values[0] ?? "all";
    await updateTatsuSettings(guildId, { rankingPeriod: period });
    const embed = await buildOverviewEmbed(guildId);
    await interaction.editReply({ embeds: [embed], components: hubRows() });
    return;
  }

  if (id === "tatsu:toggle" && interaction.isButton()) {
    await interaction.deferUpdate();
    await updateTatsuSettings(guildId, { enabled: !settings.enabled });
    const embed = await buildOverviewEmbed(guildId);
    await interaction.editReply({ embeds: [embed], components: hubRows() });
    return;
  }

  if (id === "tatsu:logs" && interaction.isButton()) {
    await interaction.deferUpdate();
    const pick = new ChannelSelectMenuBuilder()
      .setCustomId("tatsu:log_channel")
      .setPlaceholder("Pick a log channel…")
      .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
      .setMinValues(1)
      .setMaxValues(1);
    await interaction.editReply({
      embeds: [
        new EmbedBuilder()
          .setColor(TATSU_COLOR)
          .setTitle("📢 Log channel")
          .setDescription(`Current: **${settings.logChannelId ? `<#${settings.logChannelId}>` : "not set"}**`),
      ],
      components: [
        new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(pick),
        new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder().setCustomId("tatsu:log_clear").setLabel("Clear").setStyle(ButtonStyle.Danger),
          new ButtonBuilder().setCustomId("tatsu:overview").setLabel("Home").setStyle(ButtonStyle.Primary),
        ),
      ],
    });
    return;
  }

  if (id === "tatsu:log_channel" && interaction.isChannelSelectMenu()) {
    await interaction.deferUpdate();
    const ch = interaction.values[0];
    await updateTatsuSettings(guildId, { logChannelId: ch });
    const embed = await buildOverviewEmbed(guildId);
    await interaction.editReply({ embeds: [embed], components: hubRows() });
    return;
  }

  if (id === "tatsu:log_clear" && interaction.isButton()) {
    await interaction.deferUpdate();
    await updateTatsuSettings(guildId, { logChannelId: null });
    const embed = await buildOverviewEmbed(guildId);
    await interaction.editReply({ embeds: [embed], components: hubRows() });
    return;
  }

  if (id === "tatsu:lookup" && interaction.isButton()) {
    await interaction.deferUpdate();
    const pick = new UserSelectMenuBuilder()
      .setCustomId("tatsu:lookup_user")
      .setPlaceholder("Pick a member to inspect…")
      .setMinValues(1)
      .setMaxValues(1);
    await interaction.editReply({
      embeds: [
        new EmbedBuilder()
          .setColor(TATSU_COLOR)
          .setTitle("🔍 Lookup user")
          .setDescription("Pulls **guild points**, **score ranks** (all/month/week), and **global Tatsu profile**."),
      ],
      components: [
        new ActionRowBuilder<UserSelectMenuBuilder>().addComponents(pick),
        new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder().setCustomId("tatsu:overview").setLabel("Home").setStyle(ButtonStyle.Primary),
        ),
      ],
    });
    return;
  }

  if (id === "tatsu:lookup_user" && interaction.isUserSelectMenu()) {
    await interaction.deferUpdate();
    const userId = interaction.values[0]!;
    const lines: string[] = [];
    if (!isTatsuConfigured() || !settings.enabled) {
      lines.push("_API off or key missing._");
    } else {
      try {
        const [points, all, month, week, profile] = await Promise.all([
          tatsuApi.getMemberPoints(tatsuGuild, userId).catch(e => e as Error),
          tatsuApi.getMemberRanking(tatsuGuild, userId, "all").catch(e => e as Error),
          tatsuApi.getMemberRanking(tatsuGuild, userId, "month").catch(e => e as Error),
          tatsuApi.getMemberRanking(tatsuGuild, userId, "week").catch(e => e as Error),
          tatsuApi.getUserProfile(userId).catch(e => e as Error),
        ]);
        if (points instanceof Error) lines.push(`Points: ⚠️ ${points.message}`);
        else lines.push(`**Points:** ${fmt(points.points)} · points-rank **#${points.rank}**`);
        if (all instanceof Error) lines.push(`All-time score: ⚠️ ${all.message}`);
        else lines.push(`**All-time score:** ${fmt(all.score)} · rank **#${all.rank}**`);
        if (month instanceof Error) lines.push(`Month score: ⚠️ ${month.message}`);
        else lines.push(`**Month score:** ${fmt(month.score)} · rank **#${month.rank}**`);
        if (week instanceof Error) lines.push(`Week score: ⚠️ ${week.message}`);
        else lines.push(`**Week score:** ${fmt(week.score)} · rank **#${week.rank}**`);
        if (profile instanceof Error) lines.push(`Global profile: ⚠️ ${profile.message}`);
        else {
          lines.push("");
          lines.push(`**Global profile** — ${profile.username ?? "?"} · XP ${fmt(profile.xp)} · rep ${fmt(profile.reputation)}`);
          lines.push(`Credits ${fmt(profile.credits)} · tokens ${fmt(profile.tokens)} · sub type ${profile.subscription_type}`);
          if (profile.title) lines.push(`Title: ${profile.title}`);
        }
      } catch (err) {
        lines.push(`⚠️ ${err instanceof Error ? err.message : "Lookup failed"}`);
      }
    }
    const watch = await listWatchlist(guildId);
    const onWatch = watch.some(w => w.userId === userId);
    await interaction.editReply({
      embeds: [
        new EmbedBuilder()
          .setColor(TATSU_COLOR)
          .setTitle(`🔍 <@${userId}>`)
          .setDescription(lines.join("\n") + (onWatch ? "\n\n👁️ **On watchlist**" : "")),
      ],
      components: [
        new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder().setCustomId(`tatsu:watch_add_quick:${userId}`).setLabel(onWatch ? "Update watch note" : "Add to watchlist").setStyle(ButtonStyle.Danger),
          new ButtonBuilder().setCustomId("tatsu:lookup").setLabel("Lookup another").setStyle(ButtonStyle.Secondary),
          new ButtonBuilder().setCustomId("tatsu:overview").setLabel("Home").setStyle(ButtonStyle.Primary),
        ),
      ],
    });
    return;
  }

  if (id === "tatsu:points" && interaction.isButton()) {
    await interaction.deferUpdate();
    const pick = new UserSelectMenuBuilder().setCustomId("tatsu:points_user").setPlaceholder("Member for points adjust…").setMinValues(1).setMaxValues(1);
    await interaction.editReply({
      embeds: [new EmbedBuilder().setColor(TATSU_COLOR).setTitle("💠 Adjust points").setDescription(`Add or remove server points (API max **${fmt(TATSU_MODIFY_MAX)}** per call; we chunk larger amounts).`)],
      components: [
        new ActionRowBuilder<UserSelectMenuBuilder>().addComponents(pick),
        new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder().setCustomId("tatsu:overview").setLabel("Home").setStyle(ButtonStyle.Primary),
        ),
      ],
    });
    return;
  }

  if (id === "tatsu:points_user" && interaction.isUserSelectMenu()) {
    const userId = interaction.values[0]!;
    const modal = new ModalBuilder()
      .setCustomId(`tatsu:points_modal:${userId}`)
      .setTitle("Adjust Tatsu points")
      .addComponents(
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder().setCustomId("action").setLabel("Action: add or remove").setStyle(TextInputStyle.Short).setRequired(true).setPlaceholder("add"),
        ),
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder().setCustomId("amount").setLabel("Amount (1+)").setStyle(TextInputStyle.Short).setRequired(true).setPlaceholder("1000"),
        ),
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder().setCustomId("reason").setLabel("Reason (optional)").setStyle(TextInputStyle.Short).setRequired(false),
        ),
      );
    await interaction.showModal(modal);
    return;
  }

  if (id === "tatsu:score" && interaction.isButton()) {
    await interaction.deferUpdate();
    const pick = new UserSelectMenuBuilder().setCustomId("tatsu:score_user").setPlaceholder("Member for score adjust…").setMinValues(1).setMaxValues(1);
    await interaction.editReply({
      embeds: [new EmbedBuilder().setColor(TATSU_COLOR).setTitle("⭐ Adjust score").setDescription(`Add or remove XP/score (API max **${fmt(TATSU_MODIFY_MAX)}** per call; we chunk larger amounts).`)],
      components: [
        new ActionRowBuilder<UserSelectMenuBuilder>().addComponents(pick),
        new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder().setCustomId("tatsu:overview").setLabel("Home").setStyle(ButtonStyle.Primary),
        ),
      ],
    });
    return;
  }

  if (id === "tatsu:score_user" && interaction.isUserSelectMenu()) {
    const userId = interaction.values[0]!;
    const modal = new ModalBuilder()
      .setCustomId(`tatsu:score_modal:${userId}`)
      .setTitle("Adjust Tatsu score")
      .addComponents(
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder().setCustomId("action").setLabel("Action: add or remove").setStyle(TextInputStyle.Short).setRequired(true).setPlaceholder("remove"),
        ),
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder().setCustomId("amount").setLabel("Amount (1+)").setStyle(TextInputStyle.Short).setRequired(true).setPlaceholder("5000"),
        ),
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder().setCustomId("reason").setLabel("Reason (optional)").setStyle(TextInputStyle.Short).setRequired(false),
        ),
      );
    await interaction.showModal(modal);
    return;
  }

  if (id === "tatsu:strip" && interaction.isButton()) {
    await interaction.deferUpdate();
    const pick = new UserSelectMenuBuilder().setCustomId("tatsu:strip_user").setPlaceholder("Suspected spam account…").setMinValues(1).setMaxValues(1);
    await interaction.editReply({
      embeds: [
        new EmbedBuilder()
          .setColor(0xed4245)
          .setTitle("🪓 Strip spam gains")
          .setDescription(
            "Removes **points and/or score** from a member in one go (chunked).\n" +
            "Use after spotting a climber. For message-rate / persistence, still use Tatsu's `t@persistence`.",
          ),
      ],
      components: [
        new ActionRowBuilder<UserSelectMenuBuilder>().addComponents(pick),
        new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder().setCustomId("tatsu:overview").setLabel("Home").setStyle(ButtonStyle.Primary),
        ),
      ],
    });
    return;
  }

  if (id === "tatsu:strip_user" && interaction.isUserSelectMenu()) {
    const userId = interaction.values[0]!;
    const modal = new ModalBuilder()
      .setCustomId(`tatsu:strip_modal:${userId}`)
      .setTitle("Strip Tatsu spam")
      .addComponents(
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder().setCustomId("points").setLabel("Points to REMOVE (0 = skip)").setStyle(TextInputStyle.Short).setRequired(true).setValue("0"),
        ),
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder().setCustomId("score").setLabel("Score to REMOVE (0 = skip)").setStyle(TextInputStyle.Short).setRequired(true).setValue("0"),
        ),
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder().setCustomId("reason").setLabel("Reason").setStyle(TextInputStyle.Short).setRequired(true).setPlaceholder("spam / farming"),
        ),
      );
    await interaction.showModal(modal);
    return;
  }

  if (id === "tatsu:watch" && interaction.isButton()) {
    await interaction.deferUpdate();
    const watch = await listWatchlist(guildId);
    const lines = watch.length
      ? watch.slice(0, 20).map(w =>
        `• <@${w.userId}> — ${w.note ? w.note.slice(0, 80) : "_no note_"} · by <@${w.flaggedBy}>`,
      ).join("\n")
      : "_Watchlist empty._";
    const pick = new UserSelectMenuBuilder().setCustomId("tatsu:watch_add").setPlaceholder("Add / update watch…").setMinValues(1).setMaxValues(1);
    const rem = new UserSelectMenuBuilder().setCustomId("tatsu:watch_remove").setPlaceholder("Remove from watch…").setMinValues(1).setMaxValues(1);
    await interaction.editReply({
      embeds: [
        new EmbedBuilder()
          .setColor(TATSU_COLOR)
          .setTitle("👁️ Spam watchlist")
          .setDescription(lines)
          .setFooter({ text: `${watch.length} watched · local to DN Cards (not synced to Tatsu)` }),
      ],
      components: [
        new ActionRowBuilder<UserSelectMenuBuilder>().addComponents(pick),
        new ActionRowBuilder<UserSelectMenuBuilder>().addComponents(rem),
        new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder().setCustomId("tatsu:overview").setLabel("Home").setStyle(ButtonStyle.Primary),
        ),
      ],
    });
    return;
  }

  if (id === "tatsu:watch_add" && interaction.isUserSelectMenu()) {
    const userId = interaction.values[0]!;
    const modal = new ModalBuilder()
      .setCustomId(`tatsu:watch_modal:${userId}`)
      .setTitle("Watchlist note")
      .addComponents(
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder().setCustomId("note").setLabel("Why are they watched?").setStyle(TextInputStyle.Paragraph).setRequired(false).setMaxLength(400),
        ),
      );
    await interaction.showModal(modal);
    return;
  }

  if (id.startsWith("tatsu:watch_add_quick:") && interaction.isButton()) {
    const userId = id.slice("tatsu:watch_add_quick:".length);
    const modal = new ModalBuilder()
      .setCustomId(`tatsu:watch_modal:${userId}`)
      .setTitle("Watchlist note")
      .addComponents(
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder().setCustomId("note").setLabel("Why are they watched?").setStyle(TextInputStyle.Paragraph).setRequired(false).setMaxLength(400),
        ),
      );
    await interaction.showModal(modal);
    return;
  }

  if (id === "tatsu:watch_remove" && interaction.isUserSelectMenu()) {
    await interaction.deferUpdate();
    const userId = interaction.values[0]!;
    const removed = await removeWatchlist(guildId, userId);
    await writeTatsuAudit({
      guildId,
      actorId: interaction.user.id,
      targetUserId: userId,
      action: "watch_remove",
      detail: { removed },
    });
    const watch = await listWatchlist(guildId);
    await interaction.editReply({
      embeds: [
        new EmbedBuilder()
          .setColor(TATSU_COLOR)
          .setTitle("👁️ Watchlist")
          .setDescription(removed ? `Removed <@${userId}>.\n\n${watch.length} remaining.` : `<@${userId}> was not on the list.`),
      ],
      components: hubRows(),
    });
    return;
  }

  if (id === "tatsu:snapshot" && interaction.isButton()) {
    await interaction.deferUpdate();
    if (!isTatsuConfigured() || !settings.enabled) {
      await interaction.editReply({
        embeds: [new EmbedBuilder().setColor(0xed4245).setTitle("📸 Snapshot").setDescription("Enable the API link and set `TATSU_API_KEY` first.")],
        components: hubRows(),
      });
      return;
    }
    const period = rankingPeriodOf(settings.rankingPeriod);
    try {
      const rows = await tatsuApi.collectRankings(tatsuGuild, period, 3);
      const compact = rows.map(r => ({ user_id: r.user_id, rank: r.rank, score: r.score }));
      const prev = await latestSnapshot(guildId, period);
      await saveSnapshot({
        guildId,
        period,
        rankings: compact,
        takenBy: interaction.user.id,
      });
      await writeTatsuAudit({
        guildId,
        actorId: interaction.user.id,
        action: "snapshot",
        detail: { period, count: compact.length },
      });

      const climbers: string[] = [];
      if (prev) {
        const prevRows = (prev.rankings ?? []) as Array<{ user_id: string; rank: number; score: number }>;
        const before = new Map(prevRows.map(r => [r.user_id, Number(r.score)]));
        for (const r of compact) {
          const old = before.get(r.user_id);
          if (old == null) {
            if (r.score >= settings.spamScoreDelta) {
              climbers.push(`🆕 <@${r.user_id}> entered at **${fmt(r.score)}** (rank #${r.rank})`);
            }
            continue;
          }
          const delta = r.score - old;
          if (delta >= settings.spamScoreDelta) {
            climbers.push(`📈 <@${r.user_id}> **+${fmt(delta)}** → ${fmt(r.score)} (#${r.rank})`);
          }
        }
      }

      await interaction.editReply({
        embeds: [
          new EmbedBuilder()
            .setColor(TATSU_COLOR)
            .setTitle(`📸 Snapshot · ${periodLabel(period)}`)
            .setDescription(
              [
                `Saved **${compact.length}** rankings.`,
                prev ? `Compared against snapshot from <t:${Math.floor(prev.createdAt.getTime() / 1000)}:R>.` : "_First snapshot — take another later to detect climbers._",
                "",
                climbers.length ? `**Rapid climbers** (Δ ≥ ${fmt(settings.spamScoreDelta)}):\n${climbers.slice(0, 15).join("\n")}` : "_No rapid climbers vs previous snapshot._",
              ].join("\n"),
            ),
        ],
        components: [
          new ActionRowBuilder<ButtonBuilder>().addComponents(
            new ButtonBuilder().setCustomId("tatsu:spam_delta").setLabel("Edit delta threshold").setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId("tatsu:overview").setLabel("Home").setStyle(ButtonStyle.Primary),
          ),
        ],
      });
    } catch (err) {
      await interaction.editReply({
        embeds: [new EmbedBuilder().setColor(0xed4245).setTitle("📸 Snapshot failed").setDescription(err instanceof Error ? err.message : "error")],
        components: hubRows(),
      });
    }
    return;
  }

  if (id === "tatsu:spam_delta" && interaction.isButton()) {
    const modal = new ModalBuilder()
      .setCustomId("tatsu:delta_modal")
      .setTitle("Spam score delta")
      .addComponents(
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder()
            .setCustomId("delta")
            .setLabel("Flag when score rises by ≥ this much")
            .setStyle(TextInputStyle.Short)
            .setRequired(true)
            .setValue(String(settings.spamScoreDelta)),
        ),
      );
    await interaction.showModal(modal);
    return;
  }

  if (id === "tatsu:audit" && interaction.isButton()) {
    await interaction.deferUpdate();
    const rows = await listTatsuAudit(guildId, 12);
    const lines = rows.length
      ? rows.map(r => {
        const when = `<t:${Math.floor(r.createdAt.getTime() / 1000)}:R>`;
        const target = r.targetUserId ? ` → <@${r.targetUserId}>` : "";
        return `• ${when} <@${r.actorId}> **${r.action}**${target}`;
      }).join("\n")
      : "_No audit entries yet._";
    await interaction.editReply({
      embeds: [
        new EmbedBuilder()
          .setColor(TATSU_COLOR)
          .setTitle("📜 Tatsu audit log")
          .setDescription(lines),
      ],
      components: hubRows(),
    });
    return;
  }
}

export async function handleTatsuAdminModal(interaction: ModalSubmitInteraction): Promise<void> {
  const guildId = interaction.guildId;
  if (!guildId) {
    await interaction.reply({ content: "Server only.", ...EPHEMERAL });
    return;
  }
  if (!interaction.memberPermissions?.has("Administrator")) {
    await interaction.reply({ content: "Administrator only.", ...EPHEMERAL });
    return;
  }

  const id = interaction.customId;
  const settings = await getOrCreateTatsuSettings(guildId);
  const tatsuGuild = settings.tatsuGuildId || guildId;

  if (id === "tatsu:delta_modal") {
    await interaction.deferReply(EPHEMERAL);
    const delta = Math.max(1, Number(interaction.fields.getTextInputValue("delta").replace(/,/g, "")) || 5000);
    await updateTatsuSettings(guildId, { spamScoreDelta: delta });
    await interaction.editReply(`✅ Spam score delta set to **${fmt(delta)}**.`);
    return;
  }

  if (id.startsWith("tatsu:watch_modal:")) {
    await interaction.deferReply(EPHEMERAL);
    const userId = id.slice("tatsu:watch_modal:".length);
    const note = interaction.fields.getTextInputValue("note") || null;
    await upsertWatchlist(guildId, userId, interaction.user.id, note);
    await writeTatsuAudit({
      guildId,
      actorId: interaction.user.id,
      targetUserId: userId,
      action: "watch_add",
      detail: { note },
    });
    await interaction.editReply(`👁️ <@${userId}> is on the watchlist.${note ? `\nNote: ${note}` : ""}`);
    return;
  }

  const parseAction = (raw: string): 0 | 1 | null => {
    const a = raw.trim().toLowerCase();
    if (a === "add" || a === "0" || a === "+") return 0;
    if (a === "remove" || a === "rem" || a === "1" || a === "-") return 1;
    return null;
  };

  if (id.startsWith("tatsu:points_modal:") || id.startsWith("tatsu:score_modal:")) {
    await interaction.deferReply(EPHEMERAL);
    const isPoints = id.startsWith("tatsu:points_modal:");
    const userId = id.split(":")[2]!;
    const action = parseAction(interaction.fields.getTextInputValue("action"));
    const amount = Math.floor(Number(interaction.fields.getTextInputValue("amount").replace(/,/g, "")));
    const reason = interaction.fields.getTextInputValue("reason") || undefined;

    if (action == null || !Number.isFinite(amount) || amount < 1) {
      await interaction.editReply("Need action `add` or `remove`, and amount ≥ 1.");
      return;
    }
    if (!isTatsuConfigured() || !settings.enabled) {
      await interaction.editReply("Tatsu API key missing or link disabled — flip it on in `/tatsu`.");
      return;
    }

    try {
      if (isPoints) {
        const result = await tatsuApi.modifyPointsChunked(tatsuGuild, userId, amount, action);
        await writeTatsuAudit({
          guildId,
          actorId: interaction.user.id,
          targetUserId: userId,
          action: action === 0 ? "points_add" : "points_remove",
          detail: { amount, reason, result },
        });
        await tryChannelLog(interaction, settings.logChannelId,
          `💠 <@${interaction.user.id}> ${action === 0 ? "added" : "removed"} **${fmt(amount)}** points ${action === 0 ? "to" : "from"} <@${userId}>${reason ? ` — ${reason}` : ""}${result ? ` · now **${fmt(result.points)}** (#${result.rank})` : ""}`);
        await interaction.editReply(
          `✅ Points ${action === 0 ? "added" : "removed"}: **${fmt(amount)}** for <@${userId}>` +
          (result ? `\nNow **${fmt(result.points)}** points · rank **#${result.rank}**` : ""),
        );
      } else {
        const result = await tatsuApi.modifyScoreChunked(tatsuGuild, userId, amount, action);
        await writeTatsuAudit({
          guildId,
          actorId: interaction.user.id,
          targetUserId: userId,
          action: action === 0 ? "score_add" : "score_remove",
          detail: { amount, reason, result },
        });
        await tryChannelLog(interaction, settings.logChannelId,
          `⭐ <@${interaction.user.id}> ${action === 0 ? "added" : "removed"} **${fmt(amount)}** score ${action === 0 ? "to" : "from"} <@${userId}>${reason ? ` — ${reason}` : ""}${result ? ` · now **${fmt(result.score)}**` : ""}`);
        await interaction.editReply(
          `✅ Score ${action === 0 ? "added" : "removed"}: **${fmt(amount)}** for <@${userId}>` +
          (result ? `\nNow **${fmt(result.score)}** score` : ""),
        );
      }
    } catch (err) {
      await interaction.editReply(`⚠️ ${err instanceof Error ? err.message : "Modify failed"}`);
    }
    return;
  }

  if (id.startsWith("tatsu:strip_modal:")) {
    await interaction.deferReply(EPHEMERAL);
    const userId = id.slice("tatsu:strip_modal:".length);
    const points = Math.max(0, Math.floor(Number(interaction.fields.getTextInputValue("points").replace(/,/g, "")) || 0));
    const score = Math.max(0, Math.floor(Number(interaction.fields.getTextInputValue("score").replace(/,/g, "")) || 0));
    const reason = interaction.fields.getTextInputValue("reason") || "spam";

    if (!points && !score) {
      await interaction.editReply("Enter points and/or score to remove.");
      return;
    }
    if (!isTatsuConfigured() || !settings.enabled) {
      await interaction.editReply("Tatsu API key missing or link disabled.");
      return;
    }

    const results: string[] = [];
    try {
      if (points > 0) {
        const r = await tatsuApi.modifyPointsChunked(tatsuGuild, userId, points, 1);
        results.push(`−${fmt(points)} points` + (r ? ` → **${fmt(r.points)}** (#${r.rank})` : ""));
      }
      if (score > 0) {
        const r = await tatsuApi.modifyScoreChunked(tatsuGuild, userId, score, 1);
        results.push(`−${fmt(score)} score` + (r ? ` → **${fmt(r.score)}**` : ""));
      }
      await upsertWatchlist(guildId, userId, interaction.user.id, `stripped: ${reason}`);
      await writeTatsuAudit({
        guildId,
        actorId: interaction.user.id,
        targetUserId: userId,
        action: "strip_spam",
        detail: { points, score, reason },
      });
      await tryChannelLog(interaction, settings.logChannelId,
        `🪓 <@${interaction.user.id}> stripped <@${userId}>: ${results.join(" · ")} — ${reason}`);
      await interaction.editReply(`✅ Stripped <@${userId}>:\n${results.map(l => `• ${l}`).join("\n")}\nAlso added to watchlist.`);
    } catch (err) {
      await interaction.editReply(`⚠️ ${err instanceof Error ? err.message : "Strip failed"}`);
    }
  }
}

async function tryChannelLog(
  interaction: ModalSubmitInteraction,
  channelId: string | null | undefined,
  content: string,
): Promise<void> {
  if (!channelId || !interaction.guild) return;
  try {
    const ch = await interaction.guild.channels.fetch(channelId).catch(() => null);
    if (ch && ch.isTextBased() && "send" in ch) {
      await (ch as TextChannel).send({
        embeds: [
          new EmbedBuilder()
            .setColor(TATSU_COLOR)
            .setAuthor({ name: "Tatsu admin log", iconURL: TATSU_ICON })
            .setDescription(content)
            .setTimestamp(new Date()),
        ],
      });
    }
  } catch { /* ignore */ }
}
