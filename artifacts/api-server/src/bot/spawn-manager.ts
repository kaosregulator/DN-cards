import {
  Client, TextChannel, EmbedBuilder,
  ActionRowBuilder, ButtonBuilder, ButtonStyle,
} from "discord.js";
import {
  getOrCreateGuildSettings,
  pickRandomCard,
  catchCard,
  logSpawn,
  markCaught,
  getAllCards,
} from "./db.js";
import { RARITY_COLORS, RARITY_EMOJI, RARITY_LABELS, TYPE_EMOJI, type Rarity, type CardType } from "./cards-data.js";
import { logger } from "../lib/logger.js";
import type { Card, GuildSettings } from "@workspace/db";

interface ActiveSpawn {
  cardId: number;
  cardName: string;
  burnValue: number;
  channelId: string;
  spawnLogId: number;
  message: { edit: (opts: unknown) => Promise<unknown> };
  expiresAt: Date;
  caught: boolean;
}

// Multiple active spawns per guild (for cardsPerSpawn > 1)
const activeSpawns = new Map<string, Map<string, ActiveSpawn>>();
const spawnTimers = new Map<string, ReturnType<typeof setTimeout>>();

let botClient: Client | null = null;

export function initSpawnManager(client: Client) {
  botClient = client;
}

// ── Extract guild rarity weight overrides ─────────────────────────────────────
function getGuildRarityWeights(settings: GuildSettings): Record<string, number> | undefined {
  const hasCustom = [
    settings.rarityWeightCommon,
    settings.rarityWeightUncommon,
    settings.rarityWeightRare,
    settings.rarityWeightEpic,
    settings.rarityWeightLegendary,
  ].some(v => v !== null);
  if (!hasCustom) return undefined;
  return {
    common: settings.rarityWeightCommon ?? 60,
    uncommon: settings.rarityWeightUncommon ?? 25,
    rare: settings.rarityWeightRare ?? 10,
    epic: settings.rarityWeightEpic ?? 4,
    legendary: settings.rarityWeightLegendary ?? 1,
  };
}

// ── Schedule next spawn ───────────────────────────────────────────────────────
export async function scheduleNextSpawn(guildId: string) {
  clearSpawnTimer(guildId);
  const settings = await getOrCreateGuildSettings(guildId);
  if (!settings.spawnEnabled || !settings.spawnChannelId) return;

  let delayMs: number;
  if (settings.useRandomInterval && settings.spawnIntervalMin && settings.spawnIntervalMax) {
    const minMs = settings.spawnIntervalMin * 1000;
    const maxMs = settings.spawnIntervalMax * 1000;
    delayMs = Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;
  } else {
    delayMs = settings.spawnIntervalSeconds * 1000;
  }

  logger.info({ guildId, delayMs }, "Next card spawn scheduled");
  const timer = setTimeout(() => doSpawnBatch(guildId), delayMs);
  spawnTimers.set(guildId, timer);
}

export function clearSpawnTimer(guildId: string) {
  const t = spawnTimers.get(guildId);
  if (t) { clearTimeout(t); spawnTimers.delete(guildId); }
}

// ── Spawn batch (timer-triggered, respects cardsPerSpawn) ─────────────────────
async function doSpawnBatch(guildId: string) {
  const settings = await getOrCreateGuildSettings(guildId);
  let count = settings.cardsPerSpawn;
  if (count === -1) count = Math.floor(Math.random() * 3) + 1;
  if (count < 1) count = 1;

  for (let i = 0; i < count; i++) {
    if (i > 0) await sleep(5000);
    await doSingleSpawn(guildId);
  }
  scheduleNextSpawn(guildId);
}

// ── Core single-card spawn (no scheduling) ────────────────────────────────────
async function doSingleSpawn(guildId: string, forcedCardId?: number, isForced = false): Promise<void> {
  if (!botClient) return;
  const settings = await getOrCreateGuildSettings(guildId);
  if (!settings.spawnChannelId) return;

  let card: Card | undefined;
  if (forcedCardId) {
    const cards = await getAllCards();
    card = cards.find(c => c.id === forcedCardId);
  } else {
    const rarityWeights = getGuildRarityWeights(settings);
    card = await pickRandomCard(rarityWeights);
  }
  if (!card) return;

  if (card.maxCopies && card.totalMinted >= card.maxCopies) {
    logger.info({ cardId: card.id }, "Card max copies reached, skipping");
    return;
  }

  const channel = botClient.channels.cache.get(settings.spawnChannelId) as TextChannel | undefined;
  if (!channel) return;

  const embed = buildSpawnEmbed(card, settings.catchWindowSeconds);
  const spawnLog = await logSpawn(guildId, settings.spawnChannelId, card.id, isForced);
  const message = await channel.send({ embeds: [embed] });

  const spawnId = `${Date.now()}-${Math.random()}`;
  const spawn: ActiveSpawn = {
    cardId: card.id,
    cardName: card.name,
    burnValue: card.burnValue,
    channelId: settings.spawnChannelId,
    spawnLogId: spawnLog.id,
    message,
    expiresAt: new Date(Date.now() + settings.catchWindowSeconds * 1000),
    caught: false,
  };

  let guildSpawns = activeSpawns.get(guildId);
  if (!guildSpawns) { guildSpawns = new Map(); activeSpawns.set(guildId, guildSpawns); }
  guildSpawns.set(spawnId, spawn);

  // Auto-expire
  const cardRef = card;
  setTimeout(async () => {
    const gs = activeSpawns.get(guildId);
    const s = gs?.get(spawnId);
    if (s && !s.caught) {
      gs?.delete(spawnId);
      try {
        const rarity = cardRef.rarity as Rarity;
        await message.edit({
          embeds: [
            new EmbedBuilder()
              .setTitle(`${RARITY_EMOJI[rarity]} Card escaped!`)
              .setDescription(`**${cardRef.name}** was not caught in time and vanished.`)
              .setColor(0x636e72)
              .setTimestamp(),
          ],
        });
      } catch { /* deleted */ }
    }
  }, settings.catchWindowSeconds * 1000);
}

// ── Public API: force-drop a specific card (admin use) ────────────────────────
export async function spawnCard(guildId: string, forcedCardId?: number, isForced = false): Promise<void> {
  await doSingleSpawn(guildId, forcedCardId, isForced);
}

// ── Handle catch attempt ──────────────────────────────────────────────────────
export async function handleCatchAttempt(guildId: string, userId: string, guess: string): Promise<boolean> {
  const guildSpawns = activeSpawns.get(guildId);
  if (!guildSpawns || guildSpawns.size === 0) return false;

  const normalizedGuess = guess.trim().toLowerCase();
  const now = new Date();

  for (const [spawnId, spawn] of guildSpawns) {
    if (now > spawn.expiresAt) { guildSpawns.delete(spawnId); continue; }
    if (normalizedGuess !== spawn.cardName.toLowerCase()) continue;

    // Caught!
    spawn.caught = true;
    guildSpawns.delete(spawnId);

    await catchCard(guildId, userId, spawn.cardId);
    await markCaught(spawn.spawnLogId, userId);

    // Update the spawn embed: keep the image and card art, overlay "CLAIMED"
    try {
      const claimedEmbed = await buildClaimedEmbed(spawn.cardId, userId);
      if (claimedEmbed) await spawn.message.edit({ embeds: [claimedEmbed] });
    } catch { /* deleted */ }

    // Send Burn / Keep buttons to the catcher
    await sendCatchButtons(guildId, userId, spawn.cardId, spawn.cardName, spawn.burnValue, spawn.channelId);

    return true;
  }
  return false;
}

// ── Burn / Keep buttons after catching ───────────────────────────────────────
async function sendCatchButtons(
  guildId: string, userId: string, cardId: number,
  cardName: string, burnValue: number, channelId: string,
): Promise<void> {
  if (!botClient) return;
  try {
    const channel = botClient.channels.cache.get(channelId) as TextChannel | undefined;
    if (!channel) return;

    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`catch_burn:${guildId}:${userId}:${cardId}`)
        .setLabel(`🔥 Burn (+${burnValue.toLocaleString()} 💠)`)
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId(`catch_keep:${guildId}:${userId}:${cardId}`)
        .setLabel("💾 Keep it")
        .setStyle(ButtonStyle.Success),
    );

    const btnMsg = await channel.send({
      content: `<@${userId}>, you caught **${cardName}**! What would you like to do?`,
      components: [row],
    });

    // Auto-remove buttons after 90s (default to keep — no action needed, card is already in collection)
    setTimeout(async () => {
      try {
        await btnMsg.edit({
          content: `💾 **${cardName}** was kept by <@${userId}>. Use \`/collection\` to view it.`,
          components: [],
        });
      } catch { /* message deleted */ }
    }, 90 * 1000);
  } catch (err) {
    logger.warn({ err }, "Failed to send catch buttons");
  }
}

export function getActiveSpawns(guildId: string): ActiveSpawn[] {
  const gs = activeSpawns.get(guildId);
  return gs ? [...gs.values()] : [];
}

export async function initAllGuilds(client: Client) {
  for (const [guildId] of client.guilds.cache) {
    const settings = await getOrCreateGuildSettings(guildId);
    if (settings.spawnEnabled && settings.spawnChannelId) {
      scheduleNextSpawn(guildId);
    }
  }
}

// Build the "CLAIMED" version of a spawn embed — keeps the image, replaces
// the prompt with a giant CLAIMED banner and the catcher's name.
async function buildClaimedEmbed(cardId: number, userId: string): Promise<EmbedBuilder | null> {
  const cards = await getAllCards();
  const card = cards.find(c => c.id === cardId);
  if (!card) return null;
  const rarity = card.rarity as Rarity;
  const cardType = card.cardType as CardType;
  const embed = new EmbedBuilder()
    .setTitle(`✅ CLAIMED — ${card.name}`)
    .setColor(0x00b894)
    .setDescription(`# 🎉 CLAIMED BY <@${userId}>\n\u200b`)
    .addFields(
      { name: `${TYPE_EMOJI[cardType]} ${card.name}`, value: card.description || "\u200b", inline: false },
      { name: "Rarity", value: `${RARITY_EMOJI[rarity]} ${RARITY_LABELS[rarity]}`, inline: true },
      { name: "Worth", value: `💠 ${card.worthValue.toLocaleString()} shards`, inline: true },
      { name: "Caught by", value: `<@${userId}>`, inline: true },
    )
    .setTimestamp();
  if (card.flavor) embed.setFooter({ text: card.flavor });
  if (card.imageUrl) embed.setImage(card.imageUrl);
  return embed;
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function buildSpawnEmbed(card: Card, windowSeconds: number): EmbedBuilder {
  const rarity = card.rarity as Rarity;
  const cardType = card.cardType as CardType;
  const color = RARITY_COLORS[rarity] ?? 0x7289da;
  const badges: string[] = [];
  if (card.isLimitedEdition) badges.push("💎 **LIMITED EDITION**");
  if (card.isEventExclusive) badges.push("🎆 **EVENT EXCLUSIVE**");
  if (card.maxCopies) badges.push(`📦 Only ${card.maxCopies - card.totalMinted} copies remaining`);

  const embed = new EmbedBuilder()
    .setTitle(`${RARITY_EMOJI[rarity]} A DN Card has appeared!`)
    .setColor(color)
    .setDescription(
      `${badges.length > 0 ? badges.join("\n") + "\n\n" : ""}` +
      `Type the card name exactly to catch it:\n\`\`\`${card.name}\`\`\``,
    )
    .addFields(
      { name: `${TYPE_EMOJI[cardType]} ${card.name}`, value: card.description || "\u200b", inline: false },
      { name: "Rarity", value: `${RARITY_EMOJI[rarity]} ${RARITY_LABELS[rarity]}`, inline: true },
      { name: "Worth", value: `💠 ${card.worthValue.toLocaleString()} shards`, inline: true },
      { name: "⏱️ Window", value: `${windowSeconds}s`, inline: true },
    )
    .setTimestamp();

  if (card.flavor) embed.setFooter({ text: card.flavor });
  if (card.imageUrl) embed.setImage(card.imageUrl);
  return embed;
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
