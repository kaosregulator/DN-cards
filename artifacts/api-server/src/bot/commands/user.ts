import type { ChatInputCommandInteraction } from "discord.js";
import { EmbedBuilder, MessageFlags } from "discord.js";

// Commands whose results are personal/spammy and should only be seen by the user.
const EPHEMERAL_COMMANDS = new Set(["burn", "shards", "trades", "help", "daily", "achievements", "pack", "wishlist", "gift"]);
import {
  getUserCollection, getAllCards, getLeaderboard,
  getOrCreateCurrency, burnCard, getCardByName, getUserCardCount,
} from "../db.js";
import {
  RARITY_COLORS, RARITY_EMOJI, RARITY_LABELS, TYPE_EMOJI,
  getCollectorRank, getNextRank,
  type Rarity, type CardType,
} from "../cards-data.js";
import { handleTrade, handleAccept, handleDecline, handleListTrades, handleGift } from "./trading.js";
import { handleDaily, handleAchievementsCommand } from "./daily.js";
import { toAbsoluteImageUrl } from "../image-url.js";
import { handlePack } from "./pack.js";
import { handleWishlist } from "./wishlist.js";
import { checkAchievements, formatUnlockLine } from "../achievements.js";

export async function handleUserCommand(
  interaction: ChatInputCommandInteraction,
  sub: string,
): Promise<void> {
  if (!interaction.guild) return;
  await interaction.deferReply(
    EPHEMERAL_COMMANDS.has(sub) ? { flags: MessageFlags.Ephemeral } : {},
  );
  const guildId = interaction.guild.id;

  // ── /collection ──────────────────────────────────────────────────────────────
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
          const badges = [i.isLimitedEdition ? "💎" : "", i.isEventExclusive ? "🎆" : ""].filter(Boolean).join("");
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

  // ── /rank ─────────────────────────────────────────────────────────────────────
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
      embed.addFields({ name: "Next Rank", value: `${nextRank.emoji} **${nextRank.name}** — catch **${nextRank.min - unique}** more unique card${nextRank.min - unique !== 1 ? "s" : ""}`, inline: false });
    } else {
      embed.addFields({ name: "🏆 Max Rank", value: "You've reached the highest collector rank!", inline: false });
    }
    await interaction.editReply({ embeds: [embed] });
    return;
  }

  // ── /info ─────────────────────────────────────────────────────────────────────
  if (sub === "info") {
    const cardName = interaction.options.getString("name", true);
    const cards = await getAllCards();
    const card = cards.find(c => c.name.toLowerCase() === cardName.toLowerCase());
    if (!card) { await interaction.editReply(`❌ "**${cardName}**" not found. Try \`/list\`.`); return; }

    const rarity = card.rarity as Rarity;
    const cardType = card.cardType as CardType;
    const droppableCards = cards.filter(c => c.droppable);
    const totalWeight = droppableCards.reduce((s, c) => s + c.dropWeight, 0);
    const dropChance = card.droppable && totalWeight > 0 ? `~${((card.dropWeight / totalWeight) * 100).toFixed(2)}%` : "Event / Admin-drop only";

    const badges: string[] = [];
    if (card.isLimitedEdition) badges.push("💎 Limited Edition");
    if (card.isEventExclusive) badges.push("🎆 Event Exclusive");

    const embed = new EmbedBuilder()
      .setTitle(`${RARITY_EMOJI[rarity]} ${card.name}`)
      .setColor(RARITY_COLORS[rarity] ?? 0x7289da)
      .setDescription((card.description || "*No description.*") + (card.flavor ? `\n\n*${card.flavor}*` : ""))
      .addFields(
        { name: "Rarity", value: `${RARITY_EMOJI[rarity]} ${RARITY_LABELS[rarity]}`, inline: true },
        { name: "Type", value: `${TYPE_EMOJI[cardType]} ${card.cardType}`, inline: true },
        { name: "Drop Chance", value: dropChance, inline: true },
        { name: "💠 Worth", value: `${card.worthValue.toLocaleString()} shards`, inline: true },
        { name: "🔥 Burn Value", value: `${card.burnValue.toLocaleString()} shards`, inline: true },
        { name: "Total Caught", value: card.totalMinted.toLocaleString(), inline: true },
      );
    if (card.maxCopies) embed.addFields({ name: "📦 Copies", value: `${card.totalMinted} / ${card.maxCopies}`, inline: true });
    if (badges.length > 0) embed.addFields({ name: "Special", value: badges.join(" · "), inline: false });
    { const img = toAbsoluteImageUrl(card.imageUrl); if (img) embed.setImage(img); }
    await interaction.editReply({ embeds: [embed] });
    return;
  }

  // ── /list ─────────────────────────────────────────────────────────────────────
  if (sub === "list") {
    const cards = await getAllCards();
    if (cards.length === 0) { await interaction.editReply("No cards in the pool yet."); return; }
    const rarityOrder: Rarity[] = ["legendary", "epic", "rare", "uncommon", "common"];
    const byRarity: Record<string, typeof cards> = {};
    for (const card of cards) { if (!byRarity[card.rarity]) byRarity[card.rarity] = []; byRarity[card.rarity].push(card); }
    const fields = rarityOrder.filter(r => byRarity[r]?.length).map(r => ({
      name: `${RARITY_EMOJI[r]} ${RARITY_LABELS[r]} (${byRarity[r].length})`,
      value: byRarity[r].map(c => {
        const b = [c.isLimitedEdition ? "💎" : "", c.isEventExclusive ? "🎆" : "", !c.droppable ? "🔒" : ""].filter(Boolean).join("");
        return `${b}${c.name}`;
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

  // ── /top ──────────────────────────────────────────────────────────────────────
  if (sub === "top") {
    const [byWorth, byCards] = await Promise.all([
      getLeaderboard(guildId, "worth", 10),
      getLeaderboard(guildId, "cards", 5),
    ]);
    if (byWorth.length === 0) { await interaction.editReply("No one has caught any cards yet!"); return; }
    const medals = ["🥇", "🥈", "🥉"];
    const worthLines = byWorth.map((r, i) => {
      const medal = medals[i] ?? `**${i + 1}.**`;
      const rank = getCollectorRank(r.uniqueCards);
      return `${medal} ${rank.emoji} <@${r.userId}> — 💠 **${r.netWorth.toLocaleString()}** · ${r.totalCards} cards`;
    });
    const cardLines = byCards.map((r, i) => {
      const medal = medals[i] ?? `**${i + 1}.**`;
      return `${medal} <@${r.userId}> — **${r.totalCards.toLocaleString()}** cards (${r.uniqueCards} unique)`;
    });
    const domain = process.env["REPLIT_DOMAINS"]?.split(",")[0];
    const dashUrl = domain ? `https://${domain}/dashboard/leaderboard` : null;
    const embed = new EmbedBuilder()
      .setTitle("🏆 DN Cards — Collector Leaderboard")
      .setColor(0xf39c12)
      .addFields(
        { name: "💠 Top 10 by Net Worth", value: worthLines.join("\n") },
        { name: "🃏 Top 5 by Card Count", value: cardLines.join("\n") },
      )
      .setFooter({
        text: dashUrl
          ? `Full leaderboard on the web → ${dashUrl}`
          : "Ranked by total collection net worth (💠 shards)",
      });
    await interaction.editReply({ embeds: [embed] });
    return;
  }

  // ── /shards ───────────────────────────────────────────────────────────────────
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
      .setFooter({ text: "Earn shards by burning duplicate cards with /burn" });
    await interaction.editReply({ embeds: [embed] });
    return;
  }

  // ── /burn ─────────────────────────────────────────────────────────────────────
  if (sub === "burn") {
    const cardName = interaction.options.getString("name", true);
    const card = await getCardByName(cardName);
    if (!card) { await interaction.editReply(`❌ "**${cardName}**" not found. Check \`/list\`.`); return; }
    const result = await burnCard(guildId, interaction.user.id, card.id);
    if (!result.success) { await interaction.editReply(`❌ You don't have **${card.name}** in your collection.`); return; }
    const rarity = card.rarity as Rarity;
    const currency = await getOrCreateCurrency(guildId, interaction.user.id);
    await interaction.editReply(
      `🔥 Burned **${card.name}** (${RARITY_EMOJI[rarity]} ${RARITY_LABELS[rarity]})\n` +
      `+💠 **${result.shardsGained.toLocaleString()} shards** — New balance: **${currency.shards.toLocaleString()}**\n` +
      (result.remaining > 0 ? `You still have **×${result.remaining}** copies.` : "*Last copy burned.*"),
    );
    const newlyBurn = await checkAchievements(guildId, interaction.user.id);
    if (newlyBurn.length > 0) {
      await interaction.followUp({
        content: "🏆 **Achievement unlocked!**\n" + newlyBurn.map(formatUnlockLine).join("\n"),
        flags: MessageFlags.Ephemeral,
      });
    }
    return;
  }

  // ── Trading ───────────────────────────────────────────────────────────────────
  if (sub === "trade") { await handleTrade(interaction); return; }
  if (sub === "accept") { await handleAccept(interaction); return; }
  if (sub === "decline") { await handleDecline(interaction); return; }
  if (sub === "trades") { await handleListTrades(interaction); return; }
  if (sub === "daily") { await handleDaily(interaction); return; }
  if (sub === "pack") { await handlePack(interaction); return; }
  if (sub === "wishlist") { await handleWishlist(interaction); return; }
  if (sub === "gift") { await handleGift(interaction); return; }
  if (sub === "achievements") { await handleAchievementsCommand(interaction); return; }

  // ── /help ─────────────────────────────────────────────────────────────────────
  const embed = new EmbedBuilder()
    .setTitle("🃏 DN Cards — Command Reference")
    .setColor(0x5865f2)
    .setDescription(
      "When a card spawns in the drop channel, **type its name exactly** to catch it!\n" +
      "Most card-name fields **autocomplete** as you type — pick from the dropdown.\n\n" +
      "**📦 Collection**\n" +
      "`/collection` · `/rank` · `/info name:<card>` · `/list` · `/top`\n" +
      "`/achievements [user]` — view unlocked badges\n\n" +
      "**🔥 Economy** *(private — only you see the reply)*\n" +
      "`/burn name:<card>` — destroy a duplicate for DN Shards\n" +
      "`/shards` — check your balance\n" +
      "`/daily` — claim daily shards (streak bonus!)\n" +
      "`/pack` — open a 5-card pack for 💠 250\n" +
      "`/gift user:@Member amount:<n>` — send shards to a friend\n\n" +
      "**🔄 Trading**\n" +
      "`/trade user:@Member offer:<card> want:<card>` — card-for-card\n" +
      "Add `offer_shards:<n>` or `want_shards:<n>` to swap cards ↔ shards (or pure shards)\n" +
      "Accept/Decline buttons appear right on the trade message — `/accept` and `/decline` still work too\n\n" +
      "**⚙️ Server Setup** *(admins only — use `!` prefix)*\n" +
      "`!setup` — interactive setup wizard\n" +
      "`!setchannel` · `!setinterval` · `!setwindow` · `!setdrops` · `!setrarity`\n" +
      "`!spawnenable` · `!spawndisable` · `!addcard` · `!editcard` · `!removecard`\n" +
      "`!settings` — view current configuration\n\n" +
      "**⚡ Admin Quick Actions** *(slash commands)*\n" +
      "`/drop` · `/give` · `/giveshards` · `/takeback` · `/takeshards`\n\n" +
      "**🗂️ Card Sets** *(admin)*\n" +
      "`/loadset file:<.json>` — upload a card pack\n" +
      "`/loadset defaults:true` — re-add the built-in 27 cards\n" +
      "`/unloadset set:<name>` — remove a whole set\n" +
      "`/listsets` — see all loaded sets",
    );
  await interaction.editReply({ embeds: [embed] });
}
