import type { Message } from "discord.js";
import { EmbedBuilder } from "discord.js";
import {
  getUserCollection,
  getAllCards,
  getLeaderboard,
  getOrCreateCurrency,
  burnCard,
  getCardByName,
  getUserCardCount,
} from "../db.js";
import {
  RARITY_COLORS, RARITY_EMOJI, RARITY_LABELS, TYPE_EMOJI,
  getCollectorRank, getNextRank,
  type Rarity, type CardType,
} from "../cards-data.js";
import {
  handleTrade,
  handleAccept,
  handleDecline,
  handleListTrades,
} from "./trading.js";

export async function handleUserCommand(msg: Message, args: string[]): Promise<void> {
  if (!msg.guild) return;
  const sub = args[0]?.toLowerCase();

  // ── Collection ──────────────────────────────────────────────────────────────
  if (sub === "collection" || sub === "col" || sub === "inv" || sub === "inventory") {
    const target = msg.mentions.users.first() ?? msg.author;
    const items = await getUserCollection(msg.guild.id, target.id);

    if (items.length === 0) {
      await msg.reply(
        target.id === msg.author.id
          ? "You haven't caught any DN Cards yet! Wait for a card to spawn and type its name."
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
    const { unique } = await getUserCardCount(msg.guild.id, target.id);
    const rank = getCollectorRank(unique);
    const nextRank = getNextRank(unique);

    const fields = rarityOrder
      .filter(r => byRarity[r]?.length)
      .map(r => ({
        name: `${RARITY_EMOJI[r]} ${RARITY_LABELS[r]} (${byRarity[r].length} unique)`,
        value: byRarity[r]
          .map(i => {
            const badges = [
              i.isLimitedEdition ? "💎" : "",
              i.isEventExclusive ? "🎆" : "",
            ].filter(Boolean).join("");
            return `${badges}**${i.name}** ×${i.count}`;
          })
          .join("\n"),
        inline: false,
      }));

    const rankProgress = nextRank
      ? `${rank.emoji} ${rank.name} → ${nextRank.emoji} ${nextRank.name} (${unique}/${nextRank.min})`
      : `${rank.emoji} ${rank.name} *(MAX RANK)*`;

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

    await msg.reply({ embeds: [embed] });
    return;
  }

  // ── Card Info ───────────────────────────────────────────────────────────────
  if (sub === "info") {
    const cardName = args.slice(1).join(" ");
    if (!cardName) {
      await msg.reply("❌ Usage: `!card info <Card Name>`");
      return;
    }
    const cards = await getAllCards();
    const card = cards.find(c => c.name.toLowerCase() === cardName.toLowerCase());
    if (!card) {
      await msg.reply(`❌ "**${cardName}**" not found. Try \`!card list\` to see all cards.`);
      return;
    }

    const rarity = card.rarity as Rarity;
    const cardType = card.cardType as CardType;
    const totalWeight = cards.filter(c => c.droppable).reduce((s, c) => s + c.dropWeight, 0);
    const dropChance = card.droppable
      ? `~${((card.dropWeight / totalWeight) * 100).toFixed(2)}%`
      : "Admin-only / Event";

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
      embed.addFields({
        name: "📦 Copies",
        value: `${card.totalMinted} / ${card.maxCopies} exist`,
        inline: true,
      });
    }
    if (badges.length > 0) {
      embed.addFields({ name: "Special", value: badges.join(" · "), inline: false });
    }
    if (card.imageUrl) embed.setImage(card.imageUrl);

    await msg.reply({ embeds: [embed] });
    return;
  }

  // ── Card List ───────────────────────────────────────────────────────────────
  if (sub === "list") {
    const cards = await getAllCards();
    if (cards.length === 0) {
      await msg.reply("No cards in the pool yet.");
      return;
    }

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
        value: byRarity[r]
          .map(c => {
            const badges = [
              c.isLimitedEdition ? "💎" : "",
              c.isEventExclusive ? "🎆" : "",
              !c.droppable ? "🔒" : "",
            ].filter(Boolean).join("");
            return `${badges}${c.name}`;
          })
          .join(", "),
        inline: false,
      }));

    const embed = new EmbedBuilder()
      .setTitle("🃏 DN Cards — Full Roster")
      .setColor(0x5865f2)
      .setDescription(`**${cards.length}** total cards\n💎 = Limited  🎆 = Event  🔒 = Event-only drop`)
      .addFields(fields);

    await msg.reply({ embeds: [embed] });
    return;
  }

  // ── Rank ────────────────────────────────────────────────────────────────────
  if (sub === "rank") {
    const target = msg.mentions.users.first() ?? msg.author;
    const { unique, total, netWorth } = await getUserCardCount(msg.guild.id, target.id);
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
        value: `${nextRank.emoji} ${nextRank.name} — catch **${needed}** more unique card${needed !== 1 ? "s" : ""}`,
        inline: false,
      });
    } else {
      embed.addFields({ name: "🏆 Max Rank", value: "You've reached the highest collector rank!", inline: false });
    }

    await msg.reply({ embeds: [embed] });
    return;
  }

  // ── Shards ──────────────────────────────────────────────────────────────────
  if (sub === "shards" || sub === "balance" || sub === "bal") {
    const target = msg.mentions.users.first() ?? msg.author;
    const currency = await getOrCreateCurrency(msg.guild.id, target.id);

    const embed = new EmbedBuilder()
      .setTitle(`💠 ${target.username}'s DN Shards`)
      .setColor(0x74b9ff)
      .setThumbnail(target.displayAvatarURL())
      .addFields(
        { name: "Balance", value: `💠 **${currency.shards.toLocaleString()}** shards`, inline: true },
        { name: "All-Time Earned", value: `💠 ${currency.totalEarned.toLocaleString()} shards`, inline: true },
      )
      .setFooter({ text: "Earn shards by burning duplicate cards with !card burn <name>" });

    await msg.reply({ embeds: [embed] });
    return;
  }

  // ── Burn ────────────────────────────────────────────────────────────────────
  if (sub === "burn") {
    const cardName = args.slice(1).join(" ");
    if (!cardName) {
      await msg.reply(
        "❌ Usage: `!card burn <Card Name>`\n" +
        "Burning a card destroys one copy and gives you its shard value.",
      );
      return;
    }

    const card = await getCardByName(cardName);
    if (!card) {
      await msg.reply(`❌ "**${cardName}**" not found. Check \`!card list\`.`);
      return;
    }

    const result = await burnCard(msg.guild.id, msg.author.id, card.id);
    if (!result.success) {
      await msg.reply(`❌ You don't have **${card.name}** in your collection.`);
      return;
    }

    const rarity = card.rarity as Rarity;
    const currency = await getOrCreateCurrency(msg.guild.id, msg.author.id);

    await msg.reply(
      `🔥 Burned **${card.name}** (${RARITY_EMOJI[rarity]} ${RARITY_LABELS[rarity]})\n` +
      `+💠 **${result.shardsGained.toLocaleString()} shards** — New balance: **${currency.shards.toLocaleString()}**\n` +
      (result.remaining > 0 ? `You still have **×${result.remaining}** copies.` : "*Last copy burned.*"),
    );
    return;
  }

  // ── Leaderboard ─────────────────────────────────────────────────────────────
  if (sub === "top" || sub === "leaderboard" || sub === "lb") {
    const rows = await getLeaderboard(msg.guild.id);
    if (rows.length === 0) {
      await msg.reply("No one has caught any cards yet! Waiting for the first drop...");
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
      .setFooter({ text: "Ranked by total collection net worth" });

    await msg.reply({ embeds: [embed] });
    return;
  }

  // ── Trading ─────────────────────────────────────────────────────────────────
  if (sub === "trade") {
    await handleTrade(msg, args.slice(1));
    return;
  }
  if (sub === "accept") {
    await handleAccept(msg, args[1] ?? "");
    return;
  }
  if (sub === "decline" || sub === "reject") {
    await handleDecline(msg, args[1] ?? "");
    return;
  }
  if (sub === "trades" || sub === "pending") {
    await handleListTrades(msg);
    return;
  }

  // ── Help ────────────────────────────────────────────────────────────────────
  const embed = new EmbedBuilder()
    .setTitle("🃏 DN Cards — Command Reference")
    .setColor(0x5865f2)
    .setDescription(
      "DN Cards is DarkNight's collectible military card game.\nWhen a card spawns, **type its name exactly** to catch it!\n\n" +
      "**📦 Collection**\n" +
      "`!card collection [@user]` — view your (or someone's) cards\n" +
      "`!card rank [@user]` — collector rank and progression\n" +
      "`!card info <Name>` — card details, worth, drop chance\n" +
      "`!card list` — full card roster by rarity\n\n" +
      "**🔥 Economy**\n" +
      "`!card burn <Name>` — destroy a duplicate for DN Shards\n" +
      "`!card shards [@user]` — check shard balance\n\n" +
      "**🔄 Trading**\n" +
      "`!card trade @User <Your Card> for <Their Card>` — propose a trade\n" +
      "`!card trades` — view your pending trades\n" +
      "`!card accept <id>` — accept a trade offer\n" +
      "`!card decline <id>` — decline or cancel a trade\n\n" +
      "**🏆 Leaderboard**\n" +
      "`!card top` — top 10 collectors by net worth\n\n" +
      "*Admin? Use `!card admin` for admin commands.*",
    );

  await msg.reply({ embeds: [embed] });
}
