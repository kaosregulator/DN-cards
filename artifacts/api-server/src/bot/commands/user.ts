import type { ChatInputCommandInteraction } from "discord.js";
import { EmbedBuilder, MessageFlags } from "discord.js";

// Commands whose results are personal/spammy and should only be seen by the user.
const EPHEMERAL_COMMANDS = new Set(["burn", "shards", "trades", "tradehistory", "help", "daily", "achievements", "pack", "packstats", "wishlist", "gift", "tradein"]);
import {
  getUserCollection, getAllCards, getLeaderboard, getTopPackOpeners,
  getOrCreateCurrency, burnCard, getCardByName, getUserCardCount, getUserOwnedCount,
  getOrCreateGuildSettings,
} from "../db.js";
import {
  RARITY_COLORS, RARITY_EMOJI, RARITY_LABELS, getTypeEmoji,
  SHINY_EMOJI, SHINY_MULTIPLIER,
  getCollectorRank, getNextRank,
  rarityLabel, rarityEmoji, rarityColor,
  type Rarity,
} from "../cards-data.js";
import { handleTrade, handleAccept, handleDecline, handleListTrades, handleGift, handleTradeHistory } from "./trading.js";
import { handleDaily, handleAchievementsCommand } from "./daily.js";
import { ACHIEVEMENTS, getAchievement, getUnlockedKeys, getRecentUnlocks } from "../achievements.js";
import { toAbsoluteImageUrl } from "../image-url.js";
import { handlePack, handlePackStats } from "./pack.js";
import { handleTradein } from "./tradein.js";
import { handleWishlist } from "./wishlist.js";
import { handleWelcome } from "./welcome.js";
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

    const rarityOrder: Rarity[] = ["mythic", "legendary", "epic", "rare", "uncommon", "common"];
    const settings = await getOrCreateGuildSettings(guildId);
    const byRarity: Record<string, typeof items> = {};
    for (const item of items) {
      if (!byRarity[item.rarity]) byRarity[item.rarity] = [];
      byRarity[item.rarity].push(item);
    }

    const totalCards = items.reduce((s, i) => s + i.count + i.shinyCount, 0);
    const totalShinies = items.reduce((s, i) => s + i.shinyCount, 0);
    const netWorth = items.reduce(
      (s, i) => s + i.worthValue * (i.count + i.shinyCount * SHINY_MULTIPLIER),
      0,
    );
    const { unique } = await getUserCardCount(guildId, target.id);
    const rank = getCollectorRank(unique);
    const nextRank = getNextRank(unique);
    const rankProgress = nextRank
      ? `${rank.emoji} ${rank.name} → ${nextRank.emoji} ${nextRank.name} (${unique}/${nextRank.min})`
      : `${rank.emoji} ${rank.name} *(MAX RANK)*`;

    // Achievements summary — unlocked count + emoji strip of the most recently
    // unlocked (newest first, by unlockedAt). Two queries (count + recents) is
    // fine since /collection isn't hot.
    const [unlockedKeys, recentKeys] = await Promise.all([
      getUnlockedKeys(guildId, target.id),
      getRecentUnlocks(guildId, target.id, 6),
    ]);
    const achStrip = recentKeys.length > 0
      ? recentKeys.map(k => getAchievement(k)?.emoji ?? "•").join(" ")
      : "_none yet_";
    const achLine = `**🏆 Achievements:** ${unlockedKeys.size} / ${ACHIEVEMENTS.length} · ${achStrip}`;

    const fields = rarityOrder
      .filter(r => byRarity[r]?.length)
      .map(r => ({
        name: `${rarityEmoji(r, settings)} ${rarityLabel(r, settings)} (${byRarity[r].length} unique)`,
        value: byRarity[r].map(i => {
          const badges = [i.isLimitedEdition ? "💎" : "", i.isEventExclusive ? "🎆" : ""].filter(Boolean).join("");
          const shinyTag = i.shinyCount > 0 ? ` · ${SHINY_EMOJI}×${i.shinyCount}` : "";
          // Show normal count even when 0 (rare: only shinies owned) so users
          // can tell the difference between "1 shiny" and "1 normal".
          return `${badges}**${i.name}** ×${i.count}${shinyTag}`;
        }).join("\n"),
        inline: false,
      }));

    const embed = new EmbedBuilder()
      .setTitle(`🃏 ${target.username}'s DN Collection`)
      .setColor(0x5865f2)
      .setDescription(
        `**Rank:** ${rankProgress}\n` +
        `**Cards:** ${unique} unique · ${totalCards} total` +
        (totalShinies > 0 ? ` · ${SHINY_EMOJI}**${totalShinies}** shiny` : "") + `\n` +
        `**Net Worth:** 💠 ${netWorth.toLocaleString()} shards\n` +
        achLine,
      )
      .addFields(fields)
      .setThumbnail(target.displayAvatarURL());
    await interaction.editReply({ embeds: [embed] });
    return;
  }

  // ── /inventory ───────────────────────────────────────────────────────────────
  // Flat alphabetical listing of every owned card. Same data source as
  // /collection (getUserCollection) so cross-checks should always match.
  if (sub === "inventory") {
    const target = interaction.options.getUser("user") ?? interaction.user;
    const items = await getUserCollection(guildId, target.id);

    if (items.length === 0) {
      await interaction.editReply(
        target.id === interaction.user.id
          ? "Your inventory is empty — no cards caught yet."
          : `**${target.username}**'s inventory is empty.`,
      );
      return;
    }

    const sorted = [...items].sort((a, b) => a.name.localeCompare(b.name));
    const invSettings = await getOrCreateGuildSettings(guildId);
    const totalCards = sorted.reduce((s, i) => s + i.count + i.shinyCount, 0);
    const totalShinies = sorted.reduce((s, i) => s + i.shinyCount, 0);

    const lines = sorted.map(i => {
      const badges = [i.isLimitedEdition ? "💎" : "", i.isEventExclusive ? "🎆" : ""].filter(Boolean).join("");
      const shinyTag = i.shinyCount > 0 ? ` ${SHINY_EMOJI}×${i.shinyCount}` : "";
      return `${rarityEmoji(i.rarity as Rarity, invSettings)} ${badges}**${i.name}** ×${i.count}${shinyTag}`;
    });

    // Pack lines into 1024-char fields (Discord limit). Up to 25 fields/embed.
    const fields: { name: string; value: string; inline: false }[] = [];
    let chunk = "";
    let part = 1;
    for (const line of lines) {
      if ((chunk + "\n" + line).length > 1000) {
        fields.push({ name: part === 1 ? "📋 All Cards" : `📋 (cont. ${part})`, value: chunk, inline: false });
        chunk = line;
        part++;
      } else {
        chunk = chunk ? `${chunk}\n${line}` : line;
      }
      if (fields.length >= 24) break;
    }
    if (chunk && fields.length < 25) {
      fields.push({ name: part === 1 ? "📋 All Cards" : `📋 (cont. ${part})`, value: chunk, inline: false });
    }

    const embed = new EmbedBuilder()
      .setTitle(`📦 ${target.username}'s Inventory`)
      .setColor(0x5865f2)
      .setDescription(
        `**${sorted.length}** unique · **${totalCards}** total` +
        (totalShinies > 0 ? ` · ${SHINY_EMOJI}**${totalShinies}** shiny` : ""),
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
    const cardType = card.cardType;
    const droppableCards = cards.filter(c => c.droppable);
    const totalWeight = droppableCards.reduce((s, c) => s + c.dropWeight, 0);
    const dropChance = card.droppable && totalWeight > 0 ? `~${((card.dropWeight / totalWeight) * 100).toFixed(2)}%` : "Event / Admin-drop only";

    const badges: string[] = [];
    if (card.isLimitedEdition) badges.push("💎 Limited Edition");
    if (card.isEventExclusive) badges.push("🎆 Event Exclusive");

    const infoSettings = await getOrCreateGuildSettings(guildId);
    const embed = new EmbedBuilder()
      .setTitle(`${rarityEmoji(rarity, infoSettings)} ${card.name}`)
      .setColor(rarityColor(rarity, infoSettings) ?? 0x7289da)
      .setDescription((card.description || "*No description.*") + (card.flavor ? `\n\n*${card.flavor}*` : ""))
      .addFields(
        { name: "Rarity", value: `${rarityEmoji(rarity, infoSettings)} ${rarityLabel(rarity, infoSettings)}`, inline: true },
        { name: "Type", value: `${getTypeEmoji(cardType)} ${card.cardType}`, inline: true },
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
    const rarityOrder: Rarity[] = ["mythic", "legendary", "epic", "rare", "uncommon", "common"];
    const listSettings = await getOrCreateGuildSettings(guildId);
    const byRarity: Record<string, typeof cards> = {};
    for (const card of cards) { if (!byRarity[card.rarity]) byRarity[card.rarity] = []; byRarity[card.rarity].push(card); }
    const fields = rarityOrder.filter(r => byRarity[r]?.length).map(r => ({
      name: `${rarityEmoji(r, listSettings)} ${rarityLabel(r, listSettings)} (${byRarity[r].length})`,
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

  // ── /catalog ──────────────────────────────────────────────────────────────────
  // Browse cards by category (rarity, event, limited, all) — shows what the
  // target owns vs what's missing. Single embed, paginated only by character
  // count via field splitting.
  if (sub === "catalog") {
    const category = interaction.options.getString("category", true) as Rarity | "event" | "limited" | "all";
    const target = interaction.options.getUser("user") ?? interaction.user;
    const [allCards, collection] = await Promise.all([
      getAllCards(),
      getUserCollection(guildId, target.id),
    ]);
    const ownedById = new Map<number, number>();
    for (const item of collection) ownedById.set(item.cardId, item.count);

    const catSettings = await getOrCreateGuildSettings(guildId);
    let pool = allCards.filter(c => !c.isArchived);
    let title = "";
    let color = 0x5865f2;
    let thumbnail: string | null = null;
    if (category === "event") {
      pool = pool.filter(c => c.isEventExclusive);
      title = "🎆 Event Exclusive Cards";
      color = 0xe84393;
    } else if (category === "limited") {
      pool = pool.filter(c => c.isLimitedEdition);
      title = "💎 Limited Edition Cards";
      color = 0x00d4ff;
    } else if (category === "all") {
      title = "🃏 Full Card Roster";
    } else {
      pool = pool.filter(c => c.rarity === category);
      title = `${rarityEmoji(category, catSettings)} ${rarityLabel(category, catSettings)} Cards`;
      color = rarityColor(category, catSettings) ?? 0x5865f2;
    }

    if (pool.length === 0) {
      await interaction.editReply(`No cards in this category yet.`);
      return;
    }

    // Pick a thumbnail: the rarest card the user owns from this pool, else
    // the rarest card in the pool, so the embed has a visual anchor.
    const rarityRank: Record<Rarity, number> = { common: 0, uncommon: 1, rare: 2, epic: 3, legendary: 4, mythic: 5 };
    const sortedByRarity = [...pool].sort((a, b) => rarityRank[b.rarity as Rarity] - rarityRank[a.rarity as Rarity]);
    const ownedRarest = sortedByRarity.find(c => ownedById.has(c.id));
    const thumbSource = ownedRarest ?? sortedByRarity[0];
    if (thumbSource) thumbnail = toAbsoluteImageUrl(thumbSource.imageUrl) ?? null;

    // Group: by rarity for event/limited/all, single group otherwise.
    const rarityOrder: Rarity[] = ["mythic", "legendary", "epic", "rare", "uncommon", "common"];
    const groups: { rarity: Rarity; cards: typeof pool }[] = [];
    if (category === "event" || category === "limited" || category === "all") {
      for (const r of rarityOrder) {
        const inRarity = pool.filter(c => c.rarity === r);
        if (inRarity.length > 0) groups.push({ rarity: r, cards: inRarity });
      }
    } else {
      groups.push({ rarity: category as Rarity, cards: pool });
    }

    const ownedCount = pool.filter(c => ownedById.has(c.id)).length;
    const totalCount = pool.length;
    const completion = totalCount > 0 ? Math.round((ownedCount / totalCount) * 100) : 0;

    // Build field per rarity group. Each line: "✅ ×3 Card Name" or "⬜ Card Name"
    // Discord caps field value at 1024 chars; split if needed.
    const fields: { name: string; value: string; inline: false }[] = [];
    for (const g of groups) {
      const lines = g.cards
        .slice()
        .sort((a, b) => a.name.localeCompare(b.name))
        .map(c => {
          const owned = ownedById.get(c.id) ?? 0;
          const badges = [c.isLimitedEdition ? "💎" : "", c.isEventExclusive ? "🎆" : ""].filter(Boolean).join("");
          return owned > 0
            ? `✅ \`×${owned}\` ${badges}**${c.name}**`
            : `⬜ ${badges}${c.name}`;
        });
      const groupName = `${rarityEmoji(g.rarity, catSettings)} ${rarityLabel(g.rarity, catSettings)} (${g.cards.filter(c => ownedById.has(c.id)).length}/${g.cards.length})`;
      const chunks: string[] = [];
      let current = "";
      for (const line of lines) {
        if (current.length + line.length + 1 > 1000) { chunks.push(current); current = ""; }
        current += (current ? "\n" : "") + line;
      }
      if (current) chunks.push(current);
      chunks.forEach((chunk, i) => fields.push({
        name: i === 0 ? groupName : `${groupName} (cont.)`,
        value: chunk,
        inline: false,
      }));
    }

    const isSelf = target.id === interaction.user.id;
    const embed = new EmbedBuilder()
      .setTitle(title)
      .setColor(color)
      .setDescription(
        `${isSelf ? "**You own**" : `**${target.username} owns**`} ` +
        `**${ownedCount} / ${totalCount}** cards in this category (${completion}%)\n` +
        `✅ owned  ·  ⬜ missing  ·  💎 limited  ·  🎆 event`,
      )
      .addFields(fields.slice(0, 25))
      .setFooter({ text: "Use /info name:<card> for full details on any card" });
    if (thumbnail) embed.setThumbnail(thumbnail);
    await interaction.editReply({ embeds: [embed] });
    return;
  }

  // ── /top ──────────────────────────────────────────────────────────────────────
  if (sub === "top") {
    const [byWorth, byCards, byPacks] = await Promise.all([
      getLeaderboard(guildId, "worth", 10),
      getLeaderboard(guildId, "cards", 5),
      getTopPackOpeners(guildId, 5),
    ]);
    if (byWorth.length === 0 && byPacks.length === 0) {
      await interaction.editReply("No one has caught any cards yet!");
      return;
    }
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
    const packLines = byPacks.length === 0
      ? ["*No packs opened yet — be the first with `/pack`!*"]
      : byPacks.map((r, i) => {
          const medal = medals[i] ?? `**${i + 1}.**`;
          return `${medal} <@${r.userId}> — **${r.packsOpened.toLocaleString()}** packs`;
        });
    const domain = process.env["REPLIT_DOMAINS"]?.split(",")[0];
    const dashUrl = domain ? `https://${domain}/leaderboard` : null;
    const embed = new EmbedBuilder()
      .setTitle("🏆 DN Cards — Collector Leaderboard")
      .setColor(0xf39c12)
      .addFields(
        { name: "💠 Top 10 by Net Worth", value: worthLines.length ? worthLines.join("\n") : "*No collectors yet.*" },
        { name: "🃏 Top 5 by Card Count", value: cardLines.length ? cardLines.join("\n") : "*No cards caught yet.*" },
        { name: "📦 Top 5 Pack Openers", value: packLines.join("\n") },
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
    const requested = interaction.options.getInteger("amount") ?? 1;
    const burnAll = interaction.options.getBoolean("all") ?? false;
    const wantShiny = interaction.options.getBoolean("shiny") ?? false;
    const card = await getCardByName(cardName);
    if (!card) { await interaction.editReply(`❌ "**${cardName}**" not found. Check \`/list\`.`); return; }
    const rarity = card.rarity as Rarity;
    const { count, shinyCount } = await getUserOwnedCount(guildId, interaction.user.id, card.id);
    // Burn targets the chosen pile only — shiny:true burns from shinyCount,
    // otherwise from the normal count pile. This protects rare shinies from
    // an accidental /burn name:X all:true.
    const pile = wantShiny ? shinyCount : count;
    const pileLabel = wantShiny ? `${SHINY_EMOJI} shiny ` : "";
    if (pile < 1) {
      await interaction.editReply(
        wantShiny
          ? `❌ You don't have any ${SHINY_EMOJI} shiny copies of **${card.name}**.`
          : `❌ You don't have **${card.name}** in your collection.${shinyCount > 0 ? `\n*(You have ${SHINY_EMOJI}×${shinyCount} shiny — add \`shiny:true\` to burn those.)*` : ""}`,
      );
      return;
    }
    const toBurn = burnAll ? pile : Math.min(requested, pile);
    if (toBurn < 1) {
      await interaction.editReply(`❌ Nothing to burn — you only have **×${pile}** ${pileLabel}of **${card.name}**.`);
      return;
    }
    if (!burnAll && requested > pile) {
      await interaction.editReply(
        `❌ You only have **×${pile}** ${pileLabel}of **${card.name}** — can't burn ${requested}.\n` +
        `Try \`/burn name:${card.name}${wantShiny ? " shiny:true" : ""} all:true\` to burn all ${pile}.`,
      );
      return;
    }
    const result = await burnCard(guildId, interaction.user.id, card.id, toBurn, { shiny: wantShiny });
    if (!result.success) {
      await interaction.editReply(`❌ Burn failed — your collection changed mid-burn. Try again.`);
      return;
    }
    const currency = await getOrCreateCurrency(guildId, interaction.user.id);
    const perCardVal = card.burnValue * (wantShiny ? SHINY_MULTIPLIER : 1);
    const perCard = perCardVal.toLocaleString();
    const nameWithShiny = wantShiny ? `${SHINY_EMOJI} ${card.name}` : card.name;
    const breakdown = result.burned > 1
      ? `🔥 Burned **×${result.burned} ${nameWithShiny}** (${RARITY_EMOJI[rarity]} ${RARITY_LABELS[rarity]}${wantShiny ? ` ${SHINY_EMOJI}` : ""})\n` +
        `+💠 **${result.shardsGained.toLocaleString()} shards** *(${perCard} × ${result.burned})* — New balance: **${currency.shards.toLocaleString()}**\n` +
        (result.remaining > 0 ? `You still have **×${result.remaining}** ${pileLabel}${result.remaining === 1 ? "copy" : "copies"}.` : `*All ${wantShiny ? "shiny " : ""}copies burned.*`)
      : `🔥 Burned **${nameWithShiny}** (${RARITY_EMOJI[rarity]} ${RARITY_LABELS[rarity]}${wantShiny ? ` ${SHINY_EMOJI}` : ""})\n` +
        `+💠 **${result.shardsGained.toLocaleString()} shards** — New balance: **${currency.shards.toLocaleString()}**\n` +
        (result.remaining > 0 ? `You still have **×${result.remaining}** ${pileLabel}${result.remaining === 1 ? "copy" : "copies"}.` : `*Last ${wantShiny ? "shiny " : ""}copy burned.*`);
    await interaction.editReply(breakdown);
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
  if (sub === "tradehistory") { await handleTradeHistory(interaction); return; }
  if (sub === "daily") { await handleDaily(interaction); return; }
  if (sub === "pack") { await handlePack(interaction); return; }
  if (sub === "packstats") { await handlePackStats(interaction); return; }
  if (sub === "tradein") { await handleTradein(interaction); return; }
  if (sub === "wishlist") { await handleWishlist(interaction); return; }
  if (sub === "gift") { await handleGift(interaction); return; }
  // /welcome posts publicly (no flags) so it can be used as a server welcome
  // message — we still deferReply'd above without ephemeral flag.
  if (sub === "welcome") { await handleWelcome(interaction); return; }
  if (sub === "achievements") { await handleAchievementsCommand(interaction); return; }

  // ── /help (player commands only — admins use /adminhelp) ─────────────────────
  const embed = new EmbedBuilder()
    .setTitle("🃏 DN Cards — Player Commands")
    .setColor(0x5865f2)
    .setDescription(
      "When a card spawns in the drop channel, **type its name exactly** to catch it!\n" +
      "Most card-name fields **autocomplete** as you type — pick from the dropdown.\n\n" +
      "👋 New here? Run `/welcome` for the full game intro.\n" +
      "Admins: use `/adminhelp` for setup, drops, and config commands.",
    )
    .addFields(
      {
        name: "📦 Collection",
        value:
          "`/collection [user]` — see what you've caught\n" +
          "`/rank [user]` — your collector rank & progression\n" +
          "`/info name:<card>` — card details, worth & drop chance\n" +
          "`/list` — full roster grouped by rarity\n" +
          "`/catalog category:<rarity|event|limited|all>` — browse by category\n" +
          "`/top` — leaderboard by net worth\n" +
          "`/achievements [user]` — your unlocked badges",
      },
      {
        name: "🔥 Economy *(private replies)*",
        value:
          "`/burn name:<card> [amount] [all] [shiny:true]` — destroy duplicates for 💠 (shiny burns the ✨ pile at 2×)\n" +
          "`/shards [user]` — check 💠 balance\n" +
          "`/daily` — claim daily shards (streak bonus!)\n" +
          "`/pack tier:<basic|premium|legendary>` — open a 5-card pack (💠 250 / 750 / 2,000)\n" +
          "`/packstats` — your costs, weekly caps, cooldown\n" +
          "`/tradein rarity:<r>` — burn 5 to roll 1 from the next tier\n" +
          "`/gift user:@Member amount:<n>` — send 💠 to a friend",
      },
      {
        name: "🔄 Trading",
        value:
          "`/trade user:@Member offer:<card> want:<card>` — propose a trade\n" +
          "Add `offer_shards:<n>` or `want_shards:<n>` to mix in 💠 (or trade pure shards)\n" +
          "Trades with a value gap >3:1 show an orange ⚠️ warning — informational only\n" +
          "`/trades` · `/tradehistory [user]` · `/accept id:<n>` · `/decline id:<n>` — manage offers\n" +
          "Accept/Decline buttons also appear right on the trade message",
      },
      {
        name: "✨ Shinies",
        value:
          "Every random catch, pack pull, and trade-in has a flat **0.5%** chance to mint a shiny.\n" +
          "Shinies are tracked separately and count at **2× worth & burn**.\n" +
          "Not tradeable in v1 — trades only move standard copies.",
      },
      {
        name: "📌 Wishlist",
        value:
          "`/wishlist add name:<card>` — get pinged when it spawns\n" +
          "`/wishlist remove name:<card>` · `/wishlist list [user]`",
      },
    );
  await interaction.editReply({ embeds: [embed] });
}
