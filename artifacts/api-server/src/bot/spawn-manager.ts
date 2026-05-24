import { Client, TextChannel, EmbedBuilder } from "discord.js";
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
import type { Card } from "@workspace/db";

interface ActiveSpawn {
  cardId: number;
  cardName: string;
  spawnLogId: number;
  message: { edit: (opts: unknown) => Promise<unknown> };
  expiresAt: Date;
  caught: boolean;
}

const activeSpawns = new Map<string, ActiveSpawn>();
const spawnTimers = new Map<string, ReturnType<typeof setTimeout>>();

let botClient: Client | null = null;

export function initSpawnManager(client: Client) {
  botClient = client;
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
  const timer = setTimeout(() => spawnCard(guildId), delayMs);
  spawnTimers.set(guildId, timer);
}

export function clearSpawnTimer(guildId: string) {
  const t = spawnTimers.get(guildId);
  if (t) { clearTimeout(t); spawnTimers.delete(guildId); }
}

// ── Build spawn embed ─────────────────────────────────────────────────────────
function buildSpawnEmbed(card: Card, windowSeconds: number): EmbedBuilder {
  const rarity = card.rarity as Rarity;
  const cardType = card.cardType as CardType;
  const color = RARITY_COLORS[rarity] ?? 0x7289da;
  const rarityEmoji = RARITY_EMOJI[rarity] ?? "🃏";
  const typeEmoji = TYPE_EMOJI[cardType] ?? "🪖";
  const rarityLabel = RARITY_LABELS[rarity] ?? card.rarity;

  const badges: string[] = [];
  if (card.isLimitedEdition) badges.push("💎 **LIMITED EDITION**");
  if (card.isEventExclusive) badges.push("🎆 **EVENT EXCLUSIVE**");
  if (card.maxCopies) badges.push(`📦 Only ${card.maxCopies - card.totalMinted} copies remaining`);

  const embed = new EmbedBuilder()
    .setTitle(`${rarityEmoji} A DN Card has appeared!`)
    .setColor(color)
    .addFields(
      { name: `${typeEmoji} ${card.name}`, value: card.description, inline: false },
      {
        name: "Rarity",
        value: `${rarityEmoji} ${rarityLabel}`,
        inline: true,
      },
      {
        name: "Worth",
        value: `💠 ${card.worthValue.toLocaleString()} shards`,
        inline: true,
      },
    );

  if (badges.length > 0) {
    embed.addFields({ name: "⚠️ Special", value: badges.join("\n"), inline: false });
  }

  if (card.flavor) {
    embed.setFooter({ text: card.flavor });
  }

  embed
    .setDescription(
      `${badges.length > 0 ? "\n" : ""}Type the card name exactly to catch it:\n\`\`\`${card.name}\`\`\``,
    )
    .setTimestamp();

  if (card.imageUrl) embed.setImage(card.imageUrl);

  return embed;
}

// ── Spawn a card ──────────────────────────────────────────────────────────────
export async function spawnCard(guildId: string, forcedCardId?: number, isForced = false): Promise<void> {
  if (!botClient) return;

  const settings = await getOrCreateGuildSettings(guildId);
  if (!settings.spawnChannelId) {
    if (!isForced) scheduleNextSpawn(guildId);
    return;
  }

  const current = activeSpawns.get(guildId);
  if (current && !current.caught) {
    if (!isForced) scheduleNextSpawn(guildId);
    return;
  }

  let card: Card | undefined;
  if (forcedCardId) {
    const cards = await getAllCards();
    card = cards.find(c => c.id === forcedCardId);
  } else {
    card = await pickRandomCard();
  }

  if (!card) {
    if (!isForced) scheduleNextSpawn(guildId);
    return;
  }

  // Respect maxCopies for limited edition
  if (card.maxCopies && card.totalMinted >= card.maxCopies) {
    logger.info({ cardId: card.id }, "Card max copies reached, skipping");
    if (!isForced) scheduleNextSpawn(guildId);
    return;
  }

  const channel = botClient.channels.cache.get(settings.spawnChannelId) as TextChannel | undefined;
  if (!channel) {
    if (!isForced) scheduleNextSpawn(guildId);
    return;
  }

  const embed = buildSpawnEmbed(card, settings.catchWindowSeconds);
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

  // Auto-expire
  setTimeout(async () => {
    const s = activeSpawns.get(guildId);
    if (s && !s.caught && s.spawnLogId === spawn.spawnLogId) {
      activeSpawns.delete(guildId);
      try {
        const rarity = card!.rarity as Rarity;
        await message.edit({
          embeds: [
            new EmbedBuilder()
              .setTitle(`${RARITY_EMOJI[rarity]} Card escaped!`)
              .setDescription(`**${card!.name}** was not caught in time and vanished.`)
              .setColor(0x636e72)
              .setTimestamp(),
          ],
        });
      } catch { /* deleted */ }
    }
  }, settings.catchWindowSeconds * 1000);

  if (!isForced) scheduleNextSpawn(guildId);
}

// ── Handle catch attempt ──────────────────────────────────────────────────────
export async function handleCatchAttempt(guildId: string, userId: string, guess: string): Promise<boolean> {
  const spawn = activeSpawns.get(guildId);
  if (!spawn || spawn.caught) return false;
  if (new Date() > spawn.expiresAt) { activeSpawns.delete(guildId); return false; }
  if (guess.trim().toLowerCase() !== spawn.cardName.toLowerCase()) return false;

  spawn.caught = true;
  activeSpawns.delete(guildId);

  await catchCard(guildId, userId, spawn.cardId);
  await markCaught(spawn.spawnLogId, userId);

  try {
    await spawn.message.edit({
      embeds: [
        new EmbedBuilder()
          .setTitle("🎉 Card caught!")
          .setDescription(`**${spawn.cardName}** was caught by <@${userId}>!\nCheck your collection with \`!card collection\``)
          .setColor(0x00b894)
          .setTimestamp(),
      ],
    });
  } catch { /* deleted */ }

  return true;
}

export function getActiveSpawn(guildId: string): ActiveSpawn | undefined {
  return activeSpawns.get(guildId);
}

export async function initAllGuilds(client: Client) {
  for (const [guildId] of client.guilds.cache) {
    const settings = await getOrCreateGuildSettings(guildId);
    if (settings.spawnEnabled && settings.spawnChannelId) {
      scheduleNextSpawn(guildId);
    }
  }
}
