import type { ChatInputCommandInteraction } from "discord.js";
import { EmbedBuilder } from "discord.js";
import {
  addWishlist, removeWishlist, getUserWishlist, getCardByName,
  getRarityProfile,
} from "../db.js";
import { RARITY_COLORS, RARITY_EMOJI, RARITY_LABELS, type Rarity } from "../cards-data.js";

export async function handleWishlist(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!interaction.guild) return;
  const guildId = interaction.guild.id;
  const sub = interaction.options.getSubcommand();

  if (sub === "add") {
    const name = interaction.options.getString("name", true);
    const card = await getCardByName(name);
    if (!card) { await interaction.editReply(`❌ No card named **${name}**.`); return; }
    if (card.isArchived) { await interaction.editReply(`❌ **${card.name}** is archived and can't be wishlisted.`); return; }
    const added = await addWishlist(guildId, interaction.user.id, card.id);
    const rarity = card.rarity as Rarity;
    await interaction.editReply(
      added
        ? `⭐ Added **${card.name}** (${RARITY_EMOJI[rarity]} ${RARITY_LABELS[rarity]}) to your wishlist. You'll be pinged when it spawns.`
        : `**${card.name}** is already on your wishlist.`,
    );
    return;
  }

  if (sub === "remove") {
    const name = interaction.options.getString("name", true);
    const card = await getCardByName(name);
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
    // Apply per-guild worth override (wishlist row only carries worthValue).
    const profile = await getRarityProfile(guildId);
    const items = rawItems.map(it => ({
      ...it,
      worthValue: profile.get(it.rarity as Rarity)?.worthValue ?? it.worthValue,
    }));
    if (items.length === 0) {
      await interaction.editReply(
        target.id === interaction.user.id
          ? "Your wishlist is empty. Add cards with `/wishlist add name:<Card>` and the bot will ping you when one spawns."
          : `**${target.username}** has no cards on their wishlist.`,
      );
      return;
    }
    const rarityOrder: Rarity[] = ["legendary", "epic", "rare", "uncommon", "common"];
    const byRarity: Record<string, typeof items> = {};
    for (const it of items) (byRarity[it.rarity] ??= []).push(it);

    const fields = rarityOrder.filter(r => byRarity[r]?.length).map(r => ({
      name: `${RARITY_EMOJI[r]} ${RARITY_LABELS[r]} (${byRarity[r].length})`,
      value: byRarity[r].map(i => `• **${i.name}** — 💠 ${i.worthValue.toLocaleString()}`).join("\n"),
      inline: false,
    }));

    const topRarity = (items[0]?.rarity ?? "common") as Rarity;
    const embed = new EmbedBuilder()
      .setTitle(`⭐ ${target.username}'s Wishlist (${items.length})`)
      .setColor(RARITY_COLORS[topRarity] ?? 0xf1c40f)
      .addFields(fields)
      .setFooter({ text: "Wished cards ping their owner when they spawn." });
    await interaction.editReply({ embeds: [embed] });
    return;
  }
}
