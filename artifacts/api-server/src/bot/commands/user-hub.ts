// ─────────────────────────────────────────────────────────────────────────────
// Unified /user-hub — one interactive, animated command that consolidates:
// user profile, collection overview, and battle stats. Similar to /help hub
// but personal (locked to the invoker) with drill-down views by rarity, shinies,
// limited & events.
//
// Ephemeral, interactive, and fast. Single source of truth for user data.
// ─────────────────────────────────────────────────────────────────────────────

import type {
  ChatInputCommandInteraction, StringSelectMenuInteraction, ButtonInteraction, User,
} from "discord.js";
import {
  EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder, ButtonBuilder,
  ButtonStyle, MessageFlags,
} from "discord.js";
import {
  getUserCollection, getOrCreateCurrency, getLeaderboard, getUnlockedKeys,
  getOrCreateGuildSettings, getRarityDisplayOverrides, getRarityContext,
  effectiveRarityKey, getDisplayRarities, getCardDisplayRarity,
} from "../db.js";
import {
  RARITY_EMOJI, SHINY_EMOJI, getShinyName, getShinyMultiplier,
  getCollectorRank, getNextRank, type Rarity,
} from "../cards-data.js";
import { ACHIEVEMENTS } from "../achievements.js";
import { toAbsoluteImageUrl } from "../image-url.js";

const EPHEMERAL = { flags: MessageFlags.Ephemeral } as const;

interface UserSection {
  id: string;
  label: string;
  emoji: string;
  description: string;
}

const SECTIONS: UserSection[] = [
  { id: "profile", label: "Profile & Rank", emoji: "👤", description: "Your collector status, stats, and achievements" },
  { id: "collection-overview", label: "Collection", emoji: "🃏", description: "Your collection overview" },
];

// ── Entry point ──────────────────────────────────────────────────────────────
export async function handleUserHub(
  interaction: ChatInputCommandInteraction,
  openingSection: string = "profile",
): Promise<void> {
  if (!interaction.deferred && !interaction.replied) {
    await interaction.deferReply(EPHEMERAL).catch(() => {});
  }

  const embed = await buildPage(interaction, openingSection);
  await interaction.editReply({
    embeds: [embed],
    components: buildComponents(openingSection),
  });
}

// ── Component router ──────────────────────────────────────────────────────────
export async function handleUserHubComponent(
  interaction: StringSelectMenuInteraction | ButtonInteraction,
): Promise<void> {
  const parts = interaction.customId.split(":");
  let section: string = "profile";

  if (interaction.isStringSelectMenu()) {
    section = (interaction.values[0] ?? "profile");
  } else if (parts[1]) {
    section = parts[1];
  }

  const embed = await buildPage(interaction, section);
  await interaction.update({
    embeds: [embed],
    components: buildComponents(section),
  }).catch(() => {});
}

// ── Components (topic dropdown + nav buttons) ─────────────────────────────────
function buildComponents(current: string) {
  const options = SECTIONS.map(s => ({
    label: s.label,
    value: s.id,
    description: s.description,
    emoji: s.emoji,
    default: s.id === current,
  }));

  const select = new StringSelectMenuBuilder()
    .setCustomId("user-hub:select")
    .setPlaceholder("📋 Jump to a section…")
    .addOptions(options);

  return [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select)];
}

// ── Page builder ──────────────────────────────────────────────────────────────
async function buildPage(
  interaction: ChatInputCommandInteraction | StringSelectMenuInteraction | ButtonInteraction,
  section: string,
): Promise<EmbedBuilder> {
  const guildId = interaction.guildId!;
  const userId = interaction.user.id;

  if (section === "profile") {
    return buildProfilePage(interaction, guildId, userId);
  } else if (section === "collection-overview") {
    return buildCollectionOverviewPage(interaction, guildId, userId);
  }

  return new EmbedBuilder()
    .setTitle("⚠️ Unknown Section")
    .setColor(0x808080)
    .setDescription("This section doesn't exist.");
}

// ── Profile page ──────────────────────────────────────────────────────────────
async function buildProfilePage(
  interaction: ChatInputCommandInteraction | StringSelectMenuInteraction | ButtonInteraction,
  guildId: string,
  userId: string,
): Promise<EmbedBuilder> {
  const [items, settings, displayMap, ctx, unlockedKeys, worthBoard, cardsBoard] = await Promise.all([
    getUserCollection(guildId, userId),
    getOrCreateGuildSettings(guildId),
    getRarityDisplayOverrides(guildId),
    getRarityContext(guildId),
    getUnlockedKeys(guildId, userId),
    getLeaderboard(guildId, "worth", 1000),
    getLeaderboard(guildId, "cards", 1000),
  ]);

  const unique = items.length;
  const rank = getCollectorRank(unique);
  const nextRank = getNextRank(unique);
  const totalCards = items.reduce((s, i) => s + i.count + i.shinyCount, 0);
  const shinyMultiplier = getShinyMultiplier(settings);
  const netWorth = items.reduce(
    (s, i) => s + i.worthValue * (i.count + i.shinyCount * shinyMultiplier),
    0,
  );

  const worthIdx = worthBoard.findIndex(r => r.userId === userId);
  const cardsIdx = cardsBoard.findIndex(r => r.userId === userId);

  const embed = new EmbedBuilder()
    .setTitle(`${rank.emoji} ${interaction.user.username}'s Profile`)
    .setColor(0x5865f2)
    .setThumbnail(interaction.user.displayAvatarURL())
    .addFields(
      { name: "Rank", value: `${rank.emoji} **${rank.name}**`, inline: true },
      { name: "Unique Cards", value: unique.toString(), inline: true },
      { name: "💠 Net Worth", value: `${netWorth.toLocaleString()} shards`, inline: true },
      { name: "Total Cards", value: totalCards.toString(), inline: true },
      { name: "Achievements", value: `${unlockedKeys.size} / ${ACHIEVEMENTS.length}`, inline: true },
      { name: "Leaderboard", value: `${worthIdx >= 0 ? `#${worthIdx + 1}` : "unranked"} by worth · ${cardsIdx >= 0 ? `#${cardsIdx + 1}` : "unranked"} by cards`, inline: false },
    );

  if (nextRank) {
    embed.addFields({
      name: "Next Rank",
      value: `${nextRank.emoji} **${nextRank.name}** — catch **${nextRank.min - unique}** more unique card${nextRank.min - unique !== 1 ? "s" : ""}`,
      inline: false,
    });
  }

  return embed;
}

// ── Collection overview page ──────────────────────────────────────────────────
async function buildCollectionOverviewPage(
  interaction: ChatInputCommandInteraction | StringSelectMenuInteraction | ButtonInteraction,
  guildId: string,
  userId: string,
): Promise<EmbedBuilder> {
  const [items, settings, displayMap, ctx] = await Promise.all([
    getUserCollection(guildId, userId),
    getOrCreateGuildSettings(guildId),
    getRarityDisplayOverrides(guildId),
    getRarityContext(guildId),
  ]);

  const collectionLadder = getDisplayRarities(ctx, settings, { displayMap });
  const shinyMultiplier = getShinyMultiplier(settings);
  const shinyName = getShinyName(settings);

  const unique = items.length;
  const totalCards = items.reduce((s, i) => s + i.count + i.shinyCount, 0);
  const totalShinies = items.reduce((s, i) => s + i.shinyCount, 0);
  const limitedCount = items.filter(i => i.isLimitedEdition).length;
  const eventCount = items.filter(i => i.isEventExclusive).length;

  const byRarity = new Map<string, typeof items>();
  for (const tier of collectionLadder) byRarity.set(tier.key, []);
  for (const item of items) {
    const key = effectiveRarityKey(item, ctx);
    (byRarity.get(key) ?? byRarity.set(key, []).get(key)!).push(item);
  }

  const embed = new EmbedBuilder()
    .setTitle(`🃏 ${interaction.user.username}'s Collection`)
    .setColor(0x5865f2)
    .setThumbnail(interaction.user.displayAvatarURL());

  const fields: { name: string; value: string; inline: boolean }[] = [];

  // Add overview stats
  fields.push({
    name: "📊 Overview",
    value: `**${unique}** unique · **${totalCards}** total${totalShinies > 0 ? ` · ${SHINY_EMOJI} **${totalShinies}** ${shinyName}` : ""}`,
    inline: false,
  });

  // Add rarity breakdown
  const rarityLines: string[] = [];
  for (const tier of collectionLadder) {
    const group = byRarity.get(tier.key);
    if (!group || group.length === 0) continue;
    const groupTotal = group.reduce((s, i) => s + i.count + i.shinyCount, 0);
    rarityLines.push(`${tier.emoji} ${tier.label}: **${group.length}** unique · **${groupTotal}** total`);
  }
  if (rarityLines.length > 0) {
    fields.push({
      name: "📈 By Rarity",
      value: rarityLines.join("\n"),
      inline: false,
    });
  }

  // Add special categories
  const specialLines: string[] = [];
  if (limitedCount > 0) specialLines.push(`💎 Limited: **${limitedCount}** unique`);
  if (eventCount > 0) specialLines.push(`🎆 Event: **${eventCount}** unique`);
  if (specialLines.length > 0) {
    fields.push({
      name: "🌟 Special",
      value: specialLines.join(" · "),
      inline: false,
    });
  }

  for (const field of fields) {
    embed.addFields(field);
  }

  embed.setFooter({ text: "Use /collection to see detailed drill-downs" });
  return embed;
}
