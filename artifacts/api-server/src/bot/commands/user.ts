import type { ChatInputCommandInteraction } from "discord.js";
import { EmbedBuilder, MessageFlags } from "discord.js";

// Commands whose results are personal/spammy and should only be seen by the user.
const EPHEMERAL_COMMANDS = new Set(["burn", "shards", "trades", "tradehistory", "help", "daily", "achievements", "pack", "packstats", "wishlist", "gift", "tradein", "sets"]);
import {
  getUserCollection, getAllCards, getLeaderboard, getTopPackOpeners,
  getOrCreateCurrency, burnCard, getCardByName, getUserCardCount, getUserOwnedCount,
  getOrCreateGuildSettings,
  getRarityContext, applyRarityContextAll,
  effectiveRarityKey, getCardDisplayRarity, getDisplayRarities,
  getRarityDisplayOverrides,
  getGuildDropChanceRuntime,
} from "../db.js";
import {
  RARITY_COLORS, RARITY_EMOJI, RARITY_LABELS, getTypeEmoji,
  SHINY_EMOJI, SHINY_MULTIPLIER,
  getCollectorRank, getNextRank,
  rarityLabel, rarityEmoji, rarityColor,
  type Rarity, type RarityDisplayMap,
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
import { runPaginator, type PaginatorView } from "../components/paginator.js";
import { chunkLines } from "../components/field-chunker.js";

// Display order for rarity drill-downs (rarest → most common). Used by the
// paginated /collection, /list, and /catalog views.
const RARITY_ORDER: Rarity[] = ["mythic", "legendary", "epic", "rare", "uncommon", "common"];

// Pick the most evocative image from a set of cards — highest worthValue wins,
// ties broken by name for stability. Returns the first absolute URL we can build;
// skips entries without a usable imageUrl. Returns null if nothing is usable.
function pickRarestImage<T extends { worthValue: number; name: string; imageUrl: string | null }>(
  cards: T[],
): string | null {
  const sorted = cards
    .slice()
    .sort((a, b) => b.worthValue - a.worthValue || a.name.localeCompare(b.name));
  for (const c of sorted) {
    const url = toAbsoluteImageUrl(c.imageUrl);
    if (url) return url;
  }
  return null;
}

// Pack pre-chunked fields into multiple embed screens. Returns at least one
// screen even when there are zero fields (so the embed header still renders).
function buildEmbedScreens(
  baseEmbed: () => EmbedBuilder,
  fields: { name: string; value: string; inline: false }[],
  fieldsPerScreen = 24,
): EmbedBuilder[] {
  if (fields.length === 0) return [baseEmbed()];
  const screens: EmbedBuilder[] = [];
  for (let i = 0; i < fields.length; i += fieldsPerScreen) {
    screens.push(baseEmbed().addFields(fields.slice(i, i + fieldsPerScreen)));
  }
  return screens;
}

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
  // Interactive overview → drill-down view (rarity / shinies / limited / event).
  // Locked to the invoking user; 5-min idle timeout. See components/paginator.ts.
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

    const [settings, displayMap, collectionCtx] = await Promise.all([
      getOrCreateGuildSettings(guildId),
      getRarityDisplayOverrides(guildId),
      getRarityContext(guildId),
    ]);
    const collectionLadder = getDisplayRarities(collectionCtx, settings, { displayMap });
    const byRarity = new Map<string, typeof items>();
    for (const tier of collectionLadder) byRarity.set(tier.key, []);
    for (const item of items) {
      const key = effectiveRarityKey(item, collectionCtx);
      (byRarity.get(key) ?? byRarity.set(key, []).get(key)!).push(item);
    }

    const totalCards = items.reduce((s, i) => s + i.count + i.shinyCount, 0);
    const totalShinies = items.reduce((s, i) => s + i.shinyCount, 0);
    const netWorth = items.reduce(
      (s, i) => s + i.worthValue * (i.count + i.shinyCount * SHINY_MULTIPLIER),
      0,
    );
    const unique = items.length;
    const rank = getCollectorRank(unique);
    const nextRank = getNextRank(unique);
    const rankProgress = nextRank
      ? `${rank.emoji} **${rank.name}** → ${nextRank.emoji} ${nextRank.name}  ·  ${unique}/${nextRank.min} unique (${nextRank.min - unique} to go)`
      : `${rank.emoji} **${rank.name}**  ·  *MAX RANK*`;

    // Leaderboard placement on BOTH ladders (net worth + total cards). Pull a
    // wide slice so almost any active member finds themselves; if not present
    // we say "unranked".
    const [unlockedKeys, recentKeys, worthBoard, cardsBoard] = await Promise.all([
      getUnlockedKeys(guildId, target.id),
      getRecentUnlocks(guildId, target.id, 6),
      getLeaderboard(guildId, "worth", 1000),
      getLeaderboard(guildId, "cards", 1000),
    ]);
    const worthIdx = worthBoard.findIndex(r => r.userId === target.id);
    const cardsIdx = cardsBoard.findIndex(r => r.userId === target.id);
    const fmtRank = (idx: number, total: number) =>
      idx >= 0 ? `#${idx + 1} of ${total}` : "unranked";
    const lbLine =
      `**🏅 Leaderboard:** 💠 ${fmtRank(worthIdx, worthBoard.length)} by worth · ` +
      `🃏 ${fmtRank(cardsIdx, cardsBoard.length)} by cards`;
    const achStrip = recentKeys.length > 0
      ? recentKeys.map(k => getAchievement(k)?.emoji ?? "•").join(" ")
      : "_none yet_";
    const achLine = `**🏆 Achievements:** ${unlockedKeys.size} / ${ACHIEVEMENTS.length} · ${achStrip}`;

    // ── Overview screen ──
    const overview = new EmbedBuilder()
      .setTitle(`🃏 ${target.username}'s DN Collection`)
      .setColor(0x5865f2)
      .setThumbnail(target.displayAvatarURL())
      .setDescription(
        rankProgress + "\n" +
        `**🃏 Cards:** ${unique} unique · ${totalCards} total` +
        (totalShinies > 0 ? ` · ${SHINY_EMOJI} **${totalShinies}** shiny` : "") + "\n" +
        `**💠 Net Worth:** ${netWorth.toLocaleString()} shards\n` +
        lbLine + "\n" +
        achLine,
      )
      .setFooter({ text: "Use the menu below to drill into rarities, shinies, limited & event cards" });

    const views: PaginatorView[] = [{
      key: "overview",
      label: "Overview",
      emoji: "🏠",
      description: "Rank, totals, leaderboard & achievements",
      screens: [overview],
    }];

    // ── Shinies view ──
    if (totalShinies > 0) {
      const shinyItems = items.filter(i => i.shinyCount > 0);
      const shinyLines: string[] = [];
      for (const tier of collectionLadder) {
        const inR = shinyItems.filter(i => effectiveRarityKey(i, collectionCtx) === tier.key);
        if (inR.length === 0) continue;
        shinyLines.push(`__${tier.emoji} ${tier.label}__`);
        for (const i of inR) shinyLines.push(`${SHINY_EMOJI} **${i.name}** ×${i.shinyCount}`);
      }
      const shinyWorth = shinyItems.reduce(
        (s, i) => s + i.shinyCount * i.worthValue * SHINY_MULTIPLIER, 0,
      );
      const baseShiny = () => new EmbedBuilder()
        .setTitle(`${SHINY_EMOJI} ${target.username}'s Shinies`)
        .setColor(0xf5c518)
        .setThumbnail(target.displayAvatarURL())
        .setDescription(
          `**${totalShinies}** shiny ${totalShinies === 1 ? "copy" : "copies"} across **${shinyItems.length}** card${shinyItems.length === 1 ? "" : "s"}\n` +
          `Worth **💠 ${shinyWorth.toLocaleString()}** at ${SHINY_MULTIPLIER}× multiplier`,
        );
      const { fields } = chunkLines(shinyLines, { baseName: "Shinies", maxFields: 1000 });
      views.push({
        key: "shinies",
        label: "Shinies",
        emoji: "✨",
        description: `${totalShinies} shiny ${totalShinies === 1 ? "copy" : "copies"}`,
        screens: buildEmbedScreens(baseShiny, fields),
      });
    }

    // ── Per-rarity views (only rarities user actually owns) ──
    for (const tier of collectionLadder) {
      const group = byRarity.get(tier.key);
      if (!group || group.length === 0) continue;
      const groupTotal = group.reduce((s, i) => s + i.count + i.shinyCount, 0);
      const groupShinies = group.reduce((s, i) => s + i.shinyCount, 0);
      const lines = group
        .slice()
        .sort((a, b) => b.worthValue - a.worthValue || a.name.localeCompare(b.name))
        .map(i => {
          const badges = [i.isLimitedEdition ? "💎" : "", i.isEventExclusive ? "🎆" : ""].filter(Boolean).join("");
          const shinyTag = i.shinyCount > 0 ? ` · ${SHINY_EMOJI}×${i.shinyCount}` : "";
          return `${badges}**${i.name}** ×${i.count}${shinyTag}`;
        });
      const rarityImg = pickRarestImage(group);
      const baseRarity = () => {
        const e = new EmbedBuilder()
          .setTitle(`${tier.emoji} ${tier.label} — ${target.username}`)
          .setColor(tier.color)
          .setThumbnail(rarityImg ?? target.displayAvatarURL())
          .setDescription(
            `**${group.length}** unique · **${groupTotal}** total` +
            (groupShinies > 0 ? ` · ${SHINY_EMOJI}**${groupShinies}** shiny` : ""),
          );
        return e;
      };
      const { fields } = chunkLines(lines, { baseName: "Cards", maxFields: 1000 });
      views.push({
        key: `rarity:${tier.key}`,
        label: tier.label,
        emoji: tier.emoji,
        description: `${group.length} unique · ${groupTotal} total`,
        screens: buildEmbedScreens(baseRarity, fields),
      });
    }

    // ── Limited view ──
    const limitedItems = items.filter(i => i.isLimitedEdition);
    if (limitedItems.length > 0) {
      const lines = limitedItems
        .slice()
        .sort((a, b) => b.worthValue - a.worthValue || a.name.localeCompare(b.name))
        .map(i => {
          const shinyTag = i.shinyCount > 0 ? ` · ${SHINY_EMOJI}×${i.shinyCount}` : "";
          const tier = getCardDisplayRarity(i, collectionCtx, settings, displayMap);
          return `${tier.emoji} **${i.name}** ×${i.count}${shinyTag}`;
        });
      const limImg = pickRarestImage(limitedItems);
      const baseLim = () => new EmbedBuilder()
        .setTitle(`💎 ${target.username}'s Limited Edition`)
        .setColor(0x00d4ff)
        .setThumbnail(limImg ?? target.displayAvatarURL())
        .setDescription(`**${limitedItems.length}** unique limited-edition card${limitedItems.length === 1 ? "" : "s"}`);
      const { fields } = chunkLines(lines, { baseName: "Limited", maxFields: 1000 });
      views.push({
        key: "limited",
        label: "Limited",
        emoji: "💎",
        description: `${limitedItems.length} limited card${limitedItems.length === 1 ? "" : "s"}`,
        screens: buildEmbedScreens(baseLim, fields),
      });
    }

    // ── Event view ──
    const eventItems = items.filter(i => i.isEventExclusive);
    if (eventItems.length > 0) {
      const lines = eventItems
        .slice()
        .sort((a, b) => b.worthValue - a.worthValue || a.name.localeCompare(b.name))
        .map(i => {
          const shinyTag = i.shinyCount > 0 ? ` · ${SHINY_EMOJI}×${i.shinyCount}` : "";
          const tier = getCardDisplayRarity(i, collectionCtx, settings, displayMap);
          return `${tier.emoji} **${i.name}** ×${i.count}${shinyTag}`;
        });
      const evImg = pickRarestImage(eventItems);
      const baseEv = () => new EmbedBuilder()
        .setTitle(`🎆 ${target.username}'s Event Exclusives`)
        .setColor(0xe84393)
        .setThumbnail(evImg ?? target.displayAvatarURL())
        .setDescription(`**${eventItems.length}** unique event-exclusive card${eventItems.length === 1 ? "" : "s"}`);
      const { fields } = chunkLines(lines, { baseName: "Event", maxFields: 1000 });
      views.push({
        key: "event",
        label: "Event",
        emoji: "🎆",
        description: `${eventItems.length} event card${eventItems.length === 1 ? "" : "s"}`,
        screens: buildEmbedScreens(baseEv, fields),
      });
    }

    await runPaginator({
      interaction,
      views,
      ownerId: interaction.user.id,
    });
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
    const [rawCards, runtime, infoDisplayMap] = await Promise.all([
      getAllCards(),
      getGuildDropChanceRuntime(guildId),
      getRarityDisplayOverrides(guildId),
    ]);
    const { ctx, settings: infoSettings, spawnPool, chanceSummary } = runtime;
    const cards = applyRarityContextAll(rawCards, ctx);
    const card = cards.find(c => c.name.toLowerCase() === cardName.toLowerCase());
    if (!card) { await interaction.editReply(`❌ "**${cardName}**" not found. Try \`/list\`.`); return; }

    const cardType = card.cardType;
    const cardChance = chanceSummary.cardPercentById.get(card.id);
    const dropChance = cardChance != null
      ? `~${cardChance.toFixed(2)}%`
      : spawnPool.cards.length === 0
        ? "Random spawns disabled"
        : "Not in active random pool";

    const badges: string[] = [];
    if (card.isLimitedEdition) badges.push("💎 Limited Edition");
    if (card.isEventExclusive) badges.push("🎆 Event Exclusive");
    // Display the EFFECTIVE tier (custom slug if assigned, else built-in).
    const ladder = getDisplayRarities(ctx, infoSettings, { displayMap: infoDisplayMap });
    const effKey = effectiveRarityKey(card, ctx);
    const tier = ladder.find(t => t.key === effKey)
      ?? ladder.find(t => t.key === card.rarity)!;
    const embed = new EmbedBuilder()
      .setTitle(`${tier.emoji} ${card.name}`)
      .setColor(tier.color ?? 0x7289da)
      .setDescription((card.description || "*No description.*") + (card.flavor ? `\n\n*${card.flavor}*` : ""))
      .addFields(
        { name: "Rarity", value: `${tier.emoji} ${tier.label}`, inline: true },
        { name: "Type", value: `${getTypeEmoji(cardType)} ${card.cardType}`, inline: true },
        { name: "Drop Chance", value: dropChance, inline: true },
        { name: "💠 Worth", value: `${card.worthValue.toLocaleString()} shards`, inline: true },
        { name: "🔥 Burn Value", value: `${card.burnValue.toLocaleString()} shards`, inline: true },
        { name: "Total Caught", value: card.totalMinted.toLocaleString(), inline: true },
      );
    if (card.maxCopies) embed.addFields({ name: "📦 Copies", value: `${card.totalMinted} / ${card.maxCopies}`, inline: true });
    if (badges.length > 0) embed.addFields({ name: "Special", value: badges.join(" · "), inline: false });

    // Active-set badge: tell the user whether this card is currently in the
    // rotation that random spawns pull from. If no active set is selected,
    // surface that too so the dropChance number isn't misleading.
    try {
      const { getActiveSet, isCardInSet } = await import("../db.js");
      const active = await getActiveSet(guildId);
      if (!active) {
        embed.addFields({ name: "📦 Active Set", value: "_None selected — random spawns are disabled._", inline: false });
      } else {
        const inSet = await isCardInSet(active.id, card.id);
        embed.addFields({
          name: "📦 Active Set",
          value: inSet
            ? `✅ In \`${active.name}\` — can spawn randomly.`
            : `⚠️ Not in \`${active.name}\` — admin-drop only until added.`,
          inline: false,
        });
      }
    } catch { /* non-fatal — skip badge */ }
    { const img = toAbsoluteImageUrl(card.imageUrl); if (img) embed.setImage(img); }
    await interaction.editReply({ embeds: [embed] });
    return;
  }

  // ── /list ─────────────────────────────────────────────────────────────────────
  // Interactive overview → drill-down view of the full roster (no personal
  // stats). Same paginator as /collection and /catalog.
  if (sub === "list") {
    const [rawCards, runtime, listDisplayMap] = await Promise.all([
      getAllCards(),
      getGuildDropChanceRuntime(guildId),
      getRarityDisplayOverrides(guildId),
    ]);
    const { ctx: listCtx, settings: listSettings, spawnPool, chanceSummary } = runtime;
    const cards = applyRarityContextAll(rawCards, listCtx);
    if (cards.length === 0) { await interaction.editReply("No cards in the pool yet."); return; }

    // Group by EFFECTIVE rarity key (built-in OR custom slug), walking the
    // per-guild ladder so custom tiers slot in at their position.
    const ladder = getDisplayRarities(listCtx, listSettings, { displayMap: listDisplayMap }); // rarest first
    const byKey = new Map<string, typeof cards>();
    for (const t of ladder) byKey.set(t.key, []);
    for (const c of cards) {
      const k = effectiveRarityKey(c, listCtx);
      const bucket = byKey.get(k) ?? [];
      bucket.push(c);
      byKey.set(k, bucket);
    }

    const limitedCards = cards.filter(c => c.isLimitedEdition);
    const eventCards = cards.filter(c => c.isEventExclusive);
    const adminOnlyCount = cards.filter(c => !c.droppable).length;

    // Aggregate drop-chance share per tier from the active spawn pool using
    // the same resolver as the spawn engine. No active set means no visible
    // random-spawn percentages, matching actual bot behavior.
    const tierShare = (key: string) => chanceSummary.rarityPercentByKey.get(key) ?? 0;

    // ── Overview ──
    const overviewLines: string[] = [];
    for (const t of ladder) {
      const g = byKey.get(t.key) ?? [];
      if (g.length === 0) continue;
      const share = tierShare(t.key);
      const shareLabel = share === 0 ? (spawnPool.cards.length === 0 ? "_spawns disabled_" : "_admin-drop only_") : `${share.toFixed(share < 1 ? 2 : 1)}%`;
      overviewLines.push(`${t.emoji} **${t.label}** — ${g.length} · 🎲 ${shareLabel}`);
    }
    const overview = new EmbedBuilder()
      .setTitle("🃏 DN Cards — Full Roster")
      .setColor(0x5865f2)
      .setDescription(
        `**${cards.length}** cards in the pool\n\n` +
        overviewLines.join("\n") + "\n\n" +
        (limitedCards.length > 0 ? `💎 **Limited Edition:** ${limitedCards.length}\n` : "") +
        (eventCards.length > 0 ? `🎆 **Event Exclusive:** ${eventCards.length}\n` : "") +
        (adminOnlyCount > 0 ? `🔒 **Admin-drop only:** ${adminOnlyCount}\n` : "") +
        `\n_Legend:_ 💎 limited · 🎆 event · 🔒 admin-drop only`,
      )
      .setFooter({ text: "Use the menu below to view cards in any rarity or category" });

    const views: PaginatorView[] = [{
      key: "overview",
      label: "Overview",
      emoji: "🏠",
      description: "Roster summary",
      screens: [overview],
    }];

    for (const t of ladder) {
      const group = byKey.get(t.key);
      if (!group || group.length === 0) continue;
      const lines = group
        .slice()
        .sort((a, b) => a.name.localeCompare(b.name))
        .map(c => {
          const b = [c.isLimitedEdition ? "💎" : "", c.isEventExclusive ? "🎆" : "", !c.droppable ? "🔒" : ""].filter(Boolean).join("");
          return `${b}${c.name}`;
        });
      const rarityImg = pickRarestImage(group);
      const baseRarity = () => {
        const e = new EmbedBuilder()
          .setTitle(`${t.emoji} ${t.label} Roster`)
          .setColor(t.color)
          .setDescription(`**${group.length}** card${group.length === 1 ? "" : "s"} in this rarity`);
        if (rarityImg) e.setThumbnail(rarityImg);
        return e;
      };
      const { fields } = chunkLines(lines, { baseName: "Cards", separator: ", ", maxFields: 1000 });
      views.push({
        key: `rarity:${t.key}`,
        label: t.label,
        emoji: t.emoji,
        description: `${group.length} card${group.length === 1 ? "" : "s"}`,
        screens: buildEmbedScreens(baseRarity, fields),
      });
    }

    if (limitedCards.length > 0) {
      const lines = limitedCards
        .slice()
        .sort((a, b) => a.name.localeCompare(b.name))
        .map(c => {
          const tier = getCardDisplayRarity(c, listCtx, listSettings, listDisplayMap);
          return `${tier.emoji} ${c.name}` + (c.maxCopies ? ` *(${c.totalMinted}/${c.maxCopies})*` : "");
        });
      const limImg = pickRarestImage(limitedCards);
      const baseLim = () => {
        const e = new EmbedBuilder()
          .setTitle("💎 Limited Edition Cards")
          .setColor(0x00d4ff)
          .setDescription(`**${limitedCards.length}** capped-supply card${limitedCards.length === 1 ? "" : "s"}`);
        if (limImg) e.setThumbnail(limImg);
        return e;
      };
      const { fields } = chunkLines(lines, { baseName: "Limited", maxFields: 1000 });
      views.push({
        key: "limited",
        label: "Limited",
        emoji: "💎",
        description: `${limitedCards.length} limited card${limitedCards.length === 1 ? "" : "s"}`,
        screens: buildEmbedScreens(baseLim, fields),
      });
    }

    if (eventCards.length > 0) {
      const lines = eventCards
        .slice()
        .sort((a, b) => a.name.localeCompare(b.name))
        .map(c => {
          const tier = getCardDisplayRarity(c, listCtx, listSettings, listDisplayMap);
          return `${tier.emoji} ${c.name}`;
        });
      const evImg = pickRarestImage(eventCards);
      const baseEv = () => {
        const e = new EmbedBuilder()
          .setTitle("🎆 Event Exclusive Cards")
          .setColor(0xe84393)
          .setDescription(`**${eventCards.length}** admin-drop-only event card${eventCards.length === 1 ? "" : "s"}`);
        if (evImg) e.setThumbnail(evImg);
        return e;
      };
      const { fields } = chunkLines(lines, { baseName: "Event", maxFields: 1000 });
      views.push({
        key: "event",
        label: "Event",
        emoji: "🎆",
        description: `${eventCards.length} event card${eventCards.length === 1 ? "" : "s"}`,
        screens: buildEmbedScreens(baseEv, fields),
      });
    }

    await runPaginator({
      interaction,
      views,
      ownerId: interaction.user.id,
    });
    return;
  }

  // ── /catalog ──────────────────────────────────────────────────────────────────
  // Interactive overview → drill-down view of ownership vs the full pool.
  // The optional `category` option deep-links straight into a specific view.
  if (sub === "catalog") {
    const category = interaction.options.getString("category") as Rarity | "event" | "limited" | "all" | null;
    const target = interaction.options.getUser("user") ?? interaction.user;
    const [allCards, collection] = await Promise.all([
      getAllCards(),
      getUserCollection(guildId, target.id),
    ]);
    const ownedById = new Map<number, number>();
    for (const item of collection) ownedById.set(item.cardId, item.count + item.shinyCount);

    const [catSettings, catDisplayMap, catCtx] = await Promise.all([
      getOrCreateGuildSettings(guildId),
      getRarityDisplayOverrides(guildId),
      getRarityContext(guildId),
    ]);
    const pool = allCards.filter(c => !c.isArchived);
    if (pool.length === 0) { await interaction.editReply("No cards in the pool yet."); return; }

    const isSelf = target.id === interaction.user.id;
    const ownerLabel = isSelf ? "You" : `**${target.username}**`;
    const possessive = isSelf ? "your" : `${target.username}'s`;

    // Group by EFFECTIVE rarity key so custom-tier cards show up under their
    // custom tier instead of their built-in rarity bucket.
    const catLadder = getDisplayRarities(catCtx, catSettings, { displayMap: catDisplayMap });
    const byKey = new Map<string, typeof pool>();
    for (const t of catLadder) byKey.set(t.key, []);
    for (const c of pool) {
      const k = effectiveRarityKey(c, catCtx);
      (byKey.get(k) ?? byKey.set(k, []).get(k)!).push(c);
    }

    const completion = (cards: typeof pool) => {
      const owned = cards.filter(c => ownedById.has(c.id)).length;
      const total = cards.length;
      const pct = total > 0 ? Math.round((owned / total) * 100) : 0;
      return { owned, total, pct };
    };

    // ── Overview ──
    const overviewLines: string[] = [];
    for (const t of catLadder) {
      const g = byKey.get(t.key);
      if (!g || g.length === 0) continue;
      const { owned, total, pct } = completion(g);
      overviewLines.push(`${t.emoji} **${t.label}** — ${owned}/${total} (${pct}%)`);
    }
    const limitedCards = pool.filter(c => c.isLimitedEdition);
    const eventCards = pool.filter(c => c.isEventExclusive);
    if (limitedCards.length > 0) {
      const { owned, total, pct } = completion(limitedCards);
      overviewLines.push(`💎 **Limited** — ${owned}/${total} (${pct}%)`);
    }
    if (eventCards.length > 0) {
      const { owned, total, pct } = completion(eventCards);
      overviewLines.push(`🎆 **Event** — ${owned}/${total} (${pct}%)`);
    }
    const overall = completion(pool);

    const overview = new EmbedBuilder()
      .setTitle(`🃏 ${target.username}'s DN Catalog`)
      .setColor(0x5865f2)
      .setThumbnail(target.displayAvatarURL())
      .setDescription(
        `${ownerLabel} own **${overall.owned} / ${overall.total}** cards in the pool (${overall.pct}%)\n\n` +
        overviewLines.join("\n") + "\n\n" +
        `_Pick a category from the menu below to see ✅ owned vs ⬜ missing._`,
      )
      .setFooter({ text: "Use /info name:<card> for full details on any card" });

    const views: PaginatorView[] = [{
      key: "overview",
      label: "Overview",
      emoji: "🏠",
      description: `${overall.pct}% complete`,
      screens: [overview],
    }];

    const buildCatalogView = (
      key: string,
      label: string,
      emoji: string,
      color: number,
      title: string,
      groupOrder: { label: string; emoji: string; cards: typeof pool }[],
    ): PaginatorView => {
      // Prefer the rarest OWNED card in this category as the thumbnail; if none
      // owned (or none have a usable image), fall back to the rarest in pool.
      const allInView = groupOrder.flatMap(g => g.cards);
      const ownedInView = allInView.filter(c => ownedById.has(c.id));
      const thumb = pickRarestImage(ownedInView) ?? pickRarestImage(allInView);
      const ownedN = groupOrder.reduce((s, g) => s + g.cards.filter(c => ownedById.has(c.id)).length, 0);
      const totalN = groupOrder.reduce((s, g) => s + g.cards.length, 0);
      const pct = totalN > 0 ? Math.round((ownedN / totalN) * 100) : 0;
      const allFields: { name: string; value: string; inline: false }[] = [];
      for (const g of groupOrder) {
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
        const groupOwned = g.cards.filter(c => ownedById.has(c.id)).length;
        const groupName = `${g.emoji} ${g.label} (${groupOwned}/${g.cards.length})`;
        const { fields } = chunkLines(lines, { baseName: groupName, maxFields: 1000 });
        allFields.push(...fields);
      }
      const base = () => {
        const e = new EmbedBuilder()
          .setTitle(title)
          .setColor(color)
          .setDescription(
            `${ownerLabel} own **${ownedN} / ${totalN}** in this category (${pct}%)\n` +
            `✅ owned  ·  ⬜ missing  ·  💎 limited  ·  🎆 event`,
          )
          .setFooter({ text: "Use /info name:<card> for full details on any card" });
        if (thumb) e.setThumbnail(thumb);
        return e;
      };
      return {
        key,
        label,
        emoji,
        description: `${ownedN}/${totalN} owned (${pct}%)`,
        screens: buildEmbedScreens(base, allFields),
      };
    };

    for (const t of catLadder) {
      const g = byKey.get(t.key);
      if (!g || g.length === 0) continue;
      views.push(buildCatalogView(
        `rarity:${t.key}`,
        t.label,
        t.emoji,
        t.color,
        `${t.emoji} ${t.label} — ${possessive} catalog`,
        [{ label: t.label, emoji: t.emoji, cards: g }],
      ));
    }

    if (limitedCards.length > 0) {
      const groups: { label: string; emoji: string; cards: typeof pool }[] = [];
      for (const t of catLadder) {
        const inR = limitedCards.filter(c => effectiveRarityKey(c, catCtx) === t.key);
        if (inR.length > 0) groups.push({ label: t.label, emoji: t.emoji, cards: inR });
      }
      views.push(buildCatalogView(
        "limited", "Limited", "💎", 0x00d4ff,
        `💎 Limited Edition — ${possessive} catalog`,
        groups,
      ));
    }

    if (eventCards.length > 0) {
      const groups: { label: string; emoji: string; cards: typeof pool }[] = [];
      for (const t of catLadder) {
        const inR = eventCards.filter(c => effectiveRarityKey(c, catCtx) === t.key);
        if (inR.length > 0) groups.push({ label: t.label, emoji: t.emoji, cards: inR });
      }
      views.push(buildCatalogView(
        "event", "Event", "🎆", 0xe84393,
        `🎆 Event Exclusive — ${possessive} catalog`,
        groups,
      ));
    }

    // Map the `category` option to an initial view key (deep-link). "all"
    // and null both start at the overview. Built-in category strings map to
    // built-in ladder keys 1:1.
    let initialKey: string | undefined;
    if (category && category !== "all") {
      initialKey = (category === "event" || category === "limited") ? category : `rarity:${category}`;
    }

    await runPaginator({
      interaction,
      views,
      ownerId: interaction.user.id,
      ...(initialKey ? { initialKey } : {}),
    });
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
    const [burnSettings, burnDisplayMap] = await Promise.all([
      getOrCreateGuildSettings(guildId),
      getRarityDisplayOverrides(guildId),
    ]);
    const rEmoji = rarityEmoji(rarity, burnSettings, burnDisplayMap);
    const rLabel = rarityLabel(rarity, burnSettings, burnDisplayMap);
    const breakdown = result.burned > 1
      ? `🔥 Burned **×${result.burned} ${nameWithShiny}** (${rEmoji} ${rLabel}${wantShiny ? ` ${SHINY_EMOJI}` : ""})\n` +
        `+💠 **${result.shardsGained.toLocaleString()} shards** *(${perCard} × ${result.burned})* — New balance: **${currency.shards.toLocaleString()}**\n` +
        (result.remaining > 0 ? `You still have **×${result.remaining}** ${pileLabel}${result.remaining === 1 ? "copy" : "copies"}.` : `*All ${wantShiny ? "shiny " : ""}copies burned.*`)
      : `🔥 Burned **${nameWithShiny}** (${rEmoji} ${rLabel}${wantShiny ? ` ${SHINY_EMOJI}` : ""})\n` +
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

  // ── /sets (read-only set browser) ─────────────────────────────────────────
  if (sub === "sets") {
    const { handleSetsUserCommand } = await import("./sets-user.js");
    await handleSetsUserCommand(interaction);
    return;
  }
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
      {
        name: "🗂️ Card Sets",
        value:
          "`/sets list` — see all sets and how many cards are in each\n" +
          "`/sets active` — which set is currently spawning cards\n" +
          "`/sets view set:<…>` — browse cards in a set\n" +
          "`/sets progress set:<…> [user]` — how many cards in that set you've caught",
      },
    );
  await interaction.editReply({ embeds: [embed] });
}
