import {
  Client,
  TextChannel,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  type Message,
} from "discord.js";
import {
  getOrCreateGuildSettings,
  pickRandomCard,
  catchCard,
  logSpawn,
  markCaught,
} from "./db.js";
import { RARITY_COLORS, RARITY_EMOJI, RARITY_LABELS, type Rarity } from "./cards-data.js";
import { logger } from "../lib/logger.js";

interface ActiveSpawn {
  cardId: number;
  cardName: string;
  spawnLogId: number;
  message: Message;
  expiresAt: Date;
  caught: boolean;
}

// guildId → active spawn
const activeSpawns = new Map<string, ActiveSpawn>();
// guildId → next spawn timeout
const spawnTimers = new Map<string, ReturnType<typeof setTimeout>>();

let botClient: Client | null = null;

export function initSpawnManager(client: Client) {
  botClient = client;
}

// ── Schedule next spawn for a guild ──────────────────────────────────────────
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

  logger.info({ guildId, delayMs }, "Scheduling next spawn");

  const timer = setTimeout(async () => {
    await spawnCard(guildId);
  }, delayMs);

  spawnTimers.set(guildId, timer);
}

export function clearSpawnTimer(guildId: string) {
  const existing = spawnTimers.get(guildId);
  if (existing) {
    clearTimeout(existing);
    spawnTimers.delete(guildId);
  }
}

// ── Spawn a card (random or forced specific card) ─────────────────────────────
export async function spawnCard(guildId: string, forcedCardId?: number, isForced = false) {
  if (!botClient) return;

  const settings = await getOrCreateGuildSettings(guildId);
  if (!settings.spawnChannelId) {
    logger.warn({ guildId }, "No spawn channel set, skipping spawn");
    return;
  }

  // Only one active spawn per guild at a time
  const currentSpawn = activeSpawns.get(guildId);
  if (currentSpawn && !currentSpawn.caught) {
    logger.info({ guildId }, "Active spawn already in progress, skipping");
    if (!isForced) scheduleNextSpawn(guildId);
    return;
  }

  const card = forcedCardId
    ? (await import("./db.js").then(m => m.getAllCards())).find(c => c.id === forcedCardId)
    : await pickRandomCard();

  if (!card) {
    logger.warn({ guildId }, "No cards available to spawn");
    if (!isForced) scheduleNextSpawn(guildId);
    return;
  }

  const channel = botClient.channels.cache.get(settings.spawnChannelId) as TextChannel | undefined;
  if (!channel) {
    logger.warn({ guildId, channelId: settings.spawnChannelId }, "Spawn channel not found");
    if (!isForced) scheduleNextSpawn(guildId);
    return;
  }

  const rarity = card.rarity as Rarity;
  const color = RARITY_COLORS[rarity] ?? 0x7289da;
  const emoji = RARITY_EMOJI[rarity] ?? "🃏";
  const rarityLabel = RARITY_LABELS[rarity] ?? card.rarity;

  const embed = new EmbedBuilder()
    .setTitle(`${emoji} A wild card appeared!`)
    .setDescription(
      `**${card.name}**\n${card.description}\n\n` +
      `**Rarity:** ${emoji} ${rarityLabel}\n\n` +
      `Type the card name exactly to catch it:\n\`\`\`${card.name}\`\`\``,
    )
    .setColor(color)
    .setFooter({ text: `You have ${settings.catchWindowSeconds}s to catch this card!` })
    .setTimestamp();

  if (card.imageUrl) embed.setImage(card.imageUrl);

  const spawnLog = await logSpawn(guildId, settings.spawnChannelId, card.id, isForced);

  const message = await channel.send({ embeds: [embed] });

  const spawn: ActiveSpawn = {
    cardId: card.id,
    cardName: card.name,
    spawnLogId: spawnLog.id,
    message,
    expiresAt: new Date(Date.now() + settings.catchWindowSeconds * 1000),
    caught: false,
  };

  activeSpawns.set(guildId, spawn);

  // Auto-expire after catch window
  setTimeout(async () => {
    const current = activeSpawns.get(guildId);
    if (current && !current.caught && current.spawnLogId === spawn.spawnLogId) {
      activeSpawns.delete(guildId);
      try {
        await message.edit({
          embeds: [
            new EmbedBuilder()
              .setTitle(`${emoji} The card got away!`)
              .setDescription(`**${card.name}** was not caught in time and vanished into the darkness.`)
              .setColor(0x95a5a6)
              .setTimestamp(),
          ],
        });
      } catch { /* message might be deleted */ }
    }
  }, settings.catchWindowSeconds * 1000);

  // Schedule next spawn (unless forced drop — caller decides)
  if (!isForced) {
    scheduleNextSpawn(guildId);
  }
}

// ── Handle catch attempt ──────────────────────────────────────────────────────
export async function handleCatchAttempt(guildId: string, userId: string, guess: string): Promise<boolean> {
  const spawn = activeSpawns.get(guildId);
  if (!spawn || spawn.caught) return false;
  if (new Date() > spawn.expiresAt) {
    activeSpawns.delete(guildId);
    return false;
  }

  if (guess.trim().toLowerCase() !== spawn.cardName.toLowerCase()) return false;

  spawn.caught = true;
  activeSpawns.delete(guildId);

  await catchCard(guildId, userId, spawn.cardId);
  await markCaught(spawn.spawnLogId, userId);

  const rarity = (spawn as any).rarity as Rarity | undefined;

  try {
    await spawn.message.edit({
      embeds: [
        new EmbedBuilder()
          .setTitle("🎉 Card caught!")
          .setDescription(`**${spawn.cardName}** was caught by <@${userId}>!`)
          .setColor(0x2ecc71)
          .setTimestamp(),
      ],
    });
  } catch { /* message might be deleted */ }

  return true;
}

// ── Get active spawn for guild ────────────────────────────────────────────────
export function getActiveSpawn(guildId: string): ActiveSpawn | undefined {
  return activeSpawns.get(guildId);
}

// ── Initialize all guilds on startup ─────────────────────────────────────────
export async function initAllGuilds(client: Client) {
  for (const [guildId] of client.guilds.cache) {
    const settings = await getOrCreateGuildSettings(guildId);
    if (settings.spawnEnabled && settings.spawnChannelId) {
      scheduleNextSpawn(guildId);
    }
  }
}
