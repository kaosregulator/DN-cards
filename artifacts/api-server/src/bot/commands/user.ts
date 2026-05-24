import type { Message } from "discord.js";
import { EmbedBuilder } from "discord.js";
import { getUserCollection, getAllCards, getLeaderboard } from "../db.js";
import { RARITY_COLORS, RARITY_EMOJI, RARITY_LABELS, type Rarity } from "../cards-data.js";

// ── User Commands ─────────────────────────────────────────────────────────────
export async function handleUserCommand(msg: Message, args: string[]) {
  if (!msg.guild) return;
  const sub = args[0]?.toLowerCase();

  switch (sub) {
    // ── View own/other's collection ───────────────────────────────────────────
    case "collection":
    case "col": {
      const target = msg.mentions.users.first() ?? msg.author;
      const items = await getUserCollection(msg.guild.id, target.id);

      if (items.length === 0) {
        return msg.reply(
          target.id === msg.author.id
            ? "You haven't caught any cards yet! Wait for one to spawn and type its name."
            : `**${target.username}** has no cards yet.`,
        );
      }

      const byRarity: Record<string, typeof items> = {};
      for (const item of items) {
        if (!byRarity[item.rarity]) byRarity[item.rarity] = [];
        byRarity[item.rarity].push(item);
      }

      const rarityOrder: Rarity[] = ["legendary", "epic", "rare", "uncommon", "common"];
      const fields = rarityOrder
        .filter(r => byRarity[r]?.length)
        .map(r => ({
          name: `${RARITY_EMOJI[r]} ${RARITY_LABELS[r]}`,
          value: byRarity[r]
            .map(i => `**${i.name}** ×${i.count}`)
            .join("\n"),
          inline: false,
        }));

      const totalCards = items.reduce((s, i) => s + i.count, 0);
      const embed = new EmbedBuilder()
        .setTitle(`🃏 ${target.username}'s Collection`)
        .setColor(0x5865f2)
        .setDescription(`**${items.length}** unique cards · **${totalCards}** total`)
        .addFields(fields)
        .setThumbnail(target.displayAvatarURL());

      return msg.reply({ embeds: [embed] });
    }

    // ── Card info ─────────────────────────────────────────────────────────────
    case "info": {
      const cardName = args.slice(1).join(" ");
      if (!cardName) return msg.reply("❌ Usage: `!card info <Card Name>`");

      const cards = await getAllCards();
      const card = cards.find(c => c.name.toLowerCase() === cardName.toLowerCase());
      if (!card) return msg.reply(`❌ Card "**${cardName}**" not found. Use \`!card list\` to see all cards.`);

      const rarity = card.rarity as Rarity;
      const totalWeight = cards.reduce((s, c) => s + c.dropWeight, 0);
      const dropChance = ((card.dropWeight / totalWeight) * 100).toFixed(2);

      const embed = new EmbedBuilder()
        .setTitle(`${RARITY_EMOJI[rarity]} ${card.name}`)
        .setDescription(card.description || "*No description.*")
        .setColor(RARITY_COLORS[rarity] ?? 0x7289da)
        .addFields(
          { name: "Rarity", value: `${RARITY_EMOJI[rarity]} ${RARITY_LABELS[rarity]}`, inline: true },
          { name: "Drop Chance", value: `~${dropChance}%`, inline: true },
        );

      if (card.imageUrl) embed.setImage(card.imageUrl);

      return msg.reply({ embeds: [embed] });
    }

    // ── List all cards ────────────────────────────────────────────────────────
    case "list": {
      const cards = await getAllCards();
      if (cards.length === 0) return msg.reply("No cards in the pool yet.");

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
          value: byRarity[r].map(c => c.name).join(", "),
          inline: false,
        }));

      const embed = new EmbedBuilder()
        .setTitle("🃏 Card Pool")
        .setColor(0x5865f2)
        .setDescription(`**${cards.length}** cards in the pool`)
        .addFields(fields);

      return msg.reply({ embeds: [embed] });
    }

    // ── Leaderboard ───────────────────────────────────────────────────────────
    case "top":
    case "leaderboard": {
      const rows = await getLeaderboard(msg.guild.id);
      if (rows.length === 0) return msg.reply("No one has caught any cards yet!");

      const medals = ["🥇", "🥈", "🥉"];
      const lines = rows.map((r, i) => {
        const medal = medals[i] ?? `**${i + 1}.**`;
        return `${medal} <@${r.userId}> — ${r.totalCards} cards (${r.uniqueCards} unique)`;
      });

      const embed = new EmbedBuilder()
        .setTitle("🏆 Card Leaderboard")
        .setColor(0xf39c12)
        .setDescription(lines.join("\n"));

      return msg.reply({ embeds: [embed] });
    }

    // ── Help ──────────────────────────────────────────────────────────────────
    case "help":
    default: {
      const embed = new EmbedBuilder()
        .setTitle("🃏 Trading Card Bot — Commands")
        .setColor(0x5865f2)
        .setDescription(
          "When a card spawns, type its name **exactly** to catch it!\n\n" +
          "**User Commands:**\n" +
          "`!card collection [@user]` — view your (or someone's) collection\n" +
          "`!card info <Card Name>` — details about a specific card\n" +
          "`!card list` — see all cards in the pool with rarities\n" +
          "`!card top` — leaderboard\n" +
          "`!card help` — this message\n\n" +
          "**Admin Commands:** `!card admin` for the full list",
        );
      return msg.reply({ embeds: [embed] });
    }
  }
}
