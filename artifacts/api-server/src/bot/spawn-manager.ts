import {
  Client, TextChannel, EmbedBuilder,
  ActionRowBuilder, ButtonBuilder, ButtonStyle,
  type Message,
} from "discord.js";
import {
  getOrCreateGuildSettings,
  pickRandomCard,
  catchCard,
  logSpawn,
  markCaught,
  getAllCardsCached,
  getCardWishlisters,
  getUserTimeout,
  getActiveEventBoosts,
  getRarityContext,
  applyRarityContext,
  getActiveSetSpawnPoolCached,
  getRarityDisplayOverrides,
  getGuildRarityWeights,
  getCardDisplayRarity,
} from "./db.js";
import {
  getTypeEmoji,
  SHINY_EMOJI, getShinyMultiplier, getShinyName,
  type Rarity,
} from "./cards-data.js";
import { toAbsoluteImageUrl } from "./image-url.js";
import { applyEmbedOverride } from "./embed-overrides.js";
import { logger } from "../lib/logger.js";
import type { Card } from "@workspace/db";

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
  // Set once the winner clicks Burn / Keep / Trade so the auto-keep timer
  // doesn't overwrite their actual decision 90s later.
  decisionMade: boolean;
}

// After a spawn is caught, keep its entry around for a short cooldown so
// late clicks (double-taps, mobile retries, both-mode type+click race) from
// the actual winner can be silently swallowed instead of showing a confusing
// "spawn expired" message to the person who just caught it.
const POST_CATCH_LINGER_MS = 300_000;

// Funny one-liners shown when a card spawn expires uncaught. Kept short so
// the embed stays scannable.
const ESCAPE_QUIPS: readonly string[] = [
  "It slipped through your fingers and into the void. \ud83d\ude2d",
  "The card looked at you, sighed, and walked away. \ud83d\udeb6",
  "Too slow! It went AWOL. \ud83c\udfc3\u200d\u2642\ufe0f\ud83d\udca8",
  "Mission failed. We'll get 'em next time. \ud83e\udee1",
  "It hopped a chopper and dipped. \ud83d\ude81",
  "Stealth mode engaged. Card is gone. \ud83e\udd77",
  "Nobody typed fast enough \u2014 it deserted. \ud83c\udfc1",
  "Lost contact. Card is MIA. \ud83d\udce1",
  "It saw the chat and noped out. \ud83d\ude45",
  "Tactical retreat. Better luck next drop. \u26f0\ufe0f",
];

// Grace window for collecting concurrent typing-mode catch attempts.
// Anyone whose Discord-stamped message lands within this window of the first
// matching message gets considered; lowest timestamp wins.
const TYPE_GRACE_MS = 600;

// Multiple active spawns per guild (for cardsPerSpawn > 1)
const activeSpawns = new Map<string, Map<string, ActiveSpawn>>();
const spawnTimers = new Map<string, ReturnType<typeof setTimeout>>();

let botClient: Client | null = null;

export function getBotClient(): Client | null { return botClient; }

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
  const displayMap = await getRarityDisplayOverrides(guildId);

  let card: Card | undefined;
  if (forcedCardId) {
    const cards = await getAllCardsCached();
    card = cards.find(c => c.id === forcedCardId);
    if (card?.isArchived) {
      logger.info({ cardId: card.id }, "Refusing to spawn archived card");
      return;
    }
  } else {
    // Sets-driven spawn pool (Phases 1-3): random spawns now pull EXCLUSIVELY
    // from the guild's active set. No active set → no random spawns (Option B).
    // Admin `/admin drop name:<X>` and `/admin give` bypass this by setting forcedCardId.
    const spawnPool = await getActiveSetSpawnPoolCached(guildId);
    if (spawnPool.cards.length === 0) {
      logger.debug({ guildId }, "No active set or active set is empty — skipping random spawn");
      return;
    }
    const rarityWeights = getGuildRarityWeights(settings);
    const eventBoosts = await getActiveEventBoosts(guildId);
    const ctx = await getRarityContext(guildId);
    card = await pickRandomCard(
      rarityWeights, eventBoosts, ctx, spawnPool.cards, spawnPool.rarityWeights,
    );
  }
  if (!card) return;

  // Apply server rarity context (Stage-1 profile + Stage-2 custom tiers) so
  // the spawn/claim embeds and the catch flow (burn payout button label,
  // worth display) all use the overridden numbers.
  const ctxForGuild = await getRarityContext(guildId);
  card = applyRarityContext(card, ctxForGuild);
  const spawnDisplayRarity = getCardDisplayRarity(card, ctxForGuild, settings, displayMap);

  if (card.maxCopies && card.totalMinted >= card.maxCopies) {
    logger.info({ cardId: card.id }, "Card max copies reached, skipping");
    return;
  }

  const channel = botClient.channels.cache.get(settings.spawnChannelId) as TextChannel | undefined;
  if (!channel) return;

  const mode = ((settings as unknown as { catchMode?: string }).catchMode ?? "type") as "type" | "button" | "both";
  const spawnId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const embed = await buildSpawnEmbed(card, settings.catchWindowSeconds, mode, guildId);
  const spawnLog = await logSpawn(guildId, settings.spawnChannelId, card.id, isForced);
  const components = mode === "type" ? [] : [buildClaimRow(guildId, spawnId)];
  let message: Message;
  try {
    message = await channel.send({ embeds: [embed], components });
  } catch (sendErr) {
    logger.warn({ err: sendErr, channelId: settings.spawnChannelId, guildId }, "Failed to send spawn message — check bot permissions in the spawn channel");
    return;
  }

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
    decisionMade: false,
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
      if (gs && gs.size === 0) activeSpawns.delete(guildId);
      try {
        const quip = ESCAPE_QUIPS[Math.floor(Math.random() * ESCAPE_QUIPS.length)]!;
        await message.edit({
          embeds: [
            new EmbedBuilder()
              .setTitle(`\ud83d\udca8 ${cardRef.name} escaped!`)
              .setDescription(
                `${quip}\n\n` +
                `**Rarity:** ${spawnDisplayRarity.emoji} ${spawnDisplayRarity.label}\n` +
                `**Caught by:** *nobody — too slow!*`,
              )
              .setColor(0x636e72)
              .setFooter({ text: "Better luck on the next spawn \u2728" })
              .setTimestamp(),
          ],
          // Clear the stale Claim button row so the message reads cleanly.
          components: [],
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
    if (gs?.get(spawnId)?.caught) {
      gs.delete(spawnId);
      if (gs.size === 0) activeSpawns.delete(guildId);
    }
  }, POST_CATCH_LINGER_MS);
  if (spawn.resolveTimer) { clearTimeout(spawn.resolveTimer); spawn.resolveTimer = null; }

  // Parallel: write collection row + mark spawn log. Both independent DB calls.
  const [{ isShiny }, , shinySettings] = await Promise.all([
    catchCard(guildId, userId, spawn.cardId),
    markCaught(spawn.spawnLogId, userId),
    getOrCreateGuildSettings(guildId),
  ]);

  try {
    const claimedEmbed = await buildClaimedEmbed(spawn.cardId, userId, isShiny, guildId);
    if (claimedEmbed) {
      await spawn.message.edit({
        embeds: [claimedEmbed],
        components: [buildDecisionRow(guildId, userId, spawn.cardId, spawn.burnValue, isShiny, getShinyMultiplier(shinySettings))],
      });
    }
  } catch { /* deleted */ }

  // Auto-keep after 90s if no button pressed — edit the spawn embed in place.
  // Bail out if the winner already clicked Burn/Keep/Trade themselves, or
  // we'd overwrite their actual decision with a misleading "KEPT" embed.
  setTimeout(async () => {
    const gs = activeSpawns.get(guildId);
    const current = gs?.get(spawnId);
    if (current?.decisionMade) return;
    try {
      const keptEmbed = await buildPostDecisionEmbed(spawn.cardId, userId, "kept", guildId);
      if (keptEmbed) await spawn.message.edit({
        embeds: [keptEmbed],
        components: [buildDisabledDecisionRow(guildId, userId, spawn.cardId, spawn.burnValue, "keep")],
      });
      if (current) current.decisionMade = true;
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
// `isShiny` is encoded into the burn customId as a 5th `:1`/`:0` segment
// so the click handler knows which pile to torch and what payout to credit.
// Index.ts treats a missing segment as 0 for backwards-compat.
function buildDecisionRow(guildId: string, userId: string, cardId: number, burnValue: number, isShiny = false, shinyMultiplier = 2): ActionRowBuilder<ButtonBuilder> {
  const effectiveBurn = isShiny ? burnValue * shinyMultiplier : burnValue;
  const shinyFlag = isShiny ? "1" : "0";
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`catch_burn:${guildId}:${userId}:${cardId}:${shinyFlag}`)
      .setLabel(`🔥 Burn (+${effectiveBurn.toLocaleString()} 💠)`)
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

// Marks the winner's Burn/Keep/Trade decision so the auto-keep timer
// won't overwrite the message with a stale "KEPT" embed 90s later.
// Looks up the spawn by (guildId, cardId, userId) since the button handler
// doesn't carry the spawnId. Safe no-op if the entry already lingered out.
export function markDecisionMade(guildId: string, userId: string, cardId: number): void {
  const gs = activeSpawns.get(guildId);
  if (!gs) return;
  for (const spawn of gs.values()) {
    if (spawn.cardId === cardId && spawn.winnerUserId === userId) {
      spawn.decisionMade = true;
      return;
    }
  }
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
async function buildClaimedEmbed(
  cardId: number, userId: string, isShiny: boolean = false, guildId: string | null = null,
): Promise<EmbedBuilder | null> {
  const cards = await getAllCardsCached();
  const rawCard = cards.find(c => c.id === cardId);
  if (!rawCard) return null;
  const ctx = guildId ? await getRarityContext(guildId) : null;
  const card = ctx ? applyRarityContext(rawCard, ctx) : rawCard;
  const rarity = card.rarity as Rarity;
  const cardType = card.cardType;
  const typeEmoji = getTypeEmoji(cardType);
  const settings = guildId ? await getOrCreateGuildSettings(guildId) : null;
  const displayMap = guildId ? await getRarityDisplayOverrides(guildId) : null;
  const displayRarity = getCardDisplayRarity(card, ctx, settings, displayMap);
  const shinyMultiplier = getShinyMultiplier(settings);
  const shinyName = getShinyName(settings);
  const shinyPrefix = isShiny ? `${SHINY_EMOJI} ` : "";
  const worth = isShiny ? card.worthValue * shinyMultiplier : card.worthValue;
  const embed = new EmbedBuilder()
    .setTitle(`✅ CLAIMED — ${shinyPrefix}${card.name}`)
    .setColor(isShiny ? 0xf1c40f : 0x00b894)
    .setDescription(
      `# 🎉 CLAIMED BY <@${userId}>` +
      (isShiny ? `\n## ${SHINY_EMOJI} **${shinyName.toUpperCase()}!** (1 in 200 — counts at ${shinyMultiplier}× value)` : "") +
      `\n\u200b`,
    )
    .addFields(
      { name: `${typeEmoji} ${shinyPrefix}${card.name}`, value: card.description || "\u200b", inline: false },
      { name: "Rarity", value: `${displayRarity.emoji} ${displayRarity.label}`, inline: true },
      { name: "Worth", value: `💠 ${worth.toLocaleString()} shards${isShiny ? ` *(${shinyMultiplier}×)*` : ""}`, inline: true },
      { name: "Caught by", value: `<@${userId}>`, inline: true },
    )
    .setTimestamp();
  if (card.flavor) embed.setFooter({ text: card.flavor });
  const defaultImg = toAbsoluteImageUrl(card.imageUrl);
  if (defaultImg) embed.setImage(defaultImg);
  await applyEmbedOverride(embed, {
    guildId, key: "claimed", rarity, defaultImageUrl: defaultImg,
    ctx: { userId, card: card.name, rarity: displayRarity.label, worth },
  });
  return embed;
}

// ── Helpers ───────────────────────────────────────────────────────────────────
async function buildSpawnEmbed(card: Card, windowSeconds: number, mode: "type" | "button" | "both" = "type", guildId: string | null = null): Promise<EmbedBuilder> {
  const rarity = card.rarity as Rarity;
  const cardType = card.cardType;
  const settings = guildId ? await getOrCreateGuildSettings(guildId) : null;
  const displayMap = guildId ? await getRarityDisplayOverrides(guildId) : null;
  const ctx = guildId ? await getRarityContext(guildId) : null;
  const displayRarity = getCardDisplayRarity(card, ctx, settings, displayMap);
  const badges: string[] = [];
  if (card.isLimitedEdition) badges.push("💎 **LIMITED EDITION**");
  if (card.isEventExclusive) badges.push("🎆 **EVENT EXCLUSIVE**");
  if (card.maxCopies) badges.push(`📦 Only ${card.maxCopies - card.totalMinted} copies remaining`);

  const howTo =
    mode === "button" ? `Hit the **🎯 Claim** button to catch:\n\`\`\`${card.name}\`\`\``
    : mode === "both" ? `Type the card name **or** hit **🎯 Claim**:\n\`\`\`${card.name}\`\`\``
    : `Type the card name exactly to catch it:\n\`\`\`${card.name}\`\`\``;

  const embed = new EmbedBuilder()
    .setTitle(`${displayRarity.emoji} A DN Card has appeared!`)
    .setColor(displayRarity.color)
    .setDescription(
      `${badges.length > 0 ? badges.join("\n") + "\n\n" : ""}${howTo}`,
    )
    .addFields(
      { name: `${getTypeEmoji(cardType)} ${card.name}`, value: card.description || "\u200b", inline: false },
      { name: "Rarity", value: `${displayRarity.emoji} ${displayRarity.label}`, inline: true },
      { name: "Worth", value: `💠 ${card.worthValue.toLocaleString()} shards`, inline: true },
      { name: "⏱️ Window", value: `${windowSeconds}s`, inline: true },
    )
    .setTimestamp();

  if (card.flavor) embed.setFooter({ text: card.flavor });
  const defaultImg = toAbsoluteImageUrl(card.imageUrl);
  if (defaultImg) embed.setImage(defaultImg);
  await applyEmbedOverride(embed, {
    guildId, key: "spawn", rarity, defaultImageUrl: defaultImg,
    ctx: { card: card.name, rarity: displayRarity.label, worth: card.worthValue },
  });
  return embed;
}

export async function buildPostDecisionEmbed(
  cardId: number, userId: string, action: "burned" | "kept" | "trade", guildId: string | null = null,
): Promise<EmbedBuilder | null> {
  const cards = await getAllCardsCached();
  const rawCard = cards.find(c => c.id === cardId);
  if (!rawCard) return null;
  const ctxForDecision = guildId ? await getRarityContext(guildId) : null;
  const card = ctxForDecision ? applyRarityContext(rawCard, ctxForDecision) : rawCard;
  const rarity = card.rarity as Rarity;
  const cardType = card.cardType;

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

  const settings = guildId ? await getOrCreateGuildSettings(guildId) : null;
  const displayMap = guildId ? await getRarityDisplayOverrides(guildId) : null;
  const displayRarity = getCardDisplayRarity(card, ctxForDecision, settings, displayMap);
  const embed = new EmbedBuilder()
    .setTitle(titles[action])
    .setColor(colors[action])
    .setDescription(descriptions[action])
    .addFields(
      { name: `${getTypeEmoji(cardType)} ${card.name}`, value: card.description || "\u200b", inline: false },
      { name: "Rarity", value: `${displayRarity.emoji} ${displayRarity.label}`, inline: true },
      { name: "Worth", value: `\ud83d\udca0 ${card.worthValue.toLocaleString()} shards`, inline: true },
      { name: "Caught by", value: `<@${userId}>`, inline: true },
      { name: "Status", value: statusLabels[action], inline: true },
    )
    .setTimestamp();
  if (card.flavor) embed.setFooter({ text: card.flavor });
  const defaultImg = toAbsoluteImageUrl(card.imageUrl);
  if (defaultImg) embed.setImage(defaultImg);
  await applyEmbedOverride(embed, {
    guildId, key: "claimed", rarity, defaultImageUrl: defaultImg,
    ctx: { userId, card: card.name, rarity: displayRarity.label, worth: card.worthValue },
  });
  return embed;
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
