import type { ChatInputCommandInteraction, ButtonInteraction } from "discord.js";
import {
  EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags,
} from "discord.js";
import {
  getCardByName, getCollectionEntry,
  getPendingTradesFor, createTrade, getTrade,
  updateTradeStatus, executeTradeSwap,
  getOrCreateGuildSettings, updateTradeMessageId,
  getOrCreateCurrency, giftShards, getTradeHistoryFor,
  getRarityContext, applyRarityContext,
  getCardDisplayRarity,
  getRarityDisplayOverrides,
} from "../db.js";
import {
  FAIRNESS_RATIO_THRESHOLD,
} from "../cards-data.js";
import { applyEmbedOverride } from "../embed-overrides.js";
import { runPaginator, type PaginatorView } from "../components/paginator.js";
import { chunkLines } from "../components/field-chunker.js";

// Pack a list of pre-built fields into one or more embed screens (Discord caps
// at 25 fields/embed; we leave room for one summary field).
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

// Computes a fairness warning when one trade side is more than FAIRNESS_RATIO_THRESHOLD×
// the other side's worth. Returns null if both sides are roughly comparable.
// Shards count 1:1 with shard value; cards use their static worthValue. Shinies
// can't be traded (v1) so they don't enter the calc.
function buildFairnessWarning(
  offeredCardWorth: number, offeredShards: number,
  requestedCardWorth: number, requestedShards: number,
): string | null {
  const offerVal = offeredCardWorth + offeredShards;
  const wantVal = requestedCardWorth + requestedShards;
  if (offerVal <= 0 || wantVal <= 0) return null;
  const hi = Math.max(offerVal, wantVal);
  const lo = Math.min(offerVal, wantVal);
  const ratio = hi / lo;
  if (ratio <= FAIRNESS_RATIO_THRESHOLD) return null;
  const loser = offerVal < wantVal ? "initiator" : "recipient";
  return `⚠️ **Lopsided trade** — one side is ~**${ratio.toFixed(1)}×** the other ` +
    `(💠 ${offerVal.toLocaleString()} ↔ ${wantVal.toLocaleString()}). ` +
    `The **${loser}** is getting much less value — double-check before accepting.`;
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function tradeButtons(tradeId: number) {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`trade_accept:${tradeId}`)
      .setLabel("✅ Accept")
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`trade_decline:${tradeId}`)
      .setLabel("❌ Decline")
      .setStyle(ButtonStyle.Danger),
  );
}

function formatSide(cardLabel: string | null, shards: number): string {
  const parts: string[] = [];
  if (cardLabel) parts.push(cardLabel);
  if (shards > 0) parts.push(`💠 **${shards.toLocaleString()}** shards`);
  return parts.length > 0 ? parts.join(" + ") : "*nothing*";
}

// ── /trade ────────────────────────────────────────────────────────────────────
export async function handleTrade(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!interaction.guild) return;
  const guildId = interaction.guild.id;
  const opts = interaction.options;

  const settings = await getOrCreateGuildSettings(guildId);
  if (!settings.tradeEnabled) {
    await interaction.editReply("❌ Trading is currently disabled on this server.");
    return;
  }

  const target = opts.getUser("user", true);
  const offeredName = opts.getString("offer");
  const requestedName = opts.getString("want");
  const offeredShards = Math.max(0, opts.getInteger("offer_shards") ?? 0);
  const requestedShards = Math.max(0, opts.getInteger("want_shards") ?? 0);

  if (target.id === interaction.user.id) { await interaction.editReply("❌ You can't trade with yourself."); return; }
  if (target.bot) { await interaction.editReply("❌ You can't trade with a bot."); return; }
  if ((opts.getInteger("offer_shards") ?? 0) < 0 || (opts.getInteger("want_shards") ?? 0) < 0) {
    await interaction.editReply("❌ Shard amounts must be zero or positive.");
    return;
  }

  // Must offer something AND want something
  if (!offeredName && offeredShards === 0) {
    await interaction.editReply("❌ You must offer either a card (`offer`) or shards (`offer_shards`).");
    return;
  }
  if (!requestedName && requestedShards === 0) {
    await interaction.editReply("❌ You must request either a card (`want`) or shards (`want_shards`).");
    return;
  }

  // Validate offered card
  let offeredCard = null as Awaited<ReturnType<typeof getCardByName>> | null;
  if (offeredName) {
    offeredCard = await getCardByName(offeredName, guildId);
    if (!offeredCard) { await interaction.editReply(`❌ Card "**${offeredName}**" not found. Check \`/list\`.`); return; }
    if (offeredCard.isBossCard && !settings.allowBossCardTrades) {
      await interaction.editReply(`🐉 **${offeredCard.name}** is a boss card — it's earned through raids and can't be traded on this server.`);
      return;
    }
    const entry = await getCollectionEntry(guildId, interaction.user.id, offeredCard.id);
    if (!entry || entry.count < 1) { await interaction.editReply(`❌ You don't have **${offeredCard.name}** in your collection.`); return; }
  }

  // Validate requested card
  let requestedCard = null as Awaited<ReturnType<typeof getCardByName>> | null;
  if (requestedName) {
    requestedCard = await getCardByName(requestedName, guildId);
    if (!requestedCard) { await interaction.editReply(`❌ Card "**${requestedName}**" not found. Check \`/list\`.`); return; }
    if (requestedCard.isBossCard && !settings.allowBossCardTrades) {
      await interaction.editReply(`🐉 **${requestedCard.name}** is a boss card — it's earned through raids and can't be traded on this server.`);
      return;
    }
    const entry = await getCollectionEntry(guildId, target.id, requestedCard.id);
    if (!entry || entry.count < 1) { await interaction.editReply(`❌ <@${target.id}> doesn't have **${requestedCard.name}**.`); return; }
  }

  // Validate offered shards (initiator has enough)
  if (offeredShards > 0) {
    const cur = await getOrCreateCurrency(guildId, interaction.user.id);
    if (cur.shards < offeredShards) {
      await interaction.editReply(`❌ You only have 💠 **${cur.shards.toLocaleString()}** shards — can't offer ${offeredShards.toLocaleString()}.`);
      return;
    }
  }
  // Validate requested shards (target has enough)
  if (requestedShards > 0) {
    const cur = await getOrCreateCurrency(guildId, target.id);
    if (cur.shards < requestedShards) {
      await interaction.editReply(`❌ <@${target.id}> only has 💠 **${cur.shards.toLocaleString()}** shards — they can't pay ${requestedShards.toLocaleString()}.`);
      return;
    }
  }

  const trade = await createTrade({
    guildId,
    initiatorId: interaction.user.id,
    targetId: target.id,
    offeredCardId: offeredCard?.id ?? null,
    requestedCardId: requestedCard?.id ?? null,
    offeredShards,
    requestedShards,
    channelId: interaction.channelId,
  });

  // Fetch rarity context + display overrides + guild settings in parallel so
  // labels use per-guild name/emoji overrides and fairness uses per-guild economy.
  const [fairnessCtx, tradeSettings, tradeDisplayMap] = await Promise.all([
    getRarityContext(guildId),
    getOrCreateGuildSettings(guildId),
    getRarityDisplayOverrides(guildId),
  ]);

  const offTier = offeredCard ? getCardDisplayRarity(offeredCard, fairnessCtx, tradeSettings, tradeDisplayMap) : null;
  const reqTier = requestedCard ? getCardDisplayRarity(requestedCard, fairnessCtx, tradeSettings, tradeDisplayMap) : null;
  const offLabel = offeredCard && offTier
    ? `${offTier.emoji} **${offeredCard.name}** *(${offTier.label})*`
    : null;
  const reqLabel = requestedCard && reqTier
    ? `${reqTier.emoji} **${requestedCard.name}** *(${reqTier.label})*`
    : null;

  // fairnessCtx already fetched above
  const offeredCardEcon = offeredCard ? applyRarityContext(offeredCard, fairnessCtx) : null;
  const requestedCardEcon = requestedCard ? applyRarityContext(requestedCard, fairnessCtx) : null;
  const fairness = buildFairnessWarning(
    offeredCardEcon?.worthValue ?? 0, offeredShards,
    requestedCardEcon?.worthValue ?? 0, requestedShards,
  );

  const embed = new EmbedBuilder()
    .setTitle("🔄 Trade Proposal")
    .setColor(fairness ? 0xe67e22 : 0x0984e3)
    .setDescription(
      (fairness ? fairness + "\n\n" : "") +
      `<@${interaction.user.id}> → <@${target.id}>\n\n` +
      `**Offering:** ${formatSide(offLabel, offeredShards)}\n` +
      `**Requesting:** ${formatSide(reqLabel, requestedShards)}\n\n` +
      `<@${target.id}>, hit a button below to respond.\n` +
      `*Trade ID: \`#${trade.id}\` · Expires in 24h*`,
    );

  await applyEmbedOverride(embed, {
    guildId, key: "trade",
    ctx: {
      userId: interaction.user.id, username: interaction.user.username,
      card: offeredCard?.name ?? requestedCard?.name ?? "",
      amount: offeredShards || requestedShards,
      guild: interaction.guild.name,
    },
  });

  const reply = await interaction.editReply({
    content: `<@${target.id}> you've got a trade offer!`,
    embeds: [embed],
    components: [tradeButtons(trade.id)],
    allowedMentions: { users: [target.id] },
  });
  const msgId = "id" in reply ? (reply as { id: string }).id : undefined;
  if (msgId) await updateTradeMessageId(trade.id, msgId);

  setTimeout(async () => {
    const t = await getTrade(trade.id);
    if (t && t.status === "pending") await updateTradeStatus(trade.id, "expired");
  }, 24 * 60 * 60 * 1000);
}

// ── Button: Accept / Decline ─────────────────────────────────────────────────
export async function handleTradeButton(interaction: ButtonInteraction, action: "accept" | "decline", tradeId: number): Promise<void> {
  const trade = await getTrade(tradeId);
  if (!trade || trade.guildId !== interaction.guildId) {
    await interaction.reply({ content: `❌ Trade #${tradeId} not found.`, flags: MessageFlags.Ephemeral });
    return;
  }
  if (trade.status !== "pending") {
    await interaction.reply({ content: `❌ Trade #${tradeId} is already **${trade.status}**.`, flags: MessageFlags.Ephemeral });
    return;
  }

  // Only initiator or target can press these
  const isInitiator = interaction.user.id === trade.initiatorId;
  const isTarget = interaction.user.id === trade.targetId;
  if (!isInitiator && !isTarget) {
    await interaction.reply({ content: "❌ This trade isn't yours.", flags: MessageFlags.Ephemeral });
    return;
  }
  // Initiator can only cancel (decline), not accept their own trade
  if (action === "accept" && !isTarget) {
    await interaction.reply({ content: "❌ Only the recipient can accept this trade.", flags: MessageFlags.Ephemeral });
    return;
  }

  if (action === "decline") {
    const newStatus = isInitiator ? "cancelled" : "declined";
    await updateTradeStatus(tradeId, newStatus);
    await interaction.update({
      content: `❌ Trade **${newStatus}** by <@${interaction.user.id}>.`,
      embeds: [],
      components: [],
    }).catch(() => { /* may be deleted */ });
    return;
  }

  // Accept — status flip happens atomically inside executeTradeSwap so two
  // concurrent Accept clicks can't both execute the swap.
  const result = await executeTradeSwap(trade);
  if (result === "already_resolved") {
    await interaction.update({
      content: `❌ Trade #${tradeId} was already resolved.`,
      embeds: [],
      components: [],
    }).catch(() => { /* may be deleted */ });
    return;
  }
  if (result === "balance_failed") {
    await updateTradeStatus(tradeId, "declined");
    await interaction.update({
      content: `❌ Trade #${tradeId} failed — a card or shard balance changed. Trade cancelled.`,
      embeds: [],
      components: [],
    }).catch(() => { /* may be deleted */ });
    return;
  }
  await interaction.update({
    content: `✅ Trade **complete!** <@${trade.initiatorId}> ↔️ <@${trade.targetId}> — check \`/collection\` and \`/shards\`.`,
    embeds: [],
    components: [],
  }).catch(() => { /* may be deleted */ });

  // Unified account XP: a completed trade rewards both participants (best-effort).
  try {
    const { awardPlayerXp, XP } = await import("../player/xp.js");
    await Promise.all([
      awardPlayerXp(trade.guildId, trade.initiatorId, "trade", XP.trade),
      awardPlayerXp(trade.guildId, trade.targetId, "trade", XP.trade),
    ]);
  } catch { /* non-fatal */ }

  // Achievements
  try {
    const { checkAchievements, formatUnlockLine } = await import("../achievements.js");
    const [initUnlocks, targUnlocks] = await Promise.all([
      checkAchievements(trade.guildId, trade.initiatorId).catch(() => []),
      checkAchievements(trade.guildId, trade.targetId).catch(() => []),
    ]);
    const parts: string[] = [];
    if (initUnlocks.length > 0) parts.push(`<@${trade.initiatorId}>\n` + initUnlocks.map(formatUnlockLine).join("\n"));
    if (targUnlocks.length > 0) parts.push(`<@${trade.targetId}>\n` + targUnlocks.map(formatUnlockLine).join("\n"));
    if (parts.length > 0 && interaction.channel && "send" in interaction.channel) {
      await interaction.channel.send({
        content: "🏆 **Achievement unlocked!**\n" + parts.join("\n\n"),
      }).catch(() => { /* ignore */ });
    }
  } catch { /* ignore */ }

  await recordTradeQuest(trade.guildId, trade.initiatorId, trade.targetId);
}

// Credit both participants toward "complete a trade" quests. Best-effort.
async function recordTradeQuest(guildId: string, initiatorId: string, targetId: string): Promise<void> {
  try {
    const { recordQuestEvent } = await import("../quests/engine.js");
    await Promise.all([
      recordQuestEvent(guildId, initiatorId, "trade", 1),
      recordQuestEvent(guildId, targetId, "trade", 1),
    ]);
  } catch { /* non-fatal */ }
}

// ── /accept (slash fallback — still supported) ───────────────────────────────
export async function handleAccept(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!interaction.guild) return;
  const tradeId = interaction.options.getInteger("id", true);
  const trade = await getTrade(tradeId);

  if (!trade || trade.guildId !== interaction.guild.id) { await interaction.editReply(`❌ Trade #${tradeId} not found.`); return; }
  if (trade.targetId !== interaction.user.id) { await interaction.editReply("❌ This trade is not addressed to you."); return; }
  if (trade.status !== "pending") { await interaction.editReply(`❌ Trade #${tradeId} is already **${trade.status}**.`); return; }

  const result = await executeTradeSwap(trade);
  if (result === "already_resolved") {
    await interaction.editReply(`❌ Trade #${tradeId} was already resolved.`);
    return;
  }
  if (result === "balance_failed") {
    await updateTradeStatus(tradeId, "declined");
    await interaction.editReply(`❌ Trade #${tradeId} failed — a card or shard balance changed. Trade cancelled.`);
    return;
  }

  await interaction.editReply(
    `✅ Trade #${tradeId} complete! <@${trade.initiatorId}> ↔️ <@${trade.targetId}> — check \`/collection\` and \`/shards\`.`,
  );

  await recordTradeQuest(trade.guildId, trade.initiatorId, trade.targetId);

  const { checkAchievements, formatUnlockLine } = await import("../achievements.js");
  const [initUnlocks, targUnlocks] = await Promise.all([
    checkAchievements(trade.guildId, trade.initiatorId).catch(() => []),
    checkAchievements(trade.guildId, trade.targetId).catch(() => []),
  ]);
  const parts: string[] = [];
  if (initUnlocks.length > 0) parts.push(`<@${trade.initiatorId}>\n` + initUnlocks.map(formatUnlockLine).join("\n"));
  if (targUnlocks.length > 0) parts.push(`<@${trade.targetId}>\n` + targUnlocks.map(formatUnlockLine).join("\n"));
  if (parts.length > 0 && interaction.channel && "send" in interaction.channel) {
    await interaction.channel.send({
      content: "🏆 **Achievement unlocked!**\n" + parts.join("\n\n"),
    }).catch(() => { /* ignore */ });
  }
}

// ── /decline ──────────────────────────────────────────────────────────────────
export async function handleDecline(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!interaction.guild) return;
  const tradeId = interaction.options.getInteger("id", true);
  const trade = await getTrade(tradeId);

  if (!trade || trade.guildId !== interaction.guild.id) { await interaction.editReply(`❌ Trade #${tradeId} not found.`); return; }
  if (trade.targetId !== interaction.user.id && trade.initiatorId !== interaction.user.id) {
    await interaction.editReply("❌ You are not part of this trade."); return;
  }
  if (trade.status !== "pending") { await interaction.editReply(`❌ Trade #${tradeId} is already **${trade.status}**.`); return; }

  const newStatus = trade.initiatorId === interaction.user.id ? "cancelled" : "declined";
  await updateTradeStatus(tradeId, newStatus);
  await interaction.editReply(`✅ Trade #${tradeId} **${newStatus}**.`);
}

// ── /trades ───────────────────────────────────────────────────────────────────
export async function handleListTrades(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!interaction.guild) return;
  const trades = await getPendingTradesFor(interaction.guild.id, interaction.user.id);

  if (trades.length === 0) {
    await interaction.editReply("You have no pending trades.\nPropose one with `/trade propose user:@Member offer:<card> want:<card>`");
    return;
  }

  const lines = trades.map(t => {
    const off = formatSide(t.offeredCardName ? `**${t.offeredCardName}**` : null, t.offeredShards);
    const req = formatSide(t.requestedCardName ? `**${t.requestedCardName}**` : null, t.requestedShards);
    const dir = t.initiatorId === interaction.user.id
      ? `↗️ You → <@${t.targetId}>: ${off} for ${req}`
      : `↙️ <@${t.initiatorId}> → you: ${off} for ${req}`;
    return `\`#${t.id}\` ${dir}`;
  });

  const embed = new EmbedBuilder()
    .setTitle("🔄 Your Pending Trades")
    .setColor(0x0984e3)
    .setDescription(lines.join("\n") + "\n\nUse the Accept/Decline buttons on the trade message, or `/trade accept id:<ID>` / `/trade decline id:<ID>`.");

  await interaction.editReply({ embeds: [embed] });
}

// ── /trade_history ─────────────────────────────────────────────────────────────
// Recent resolved (accepted/declined/cancelled/expired) trades involving the
// target user. Joins the cards table twice for offered/requested names.
export async function handleTradeHistory(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!interaction.guild) return;
  const guildId = interaction.guild.id;
  const target = interaction.options.getUser("user") ?? interaction.user;
  const isSelf = target.id === interaction.user.id;

  // Pull a wide slice (vs. the legacy 10) so the paginator can offer a real
  // "All" view and reliably compute partner totals + last-30-days counts.
  const rows = await getTradeHistoryFor(guildId, target.id, 200);

  if (rows.length === 0) {
    await interaction.editReply(
      isSelf
        ? "📜 You don't have any completed trades yet. Propose one with `/trade propose`!"
        : `📜 **${target.username}** has no completed trades yet.`,
    );
    return;
  }

  const STATUS_BADGE: Record<string, string> = {
    accepted: "✅",
    declined: "❌",
    cancelled: "🚫",
    expired: "⌛",
  };

  const formatLine = (t: typeof rows[number]): string => {
    const badge = STATUS_BADGE[t.status] ?? "•";
    const off = formatSide(t.offeredCardName ? `**${t.offeredCardName}**` : null, t.offeredShards);
    const req = formatSide(t.requestedCardName ? `**${t.requestedCardName}**` : null, t.requestedShards);
    const partnerId = t.initiatorId === target.id ? t.targetId : t.initiatorId;
    const direction = t.initiatorId === target.id ? "→" : "←";
    const when = t.resolvedAt ?? t.createdAt;
    return `${badge} <t:${Math.floor(when.getTime() / 1000)}:R> · ${off} ${direction} ${req} · with <@${partnerId}>`;
  };

  const sent = rows.filter(r => r.initiatorId === target.id);
  const received = rows.filter(r => r.targetId === target.id);
  const accepted = rows.filter(r => r.status === "accepted").length;
  const declined = rows.filter(r => r.status === "declined").length;
  const cancelled = rows.filter(r => r.status === "cancelled").length;
  const expired = rows.filter(r => r.status === "expired").length;

  const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
  const cutoff = Date.now() - THIRTY_DAYS_MS;
  const last30 = rows.filter(r => (r.resolvedAt ?? r.createdAt).getTime() >= cutoff).length;

  // Top partners by trade volume (any status). Cap to top 5 for the overview.
  const partnerCounts = new Map<string, number>();
  for (const r of rows) {
    const partnerId = r.initiatorId === target.id ? r.targetId : r.initiatorId;
    partnerCounts.set(partnerId, (partnerCounts.get(partnerId) ?? 0) + 1);
  }
  const topPartners = [...partnerCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);

  const overview = new EmbedBuilder()
    .setTitle(`📜 ${target.username}'s Trade History`)
    .setColor(0x9b59b6)
    .setThumbnail(target.displayAvatarURL())
    .setDescription(
      `Showing last **${rows.length}** resolved trade${rows.length === 1 ? "" : "s"}\n` +
      `Last 30 days: **${last30}**\n\n` +
      `✅ ${accepted} accepted · ❌ ${declined} declined · 🚫 ${cancelled} cancelled · ⌛ ${expired} expired\n` +
      `→ Sent: **${sent.length}**  ·  ← Received: **${received.length}**`,
    )
    .setFooter({ text: "Use the menu below to drill into Sent / Received / All" });

  if (topPartners.length > 0) {
    overview.addFields({
      name: "Top trade partners",
      value: topPartners
        .map(([uid, n], i) => `${i + 1}. <@${uid}> — **${n}** trade${n === 1 ? "" : "s"}`)
        .join("\n"),
      inline: false,
    });
  }

  const views: PaginatorView[] = [{
    key: "overview",
    label: "Overview",
    emoji: "🏠",
    description: `${rows.length} trades · ${last30} in last 30d`,
    screens: [overview],
  }];

  const addListView = (
    key: string, label: string, emoji: string, description: string,
    baseTitle: string, color: number, slice: typeof rows,
  ) => {
    if (slice.length === 0) return;
    const lines = slice.map(formatLine);
    const base = () => new EmbedBuilder()
      .setTitle(baseTitle)
      .setColor(color)
      .setThumbnail(target.displayAvatarURL())
      .setDescription(`**${slice.length}** trade${slice.length === 1 ? "" : "s"}`);
    const { fields } = chunkLines(lines, { baseName: label, maxFields: 1000 });
    views.push({
      key, label, emoji, description,
      screens: buildEmbedScreens(base, fields),
    });
  };

  addListView(
    "sent", "Sent", "→",
    `${sent.length} proposed by ${isSelf ? "you" : target.username}`,
    `→ ${target.username}'s Sent Trades`, 0x3498db, sent,
  );
  addListView(
    "received", "Received", "←",
    `${received.length} received by ${isSelf ? "you" : target.username}`,
    `← ${target.username}'s Received Trades`, 0x16a085, received,
  );
  addListView(
    "all", "All", "📜",
    `${rows.length} total resolved`,
    `📜 ${target.username}'s All Trades`, 0x9b59b6, rows,
  );

  await runPaginator({
    interaction,
    views,
    ownerId: interaction.user.id,
  });
}

// ── /gift ─────────────────────────────────────────────────────────────────────
export async function handleGift(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!interaction.guild) return;
  const guildId = interaction.guild.id;
  const target = interaction.options.getUser("user", true);
  const amount = interaction.options.getInteger("amount", true);

  if (target.id === interaction.user.id) { await interaction.editReply("❌ You can't gift shards to yourself."); return; }
  if (target.bot) { await interaction.editReply("❌ You can't gift shards to a bot."); return; }

  const result = await giftShards(guildId, interaction.user.id, target.id, amount);
  if (!result.success) {
    await interaction.editReply(`❌ You only have 💠 **${result.remaining.toLocaleString()}** shards — can't gift ${amount.toLocaleString()}.`);
    return;
  }

  await interaction.editReply(
    `🎁 You gifted 💠 **${amount.toLocaleString()}** shards to <@${target.id}>.\n` +
    `Your new balance: **${result.remaining.toLocaleString()}** 💠`,
  );

  // Public note in the same channel so the recipient sees it
  if (interaction.channel && "send" in interaction.channel) {
    await interaction.channel.send({
      content: `🎁 <@${interaction.user.id}> gifted 💠 **${amount.toLocaleString()}** shards to <@${target.id}>!`,
      allowedMentions: { users: [target.id] },
    }).catch(() => { /* ignore */ });
  }
}
