import type { ChatInputCommandInteraction, ButtonInteraction } from "discord.js";
import {
  EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags,
} from "discord.js";
import {
  getCardByName, getCollectionEntry,
  getPendingTradesFor, createTrade, getTrade,
  updateTradeStatus, executeTradeSwap,
  getOrCreateGuildSettings, updateTradeMessageId,
  getOrCreateCurrency, giftShards,
} from "../db.js";
import { RARITY_EMOJI, RARITY_LABELS, type Rarity } from "../cards-data.js";

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
    offeredCard = await getCardByName(offeredName);
    if (!offeredCard) { await interaction.editReply(`❌ Card "**${offeredName}**" not found. Check \`/list\`.`); return; }
    const entry = await getCollectionEntry(guildId, interaction.user.id, offeredCard.id);
    if (!entry || entry.count < 1) { await interaction.editReply(`❌ You don't have **${offeredCard.name}** in your collection.`); return; }
  }

  // Validate requested card
  let requestedCard = null as Awaited<ReturnType<typeof getCardByName>> | null;
  if (requestedName) {
    requestedCard = await getCardByName(requestedName);
    if (!requestedCard) { await interaction.editReply(`❌ Card "**${requestedName}**" not found. Check \`/list\`.`); return; }
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

  const offLabel = offeredCard
    ? `${RARITY_EMOJI[offeredCard.rarity as Rarity]} **${offeredCard.name}** *(${RARITY_LABELS[offeredCard.rarity as Rarity]})*`
    : null;
  const reqLabel = requestedCard
    ? `${RARITY_EMOJI[requestedCard.rarity as Rarity]} **${requestedCard.name}** *(${RARITY_LABELS[requestedCard.rarity as Rarity]})*`
    : null;

  const embed = new EmbedBuilder()
    .setTitle("🔄 Trade Proposal")
    .setColor(0x0984e3)
    .setDescription(
      `<@${interaction.user.id}> → <@${target.id}>\n\n` +
      `**Offering:** ${formatSide(offLabel, offeredShards)}\n` +
      `**Requesting:** ${formatSide(reqLabel, requestedShards)}\n\n` +
      `<@${target.id}>, hit a button below to respond.\n` +
      `*Trade ID: \`#${trade.id}\` · Expires in 24h*`,
    );

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

  // Accept
  const success = await executeTradeSwap(trade);
  if (!success) {
    await updateTradeStatus(tradeId, "declined");
    await interaction.update({
      content: `❌ Trade #${tradeId} failed — a card or shard balance changed. Trade cancelled.`,
      embeds: [],
      components: [],
    }).catch(() => { /* may be deleted */ });
    return;
  }
  await updateTradeStatus(tradeId, "accepted");
  await interaction.update({
    content: `✅ Trade **complete!** <@${trade.initiatorId}> ↔️ <@${trade.targetId}> — check \`/collection\` and \`/shards\`.`,
    embeds: [],
    components: [],
  }).catch(() => { /* may be deleted */ });

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
}

// ── /accept (slash fallback — still supported) ───────────────────────────────
export async function handleAccept(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!interaction.guild) return;
  const tradeId = interaction.options.getInteger("id", true);
  const trade = await getTrade(tradeId);

  if (!trade || trade.guildId !== interaction.guild.id) { await interaction.editReply(`❌ Trade #${tradeId} not found.`); return; }
  if (trade.targetId !== interaction.user.id) { await interaction.editReply("❌ This trade is not addressed to you."); return; }
  if (trade.status !== "pending") { await interaction.editReply(`❌ Trade #${tradeId} is already **${trade.status}**.`); return; }

  const success = await executeTradeSwap(trade);
  if (!success) {
    await updateTradeStatus(tradeId, "declined");
    await interaction.editReply(`❌ Trade #${tradeId} failed — a card or shard balance changed. Trade cancelled.`);
    return;
  }

  await updateTradeStatus(tradeId, "accepted");
  await interaction.editReply(
    `✅ Trade #${tradeId} complete! <@${trade.initiatorId}> ↔️ <@${trade.targetId}> — check \`/collection\` and \`/shards\`.`,
  );

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
    await interaction.editReply("You have no pending trades.\nPropose one with `/trade user:@Member offer:<card> want:<card>`");
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
    .setDescription(lines.join("\n") + "\n\nUse the Accept/Decline buttons on the trade message, or `/accept id:<ID>` / `/decline id:<ID>`.");

  await interaction.editReply({ embeds: [embed] });
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
