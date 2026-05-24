import type { ChatInputCommandInteraction } from "discord.js";
import { EmbedBuilder } from "discord.js";
import {
  getUserCollection, getAllCards, getLeaderboard,
  getOrCreateCurrency, burnCard, getCardByName, getUserCardCount,
} from "../db.js";
import {
  RARITY_COLORS, RARITY_EMOJI, RARITY_LABELS, TYPE_EMOJI,
  getCollectorRank, getNextRank,
  type Rarity, type CardType,
} from "../cards-data.js";
import { handleTrade, handleAccept, handleDecline, handleListTrades } from "./trading.js";

export async function handleUserCommand(
  interaction: ChatInputCommandInteraction,
  sub: string,
): Promise<void> {
  if (!interaction.guild) return;
  await interaction.deferReply();
  const guildId = interaction.guild.id;

  // ── /card collection ────────────────────────────────────────────────────────
  if (sub === "collection") {
    const target = interaction.options.getUser("user") ?? interaction.user;
    const items = await getUserCollection(guildId, target.id);

    if (items.length === 0) {
      await interaction.editReply(
        target.id === interaction.user.id
          ? "You haven't caught any DN Cards yet! Watch for a card to spawn and type its name."
          : `**${target.username}** hasn't caught any cards yet.`,
      );
      return;
    }

    const rarityOrder: Rarity[] = ["legendary", "epic", "rare", "uncommon", "common"];
    const byRarity: Record<string, typeof items> = {};
    for (const item of items) {
      if (!byRarity[item.rarity]) byRarity[item.rarity] = [];
      byRarity[item.rarity].push(item);
    }

    const totalCards = items.reduce((s, i) => s + i.count, 0);
    const netWorth = items.reduce((s, i) => s + i.worthValue * i.count, 0);
    const { unique } = await getUserCardCount(guildId, target.id);
    const rank = getCollectorRank(unique);
    const nextRank = getNextRank(unique);
    const rankProgress = nextRank
      ? `${rank.emoji} ${rank.name} → ${nextRank.emoji} ${nextRank.name} (${unique}/${nextRank.min})`
      : `${rank.emoji} ${rank.name} *(MAX RANK)*`;

    const fields = rarityOrder
      .filter(r => byRarity[r]?.length)
      .map(r => ({
        name: `${RARITY_EMOJI[r]} ${RARITY_LABELS[r]} (${byRarity[r].length} unique)`,
        value: byRarity[r].map(i => {
          const badges = [
            i.isLimitedEdition ? "💎" : "",
            i.isEventExclusive ? "🎆" : "",
          ].filter(Boolean).join("");
          return `${badges}**${i.name}** ×${i.count}`;
        }).join("\n"),
        inline: false,
      }));

    const embed = new EmbedBuilder()
      .setTitle(`🃏 ${target.username}'s DN Collection`)
      .setColor(0x5865f2)
      .setDescription(
        `**Rank:** ${rankProgress}\n` +
        `**Cards:** ${unique} unique · ${totalCards} total\n` +
        `**Net Worth:** 💠 ${netWorth.toLocaleString()} shards`,
      )
      .addFields(fields)
      .setThumbnail(target.displayAvatarURL());

    await interaction.editReply({ embeds: [embed] });
    return;
  }

  // ── /card rank ──────────────────────────────────────────────────────────────
  if (sub === "rank") {
    const target = interaction.options.getUser("user") ?? interaction.user;
    const { unique, total, netWorth } = await getUserCardCount(guildId, target.id);
    const rank = getCollectorRank(unique);
    const nextRank = getNextRank(unique);

    const embed = new EmbedBuilder()
      .setTitle(`${rank.emoji} ${target.username}'s Collector Rank`)
      .setColor(0x5865f2)
      .setThumbnail(target.displayAvatarURL())
      .addFields(
        { name: "Rank", value: `${rank.emoji} **${rank.name}**`, inline: true },
        { name: "Unique Cards", value: unique.toString(), inline: true },
        { name: "Total Cards", value: total.toString(), inline: true },
        { name: "💠 Net Worth", value: `${netWorth.toLocaleString()} shards`, inline: true },
      );

    if (nextRank) {
      const needed = nextRank.min - unique;
      embed.addFields({
        name: "Next Rank",
        value: `${nextRank.emoji} **${nextRank.name}** — catch **${needed}** more unique card${needed !== 1 ? "s" : ""}`,
        inline: false,
      });
    } else {
      embed.addFields({ name: "🏆 Max Rank", value: "You've reached the highest collector rank!", inline: false });
    }

    await interaction.editReply({ embeds: [embed] });
    return;
  }

  // ── /card info ──────────────────────────────────────────────────────────────
  if (sub === "info") {
    const cardName = interaction.options.getString("name", true);
    const cards = await getAllCards();
    const card = cards.find(c => c.name.toLowerCase() === cardName.toLowerCase());

    if (!card) {
      await interaction.editReply(`❌ "**${cardName}**" not found. Try \`/card list\` to see all cards.`);
      return;
    }

    const rarity = card.rarity as Rarity;
    const cardType = card.cardType as CardType;
    const droppableCards = cards.filter(c => c.droppable);
    const totalWeight = droppableCards.reduce((s, c) => s + c.dropWeight, 0);
    const dropChance = card.droppable && totalWeight > 0
      ? `~${((card.dropWeight / totalWeight) * 100).toFixed(2)}%`
      : "Event / Admin-drop only";

    const badges: string[] = [];
    if (card.isLimitedEdition) badges.push("💎 Limited Edition");
    if (card.isEventExclusive) badges.push("🎆 Event Exclusive");

    const embed = new EmbedBuilder()
      .setTitle(`${RARITY_EMOJI[rarity]} ${card.name}`)
      .setColor(RARITY_COLORS[rarity] ?? 0x7289da)
      .setDescription(
        (card.description || "*No description.*") +
        (card.flavor ? `\n\n*${card.flavor}*` : ""),
      )
      .addFields(
        { name: "Rarity", value: `${RARITY_EMOJI[rarity]} ${RARITY_LABELS[rarity]}`, inline: true },
        { name: "Type", value: `${TYPE_EMOJI[cardType]} ${card.cardType}`, inline: true },
        { name: "Drop Chance", value: dropChance, inline: true },
        { name: "💠 Worth", value: `${card.worthValue.toLocaleString()} shards`, inline: true },
        { name: "🔥 Burn Value", value: `${card.burnValue.toLocaleString()} shards`, inline: true },
        { name: "Total Caught", value: card.totalMinted.toLocaleString(), inline: true },
      );

    if (card.maxCopies) {
      embed.addFields({ name: "📦 Copies", value: `${card.totalMinted} / ${card.maxCopies}`, inline: true });
    }
    if (badges.length > 0) {
      embed.addFields({ name: "Special", value: badges.join(" · "), inline: false });
    }
    if (card.imageUrl) embed.setImage(card.imageUrl);

    await interaction.editReply({ embeds: [embed] });
    return;
  }

  // ── /card list ──────────────────────────────────────────────────────────────
  if (sub === "list") {
    const cards = await getAllCards();
    if (cards.length === 0) { await interaction.editReply("No cards in the pool yet."); return; }

    const rarityOrder: Rarity[] = ["legendary", "epic", "rare", "uncommon", "common"];
    const byRarity: Record<string, typeof cards> = {};
    for (const card of cards) {
      if (!byRarity[card.rarity]) byRarity[card.rarity] = [];
      byRarity[card.rarity].push(card);
    }

    const fields = rarityOrder
      .filter(r => byRarity[r]?.length)
      .map(r => ({
        name: `${RARITY_EMOJI[r]} ${RARITY_LABELS[r]} (${byRarity[r].length})`,
        value: byRarity[r].map(c => {
          const badges = [
            c.isLimitedEdition ? "💎" : "",
            c.isEventExclusive ? "🎆" : "",
            !c.droppable ? "🔒" : "",
          ].filter(Boolean).join("");
          return `${badges}${c.name}`;
        }).join(", "),
        inline: false,
      }));

    const embed = new EmbedBuilder()
      .setTitle("🃏 DN Cards — Full Roster")
      .setColor(0x5865f2)
      .setDescription(`**${cards.length}** total cards\n💎 Limited  🎆 Event  🔒 Admin-drop only`)
      .addFields(fields);

    await interaction.editReply({ embeds: [embed] });
    return;
  }

  // ── /card top ───────────────────────────────────────────────────────────────
  if (sub === "top") {
    const rows = await getLeaderboard(guildId);
    if (rows.length === 0) {
      await interaction.editReply("No one has caught any cards yet! Waiting for the first drop...");
      return;
    }

    const medals = ["🥇", "🥈", "🥉"];
    const lines = rows.map((r, i) => {
      const medal = medals[i] ?? `**${i + 1}.**`;
      const rank = getCollectorRank(r.uniqueCards);
      return `${medal} ${rank.emoji} <@${r.userId}> — 💠 ${r.netWorth.toLocaleString()} worth · ${r.totalCards} cards (${r.uniqueCards} unique)`;
    });

    const embed = new EmbedBuilder()
      .setTitle("🏆 DN Cards — Collector Leaderboard")
      .setColor(0xf39c12)
      .setDescription(lines.join("\n"))
      .setFooter({ text: "Ranked by total collection net worth (💠 shards)" });

    await interaction.editReply({ embeds: [embed] });
    return;
  }

  // ── /card shards ─────────────────────────────────────────────────────────────
  if (sub === "shards") {
    const target = interaction.options.getUser("user") ?? interaction.user;
    const currency = await getOrCreateCurrency(guildId, target.id);

    const embed = new EmbedBuilder()
      .setTitle(`💠 ${target.username}'s DN Shards`)
      .setColor(0x74b9ff)
      .setThumbnail(target.displayAvatarURL())
      .addFields(
        { name: "Balance", value: `💠 **${currency.shards.toLocaleString()}** shards`, inline: true },
        { name: "All-Time Earned", value: `💠 ${currency.totalEarned.toLocaleString()} shards`, inline: true },
      )
      .setFooter({ text: "Earn shards by burning duplicate cards with /card burn" });

    await interaction.editReply({ embeds: [embed] });
    return;
  }

  // ── /card burn ──────────────────────────────────────────────────────────────
  if (sub === "burn") {
    const cardName = interaction.options.getString("name", true);
    const card = await getCardByName(cardName);

    if (!card) {
      await interaction.editReply(`❌ "**${cardName}**" not found. Check \`/card list\`.`);
      return;
    }

    const result = await burnCard(guildId, interaction.user.id, card.id);
    if (!result.success) {
      await interaction.editReply(`❌ You don't have **${card.name}** in your collection.`);
      return;
    }

    const rarity = card.rarity as Rarity;
    const currency = await getOrCreateCurrency(guildId, interaction.user.id);

    await interaction.editReply(
      `🔥 Burned **${card.name}** (${RARITY_EMOJI[rarity]} ${RARITY_LABELS[rarity]})\n` +
      `+💠 **${result.shardsGained.toLocaleString()} shards** — New balance: **${currency.shards.toLocaleString()}**\n` +
      (result.remaining > 0 ? `You still have **×${result.remaining}** copies.` : "*Last copy burned.*"),
    );
    return;
  }

  // ── Trading ─────────────────────────────────────────────────────────────────
  if (sub === "trade") { await handleTrade(interaction); return; }
  if (sub === "accept") { await handleAccept(interaction); return; }
  if (sub === "decline") { await handleDecline(interaction); return; }
  if (sub === "trades") { await handleListTrades(interaction); return; }

  // ── /card help ──────────────────────────────────────────────────────────────
  const embed = new EmbedBuilder()
    .setTitle("🃏 DN Cards — Command Reference")
    .setColor(0x5865f2)
    .setDescription(
      "DN Cards is DarkNight's collectible military card game.\n" +
      "When a card spawns in the spawn channel, **type its name exactly** to catch it!\n\n" +
      "**📦 Collection**\n" +
      "`/card collection` — view your cards\n" +
      "`/card rank` — collector rank and progression\n" +
      "`/card info name:<card>` — card details, worth, drop chance\n" +
      "`/card list` — full roster by rarity\n\n" +
      "**🔥 Economy**\n" +
      "`/card burn name:<card>` — destroy a duplicate for DN Shards\n" +
      "`/card shards` — check your shard balance\n\n" +
      "**🔄 Trading**\n" +
      "`/card trade user:@Member offer:<card> want:<card>` — propose a trade\n" +
      "`/card trades` — view pending trades\n" +
      "`/card accept id:<ID>` — accept a trade\n" +
      "`/card decline id:<ID>` — decline or cancel\n\n" +
      "**🏆 Leaderboard**\n" +
      "`/card top` — top 10 by net worth\n\n" +
      "*Server admin? Use `/card admin` commands.*",
    );

  await interaction.editReply({ embeds: [embed] });
}
