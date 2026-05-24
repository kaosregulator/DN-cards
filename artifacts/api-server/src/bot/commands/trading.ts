import type { Message } from "discord.js";
import { EmbedBuilder } from "discord.js";
import {
  getCardByName,
  getCollectionEntry,
  getPendingTradesFor,
  createTrade,
  getTrade,
  updateTradeStatus,
  executeTradeSwap,
  getOrCreateGuildSettings,
  updateTradeMessageId,
} from "../db.js";
import { RARITY_EMOJI, RARITY_LABELS, type Rarity } from "../cards-data.js";

// ── !card trade @user <YourCard> for <TheirCard> ──────────────────────────────
export async function handleTrade(msg: Message, args: string[]): Promise<void> {
  if (!msg.guild) return;
  const guildId = msg.guild.id;

  const settings = await getOrCreateGuildSettings(guildId);
  if (!settings.tradeEnabled) {
    await msg.reply("❌ Trading is currently disabled on this server.");
    return;
  }

  const target = msg.mentions.users.first();
  if (!target) {
    await msg.reply(
      "❌ Usage: `!card trade @User <Your Card> for <Their Card>`\n" +
      "Example: `!card trade @John M1 Abrams for F-22 Raptor`",
    );
    return;
  }
  if (target.id === msg.author.id) {
    await msg.reply("❌ You can't trade with yourself.");
    return;
  }
  if (target.bot) {
    await msg.reply("❌ You can't trade with a bot.");
    return;
  }

  // Parse: <offer> for <request>
  // Remove the @mention from args, then split on "for"
  const rawText = args.slice(1).join(" ");
  const forIdx = rawText.toLowerCase().indexOf(" for ");
  if (forIdx === -1) {
    await msg.reply(
      "❌ Usage: `!card trade @User <Your Card> for <Their Card>`\n" +
      "Example: `!card trade @John M1 Abrams for F-22 Raptor`",
    );
    return;
  }

  const offeredName = rawText.slice(0, forIdx).trim();
  const requestedName = rawText.slice(forIdx + 5).trim();

  if (!offeredName || !requestedName) {
    await msg.reply("❌ Please specify both the card you're offering and the card you want.");
    return;
  }

  const offeredCard = await getCardByName(offeredName);
  if (!offeredCard) {
    await msg.reply(`❌ Card "**${offeredName}**" not found. Check the name with \`!card list\`.`);
    return;
  }

  const requestedCard = await getCardByName(requestedName);
  if (!requestedCard) {
    await msg.reply(`❌ Card "**${requestedName}**" not found. Check the name with \`!card list\`.`);
    return;
  }

  // Verify initiator owns the offered card
  const initiatorEntry = await getCollectionEntry(guildId, msg.author.id, offeredCard.id);
  if (!initiatorEntry || initiatorEntry.count < 1) {
    await msg.reply(`❌ You don't have **${offeredCard.name}** in your collection.`);
    return;
  }

  // Verify target owns the requested card
  const targetEntry = await getCollectionEntry(guildId, target.id, requestedCard.id);
  if (!targetEntry || targetEntry.count < 1) {
    await msg.reply(`❌ <@${target.id}> doesn't have **${requestedCard.name}** in their collection.`);
    return;
  }

  // Create the trade
  const trade = await createTrade(
    guildId, msg.author.id, target.id,
    offeredCard.id, requestedCard.id,
    msg.channelId,
  );

  const offeredRarity = offeredCard.rarity as Rarity;
  const requestedRarity = requestedCard.rarity as Rarity;

  const embed = new EmbedBuilder()
    .setTitle("🔄 Trade Proposal")
    .setColor(0x0984e3)
    .setDescription(
      `<@${msg.author.id}> wants to trade with <@${target.id}>\n\n` +
      `**Offering:** ${RARITY_EMOJI[offeredRarity]} ${offeredCard.name} (${RARITY_LABELS[offeredRarity]})\n` +
      `**Requesting:** ${RARITY_EMOJI[requestedRarity]} ${requestedCard.name} (${RARITY_LABELS[requestedRarity]})\n\n` +
      `<@${target.id}>, use \`!card accept ${trade.id}\` to accept or \`!card decline ${trade.id}\` to decline.\n` +
      `Trade ID: \`#${trade.id}\``,
    )
    .setFooter({ text: "Trade expires in 24 hours" })
    .setTimestamp();

  const tradeMsg = await msg.reply({ embeds: [embed] });
  await updateTradeMessageId(trade.id, tradeMsg.id);

  // Auto-expire after 24h
  setTimeout(async () => {
    const t = await getTrade(trade.id);
    if (t && t.status === "pending") {
      await updateTradeStatus(trade.id, "expired");
    }
  }, 24 * 60 * 60 * 1000);
}

// ── !card accept <id> ─────────────────────────────────────────────────────────
export async function handleAccept(msg: Message, tradeIdStr: string): Promise<void> {
  if (!msg.guild) return;
  const tradeId = parseInt(tradeIdStr, 10);
  if (isNaN(tradeId)) {
    await msg.reply("❌ Usage: `!card accept <trade ID>` — find pending trades with `!card trades`");
    return;
  }

  const trade = await getTrade(tradeId);
  if (!trade || trade.guildId !== msg.guild.id) {
    await msg.reply(`❌ Trade #${tradeId} not found.`);
    return;
  }
  if (trade.targetId !== msg.author.id) {
    await msg.reply("❌ This trade is not addressed to you.");
    return;
  }
  if (trade.status !== "pending") {
    await msg.reply(`❌ Trade #${tradeId} is already **${trade.status}**.`);
    return;
  }

  const success = await executeTradeSwap(trade);
  if (!success) {
    await updateTradeStatus(tradeId, "declined");
    await msg.reply(
      `❌ Trade #${tradeId} could not be completed — one of the cards is no longer available.\n` +
      "The trade has been cancelled.",
    );
    return;
  }

  await updateTradeStatus(tradeId, "accepted");
  await msg.reply(
    `✅ Trade #${tradeId} accepted! The cards have been swapped.\n` +
    `<@${trade.initiatorId}> and <@${trade.targetId}> — check your collections!`,
  );
}

// ── !card decline <id> ────────────────────────────────────────────────────────
export async function handleDecline(msg: Message, tradeIdStr: string): Promise<void> {
  if (!msg.guild) return;
  const tradeId = parseInt(tradeIdStr, 10);
  if (isNaN(tradeId)) {
    await msg.reply("❌ Usage: `!card decline <trade ID>`");
    return;
  }

  const trade = await getTrade(tradeId);
  if (!trade || trade.guildId !== msg.guild.id) {
    await msg.reply(`❌ Trade #${tradeId} not found.`);
    return;
  }
  if (trade.targetId !== msg.author.id && trade.initiatorId !== msg.author.id) {
    await msg.reply("❌ You are not part of this trade.");
    return;
  }
  if (trade.status !== "pending") {
    await msg.reply(`❌ Trade #${tradeId} is already **${trade.status}**.`);
    return;
  }

  const newStatus = trade.initiatorId === msg.author.id ? "cancelled" : "declined";
  await updateTradeStatus(tradeId, newStatus);
  await msg.reply(`✅ Trade #${tradeId} has been **${newStatus}**.`);
}

// ── !card trades ──────────────────────────────────────────────────────────────
export async function handleListTrades(msg: Message): Promise<void> {
  if (!msg.guild) return;
  const trades = await getPendingTradesFor(msg.guild.id, msg.author.id);

  if (trades.length === 0) {
    await msg.reply("You have no pending trades. Propose one with `!card trade @User <YourCard> for <TheirCard>`");
    return;
  }

  const lines = trades.map(t => {
    const dir = t.initiatorId === msg.author.id
      ? `You offered **${t.offeredCardName}** → <@${t.targetId}> for **${t.requestedCardName}**`
      : `<@${t.initiatorId}> offered **${t.offeredCardName}** → You for **${t.requestedCardName}**`;
    return `\`#${t.id}\` ${dir}`;
  });

  const embed = new EmbedBuilder()
    .setTitle("🔄 Your Pending Trades")
    .setColor(0x0984e3)
    .setDescription(lines.join("\n") + "\n\nUse `!card accept <id>` or `!card decline <id>` to respond.");

  await msg.reply({ embeds: [embed] });
}
