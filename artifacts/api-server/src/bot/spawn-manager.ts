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
  getCardWishlisters,
  getUserTimeout,
} from "./db.js";
import { RARITY_COLORS, RARITY_EMOJI, RARITY_LABELS, TYPE_EMOJI, type Rarity, type CardType } from "./cards-data.js";
import { toAbsoluteImageUrl } from "./image-url.js";
import { logger } from "../lib/logger.js";
import type { Card, GuildSettings } from "@workspace/db";

interface PendingCatch {
  userId: string;
  timestamp: number; // message createdTimestamp — lower wins
}

interface ActiveSpawn {
  spawnId: string;
  cardId: number;
  cardName: string;
  burnValue: number;
  channelId: string;
  spawnLogId: number;
  message: { edit: (opts: unknown) => Promise<unknown> };
  expiresAt: Date;
  caught: boolean;
  winnerUserId: string | null;
  catchMode: "type" | "button" | "both";
  // Fair-claim buffer for typing mode: collect matches in a small grace
  // window, then award to the message with the smallest server timestamp.
  pending: PendingCatch[];
  resolveTimer: ReturnType<typeof setTimeout> | null;
}

// After a spawn is caught, keep its entry around for a short cooldown so
// late clicks (double-taps, mobile retries, both-mode type+click race) from
// the actual winner can be silently swallowed instead of showing a confusing
// "spawn expired" message to the person who just caught it.
const POST_CATCH_LINGER_MS = 300_000;

// Grace window for collecting concurrent typing-mode catch attempts.
// Anyone whose Discord-stamped message lands within this window of the first
// matching message gets considered; lowest timestamp wins.
const TYPE_GRACE_MS = 500;

// Multiple active spawns per guild (for cardsPerSpawn > 1)
const activeSpawns = new Map<string, Map<string, ActiveSpawn>>();
const spawnTimers = new Map<string, ReturnType<typeof setTimeout>>();

let botClient: Client | null = null;

export function getBotClient(): Client | null { return botClient; }

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
    if (card?.isArchived) {
      logger.info({ cardId: card.id }, "Refusing to spawn archived card");
      return;
    }
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

  const mode = ((settings as unknown as { catchMode?: string }).catchMode ?? "type") as "type" | "button" | "both";
  const spawnId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const embed = buildSpawnEmbed(card, settings.catchWindowSeconds, mode);
  const spawnLog = await logSpawn(guildId, settings.spawnChannelId, card.id, isForced);
  const components = mode === "type" ? [] : [buildClaimRow(guildId, spawnId)];
  const message = await channel.send({ embeds: [embed], components });

  // ── Wishlist ping: notify users who have this card on their wishlist ──────
  // Chunk into batches so a popular card doesn't blast a 100-mention message
  // (Discord rate-limits + spam filters).
  try {
    const wishers = await getCardWishlisters(guildId, card.id);
    const CHUNK = 20;
    for (let i = 0; i < wishers.length; i += CHUNK) {
      const slice = wishers.slice(i, i + CHUNK);
      const mentions = slice.map(u => `<@${u}>`).join(" ");
      await channel.send({
        content: `⭐ ${mentions} — **${card.name}** is on your wishlist! Catch it now.`,
        allowedMentions: { users: slice },
      }).catch(() => { /* permissions / rate limit — ignore */ });
    }
  } catch (err) {
    logger.warn({ err }, "Wishlist ping failed");
  }

  const spawn: ActiveSpawn = {
    spawnId,
    cardId: card.id,
    cardName: card.name,
    burnValue: card.burnValue,
    channelId: settings.spawnChannelId,
    spawnLogId: spawnLog.id,
    message,
    expiresAt: new Date(Date.now() + settings.catchWindowSeconds * 1000),
    caught: false,
    winnerUserId: null,
    catchMode: mode,
    pending: [],
    resolveTimer: null,
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

// ── Handle catch attempt (typing) ────────────────────────────────────────────
// Lag-fair: when the first match arrives we open a short grace window and
// collect all matching messages. Whoever has the earliest Discord-stamped
// timestamp (msg.createdTimestamp) wins, not whoever the bot processed first.
export async function handleCatchAttempt(
  guildId: string, userId: string, guess: string,
  messageTimestamp: number,
): Promise<{ matched: boolean; awaiting: boolean; timedOutUntil?: Date }> {
  const guildSpawns = activeSpawns.get(guildId);
  if (!guildSpawns || guildSpawns.size === 0) return { matched: false, awaiting: false };

  const normalizedGuess = guess.trim().toLowerCase();
  const now = new Date();

  // First find a matching spawn so we don't query the DB on every random msg.
  let matchedSpawnId: string | null = null;
  for (const [spawnId, spawn] of guildSpawns) {
    if (now > spawn.expiresAt) { guildSpawns.delete(spawnId); continue; }
    if (spawn.caught) continue;
    if (spawn.catchMode === "button") continue; // typing disabled
    if (normalizedGuess !== spawn.cardName.toLowerCase()) continue;
    matchedSpawnId = spawnId;
    break;
  }
  if (!matchedSpawnId) return { matched: false, awaiting: false };

  // Admin-imposed catch timeout — block before queuing.
  const timeout = await getUserTimeout(guildId, userId);
  if (timeout) return { matched: true, awaiting: false, timedOutUntil: timeout.expiresAt };

  const spawn = guildSpawns.get(matchedSpawnId)!;
  spawn.pending.push({ userId, timestamp: messageTimestamp });
  if (!spawn.resolveTimer) {
    spawn.resolveTimer = setTimeout(() => { void resolveTypingSpawn(guildId, matchedSpawnId!); }, TYPE_GRACE_MS);
  }
  return { matched: true, awaiting: true };
}

async function resolveTypingSpawn(guildId: string, spawnId: string): Promise<void> {
  const guildSpawns = activeSpawns.get(guildId);
  const spawn = guildSpawns?.get(spawnId);
  if (!spawn || spawn.caught || spawn.pending.length === 0) return;

  spawn.pending.sort((a, b) => a.timestamp - b.timestamp);
  const winner = spawn.pending[0];
  await awardSpawn(guildId, spawnId, winner.userId);
}

// Award a spawn to a specific user atomically (used by both typing winner and button click).
async function awardSpawn(guildId: string, spawnId: string, userId: string): Promise<boolean> {
  const guildSpawns = activeSpawns.get(guildId);
  const spawn = guildSpawns?.get(spawnId);
  if (!spawn || spawn.caught) return false;

  spawn.caught = true;
  spawn.winnerUserId = userId;
  // Keep the spawn entry around briefly so we can recognise late clicks from
  // the winner (double-tap, both-mode type+click race) instead of telling
  // them the spawn expired. It's cleaned up after POST_CATCH_LINGER_MS.
  setTimeout(() => {
    const gs = activeSpawns.get(guildId);
    if (gs?.get(spawnId)?.caught) gs.delete(spawnId);
  }, POST_CATCH_LINGER_MS);
  if (spawn.resolveTimer) { clearTimeout(spawn.resolveTimer); spawn.resolveTimer = null; }

  await catchCard(guildId, userId, spawn.cardId);
  await markCaught(spawn.spawnLogId, userId);

  try {
    const claimedEmbed = await buildClaimedEmbed(spawn.cardId, userId);
    if (claimedEmbed) {
      await spawn.message.edit({
        embeds: [claimedEmbed],
        components: [buildDecisionRow(guildId, userId, spawn.cardId, spawn.burnValue)],
      });
    }
  } catch { /* deleted */ }

  // Auto-keep after 90s if no button pressed — edit the spawn embed in place.
  setTimeout(async () => {
    try {
      const keptEmbed = await buildPostDecisionEmbed(spawn.cardId, userId, "kept");
      if (keptEmbed) await spawn.message.edit({
        embeds: [keptEmbed],
        components: [buildDisabledDecisionRow(guildId, userId, spawn.cardId, spawn.burnValue, "keep")],
      });
    } catch { /* deleted */ }
  }, 90_000);

  return true;
}

// Public: button-click claim. Returns success/false.
// `reason: "self_already"` means this user is the actual winner clicking
// again (double-tap / both-mode race) — caller should silently swallow it.
export async function handleClaimButtonClick(guildId: string, spawnId: string, userId: string): Promise<{
  ok: boolean; reason?: "expired" | "wrong_mode" | "already_caught" | "self_already" | "timed_out";
  timedOutUntil?: Date;
}> {
  const guildSpawns = activeSpawns.get(guildId);
  const spawn = guildSpawns?.get(spawnId);
  if (!spawn) return { ok: false, reason: "expired" };
  if (spawn.catchMode === "type") return { ok: false, reason: "wrong_mode" };
  if (spawn.caught) {
    return { ok: false, reason: spawn.winnerUserId === userId ? "self_already" : "already_caught" };
  }
  const timeout = await getUserTimeout(guildId, userId);
  if (timeout) return { ok: false, reason: "timed_out", timedOutUntil: timeout.expiresAt };
  const awarded = await awardSpawn(guildId, spawnId, userId);
  if (awarded) return { ok: true };
  // Race: someone else won between our checks. If that someone is us, swallow.
  const after = activeSpawns.get(guildId)?.get(spawnId);
  if (after?.winnerUserId === userId) return { ok: false, reason: "self_already" };
  return { ok: false, reason: "already_caught" };
}

// Decision buttons row for the caught card.
function buildDecisionRow(guildId: string, userId: string, cardId: number, burnValue: number): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`catch_burn:${guildId}:${userId}:${cardId}`)
      .setLabel(`🔥 Burn (+${burnValue.toLocaleString()} 💠)`)
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId(`catch_keep:${guildId}:${userId}:${cardId}`)
      .setLabel("💾 Keep it")
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`catch_trade:${guildId}:${userId}:${cardId}`)
      .setLabel("🔄 Offer Trade")
      .setStyle(ButtonStyle.Primary),
  );
}

// Disabled (greyed-out) version of the decision row, used after the catcher
// picks one of the three options so the buttons stay visible but inert.
export function buildDisabledDecisionRow(
  guildId: string, userId: string, cardId: number, burnValue: number, chosen: "burn" | "keep" | "trade",
): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`catch_burn_done:${guildId}:${userId}:${cardId}`)
      .setLabel(chosen === "burn" ? `🔥 Burned (+${burnValue.toLocaleString()} 💠)` : `🔥 Burn (+${burnValue.toLocaleString()} 💠)`)
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(true),
    new ButtonBuilder()
      .setCustomId(`catch_keep_done:${guildId}:${userId}:${cardId}`)
      .setLabel(chosen === "keep" ? "💾 Kept" : "💾 Keep it")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(true),
    new ButtonBuilder()
      .setCustomId(`catch_trade_done:${guildId}:${userId}:${cardId}`)
      .setLabel(chosen === "trade" ? "🔄 Open to Trade" : "🔄 Offer Trade")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(true),
  );
}

// Build a 5-button row with the Claim button at a random column 0–4. The
// other 4 slots are disabled spacers — this randomizes the click target each
// spawn so players can't camp a fixed screen position.
function buildClaimRow(guildId: string, spawnId: string): ActionRowBuilder<ButtonBuilder> {
  const claimPos = Math.floor(Math.random() * 5);
  const buttons: ButtonBuilder[] = [];
  for (let i = 0; i < 5; i++) {
    if (i === claimPos) {
      buttons.push(
        new ButtonBuilder()
          .setCustomId(`spawn_claim:${guildId}:${spawnId}`)
          .setLabel("🎯 Claim")
          .setStyle(ButtonStyle.Success),
      );
    } else {
      buttons.push(
        new ButtonBuilder()
          .setCustomId(`spawn_spacer:${spawnId}:${i}`)
          .setLabel("\u200b")
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(true),
      );
    }
  }
  return new ActionRowBuilder<ButtonBuilder>().addComponents(buttons);
}

// ── Burn / Keep / Offer Trade buttons after catching ─────────────────────────
// Posted in-channel; everyone sees the prompt but only the catcher's clicks
// are accepted (others get an ephemeral "not yours" reply).
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
  { const img = toAbsoluteImageUrl(card.imageUrl); if (img) embed.setImage(img); }
  return embed;
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function buildSpawnEmbed(card: Card, windowSeconds: number, mode: "type" | "button" | "both" = "type"): EmbedBuilder {
  const rarity = card.rarity as Rarity;
  const cardType = card.cardType as CardType;
  const color = RARITY_COLORS[rarity] ?? 0x7289da;
  const badges: string[] = [];
  if (card.isLimitedEdition) badges.push("💎 **LIMITED EDITION**");
  if (card.isEventExclusive) badges.push("🎆 **EVENT EXCLUSIVE**");
  if (card.maxCopies) badges.push(`📦 Only ${card.maxCopies - card.totalMinted} copies remaining`);

  const howTo =
    mode === "button" ? `Hit the **🎯 Claim** button to catch:\n\`\`\`${card.name}\`\`\``
    : mode === "both" ? `Type the card name **or** hit **🎯 Claim**:\n\`\`\`${card.name}\`\`\``
    : `Type the card name exactly to catch it:\n\`\`\`${card.name}\`\`\``;

  const embed = new EmbedBuilder()
    .setTitle(`${RARITY_EMOJI[rarity]} A DN Card has appeared!`)
    .setColor(color)
    .setDescription(
      `${badges.length > 0 ? badges.join("\n") + "\n\n" : ""}${howTo}`,
    )
    .addFields(
      { name: `${TYPE_EMOJI[cardType]} ${card.name}`, value: card.description || "\u200b", inline: false },
      { name: "Rarity", value: `${RARITY_EMOJI[rarity]} ${RARITY_LABELS[rarity]}`, inline: true },
      { name: "Worth", value: `💠 ${card.worthValue.toLocaleString()} shards`, inline: true },
      { name: "⏱️ Window", value: `${windowSeconds}s`, inline: true },
    )
    .setTimestamp();

  if (card.flavor) embed.setFooter({ text: card.flavor });
  { const img = toAbsoluteImageUrl(card.imageUrl); if (img) embed.setImage(img); }
  return embed;
}

export async function buildPostDecisionEmbed(
  cardId: number, userId: string, action: "burned" | "kept" | "trade",
): Promise<EmbedBuilder | null> {
  const cards = await getAllCards();
  const card = cards.find(c => c.id === cardId);
  if (!card) return null;
  const rarity = card.rarity as Rarity;
  const cardType = card.cardType as CardType;

  const titles = {
    burned: `\ud83d\udd25 CAUGHT & BURNED \u2014 ${card.name}`,
    kept:   `\ud83d\udcbe CAUGHT & KEPT \u2014 ${card.name}`,
    trade:  `\ud83d\udd04 CAUGHT & OPEN TO TRADE \u2014 ${card.name}`,
  };
  const descriptions = {
    burned: `\u2705 Caught by <@${userId}> \u2192 \ud83d\udd25 burned for shards\n\n\u200b`,
    kept:   `\u2705 Caught by <@${userId}> \u2192 \ud83d\udcbe kept in collection\n\n\u200b`,
    trade:  `\u2705 Caught by <@${userId}> \u2192 \ud83d\udd04 open to trade!\n\n\u200b`,
  };
  const colors = { burned: 0xe74c3c, kept: 0x00b894, trade: 0x3498db };
  const statusLabels = {
    burned: "\ud83d\udd25 Burned",
    kept:   "\ud83d\udcbe Kept",
    trade:  "\ud83d\udd04 Open to Trade",
  };

  const embed = new EmbedBuilder()
    .setTitle(titles[action])
    .setColor(colors[action])
    .setDescription(descriptions[action])
    .addFields(
      { name: `${TYPE_EMOJI[cardType]} ${card.name}`, value: card.description || "\u200b", inline: false },
      { name: "Rarity", value: `${RARITY_EMOJI[rarity]} ${RARITY_LABELS[rarity]}`, inline: true },
      { name: "Worth", value: `\ud83d\udca0 ${card.worthValue.toLocaleString()} shards`, inline: true },
      { name: "Caught by", value: `<@${userId}>`, inline: true },
      { name: "Status", value: statusLabels[action], inline: true },
    )
    .setTimestamp();
  if (card.flavor) embed.setFooter({ text: card.flavor });
  { const img = toAbsoluteImageUrl(card.imageUrl); if (img) embed.setImage(img); }
  return embed;
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
