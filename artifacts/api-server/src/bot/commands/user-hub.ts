// ─────────────────────────────────────────────────────────────────────────────
// Unified /user-hub — one interactive, ephemeral command that consolidates a
// player's personal surfaces behind a single /help-style dropdown:
//
//   👤 Collector Profile   — rank, net worth, achievements, leaderboard
//   🃏 Collection          — owned breakdown by rarity + specials
//   ⚔️ Battle Profile      — combat record (ported from /battle profile)
//   🎖️ Battle Achievements — combat badges (ported from /battle achievements)
//   📅 Daily               — merged login reward (claim button) + battle dailies
//   🗓️ Calendar            — login streak calendar (ported from /calendar)
//   🖼️ Frames              — equip cosmetic frames (in-hub card→frame picker)
//
// Every section is locked to the invoker. Interactive inputs (frame equip, daily
// claim) run right here — no standalone command needed.
// ─────────────────────────────────────────────────────────────────────────────

import type {
  ChatInputCommandInteraction, StringSelectMenuInteraction, ButtonInteraction,
} from "discord.js";
import {
  EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder, ButtonBuilder,
  ButtonStyle, MessageFlags,
} from "discord.js";
import {
  getUserCollection, getLeaderboard, getOrCreateGuildSettings,
  getRarityDisplayOverrides, getRarityContext, effectiveRarityKey, getDisplayRarities,
} from "../db.js";
import {
  SHINY_EMOJI, getShinyName, getShinyMultiplier,
  getCollectorRank, getNextRank, type Rarity,
} from "../cards-data.js";
import { ACHIEVEMENTS, getUnlockedKeys } from "../achievements.js";
import { buildBattleProfileEmbed, buildBattleAchievementsEmbed, buildBattleDailyEmbed } from "./battle.js";
import { buildCalendarEmbed } from "../cards/calendar-command.js";
import { claimDailyReward } from "./daily.js";
import {
  framesForRarity, resolveActiveFrame, isFrameUnlocked, defaultFrameForRarity,
} from "../cards/frames.js";
import { getCardProgress, setEquippedFrame } from "../cards/leveling.js";

const EPHEMERAL = { flags: MessageFlags.Ephemeral } as const;

type Section =
  | "profile" | "collection" | "battle-profile" | "battle-achievements"
  | "daily" | "calendar" | "frames";

interface SectionMeta { id: Section; label: string; emoji: string; description: string }

const SECTIONS: SectionMeta[] = [
  { id: "profile",             label: "Collector Profile",   emoji: "👤", description: "Rank, net worth, achievements & standing" },
  { id: "collection",          label: "Collection",          emoji: "🃏", description: "Your owned cards by rarity" },
  { id: "battle-profile",      label: "Battle Profile",      emoji: "⚔️", description: "Your combat record & rank points" },
  { id: "battle-achievements", label: "Battle Achievements", emoji: "🎖️", description: "Combat badges you've unlocked" },
  { id: "daily",               label: "Daily",               emoji: "📅", description: "Claim your login reward + battle challenges" },
  { id: "calendar",            label: "Calendar",            emoji: "🗓️", description: "Your login streak calendar" },
  { id: "frames",              label: "Frames",              emoji: "🖼️", description: "Equip a cosmetic frame on a card" },
];

// ── Entry point ──────────────────────────────────────────────────────────────
export async function handleUserHub(
  interaction: ChatInputCommandInteraction, opening: Section = "profile",
): Promise<void> {
  if (!interaction.deferred && !interaction.replied) {
    await interaction.deferReply(EPHEMERAL).catch(() => {});
  }
  const view = await buildView(interaction, opening);
  await interaction.editReply(view);
}

// Re-render the user-hub in place from a button (used by the sub-hubs' Back).
export async function openUserHubFromButton(interaction: ButtonInteraction): Promise<void> {
  const view = await buildView(interaction, "profile");
  await interaction.update(view).catch(() => {});
}

// ── Component router (user-hub:* selects + buttons) ──────────────────────────
export async function handleUserHubComponent(
  interaction: StringSelectMenuInteraction | ButtonInteraction,
): Promise<void> {
  const parts = interaction.customId.split(":"); // user-hub:<action>[:arg]
  const action = parts[1] ?? "select";

  // Frame: a card was picked → show that card's frame options.
  if (action === "frame-card" && interaction.isStringSelectMenu()) {
    const cardId = Number(interaction.values[0]);
    const view = await buildFramePickerView(interaction, cardId);
    await interaction.update(view).catch(() => {});
    return;
  }

  // Frame: a frame was picked → equip it, then re-render the frame section.
  if (action === "frame-pick" && interaction.isStringSelectMenu()) {
    const cardId = Number(parts[2]);
    const frameId = interaction.values[0]!;
    await equipFrame(interaction, cardId, frameId);
    return;
  }

  // Daily: claim button.
  if (action === "daily-claim" && interaction.isButton()) {
    await handleDailyClaim(interaction);
    return;
  }

  // Side quick-access: open the Market / Squad sub-hubs in place.
  if (action === "open-market" && interaction.isButton()) {
    const { openMarketHubFromButton } = await import("./market-hub.js");
    await openMarketHubFromButton(interaction);
    return;
  }
  if (action === "open-squad" && interaction.isButton()) {
    const { openSquadHubFromButton } = await import("./squad-hub.js");
    await openSquadHubFromButton(interaction);
    return;
  }

  // Default: main section dropdown changed.
  let section: Section = "profile";
  if (interaction.isStringSelectMenu()) section = (interaction.values[0] as Section) ?? "profile";
  const view = await buildView(interaction, section);
  await interaction.update(view).catch(() => {});
}

// ── Section dropdown ──────────────────────────────────────────────────────────
function sectionRow(current: Section) {
  const select = new StringSelectMenuBuilder()
    .setCustomId("user-hub:select")
    .setPlaceholder("📋 Jump to a section…")
    .addOptions(SECTIONS.map(s => ({
      label: s.label, value: s.id, description: s.description, emoji: s.emoji, default: s.id === current,
    })));
  return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select);
}

// Quick-access side panel: open the Market / Squad sub-hubs. (🏆 Show Card —
// the public trophy showcase — will slot in here in a later phase.)
function sideRow() {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId("user-hub:open-market").setLabel("Market").setEmoji("🏪").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId("user-hub:open-squad").setLabel("Squad").setEmoji("🤝").setStyle(ButtonStyle.Secondary),
  );
}

type AnyInteraction = ChatInputCommandInteraction | StringSelectMenuInteraction | ButtonInteraction;

// ── View builder — returns embeds + components for a section ──────────────────
async function buildView(interaction: AnyInteraction, section: Section) {
  const guildId = interaction.guildId!;
  const userId = interaction.user.id;
  const username = interaction.user.username;
  const avatar = interaction.user.displayAvatarURL();

  const rows: ActionRowBuilder<any>[] = [sectionRow(section)];
  let embeds: EmbedBuilder[];

  switch (section) {
    case "profile":
      embeds = [await buildProfileEmbed(guildId, userId, username, avatar)];
      break;
    case "collection":
      embeds = [await buildCollectionEmbed(guildId, userId, username, avatar)];
      break;
    case "battle-profile":
      embeds = [await buildBattleProfileEmbed(guildId, userId, username, avatar)];
      break;
    case "battle-achievements":
      embeds = [await buildBattleAchievementsEmbed(guildId, userId, username)];
      break;
    case "daily": {
      embeds = [await buildBattleDailyEmbed(guildId, userId)];
      rows.push(new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId("user-hub:daily-claim").setLabel("Claim Daily Reward").setEmoji("🎁").setStyle(ButtonStyle.Success),
      ));
      break;
    }
    case "calendar":
      embeds = [await buildCalendarEmbed(guildId, userId, username)];
      break;
    case "frames": {
      const cardRow = await buildFrameCardRow(guildId, userId);
      embeds = [new EmbedBuilder().setColor(0x9b59b6).setTitle("🖼️ Cosmetic Frames")
        .setDescription(cardRow
          ? "Pick a card below to see and equip its frames. Frames unlock as a card levels up (Lv 1 / 50 / 100)."
          : "You haven't leveled any cards yet. Field a card in **/battle** to start earning card XP, then come back to equip frames.")];
      if (cardRow) rows.push(cardRow);
      break;
    }
  }
  rows.push(sideRow());
  return { embeds, components: rows };
}

// ── Collector profile ─────────────────────────────────────────────────────────
async function buildProfileEmbed(guildId: string, userId: string, username: string, avatar: string) {
  const [items, settings, unlockedKeys, worthBoard, cardsBoard] = await Promise.all([
    getUserCollection(guildId, userId),
    getOrCreateGuildSettings(guildId),
    getUnlockedKeys(guildId, userId),
    getLeaderboard(guildId, "worth", 1000),
    getLeaderboard(guildId, "cards", 1000),
  ]);
  const unique = items.length;
  const rank = getCollectorRank(unique);
  const nextRank = getNextRank(unique);
  const totalCards = items.reduce((s, i) => s + i.count + i.shinyCount, 0);
  const shinyMultiplier = getShinyMultiplier(settings);
  const netWorth = items.reduce((s, i) => s + i.worthValue * (i.count + i.shinyCount * shinyMultiplier), 0);
  const worthIdx = worthBoard.findIndex(r => r.userId === userId);
  const cardsIdx = cardsBoard.findIndex(r => r.userId === userId);

  const embed = new EmbedBuilder()
    .setTitle(`${rank.emoji} ${username}'s Collector Profile`)
    .setColor(0x5865f2)
    .setThumbnail(avatar)
    .addFields(
      { name: "Rank", value: `${rank.emoji} **${rank.name}**`, inline: true },
      { name: "Unique Cards", value: unique.toString(), inline: true },
      { name: "💠 Net Worth", value: `${netWorth.toLocaleString()} shards`, inline: true },
      { name: "Total Cards", value: totalCards.toString(), inline: true },
      { name: "Achievements", value: `${unlockedKeys.size} / ${ACHIEVEMENTS.length}`, inline: true },
      { name: "Leaderboard", value: `${worthIdx >= 0 ? `#${worthIdx + 1}` : "unranked"} worth · ${cardsIdx >= 0 ? `#${cardsIdx + 1}` : "unranked"} cards`, inline: false },
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

// ── Collection overview ───────────────────────────────────────────────────────
async function buildCollectionEmbed(guildId: string, userId: string, username: string, avatar: string) {
  const [items, settings, displayMap, ctx] = await Promise.all([
    getUserCollection(guildId, userId),
    getOrCreateGuildSettings(guildId),
    getRarityDisplayOverrides(guildId),
    getRarityContext(guildId),
  ]);
  const ladder = getDisplayRarities(ctx, settings, { displayMap });
  const shinyName = getShinyName(settings);
  const unique = items.length;
  const totalCards = items.reduce((s, i) => s + i.count + i.shinyCount, 0);
  const totalShinies = items.reduce((s, i) => s + i.shinyCount, 0);
  const limitedCount = items.filter(i => i.isLimitedEdition).length;
  const eventCount = items.filter(i => i.isEventExclusive).length;

  const byRarity = new Map<string, typeof items>();
  for (const tier of ladder) byRarity.set(tier.key, []);
  for (const item of items) {
    const key = effectiveRarityKey(item, ctx);
    (byRarity.get(key) ?? byRarity.set(key, []).get(key)!).push(item);
  }

  const embed = new EmbedBuilder()
    .setTitle(`🃏 ${username}'s Collection`)
    .setColor(0x5865f2)
    .setThumbnail(avatar)
    .addFields({
      name: "📊 Overview",
      value: `**${unique}** unique · **${totalCards}** total${totalShinies > 0 ? ` · ${SHINY_EMOJI} **${totalShinies}** ${shinyName}` : ""}`,
      inline: false,
    });

  const rarityLines: string[] = [];
  for (const tier of ladder) {
    const group = byRarity.get(tier.key);
    if (!group || group.length === 0) continue;
    const groupTotal = group.reduce((s, i) => s + i.count + i.shinyCount, 0);
    rarityLines.push(`${tier.emoji} ${tier.label}: **${group.length}** unique · **${groupTotal}** total`);
  }
  if (rarityLines.length > 0) embed.addFields({ name: "📈 By Rarity", value: rarityLines.join("\n"), inline: false });

  const specials: string[] = [];
  if (limitedCount > 0) specials.push(`💎 Limited: **${limitedCount}**`);
  if (eventCount > 0) specials.push(`🎆 Event: **${eventCount}**`);
  if (specials.length > 0) embed.addFields({ name: "🌟 Special", value: specials.join(" · "), inline: false });

  embed.setFooter({ text: "Use /collection for detailed drill-downs" });
  return embed;
}

// ── Frame flow ────────────────────────────────────────────────────────────────
// Card dropdown for the frame section. Returns null when the user owns no cards.
async function buildFrameCardRow(guildId: string, userId: string) {
  const items = await getUserCollection(guildId, userId);
  if (items.length === 0) return null;
  const options = items
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name))
    .slice(0, 25)
    .map(i => ({ label: i.name.slice(0, 100), value: i.cardId.toString(), description: (i.rarity as string) }));
  const select = new StringSelectMenuBuilder()
    .setCustomId("user-hub:frame-card")
    .setPlaceholder("Pick a card to frame…")
    .addOptions(options);
  return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select);
}

// After a card is picked: show its frames as a dropdown with lock states.
async function buildFramePickerView(interaction: AnyInteraction, cardId: number) {
  const guildId = interaction.guildId!;
  const userId = interaction.user.id;
  const items = await getUserCollection(guildId, userId);
  const item = items.find(i => i.cardId === cardId);
  if (!item) {
    return { embeds: [new EmbedBuilder().setColor(0xe74c3c).setTitle("❌ Card not found").setDescription("You don't own that card anymore.")], components: [sectionRow("frames")] };
  }
  const rarity = item.rarity as Rarity;
  const progress = await getCardProgress(guildId, userId, cardId);
  const level = progress?.level ?? 1;
  const frames = framesForRarity(rarity);
  const active = resolveActiveFrame(rarity, progress?.equippedFrame ?? null, level);

  const lines = frames.map(f => {
    const isActive = f.id === active.id;
    const unlocked = isFrameUnlocked(f, level);
    const tag = isActive ? "**✓ equipped**" : unlocked ? "available" : `🔒 Lv ${f.unlockLevel}`;
    return `${f.emoji} **${f.name}** — ${tag}`;
  });
  const embed = new EmbedBuilder()
    .setColor(active.color)
    .setTitle(`🖼️ Frames for ${item.name}`)
    .setDescription(`Card level: **${level}**\n\n${lines.join("\n")}\n\nPick an unlocked frame below to equip it.`);

  const select = new StringSelectMenuBuilder()
    .setCustomId(`user-hub:frame-pick:${cardId}`)
    .setPlaceholder("Equip a frame…")
    .addOptions(frames.map(f => ({
      label: f.name.slice(0, 100),
      value: f.id,
      emoji: f.emoji,
      description: isFrameUnlocked(f, level) ? (f.id === active.id ? "Currently equipped" : "Available") : `Unlocks at Lv ${f.unlockLevel}`,
    })));
  return {
    embeds: [embed],
    components: [sectionRow("frames"), new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select)],
  };
}

// Equip the chosen frame (if unlocked), then re-render the frame picker.
async function equipFrame(interaction: StringSelectMenuInteraction, cardId: number, frameId: string) {
  const guildId = interaction.guildId!;
  const userId = interaction.user.id;
  const items = await getUserCollection(guildId, userId);
  const item = items.find(i => i.cardId === cardId);
  if (!item) { await interaction.update(await buildView(interaction, "frames")); return; }
  const rarity = item.rarity as Rarity;
  const progress = await getCardProgress(guildId, userId, cardId);
  const level = progress?.level ?? 1;
  const frames = framesForRarity(rarity);
  const match = frames.find(f => f.id === frameId);

  if (!match) {
    await interaction.reply({ content: "❌ Unknown frame.", ...EPHEMERAL }).catch(() => {});
    return;
  }
  if (!isFrameUnlocked(match, level)) {
    await interaction.reply({ content: `🔒 **${match.name}** unlocks at card **Level ${match.unlockLevel}** — this card is Level ${level}.`, ...EPHEMERAL }).catch(() => {});
    return;
  }
  // Rarity default is stored as null so it self-heals if the registry changes.
  const store = match.id === defaultFrameForRarity(rarity).id ? null : match.id;
  await setEquippedFrame(guildId, userId, cardId, store);
  const view = await buildFramePickerView(interaction, cardId);
  await interaction.update(view).catch(() => {});
  await interaction.followUp({ content: `✅ Equipped **${match.emoji} ${match.name}** on **${item.name}**.`, ...EPHEMERAL }).catch(() => {});
}

// ── Daily claim button ────────────────────────────────────────────────────────
async function handleDailyClaim(interaction: ButtonInteraction) {
  const guildId = interaction.guildId!;
  const userId = interaction.user.id;
  const result = await claimDailyReward(guildId, userId, interaction.user.username, interaction.guild?.name ?? "this server");

  // Re-render the daily section with the claim result stacked above the
  // (now-updated) battle challenges.
  const battle = await buildBattleDailyEmbed(guildId, userId);
  const rows: ActionRowBuilder<any>[] = [sectionRow("daily")];
  if (result.ok) {
    // Nothing left to claim today — drop the button.
  } else {
    rows.push(new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId("user-hub:daily-claim").setLabel("Claim Daily Reward").setEmoji("🎁").setStyle(ButtonStyle.Success).setDisabled(true),
    ));
  }
  await interaction.update({ embeds: [result.embed, battle], components: rows }).catch(() => {});
  for (const note of result.followUps) {
    await interaction.followUp({ content: note, ...EPHEMERAL }).catch(() => {});
  }
}
