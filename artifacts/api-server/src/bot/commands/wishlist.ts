import type { ChatInputCommandInteraction } from "discord.js";
import { EmbedBuilder } from "discord.js";
import {
  addWishlist, removeWishlist, getUserWishlist, getCardByName,
  getRarityContext, getCardDisplayRarity, getRarityDisplayOverrides,
} from "../db.js";
import { type Rarity } from "../cards-data.js";

export async function handleWishlist(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!interaction.guild) return;
  const guildId = interaction.guild.id;
  const sub = interaction.options.getSubcommand();

  if (sub === "add") {
    const name = interaction.options.getString("name", true);
    const card = await getCardByName(name, guildId);
    if (!card) { await interaction.editReply(`❌ No card named **${name}**.`); return; }
    if (card.isArchived) { await interaction.editReply(`❌ **${card.name}** is archived and can't be wishlisted.`); return; }
    const added = await addWishlist(guildId, interaction.user.id, card.id);
    const [ctx, displayMap] = await Promise.all([getRarityContext(guildId), getRarityDisplayOverrides(guildId)]);
    const rarity = getCardDisplayRarity(card, ctx, null, displayMap);
    await interaction.editReply(
      added
        ? `⭐ Added **${card.name}** (${rarity.emoji} ${rarity.label}) to your wishlist. You'll be pinged when it spawns.`
        : `**${card.name}** is already on your wishlist.`,
    );
    return;
  }

  if (sub === "remove") {
    const name = interaction.options.getString("name", true);
    const card = await getCardByName(name, guildId);
    if (!card) { await interaction.editReply(`❌ No card named **${name}**.`); return; }
    const removed = await removeWishlist(guildId, interaction.user.id, card.id);
    await interaction.editReply(
      removed
        ? `🗑️ Removed **${card.name}** from your wishlist.`
        : `**${card.name}** wasn't on your wishlist.`,
    );
    return;
  }

  if (sub === "list") {
    const target = interaction.options.getUser("user") ?? interaction.user;
    const rawItems = await getUserWishlist(guildId, target.id);
    const [ctx, displayMap] = await Promise.all([getRarityContext(guildId), getRarityDisplayOverrides(guildId)]);
    const items = rawItems.map(it => ({
      ...it,
      id: it.cardId,
      worthValue: ctx.customByCard.get(it.cardId)?.worthValue ?? ctx.profile.get(it.rarity as Rarity)?.worthValue ?? it.worthValue,
    }));
    if (items.length === 0) {
      await interaction.editReply(
        target.id === interaction.user.id
          ? "Your wishlist is empty. Add cards with `/wishlist add name:<Card>` and the bot will ping you when one spawns."
          : `**${target.username}** has no cards on their wishlist.`,
      );
      return;
    }

    const byRarity = new Map<string, typeof items>();
    for (const it of items) {
      const rarity = getCardDisplayRarity(it, ctx, null, displayMap);
      (byRarity.get(rarity.key) ?? byRarity.set(rarity.key, []).get(rarity.key)!).push(it);
    }

    const fields = [...byRarity.values()].map(group => {
      const rarity = getCardDisplayRarity(group[0]!, ctx, null, displayMap);
      return {
        name: `${rarity.emoji} ${rarity.label} (${group.length})`,
        value: group.map(i => `• **${i.name}** — 💠 ${i.worthValue.toLocaleString()}`).join("\n"),
        inline: false,
      };
    });

    const topRarity = getCardDisplayRarity(items[0]!, ctx, null, displayMap);
    const embed = new EmbedBuilder()
      .setTitle(`⭐ ${target.username}'s Wishlist (${items.length})`)
      .setColor(topRarity.color)
      .addFields(fields)
      .setFooter({ text: "Wished cards ping their owner when they spawn." });
    await interaction.editReply({ embeds: [embed] });
    return;
  }
}
