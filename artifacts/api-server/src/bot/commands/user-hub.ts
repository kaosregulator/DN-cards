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
  ButtonStyle, MessageFlags, AttachmentBuilder,
} from "discord.js";
import {
  getUserCollection, getLeaderboard, getOrCreateGuildSettings,
  getRarityDisplayOverrides, getRarityContext, effectiveRarityKey, getDisplayRarities,
  getShowcaseBackgrounds,
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
import { getCardProgress, setEquippedFrame, starsForLevel } from "../cards/leveling.js";
import { renderShowcaseImage } from "../battle/image/render.js";
import { toAbsoluteImageUrl } from "../image-url.js";
import { bar } from "../battle/embeds.js";
import { getPlayerProfile } from "../player/profile.js";
import type { XpSource } from "@workspace/db";

const EPHEMERAL = { flags: MessageFlags.Ephemeral } as const;

type Section =
  | "progression" | "profile" | "collection" | "battle-profile" | "battle-achievements"
  | "daily" | "calendar" | "frames";

interface SectionMeta { id: Section; label: string; emoji: string; description: string }

const SECTIONS: SectionMeta[] = [
  { id: "progression",         label: "Progression",         emoji: "🌟", description: "Your account level & XP across every activity" },
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
  interaction: ChatInputCommandInteraction, opening: Section = "progression",
): Promise<void> {
  if (!interaction.deferred && !interaction.replied) {
    await interaction.deferReply(EPHEMERAL).catch(() => {});
  }
  const view = await buildView(interaction, opening);
  await interaction.editReply(view);
}

// Re-render the user-hub in place from a button (used by the sub-hubs' Back).
export async function openUserHubFromButton(interaction: ButtonInteraction): Promise<void> {
  const view = await buildView(interaction, "progression");
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

  // Show Card trophy: open the card picker, then render + post publicly.
  if (action === "open-showcase" && interaction.isButton()) {
    await openShowcasePicker(interaction);
    return;
  }
  if (action === "showcase-best" && interaction.isButton()) {
    await postShowcaseBest(interaction);
    return;
  }
  if (action === "showcase-pick" && interaction.isStringSelectMenu()) {
    await postShowcase(interaction);
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
    new ButtonBuilder().setCustomId("user-hub:open-showcase").setLabel("Show Card").setEmoji("🏆").setStyle(ButtonStyle.Secondary),
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
    case "progression":
      embeds = [await buildProgressionEmbed(guildId, userId, username, avatar)];
      break;
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

// ── Unified progression ───────────────────────────────────────────────────────
// The single "source of truth" overview: account level/XP fed by every activity,
// plus a snapshot of each subsystem (read through the PlayerProfile aggregator,
// which composes the existing tables — it does not duplicate any of them).
const XP_SOURCE_LABELS: Record<XpSource, string> = {
  catch: "🎯 Catching",
  pack: "📦 Packs",
  battle: "⚔️ Battles",
  raid: "🐉 Raids",
  trade: "🔁 Trades",
  economy: "🏪 Market",
  daily: "📅 Daily",
  quest: "📜 Quests",
  achievement: "🏆 Achievements",
  reputation: "⭐ Reputation",
  collection: "🃏 Collection",
};

async function buildProgressionEmbed(guildId: string, userId: string, username: string, avatar: string) {
  const p = await getPlayerProfile(guildId, userId);
  const { account } = p;

  const levelLine = account.isMax
    ? `**Level ${account.level}** · MAX 🎉  ·  ${account.xp.toLocaleString()} XP`
    : `**Level ${account.level}**  ·  ${bar(account.into, account.needed, 12)}  ${account.into.toLocaleString()}/${account.needed.toLocaleString()} XP`;

  // XP-by-source breakdown, highest first — shows every system contributes.
  const bySource = Object.entries(account.xpBySource)
    .filter(([, v]) => (v ?? 0) > 0)
    .sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0));
  const breakdown = bySource.length
    ? bySource.map(([src, v]) => `${XP_SOURCE_LABELS[src as XpSource] ?? src} — **${(v ?? 0).toLocaleString()}**`).join("\n")
    : "_Play any activity — catch, packs, battles, raids, trades, market, daily, quests, achievements, reputation — to start earning account XP._";

  const embed = new EmbedBuilder()
    .setColor(0xf1c40f)
    .setAuthor({ name: `${username} — Progression`, iconURL: avatar })
    .setDescription(
      `${levelLine}\n\n` +
      `Every activity feeds one shared account level. Specialized progression ` +
      `(card XP, battle rank) still applies on top.`,
    )
    .addFields(
      {
        name: "💠 Economy",
        value: `${p.economy.shards.toLocaleString()} shards\n${p.economy.totalEarned.toLocaleString()} earned`,
        inline: true,
      },
      {
        name: "🃏 Collection",
        value: `${p.collection.unique.toLocaleString()} unique\n${p.collection.total.toLocaleString()} total`,
        inline: true,
      },
      {
        name: "⚔️ Battles",
        value: `${p.battles.wins}W / ${p.battles.losses}L\n${p.battles.rankPoints} RP · 🔥${p.battles.currentStreak}`,
        inline: true,
      },
      {
        name: "📜 Quests",
        value: `Daily ${p.quests.dailyDone}/${p.quests.dailyTotal}\nWeekly ${p.quests.weeklyDone}/${p.quests.weeklyTotal}`,
        inline: true,
      },
      {
        name: "📅 Daily",
        value: `🔥 ${p.daily.streak} day streak`,
        inline: true,
      },
      {
        name: "⭐ Standing",
        value: `${p.reputation.rep} rep\n${p.achievements.unlocked} achievements`,
        inline: true,
      },
      {
        name: "✨ XP by activity",
        value: breakdown,
        inline: false,
      },
    )
    .setFooter({ text: "Use the dropdown to dive into any section." });

  return embed;
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

// ── Show Card trophy ──────────────────────────────────────────────────────────
// Pick a card, render a premium trophy image (with the card's equipped /frames
// colour), post it PUBLICLY in the channel, and auto-delete after 40 seconds.
const SHOWCASE_TTL_MS = 40_000;

async function openShowcasePicker(interaction: ButtonInteraction) {
  const guildId = interaction.guildId!;
  const userId = interaction.user.id;
  const leveled = await getLeveledCards(guildId, userId);
  if (leveled.length === 0) {
    await interaction.reply({ content: "🔒 Only leveled-up cards can be shown off. Battle with a card to earn XP and unlock the trophy showcase!", ...EPHEMERAL }).catch(() => {});
    return;
  }
  const select = new StringSelectMenuBuilder()
    .setCustomId("user-hub:showcase-pick")
    .setPlaceholder("Pick a leveled card to show off…")
    .addOptions(
      leveled
        .slice(0, 24)
        .map(({ item, level }) => ({
          label: `${item.name.slice(0, 80)} · Lv ${level}`,
          value: item.cardId.toString(),
          description: `${item.rarity} · ${item.worthValue} shards`,
        })),
    );
  const embed = new EmbedBuilder()
    .setColor(0xffd76b)
    .setTitle("🏆 Show Card")
    .setDescription(
      "Only **leveled-up cards** can be shown off — this gives you a reason to level them up.\n\n" +
      "Pick a card below or hit **Show Best** to post your highest-level card instantly."
    );
  const rows: ActionRowBuilder<any>[] = [
    new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select),
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId("user-hub:showcase-best").setLabel("🏆 Show Best").setStyle(ButtonStyle.Success),
    ),
    sideRow(),
  ];
  await interaction.update({ embeds: [embed], components: rows }).catch(() => {});
}

async function postShowcaseBest(interaction: ButtonInteraction) {
  const guildId = interaction.guildId!;
  const userId = interaction.user.id;
  const leveled = await getLeveledCards(guildId, userId);
  if (leveled.length === 0) {
    await interaction.reply({ content: "🔒 No leveled-up cards to show off yet.", ...EPHEMERAL }).catch(() => {});
    return;
  }
  const best = leveled[0]!;
  await renderAndPostShowcase(interaction, best.item, best.progress, best.level);
}

async function postShowcase(interaction: StringSelectMenuInteraction) {
  const guildId = interaction.guildId!;
  const userId = interaction.user.id;
  const cardId = Number(interaction.values[0]);

  const item = (await getUserCollection(guildId, userId)).find(i => i.cardId === cardId);
  if (!item) {
    await interaction.reply({ content: "❌ You don't own that card anymore.", ...EPHEMERAL }).catch(() => {});
    return;
  }
  const progress = await getCardProgress(guildId, userId, cardId);
  const level = progress?.level ?? 1;
  await renderAndPostShowcase(interaction, item, progress, level);
}

async function renderAndPostShowcase(
  interaction: ButtonInteraction | StringSelectMenuInteraction,
  item: Awaited<ReturnType<typeof getUserCollection>>[number],
  progress: Awaited<ReturnType<typeof getCardProgress>>,
  level: number,
) {
  const guildId = interaction.guildId!;
  const userId = interaction.user.id;
  const [settings, backgrounds] = await Promise.all([
    getOrCreateGuildSettings(guildId),
    getShowcaseBackgrounds(guildId),
  ]);
  const stars = starsForLevel(level);
  const frame = resolveActiveFrame(item.rarity as Rarity, progress?.equippedFrame ?? null, level);

  const caughtLabel = item.firstCaughtAt
    ? `Caught · ${new Date(item.firstCaughtAt).toLocaleDateString(undefined, { month: "short", year: "numeric" })}`
    : undefined;
  const badges: string[] = [];
  if (level >= 100) badges.push("Maxed");
  if (item.isLimitedEdition) badges.push("Limited");
  if (item.isEventExclusive) badges.push("Event");
  if (item.shinyCount > 0) badges.push(getShinyName(settings));

  const backgroundUrl = backgrounds.length > 0 ? backgrounds[Math.floor(Math.random() * backgrounds.length)]! : null;

  const img = await renderShowcaseImage({
    name: item.name,
    rarity: item.rarity as Rarity,
    rarityLabel: (item.rarity as string).toUpperCase(),
    rarityColor: frame.color,
    cardId: item.cardId,
    cardType: item.cardType,
    level,
    artUrl: toAbsoluteImageUrl(item.imageUrl),
  }, { stars, caughtLabel, frameName: frame.name, badges, backgroundUrl }).catch(() => null);

  await interaction.reply({ content: "🏆 Showing off your card…", ...EPHEMERAL }).catch(() => {});

  const channel = interaction.channel;
  if (!channel || !("send" in channel) || !channel.isSendable?.()) {
    await interaction.followUp({ content: "❌ I can't post in this channel.", ...EPHEMERAL }).catch(() => {});
    return;
  }
  const content = `🏆 <@${userId}> shows off **${item.name}** — Lv ${level} ${"★".repeat(stars)}${"☆".repeat(5 - stars)}`;
  const files = img ? [new AttachmentBuilder(img, { name: "showcase.png" })] : [];
  const msg = await channel.send({ content, files, allowedMentions: { users: [] } }).catch(() => null);
  if (msg) setTimeout(() => { msg.delete().catch(() => {}); }, SHOWCASE_TTL_MS);
}

async function getLeveledCards(guildId: string, userId: string) {
  const items = await getUserCollection(guildId, userId);
  const withProgress = await Promise.all(
    items.map(async item => {
      const progress = await getCardProgress(guildId, userId, item.cardId);
      const level = progress?.level ?? 1;
      return { item, progress, level };
    }),
  );
  return withProgress
    .filter(p => p.level > 1)
    .sort((a, b) => b.level - a.level || b.item.worthValue - a.item.worthValue || a.item.name.localeCompare(b.item.name));
}
