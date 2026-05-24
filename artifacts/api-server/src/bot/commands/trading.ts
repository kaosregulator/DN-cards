import type { ChatInputCommandInteraction } from "discord.js";
import { EmbedBuilder } from "discord.js";
import {
  getCardByName, getCollectionEntry,
  getPendingTradesFor, createTrade, getTrade,
  updateTradeStatus, executeTradeSwap,
  getOrCreateGuildSettings, updateTradeMessageId,
} from "../db.js";
import { RARITY_EMOJI, RARITY_LABELS, type Rarity } from "../cards-data.js";

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
  const offeredName = opts.getString("offer", true);
  const requestedName = opts.getString("want", true);

  if (target.id === interaction.user.id) { await interaction.editReply("❌ You can't trade with yourself."); return; }
  if (target.bot) { await interaction.editReply("❌ You can't trade with a bot."); return; }

  const offeredCard = await getCardByName(offeredName);
  if (!offeredCard) { await interaction.editReply(`❌ Card "**${offeredName}**" not found. Check \`/list\`.`); return; }

  const requestedCard = await getCardByName(requestedName);
  if (!requestedCard) { await interaction.editReply(`❌ Card "**${requestedName}**" not found. Check \`/list\`.`); return; }

  const initiatorEntry = await getCollectionEntry(guildId, interaction.user.id, offeredCard.id);
  if (!initiatorEntry || initiatorEntry.count < 1) {
    await interaction.editReply(`❌ You don't have **${offeredCard.name}** in your collection.`);
    return;
  }

  const targetEntry = await getCollectionEntry(guildId, target.id, requestedCard.id);
  if (!targetEntry || targetEntry.count < 1) {
    await interaction.editReply(`❌ <@${target.id}> doesn't have **${requestedCard.name}**.`);
    return;
  }

  const trade = await createTrade(
    guildId, interaction.user.id, target.id,
    offeredCard.id, requestedCard.id, interaction.channelId,
  );

  const offRarity = offeredCard.rarity as Rarity;
  const reqRarity = requestedCard.rarity as Rarity;

  const embed = new EmbedBuilder()
    .setTitle("🔄 Trade Proposal")
    .setColor(0x0984e3)
    .setDescription(
      `<@${interaction.user.id}> wants to trade with <@${target.id}>\n\n` +
      `**Offering:** ${RARITY_EMOJI[offRarity]} ${offeredCard.name} *(${RARITY_LABELS[offRarity]})*\n` +
      `**Requesting:** ${RARITY_EMOJI[reqRarity]} ${requestedCard.name} *(${RARITY_LABELS[reqRarity]})*\n\n` +
      `<@${target.id}>, respond:\n` +
      `✅ \`/accept id:${trade.id}\`\n` +
      `❌ \`/decline id:${trade.id}\`\n\n` +
      `*Trade ID: \`#${trade.id}\` · Expires in 24h*`,
    );

  const reply = await interaction.editReply({ embeds: [embed] });
  const msgId = "id" in reply ? (reply as { id: string }).id : undefined;
  if (msgId) await updateTradeMessageId(trade.id, msgId);

  setTimeout(async () => {
    const t = await getTrade(trade.id);
    if (t && t.status === "pending") await updateTradeStatus(trade.id, "expired");
  }, 24 * 60 * 60 * 1000);
}

// ── /accept ───────────────────────────────────────────────────────────────────
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
    await interaction.editReply(`❌ Trade #${tradeId} failed — a card is no longer available. Trade cancelled.`);
    return;
  }

  await updateTradeStatus(tradeId, "accepted");
  await interaction.editReply(
    `✅ Trade #${tradeId} complete! Cards swapped.\n<@${trade.initiatorId}> and <@${trade.targetId}> check \`/collection\`!`,
  );
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
    const dir = t.initiatorId === interaction.user.id
      ? `↗️ You offered **${t.offeredCardName}** to <@${t.targetId}> for **${t.requestedCardName}**`
      : `↙️ <@${t.initiatorId}> offers **${t.offeredCardName}** for your **${t.requestedCardName}**`;
    return `\`#${t.id}\` ${dir}`;
  });

  const embed = new EmbedBuilder()
    .setTitle("🔄 Your Pending Trades")
    .setColor(0x0984e3)
    .setDescription(lines.join("\n") + "\n\nUse `/accept id:<ID>` or `/decline id:<ID>` to respond.");

  await interaction.editReply({ embeds: [embed] });
}
