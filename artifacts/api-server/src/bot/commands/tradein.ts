// ─────────────────────────────────────────────────────────────────────────────
// /card_recycle (internal command key "tradein") — Card Recycle
//
// Replaces the old rarity Trade-In. Recycling consumes DUPLICATE copies of a
// single owned card from the existing collection to raise that card's Star Rank
// by one (see cards/stars.ts). Rarity is never changed; inventory counting is
// unchanged. One normal copy is always preserved as the card itself.
// ─────────────────────────────────────────────────────────────────────────────

import type { ChatInputCommandInteraction, ButtonInteraction } from "discord.js";
import {
  EmbedBuilder, MessageFlags,
  ActionRowBuilder, ButtonBuilder, ButtonStyle,
} from "discord.js";
import {
  getCardByName, getCardById, getOrCreateGuildSettings,
  getRarityContext, getRarityDisplayOverrides, getCardDisplayRarity,
} from "../db.js";
import { toAbsoluteImageUrl } from "../image-url.js";
import {
  recycleQuote, recycleCard, recycleCost, starRankString, MAX_STAR,
} from "../cards/stars.js";

const EPHEMERAL = { flags: MessageFlags.Ephemeral } as const;

async function displayFor(guildId: string, card: { id: number; rarity: string }) {
  const [ctx, settings, displayMap] = await Promise.all([
    getRarityContext(guildId),
    getOrCreateGuildSettings(guildId),
    getRarityDisplayOverrides(guildId),
  ]);
  return getCardDisplayRarity(card, ctx, settings, displayMap);
}

function recycleRow(cardId: number, disabled: boolean): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`recycle:do:${cardId}`)
      .setLabel("♻️ Recycle")
      .setStyle(ButtonStyle.Success)
      .setDisabled(disabled),
  );
}

export async function handleTradein(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!interaction.guild) return;
  const guildId = interaction.guild.id;
  const userId = interaction.user.id;
  if (!interaction.deferred && !interaction.replied) await interaction.deferReply(EPHEMERAL).catch(() => {});

  const name = interaction.options.getString("name", true).trim();
  const card = await getCardByName(name, guildId);
  if (!card) {
    await interaction.editReply(`❌ Couldn't find a card called **${name}**. Use the autocomplete to pick one you own.`);
    return;
  }

  const [quote, disp] = await Promise.all([
    recycleQuote(guildId, userId, card.id),
    displayFor(guildId, card),
  ]);

  const embed = new EmbedBuilder()
    .setColor(disp.color ?? 0x2ecc71)
    .setAuthor({ name: `♻️ Card Recycle — ${card.name}` })
    .setDescription(
      `${disp.emoji} **${card.name}** · ${disp.label}\n` +
      `**Star Rank:** ${starRankString(quote.star)}  (${quote.star}★)\n` +
      `Rarity and Star Rank are separate — recycling never changes the card's rarity.`,
    );
  const thumb = toAbsoluteImageUrl(card.imageUrl);
  if (thumb) embed.setThumbnail(thumb);

  if (quote.atMax) {
    embed.addFields({ name: "Maxed", value: `This card is already **${MAX_STAR}★** — the highest Star Rank.`, inline: false });
    await interaction.editReply({ embeds: [embed], components: [] });
    return;
  }

  embed.addFields({
    name: `Next: ${quote.star}★ → ${quote.star + 1}★`,
    value:
      `Cost: **${quote.cost}** duplicate copies\n` +
      `You have **${quote.spendable}** spendable ${quote.spendable === 1 ? "duplicate" : "duplicates"} (1 copy is always kept).`,
    inline: false,
  });

  if (!quote.canRecycle) {
    embed.addFields({
      name: "Not enough duplicates",
      value: `Catch or pull **${Math.max(0, quote.cost - quote.spendable)}** more **${card.name}** to recycle to ${quote.star + 1}★.`,
      inline: false,
    });
    await interaction.editReply({ embeds: [embed], components: [] });
    return;
  }

  await interaction.editReply({ embeds: [embed], components: [recycleRow(card.id, false)] });
}

// Button: recycle:do:<cardId> — confirm and perform one recycle step.
export async function handleRecycleButton(interaction: ButtonInteraction): Promise<void> {
  if (!interaction.guild) return;
  const guildId = interaction.guild.id;
  const userId = interaction.user.id;
  const cardId = Number(interaction.customId.split(":")[2]);
  await interaction.deferUpdate().catch(() => {});

  const card = await getCardById(cardId, guildId);
  if (!card) { await interaction.editReply({ content: "❌ Card no longer available.", embeds: [], components: [] }); return; }

  const res = await recycleCard(guildId, userId, cardId);
  const disp = await displayFor(guildId, card);

  if (!res.ok) {
    const msg = res.reason === "max_star" ? "This card is already at max Star Rank."
      : res.reason === "not_enough" ? "You no longer have enough duplicate copies to recycle."
      : "Something went wrong recycling that card.";
    await interaction.editReply({ content: `❌ ${msg}`, embeds: [], components: [] });
    return;
  }

  const embed = new EmbedBuilder()
    .setColor(disp.color ?? 0xf1c40f)
    .setAuthor({ name: `⭐ Star Up! — ${card.name}` })
    .setDescription(
      `${disp.emoji} **${card.name}** recycled **${res.consumed}** duplicates.\n\n` +
      `**${starRankString(res.fromStar)}**  →  **${starRankString(res.toStar)}**  (${res.toStar}★)\n` +
      `Its battle stats now scale with the new Star Rank.`,
    );
  const thumb = toAbsoluteImageUrl(card.imageUrl);
  if (thumb) embed.setThumbnail(thumb);

  // Offer another recycle if still possible.
  const next = await recycleQuote(guildId, userId, cardId);
  if (!next.atMax && next.canRecycle) {
    embed.addFields({ name: `Next: ${next.star}★ → ${next.star + 1}★`, value: `Cost: **${next.cost}** duplicates · you have **${next.spendable}**.`, inline: false });
    await interaction.editReply({ embeds: [embed], components: [recycleRow(cardId, false)] });
  } else {
    await interaction.editReply({ embeds: [embed], components: [] });
  }
}

// Kept for compatibility with any older imports.
export const TRADEIN_COST = recycleCost(0);
