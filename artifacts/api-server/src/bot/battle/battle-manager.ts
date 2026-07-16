// Battle Manager — orchestrates the whole battle lifecycle inside ONE message.
//
// Owns the in-memory battle state machine (challenge → prep → combat → ended),
// all component interactions, turn timers, the AI loop, and the cinematic edits.
// It ties together every engine (stat, combat, ai, reward, achievement, daily,
// season, logging) but keeps them decoupled — this file is the only place that
// knows about Discord messages/interactions.
//
// The design is deliberately N-combatant-friendly: a battle is two "sides", each
// currently a single Combatant. New modes (2v2, boss raids, tower, tournaments)
// slot in by growing a side into an array without touching combat-engine.

import {
  EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
  StringSelectMenuBuilder, MessageFlags, AttachmentBuilder,
  type ChatInputCommandInteraction, type ButtonInteraction,
  type StringSelectMenuInteraction, type Message, type User,
} from "discord.js";
import { logger } from "../../lib/logger.js";
import { renderBattleImage, type RenderCard } from "./image/render.js";
import { renderAttackFrame, renderBattleVictory } from "../animations/index.js";
import type { AnimationSpeed } from "../animations/types.js";
import { toAbsoluteImageUrl } from "../image-url.js";
import { getBotClient } from "../client-holder.js";
import { removeCardFromUser, restoreCardToUser, getOrCreateGuildSettings, getCardsInSet } from "../db.js";
import type { BattleSettings } from "@workspace/db";
import type { Combatant, MoveType, AiDifficulty, Rarity } from "./types.js";
import { AI_DIFFICULTIES } from "./types.js";
import { getBattleSettings, rarityAllowed, typeAllowed } from "./config-engine.js";
import { getScaledStats, powerRating } from "./stat-engine.js";
import { inferMoveset, getMoveset } from "./movesets.js";
import { inferSpecialEffect, getEffectDef } from "./special-cards.js";
import { resolveMove, startOfTurn, availableMoves } from "./combat-engine.js";
import { chooseAiMove, pickAiCardIndex } from "./ai-engine.js";
import { ARENAS, ARENA_KEYS, getArena, arenaLabel, isArenaKey } from "./arenas.js";
import {
  getOwnedBattleCards, getAllBattleCards, acquireBattleLock, releaseBattleLock,
  getUserLock, sweepStaleLocks, getAllLocks, deleteAllLocks, type OwnedBattleCard,
} from "./db.js";
import { processBattleRewards, type ParticipantResult, type RewardOutcome } from "./reward-engine.js";
import { advanceDaily } from "./daily-engine.js";
import { ensureSeason } from "./season-engine.js";
import { logBattleResult } from "./logging-engine.js";
import { grantFreePack } from "./pack-grant.js";
import {
  buildBattleLogEmbed, buildBattleStatusEmbed, buildIntroFrame, buildCoinFlipEmbed, buildWinnerEmbed,
  type BattleView,
} from "./embeds.js";
import { formatAchievementLine } from "./achievement-engine.js";
import { rarityLabel, rarityEmoji, rarityColor, type RarityDisplayMap } from "../cards-data.js";
import { getRarityContext, getRarityDisplayOverrides } from "../db.js";
import { getCardDisplayRarity, BUILTIN_POSITIONS, type RarityContext } from "../rarity-runtime.js";

const MAX_BATTLE_MS = 20 * 60 * 1000;   // hard TTL safety net
const DEFAULT_FRAME_MS = 950;            // fallback delay between animation frames
const MAX_COMBAT_TURNS = 30;             // sudden-death cap → decide by HP%

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));
const AI_ID = "AI";

// Per-guild animation pace (the "speed controller"), clamped to a sane range.
function frameMs(rt: BattleRuntime): number {
  const v = rt.settings.frameDelayMs ?? DEFAULT_FRAME_MS;
  return Math.max(120, Math.min(4000, v));
}

type Phase = "challenge" | "aidiff" | "prep" | "combat" | "ended";

interface PrepState {
  cardId: number | null;
  specialCardId: number | null;
  stake: boolean;
  coin: "heads" | "tails" | null;
  ready: boolean;
  page: number; // 0-based page for the card picker (25 cards per page)
}

interface BattleRuntime {
  id: string;
  guildId: string;
  channelId: string;
  message: Message | null;
  settings: BattleSettings;

  challengerId: string;
  challengerName: string;
  opponentId: string | null;   // null until accepted; AI_ID for AI
  opponentName: string;
  isAi: boolean;
  aiDifficulty: AiDifficulty;

  phase: Phase;
  prep: Map<string, PrepState>;   // human userId → prep
  eligibleCache: Map<string, OwnedBattleCard[]>;
  // Active Card Set membership (card IDs) — the single source of truth for which
  // cards may battle. `null` = no active set configured → no restriction (so
  // battles never lock out). Memoized per battle. `undefined` = not resolved yet.
  activeSetIds?: Set<number> | null;

  a: Combatant | null;   // side 0 = challenger
  b: Combatant | null;   // side 1 = opponent / AI
  turnNumber: number;
  currentSide: 0 | 1;
  staked: boolean;
  displayMap: RarityDisplayMap | null;   // source-of-truth rarity display overrides
  ctx: RarityContext;                    // source-of-truth rarity context (profiles + custom tiers)
  // When a staked PvP battle starts, one copy of each fighter's card is removed
  // from their collection and held here (escrow). This makes it impossible to
  // burn/trade a staked card mid-battle to dodge a loss; the copies are settled
  // (winner takes both / draw returns both) exactly once when the battle ends.
  escrow: { challengerCardId: number; opponentCardId: number } | null;
  escrowSettled: boolean;
  log: string[];
  coinCall: string;

  // per-side battle telemetry for rewards/achievements
  crits: [number, number];
  dmg: [number, number];
  wentLow: [boolean, boolean];

  // Optional GIF frame shown once on the next combat render, then cleared.
  turnAnimation: Buffer | null;

  turnTimer: ReturnType<typeof setTimeout> | null;
  aiOfferTimer: ReturnType<typeof setTimeout> | null;
  ttlTimer: ReturnType<typeof setTimeout> | null;
  processing: boolean;
  createdAt: number;

  // Layered VS battle image (rendered once at combat start; re-attached each
  // combat render). null when @napi-rs/canvas isn't installed — the battle then
  // shows the plain embed with no image, never an error.
  vsImage: Buffer | null;
}

const battles = new Map<string, BattleRuntime>();

function newId(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}

function getRuntime(id: string): BattleRuntime | undefined {
  return battles.get(id);
}

// ── Eligibility ──────────────────────────────────────────────────────────────
// Use the card's source-of-truth rarity (built-in or custom tier position) for
// the rarity window check. Custom tiers compare their position against the
// built-in min/max rarity positions so "allow all" still includes them.
export function isCardEligible(settings: BattleSettings, c: OwnedBattleCard, ctx?: RarityContext): boolean {
  if (c.config && c.config.enabled === false) return false;
  const key = c.effectiveRarityKey ?? c.rarity;
  if (ctx && key.startsWith("custom:")) {
    const tier = ctx.customByCard.get(c.id);
    if (tier) {
      const minPos = BUILTIN_POSITIONS[settings.minRarity as Rarity] ?? 1;
      const maxPos = BUILTIN_POSITIONS[settings.maxRarity as Rarity] ?? 6;
      return tier.position >= minPos && tier.position <= maxPos && typeAllowed(settings, c.cardType);
    }
  }
  return rarityAllowed(settings, c.rarity) && typeAllowed(settings, c.cardType);
}

// Resolve (and memoize) the Active Card Set membership for this battle. This is
// the SAME set source packs/spawns use (`getCardsInSet` over the guild's active
// set + secondary set). `null` means no active set is configured, in which case
// we impose no restriction so battles keep working.
async function resolveActiveSetIds(rt: BattleRuntime): Promise<Set<number> | null> {
  if (rt.activeSetIds !== undefined) return rt.activeSetIds;
  try {
    const settings = await getOrCreateGuildSettings(rt.guildId);
    const setIds = [settings.activeSetId, settings.activeSetIdSecondary]
      .filter((x): x is number => x != null);
    if (setIds.length === 0) { rt.activeSetIds = null; return null; }
    const lists = await Promise.all(setIds.map(sid => getCardsInSet(sid, rt.guildId)));
    const ids = new Set<number>();
    for (const list of lists) for (const c of list) ids.add(c.id);
    rt.activeSetIds = ids.size > 0 ? ids : null;
  } catch {
    rt.activeSetIds = null; // never block battles on a lookup failure
  }
  return rt.activeSetIds;
}

// A card may battle only if it passes battle eligibility AND (when an active set
// exists) belongs to it.
function inActiveSet(setIds: Set<number> | null, cardId: number): boolean {
  return !setIds || setIds.has(cardId);
}

async function eligibleForUser(rt: BattleRuntime, userId: string): Promise<OwnedBattleCard[]> {
  const cached = rt.eligibleCache.get(userId);
  if (cached) return cached;
  const [owned, setIds] = await Promise.all([
    getOwnedBattleCards(rt.guildId, userId, rt.ctx),
    resolveActiveSetIds(rt),
  ]);
  const list = owned
    .filter(c => isCardEligible(rt.settings, c, rt.ctx) && inActiveSet(setIds, c.id))
    .sort((x, y) =>
      powerRating(getScaledStats(cardish(y), y.config, rt.settings, y.level))
      - powerRating(getScaledStats(cardish(x), x.config, rt.settings, x.level)));
  rt.eligibleCache.set(userId, list);
  return list;
}

function cardish(c: OwnedBattleCard) {
  return { id: c.id, name: c.name, rarity: c.rarity, worthValue: c.worthValue, cardType: c.cardType };
}

function buildCombatant(
  rt: BattleRuntime, userId: string, name: string, isAi: boolean, side: 0 | 1,
  card: OwnedBattleCard, special: OwnedBattleCard | null, aiDifficulty?: AiDifficulty,
  levelOverride?: number,
): Combatant {
  // A per-card battle-rarity override (set in the admin card editor) drives both
  // stat derivation and the rarity shown in the battle embed, without touching
  // the real card. Stats resolve through the single get_scaled_stats entry point,
  // scaled by the card's level (the AI can override to match the player's card).
  const battleRarity = (card.config?.rarity as Rarity) || (card.rarity as Rarity);
  const level = levelOverride ?? card.level;
  const stats = getScaledStats(cardish(card), card.config, rt.settings, level, battleRarity);
  const moveset = card.config?.moveset ?? inferMoveset(card.cardType, battleRarity);
  let specialEffect: string | null = null;
  let specialCooldownMax = 3;
  if (rt.settings.specialCardsEnabled && special) {
    specialEffect = special.config?.specialEffect ?? inferSpecialEffect(special.cardType, special.rarity);
    specialCooldownMax = special.config?.specialCooldown ?? 3;
  }
  return {
    userId, displayName: name, isAi, aiDifficulty, side,
    cardId: card.id, cardName: card.name, cardRarity: battleRarity,
    cardType: card.cardType, cardImageUrl: toAbsoluteImageUrl(card.imageUrl),
    cardRarityDisplay: card.displayRarity,
    moveset,
    stats,
    hp: stats.maxHealth, shield: 0, energy: 40, ultimate: 0, status: [],
    specialCardId: special?.id ?? null,
    specialCardName: special?.name ?? null,
    specialEffect,
    specialCooldownMax, specialCooldownRemaining: 0,
    defending: false, nextAttackBoostPct: 0, doubleNextAttack: false,
    frozenTurns: 0, lastStandUsed: false,
  };
}

// ── Entry: /battle ───────────────────────────────────────────────────────────
export async function startChallenge(
  interaction: ChatInputCommandInteraction, opponent: User | null,
): Promise<void> {
  const guild = interaction.guild;
  if (!guild) { await interaction.reply({ content: "Battles can only be started in a server.", flags: MessageFlags.Ephemeral }); return; }
  const guildId = guild.id;
  const settings = await getBattleSettings(guildId);
  const [displayMap, ctx] = await Promise.all([getRarityDisplayOverrides(guildId), getRarityContext(guildId)]);

  if (!settings.enabled) {
    await interaction.reply({ content: "⚔️ The battle system is currently disabled on this server.", flags: MessageFlags.Ephemeral });
    return;
  }
  if (!settings.setupComplete) {
    await interaction.reply({ content: "🛠️ Battles aren't set up yet. An admin needs to run **/battle_admin** → **Setup Wizard** first.", flags: MessageFlags.Ephemeral });
    return;
  }
  if (settings.battleChannelId && settings.battleChannelId !== interaction.channelId) {
    await interaction.reply({ content: `⚔️ Battles must be started in <#${settings.battleChannelId}>.`, flags: MessageFlags.Ephemeral });
    return;
  }
  if (opponent && (opponent.bot || opponent.id === interaction.user.id)) {
    await interaction.reply({ content: "Pick a real opponent (not yourself or a bot). Leave it empty to battle the AI.", flags: MessageFlags.Ephemeral });
    return;
  }

  // Multiple-battle prevention (in-memory + DB lock).
  const existingLock = await getUserLock(guildId, interaction.user.id);
  if (existingLock) {
    await interaction.reply({ content: "⚠️ You're already in a battle. Finish it first.", flags: MessageFlags.Ephemeral });
    return;
  }
  const challengerCards = await getOwnedBattleCards(guildId, interaction.user.id, ctx);
  if (challengerCards.filter(c => isCardEligible(settings, c, ctx)).length === 0) {
    await interaction.reply({ content: "You don't own any battle-eligible cards yet. Catch or open packs first!", flags: MessageFlags.Ephemeral });
    return;
  }

  const id = newId();
  const rt: BattleRuntime = {
    id, guildId, channelId: interaction.channelId!, message: null, settings,
    challengerId: interaction.user.id, challengerName: interaction.user.username,
    opponentId: opponent ? opponent.id : null,
    opponentName: opponent ? opponent.username : "AI",
    isAi: !opponent, aiDifficulty: "beginner",
    phase: opponent ? "challenge" : "aidiff",
    prep: new Map(), eligibleCache: new Map(),
    a: null, b: null, turnNumber: 1, currentSide: 0, staked: false,
    escrow: null, escrowSettled: false, log: [], coinCall: "heads",
    crits: [0, 0], dmg: [0, 0], wentLow: [false, false],
    turnAnimation: null,
    turnTimer: null, aiOfferTimer: null, ttlTimer: null, processing: false, createdAt: Date.now(),
    displayMap,
    ctx,
    vsImage: null,
  };
  battles.set(id, rt);

  // Reserve the challenger immediately (DB lock).
  const locked = await acquireBattleLock(guildId, interaction.user.id, id, null, false);
  if (!locked) {
    battles.delete(id);
    await interaction.reply({ content: "⚠️ You're already in a battle. Finish it first.", flags: MessageFlags.Ephemeral });
    return;
  }

  rt.ttlTimer = setTimeout(() => { void endBattleByTimeout(rt); }, MAX_BATTLE_MS);

  if (opponent) {
    await interaction.reply({
      embeds: [buildChallengeEmbed(rt, opponent)],
      components: buildChallengeComponents(rt),
    });
    rt.message = await interaction.fetchReply();
    // Offer AI after the configured wait if the opponent hasn't accepted.
    rt.aiOfferTimer = setTimeout(() => { void offerAi(rt); }, Math.max(5, rt.settings.aiOfferSeconds) * 1000);
  } else {
    await interaction.reply({
      embeds: [buildAiDifficultyEmbed(rt)],
      components: buildAiDifficultyComponents(rt),
    });
    rt.message = await interaction.fetchReply();
  }
}

// ── Component dispatch (called from index.ts for any `battle:` customId) ──────
export async function handleBattleComponent(
  interaction: ButtonInteraction | StringSelectMenuInteraction,
): Promise<void> {
  const parts = interaction.customId.split(":"); // battle:<action>:<id>[:...]
  const action = parts[1];
  const id = parts[2];
  const rt = id ? getRuntime(id) : undefined;

  if (!rt) {
    await safeEphemeral(interaction, "This battle has ended or expired.");
    return;
  }

  try {
    if (interaction.isButton()) {
      switch (action) {
        case "accept": return void await onAccept(rt, interaction);
        case "decline": return void await onDecline(rt, interaction);
        case "cancel": return void await onCancel(rt, interaction);
        case "ai": return void await onConvertToAi(rt, interaction);
        case "aidiff": return void await onPickAiDifficulty(rt, interaction, parts[3] as AiDifficulty);
        case "prep": return void await onOpenPrep(rt, interaction);
        case "pstake": return void await onToggleStake(rt, interaction);
        case "pcoin": return void await onPickCoin(rt, interaction, parts[3] as "heads" | "tails");
        case "ppage": return void await onPage(rt, interaction, parts[3] as "prev" | "next");
        case "pready": return void await onReady(rt, interaction);
        case "move": return void await onMoveButton(rt, interaction, parts[3] as MoveType);
        default: return void await safeEphemeral(interaction, "Unknown action.");
      }
    } else {
      switch (action) {
        case "pcard": return void await onSelectCard(rt, interaction);
        case "pspecial": return void await onSelectSpecial(rt, interaction);
        default: return void await safeEphemeral(interaction, "Unknown selection.");
      }
    }
  } catch (err) {
    logger.error({ err, battleId: rt.id, action }, "battle component error");
    await safeEphemeral(interaction, "Something went wrong with that action.").catch(() => {});
  }
}

// ── Challenge phase ──────────────────────────────────────────────────────────
async function onAccept(rt: BattleRuntime, interaction: ButtonInteraction) {
  if (interaction.user.id !== rt.opponentId) {
    return safeEphemeral(interaction, "Only the challenged player can accept.");
  }
  if (rt.phase !== "challenge") return safeEphemeral(interaction, "This challenge is no longer open.");
  const eligible = (await getOwnedBattleCards(rt.guildId, interaction.user.id, rt.ctx)).filter(c => isCardEligible(rt.settings, c, rt.ctx));
  if (eligible.length === 0) return safeEphemeral(interaction, "You have no battle-eligible cards to fight with.");
  const locked = await acquireBattleLock(rt.guildId, interaction.user.id, rt.id, null, false);
  if (!locked) return safeEphemeral(interaction, "You're already in another battle.");

  clearTimer(rt, "aiOfferTimer");
  rt.opponentName = interaction.user.username;
  await enterPrep(rt, interaction);
}

async function onDecline(rt: BattleRuntime, interaction: ButtonInteraction) {
  if (interaction.user.id !== rt.opponentId && interaction.user.id !== rt.challengerId) {
    return safeEphemeral(interaction, "Only the players involved can decline.");
  }
  await interaction.update({
    embeds: [new EmbedBuilder().setColor(0x99aab5).setTitle("❌ Challenge declined").setDescription(`<@${rt.opponentId}> declined the battle.`)],
    components: [],
  }).catch(() => {});
  await teardown(rt);
}

async function onCancel(rt: BattleRuntime, interaction: ButtonInteraction) {
  if (interaction.user.id !== rt.challengerId) return safeEphemeral(interaction, "Only the challenger can cancel.");
  await interaction.update({
    embeds: [new EmbedBuilder().setColor(0x99aab5).setTitle("🚫 Battle cancelled").setDescription("The challenger called it off.")],
    components: [],
  }).catch(() => {});
  await teardown(rt);
}

async function offerAi(rt: BattleRuntime) {
  if (rt.phase !== "challenge" || !rt.message) return;
  await rt.message.edit({
    embeds: [buildChallengeEmbed(rt, null, true)],
    components: buildChallengeComponents(rt, true),
  }).catch(() => {});
}

async function onConvertToAi(rt: BattleRuntime, interaction: ButtonInteraction) {
  if (interaction.user.id !== rt.challengerId) return safeEphemeral(interaction, "Only the challenger can switch to an AI battle.");
  if (!rt.settings.aiEnabled) return safeEphemeral(interaction, "AI battles are disabled on this server.");
  clearTimer(rt, "aiOfferTimer");
  rt.isAi = true; rt.opponentId = AI_ID; rt.opponentName = "AI"; rt.phase = "aidiff";
  await interaction.update({
    embeds: [buildAiDifficultyEmbed(rt)],
    components: buildAiDifficultyComponents(rt),
  }).catch(() => {});
}

async function onPickAiDifficulty(rt: BattleRuntime, interaction: ButtonInteraction, diff: AiDifficulty) {
  if (interaction.user.id !== rt.challengerId) return safeEphemeral(interaction, "Only the challenger picks the arena.");
  if (!isArenaKey(diff)) return safeEphemeral(interaction, "Unknown arena.");
  rt.isAi = true; rt.opponentId = AI_ID; rt.aiDifficulty = diff;
  await enterPrep(rt, interaction);
}

// ── Prep phase ───────────────────────────────────────────────────────────────
async function enterPrep(rt: BattleRuntime, interaction: ButtonInteraction) {
  rt.phase = "prep";
  rt.prep.set(rt.challengerId, { cardId: null, specialCardId: null, stake: false, coin: null, ready: false, page: 0 });
  if (!rt.isAi && rt.opponentId) {
    rt.prep.set(rt.opponentId, { cardId: null, specialCardId: null, stake: false, coin: null, ready: false, page: 0 });
  }
  await interaction.update({
    embeds: [buildPrepEmbed(rt)],
    components: buildPrepSharedComponents(rt),
  }).catch(() => {});
}

async function onOpenPrep(rt: BattleRuntime, interaction: ButtonInteraction) {
  if (!rt.prep.has(interaction.user.id)) return safeEphemeral(interaction, "You're not part of this battle.");
  const eligible = await eligibleForUser(rt, interaction.user.id);
  if (eligible.length === 0) return safeEphemeral(interaction, "You have no battle-eligible cards.");
  await interaction.reply({
    content: "🎴 **Prepare for battle** — pick your card, an optional special support card, your coin call, and (optionally) stake your card. Then press **Ready**.",
    embeds: [buildPersonalPrepEmbed(rt, interaction.user.id)],
    components: buildPersonalPrepComponents(rt, interaction.user.id, eligible),
    flags: MessageFlags.Ephemeral,
  }).catch(() => {});
}

async function onSelectCard(rt: BattleRuntime, interaction: StringSelectMenuInteraction) {
  const prep = rt.prep.get(interaction.user.id);
  if (!prep) return safeEphemeral(interaction, "You're not part of this battle.");
  prep.cardId = Number(interaction.values[0]);
  const eligible = await eligibleForUser(rt, interaction.user.id);
  await interaction.update({
    embeds: [buildPersonalPrepEmbed(rt, interaction.user.id)],
    components: buildPersonalPrepComponents(rt, interaction.user.id, eligible),
  }).catch(() => {});
}

async function onSelectSpecial(rt: BattleRuntime, interaction: StringSelectMenuInteraction) {
  const prep = rt.prep.get(interaction.user.id);
  if (!prep) return safeEphemeral(interaction, "You're not part of this battle.");
  const v = interaction.values[0];
  prep.specialCardId = v === "none" ? null : Number(v);
  const eligible = await eligibleForUser(rt, interaction.user.id);
  await interaction.update({
    embeds: [buildPersonalPrepEmbed(rt, interaction.user.id)],
    components: buildPersonalPrepComponents(rt, interaction.user.id, eligible),
  }).catch(() => {});
}

async function onToggleStake(rt: BattleRuntime, interaction: ButtonInteraction) {
  const prep = rt.prep.get(interaction.user.id);
  if (!prep) return safeEphemeral(interaction, "You're not part of this battle.");
  if (rt.isAi || !rt.settings.stakingEnabled) return safeEphemeral(interaction, "Staking isn't available for this battle.");
  prep.stake = !prep.stake;
  const eligible = await eligibleForUser(rt, interaction.user.id);
  await interaction.update({
    embeds: [buildPersonalPrepEmbed(rt, interaction.user.id)],
    components: buildPersonalPrepComponents(rt, interaction.user.id, eligible),
  }).catch(() => {});
}

async function onPickCoin(rt: BattleRuntime, interaction: ButtonInteraction, coin: "heads" | "tails") {
  const prep = rt.prep.get(interaction.user.id);
  if (!prep) return safeEphemeral(interaction, "You're not part of this battle.");
  prep.coin = coin;
  const eligible = await eligibleForUser(rt, interaction.user.id);
  await interaction.update({
    embeds: [buildPersonalPrepEmbed(rt, interaction.user.id)],
    components: buildPersonalPrepComponents(rt, interaction.user.id, eligible),
  }).catch(() => {});
}

async function onPage(rt: BattleRuntime, interaction: ButtonInteraction, direction: "prev" | "next") {
  const prep = rt.prep.get(interaction.user.id);
  if (!prep) return safeEphemeral(interaction, "You're not part of this battle.");
  const eligible = await eligibleForUser(rt, interaction.user.id);
  const totalPages = Math.ceil(eligible.length / PICKER_PAGE_SIZE);
  const current = prep.page ?? 0;
  const next = direction === "prev" ? Math.max(0, current - 1) : Math.min(totalPages - 1, current + 1);
  prep.page = next;
  await interaction.update({
    embeds: [buildPersonalPrepEmbed(rt, interaction.user.id)],
    components: buildPersonalPrepComponents(rt, interaction.user.id, eligible),
  }).catch(() => {});
}

async function onReady(rt: BattleRuntime, interaction: ButtonInteraction) {
  const prep = rt.prep.get(interaction.user.id);
  if (!prep) return safeEphemeral(interaction, "You're not part of this battle.");
  if (!prep.cardId) return safeEphemeral(interaction, "Pick a battle card first.");
  if (!prep.coin) prep.coin = Math.random() < 0.5 ? "heads" : "tails";
  prep.ready = true;

  await interaction.update({
    content: "✅ You're ready! Waiting for the battle to begin…",
    embeds: [buildPersonalPrepEmbed(rt, interaction.user.id)],
    components: [],
  }).catch(() => {});

  // Refresh the shared readiness board.
  if (rt.message) {
    await rt.message.edit({ embeds: [buildPrepEmbed(rt)], components: buildPrepSharedComponents(rt) }).catch(() => {});
  }

  const humans = [...rt.prep.values()];
  if (humans.every(p => p.ready)) {
    await beginCombat(rt);
  }
}

// ── Combat start ─────────────────────────────────────────────────────────────
async function beginCombat(rt: BattleRuntime) {
  rt.phase = "combat";
  clearTimer(rt, "aiOfferTimer");

  // Build challenger.
  const chalPrep = rt.prep.get(rt.challengerId)!;
  const chalEligible = await eligibleForUser(rt, rt.challengerId);
  const chalCard = chalEligible.find(c => c.id === chalPrep.cardId) ?? chalEligible[0]!;
  const chalSpecial = chalPrep.specialCardId ? chalEligible.find(c => c.id === chalPrep.specialCardId) ?? null : null;
  rt.a = buildCombatant(rt, rt.challengerId, rt.challengerName, false, 0, chalCard, chalSpecial);

  // Build opponent (human or AI).
  if (rt.isAi) {
    // AI draws from the SAME Active Card Set as packs/players — never the whole
    // database. Falls back to the challenger's eligible cards if the set is empty.
    const setIds = await resolveActiveSetIds(rt);
    const pool = (await getAllBattleCards(rt.guildId, rt.ctx))
      .filter(c => isCardEligible(rt.settings, c, rt.ctx) && inActiveSet(setIds, c.id));
    const usePool = pool.length ? pool : chalEligible;
    const scores = usePool.map(c => powerRating(getScaledStats(cardish(c), c.config, rt.settings, c.level)));
    const idx = pickAiCardIndex(scores, rt.aiDifficulty);
    const aiCard = usePool[idx] ?? usePool[0]!;
    const aiSpecial = usePool[Math.floor(Math.random() * usePool.length)] ?? null;
    // The AI card is scaled to the ARENA's level — an under-levelled player
    // card facing the Ascended Arena's Lv 100 AI is a fast wipe (the grind hook).
    const arena = getArena(rt.aiDifficulty);
    rt.b = buildCombatant(rt, AI_ID, `AI · ${arena.name}`, true, 1, aiCard, aiSpecial, rt.aiDifficulty, arena.aiLevel);
    rt.staked = false;
  } else {
    const oppPrep = rt.prep.get(rt.opponentId!)!;
    const oppEligible = await eligibleForUser(rt, rt.opponentId!);
    const oppCard = oppEligible.find(c => c.id === oppPrep.cardId) ?? oppEligible[0]!;
    const oppSpecial = oppPrep.specialCardId ? oppEligible.find(c => c.id === oppPrep.specialCardId) ?? null : null;
    rt.b = buildCombatant(rt, rt.opponentId!, rt.opponentName, false, 1, oppCard, oppSpecial);
    rt.staked = rt.settings.stakingEnabled && chalPrep.stake && oppPrep.stake;
  }

  // Escrow staked cards up-front (before locks reflect the stake) so neither
  // player can burn or trade the card away mid-battle. If either escrow fails
  // (card no longer owned), refund the other and fall back to a normal battle.
  if (rt.staked && rt.a && rt.b) {
    const okA = await removeCardFromUser(rt.guildId, rt.a.userId, rt.a.cardId).catch(() => ({ success: false, remaining: 0 }));
    const okB = okA.success
      ? await removeCardFromUser(rt.guildId, rt.b.userId, rt.b.cardId).catch(() => ({ success: false, remaining: 0 }))
      : { success: false, remaining: 0 };
    if (okA.success && okB.success) {
      rt.escrow = { challengerCardId: rt.a.cardId, opponentCardId: rt.b.cardId };
    } else {
      if (okA.success) await restoreCardToUser(rt.guildId, rt.a.userId, rt.a.cardId).catch(() => {});
      rt.staked = false;
      rt.log.push("⚠️ Stake cancelled — a staked card was no longer owned. Fighting a normal battle.");
    }
  }

  // Record staked cards on the locks (card-lock during battle).
  await releaseAndRelock(rt);

  // Render the layered VS battle image once (background + both cards + VS).
  // Fire-and-forget safe: null on any failure → battle just shows no image.
  if (rt.a && rt.b) {
    rt.vsImage = await renderBattleImage(
      combatantToRenderCard(rt, rt.a),
      combatantToRenderCard(rt, rt.b),
    ).catch(() => null);
  }

  // Coin flip → first mover.
  const flip = Math.random() < 0.5 ? "heads" : "tails";
  rt.coinCall = flip;
  const aCall = rt.prep.get(rt.challengerId)?.coin ?? "heads";
  const bCall = rt.isAi ? (Math.random() < 0.5 ? "heads" : "tails") : (rt.prep.get(rt.opponentId!)?.coin ?? "tails");
  const aMatch = aCall === flip, bMatch = bCall === flip;
  let firstSide: 0 | 1;
  if (aMatch && !bMatch) firstSide = 0;
  else if (bMatch && !aMatch) firstSide = 1;
  else firstSide = Math.random() < 0.5 ? 0 : 1;
  rt.currentSide = firstSide;

  await ensureSeason(rt.guildId).catch(() => {});
  await playIntro(rt, firstSide, flip);
}

// Re-acquire locks so both users' rows carry their staked card id. (The DB lock
// is one row per user; we upsert-by-delete+insert to update the card id.)
async function releaseAndRelock(rt: BattleRuntime) {
  if (!rt.a) return;
  await releaseBattleLock(rt.guildId, rt.challengerId, rt.id).catch(() => {});
  await acquireBattleLock(rt.guildId, rt.challengerId, rt.id, rt.a.cardId, rt.staked).catch(() => {});
  if (!rt.isAi && rt.b) {
    await releaseBattleLock(rt.guildId, rt.b.userId, rt.id).catch(() => {});
    await acquireBattleLock(rt.guildId, rt.b.userId, rt.id, rt.b.cardId, rt.staked).catch(() => {});
  }
}

async function playIntro(rt: BattleRuntime, firstSide: 0 | 1, flip: string) {
  if (!rt.message) return;
  const view = () => toView(rt);

  // ── VS reveal ──────────────────────────────────────────────────────────────
  // Show the battlefield VS image FIRST, like a real fight intro, before the
  // battle screen appears. If the image lib isn't installed, fall back to the
  // original text intro frames so the reveal still plays.
  const reveal = vsTop(rt, `⚔️ ${rt.a?.cardName ?? "Challenger"} VS ${rt.b?.cardName ?? "Opponent"}`);
  if (reveal.embed) {
    await rt.message.edit({ content: null, embeds: [reveal.embed], files: [reveal.file!], components: [] }).catch(() => {});
    await sleep(Math.max(1400, frameMs(rt) * 2));
  } else {
    for (let f = 0; f < 4; f++) {
      await rt.message.edit({ embeds: [buildIntroFrame(view(), f)], components: [] }).catch(() => {});
      await sleep(frameMs(rt));
    }
  }

  // Coin flip — keep the VS image pinned on top while it resolves.
  const coinTop = vsTop(rt);
  await rt.message.edit({
    embeds: coinTop.embed ? [coinTop.embed, buildCoinFlipEmbed(view(), firstSide, flip)] : [buildCoinFlipEmbed(view(), firstSide, flip)],
    files: coinTop.file ? [coinTop.file] : [],
    components: [],
  }).catch(() => {});
  await sleep(frameMs(rt));

  rt.log.push(`🔔 Battle begins! ${firstSide === 0 ? "Challenger" : "Opponent"} moves first.`);
  await renderCombat(rt);
  await startTurn(rt);
}

// ── Turn handling ────────────────────────────────────────────────────────────
async function startTurn(rt: BattleRuntime) {
  if (rt.phase !== "combat") return;
  const actor = rt.currentSide === 0 ? rt.a! : rt.b!;
  if (actor.isAi) {
    await sleep(frameMs(rt));
    const move = chooseAiMove(actor, other(rt, rt.currentSide), rt.settings, rt.aiDifficulty);
    await applyMove(rt, rt.currentSide, move);
    return;
  }
  // Human: arm the turn timer (auto-skip on timeout).
  clearTimer(rt, "turnTimer");
  const ms = Math.max(10, rt.settings.turnTimerSeconds) * 1000;
  rt.turnTimer = setTimeout(() => {
    rt.log.push(`⏱️ ${actor.cardName} hesitated — turn skipped.`);
    void applyMove(rt, rt.currentSide, "skip");
  }, ms);
  await renderCombat(rt, { turnEndsAt: Date.now() + ms });
}

async function onMoveButton(rt: BattleRuntime, interaction: ButtonInteraction, move: MoveType) {
  if (rt.phase !== "combat") return safeEphemeral(interaction, "The battle isn't in combat.");
  const actor = rt.currentSide === 0 ? rt.a! : rt.b!;
  if (interaction.user.id !== actor.userId) return safeEphemeral(interaction, "It's not your turn.");
  if (rt.processing) return safeEphemeral(interaction, "Resolving the previous move…");
  await interaction.deferUpdate().catch(() => {});
  await applyMove(rt, rt.currentSide, move);
}

async function applyMove(rt: BattleRuntime, side: 0 | 1, move: MoveType) {
  if (rt.phase !== "combat" || rt.processing) return;
  rt.processing = true;
  clearTimer(rt, "turnTimer");
  try {
    const actor = side === 0 ? rt.a! : rt.b!;
    const foe = other(rt, side);

    // Start-of-turn ticks (DoT / regen / freeze / energy). Attribute any DoT
    // loss to the foe's dealt-damage total so leaderboard stats stay honest.
    const actorPoolBefore = actor.hp + actor.shield;
    const start = startOfTurn(actor, rt.settings);
    const dotLoss = Math.max(0, actorPoolBefore - (actor.hp + actor.shield));
    if (dotLoss > 0) rt.dmg[foeSide(side)] += dotLoss;
    for (const e of start.events) rt.log.push(e.text);
    if (actor.hp / actor.stats.maxHealth <= 0.15) rt.wentLow[side] = true;
    if (start.koed) {
      await finishBattle(rt, foeSide(side), "dot");
      return;
    }

    // "Current move" animation frame.
    await renderCombat(rt, { currentMove: `${actor.cardName} → ${moveLabel(move)}…` });
    await sleep(frameMs(rt));

    if (!start.skipped) {
      // Measure BOTH combatants' losses so counters/reflect count correctly:
      // the actor's own loss (counter/reflect) is damage the foe dealt.
      const foePoolBefore = foe.hp + foe.shield;
      const selfPoolBefore = actor.hp + actor.shield;
      const result = resolveMove(rt.settings, actor, foe, move);
      for (const e of result.events) {
        rt.log.push(e.text);
        if (e.flash === "crit") rt.crits[side]++;
      }
      const damage = Math.max(0, foePoolBefore - (foe.hp + foe.shield));
      rt.dmg[side] += damage;
      rt.dmg[foeSide(side)] += Math.max(0, selfPoolBefore - (actor.hp + actor.shield));
      if (foe.hp / foe.stats.maxHealth <= 0.15) rt.wentLow[foeSide(side)] = true;
      if (actor.hp / actor.stats.maxHealth <= 0.15) rt.wentLow[side] = true;

      // Show a lightweight single-card "attack" frame (cheap static PNG, not a
      // GIF) on every successful turn. Reuses the turnAnimation hook.
      const isCrit = result.events.some(e => e.flash === "crit");
      if (rt.settings.battleAnimationEnabled) {
        rt.turnAnimation = await renderAttackFrame({
          attacker: combatantToRenderCard(rt, actor),
          moveName: moveLabel(move),
          damage,
          isCrit,
          isHit: damage > 0,
        }).catch(() => null);
      }

      await renderCombat(rt);
      await sleep(frameMs(rt));

      // A counter/reflect can KO the attacker — check both.
      if (actor.hp <= 0 && foe.hp > 0) {
        await finishBattle(rt, foeSide(side), "ko");
        return;
      }
      if (result.koed || foe.hp <= 0) {
        await finishBattle(rt, actor.hp <= 0 ? null : side, "ko");
        return;
      }
    } else {
      await renderCombat(rt);
    }

    // Next turn.
    rt.currentSide = foeSide(side);
    if (rt.currentSide === 0) rt.turnNumber++;
    // Sudden-death cap keeps battles snappy — decide by remaining HP%.
    if (rt.turnNumber > MAX_COMBAT_TURNS) {
      rt.log.push("⌛ Time limit reached — the fighter with more HP wins!");
      await finishBattle(rt, decideByHp(rt), "turnlimit");
      return;
    }
    rt.processing = false;
    await startTurn(rt);
  } catch (err) {
    logger.error({ err, battleId: rt.id }, "applyMove failed");
    rt.processing = false;
  }
}

// ── Battle end + rewards ─────────────────────────────────────────────────────
async function finishBattle(rt: BattleRuntime, winnerSide: 0 | 1 | null, reason: string) {
  if (rt.phase === "ended") return;
  rt.phase = "ended";
  clearTimer(rt, "turnTimer"); clearTimer(rt, "ttlTimer"); clearTimer(rt, "aiOfferTimer");
  rt.processing = true;
  const a = rt.a!, b = rt.b!;

  const winnerId = winnerSide === null ? null : (winnerSide === 0 ? a.userId : b.userId);

  const mkResult = (c: Combatant, side: 0 | 1, won: boolean): ParticipantResult => ({
    userId: c.userId, isAi: c.isAi, cardId: c.cardId, cardName: c.cardName,
    damageDealt: rt.dmg[side], damageTaken: rt.dmg[foeSide(side)],
    crits: rt.crits[side], perfect: won && rt.dmg[foeSide(side)] === 0,
    comeback: won && rt.wentLow[side],
  });

  const season = await ensureSeason(rt.guildId).catch(() => null);
  let outcomes: RewardOutcome[] = [];
  let levelUps: import("./reward-engine.js").CardLevelUp[] = [];
  try {
    const res = await processBattleRewards({
      guildId: rt.guildId, settings: rt.settings, season,
      staked: rt.staked, isAi: rt.isAi, aiDifficulty: rt.isAi ? rt.aiDifficulty : null,
      challenger: mkResult(a, 0, winnerSide === 0),
      opponent: mkResult(b, 1, winnerSide === 1),
      winnerId, turns: rt.turnNumber, endedReason: reason,
      grantPack: grantFreePack,
    });
    outcomes = res.outcomes;
    levelUps = res.levelUps;

    // Daily challenge progress + unified account XP for humans.
    const { awardPlayerXp, XP } = await import("../player/xp.js");
    for (const side of [0, 1] as const) {
      const c = side === 0 ? a : b;
      if (c.isAi) continue;
      await advanceDaily(rt.guildId, c.userId, {
        won: winnerId === c.userId, vsAi: rt.isAi, damageDealt: rt.dmg[side],
        perfect: winnerId === c.userId && rt.dmg[foeSide(side)] === 0,
        cardRarity: c.cardRarity, crits: rt.crits[side],
      }).catch(() => {});
      await awardPlayerXp(rt.guildId, c.userId, "battle", winnerId === c.userId ? XP.battleWin : XP.battleLoss);
    }
  } catch (err) {
    logger.error({ err, battleId: rt.id }, "reward processing failed");
  }

  // Settle escrowed staked cards exactly once (winner takes both, draw returns).
  await settleEscrow(rt, winnerSide);

  const rewardLines = buildRewardLines(rt, outcomes);
  const view = toView(rt);
  const winner = winnerSide === null ? null : (winnerSide === 0 ? rt.a : rt.b);

  // Victory animation: replace the static VS image with a cinematic GIF.
  if (winner && rt.settings.battleAnimationEnabled && rt.a && rt.b) {
    const victory = await renderBattleVictory({
      winner: combatantToRenderCard(rt, winner),
      loser: combatantToRenderCard(rt, winnerSide === 0 ? rt.b : rt.a),
    }, rt.settings.battleAnimationSpeed as AnimationSpeed).catch(() => null);
    if (victory) rt.vsImage = victory.buffer;
  }

  // Build the victory embed once and reuse it for the message + the battle log.
  // The winner's card stays the thumbnail (buildWinnerEmbed); the VS battle image
  // is reused as the big embed image so it isn't wasted, plus an "HP left" line.
  const winnerEmbed = buildWinnerEmbed(view, winnerSide, rewardLines);
  if (rt.vsImage) winnerEmbed.setImage(`attachment://${VS_IMAGE_NAME}`);
  if (winner) {
    const pct = Math.max(0, Math.round((winner.hp / Math.max(1, winner.stats.maxHealth)) * 100));
    winnerEmbed.addFields({
      name: "💪 Survived",
      value: `Won with **${Math.max(0, winner.hp).toLocaleString()} / ${winner.stats.maxHealth.toLocaleString()} HP** left (${pct}%)`,
      inline: false,
    });
  }
  const winnerFiles = rt.vsImage ? [new AttachmentBuilder(rt.vsImage, { name: VS_IMAGE_NAME })] : [];

  if (rt.message) {
    await rt.message.edit({ embeds: [winnerEmbed], components: [], files: winnerFiles }).catch(() => {});
  }

  // Achievement toasts + battle log channel.
  const client = getBotClient();
  if (rt.message) {
    const channel = rt.message.channel;
    for (const o of outcomes) {
      if (o.achievements.length > 0 && channel.isSendable()) {
        await channel.send({
          content: `🏆 <@${o.userId}> unlocked:\n${o.achievements.map(formatAchievementLine).join("\n")}`,
          allowedMentions: { users: [o.userId] },
        }).catch(() => {});
      }
    }
    // Log the same victory embed, re-attaching the VS image so it stays with
    // the logged result too.
    if (client) await logBattleResult(client, rt.guildId, winnerEmbed,
      rt.vsImage ? { buffer: rt.vsImage, name: VS_IMAGE_NAME } : undefined).catch(() => {});

    // Victory embed is dramatic but temporary; the battle log keeps the result.
    setTimeout(() => {
      rt.message?.delete().catch(() => {});
    }, 15000).unref();

    // Card level-up / star-up toasts.
    if (levelUps.length > 0 && rt.message.channel.isSendable()) {
      const lines = levelUps.map(l => {
        const starUp = l.newStars > l.oldStars ? `  ⭐ **${l.newStars}-star!**` : "";
        const frames = l.newFrames.length > 0 ? `  ·  🖼️ unlocked: ${l.newFrames.join(", ")}` : "";
        return `🎖️ <@${l.userId}>'s **${l.cardName}** reached **Level ${l.newLevel}**${starUp}${frames}`;
      });
      await rt.message.channel.send({
        content: lines.join("\n"),
        allowedMentions: { users: levelUps.map(l => l.userId) },
      }).catch(() => {});
    }
  }

  await teardown(rt);
}

function buildRewardLines(rt: BattleRuntime, outcomes: RewardOutcome[]): string[] {
  const lines: string[] = [];
  for (const o of outcomes) {
    const bits: string[] = [];
    if (o.shards > 0) bits.push(`💠 +${o.shards}`);
    if (o.xp > 0) bits.push(`✨ +${o.xp} XP`);
    if (o.streakBonus > 0) bits.push(`🔥 streak +${o.streakBonus}`);
    if (o.rankDelta !== 0) bits.push(`${o.rankDelta > 0 ? "📈" : "📉"} ${o.rankDelta > 0 ? "+" : ""}${o.rankDelta} rank`);
    if (o.leveledUp) bits.push(`⬆️ Level ${o.level}`);
    if (o.cardWonId) bits.push("🎴 won opponent's card!");
    if (o.cardLostId) bits.push("💔 lost staked card");
    if (o.freePackTier) bits.push(`🎁 free ${o.freePackTier} pack`);
    if (o.throttled) bits.push("⚠️ daily reward cap reached");
    const status = o.won ? "🏆 Win" : o.draw ? "🤝 Draw" : "❌ Loss";
    lines.push(`${status}: <@${o.userId}> — ${bits.length ? bits.join(" · ") : "no rewards"}`);
  }
  return lines;
}

// Return escrowed staked cards. Winner receives BOTH cards; a draw returns each
// player their own. Idempotent via `escrowSettled`. Uses restoreCardToUser so
// the global mint count is untouched (a transfer, not a new card).
async function settleEscrow(rt: BattleRuntime, winnerSide: 0 | 1 | null): Promise<void> {
  if (!rt.escrow || rt.escrowSettled) return;
  rt.escrowSettled = true;
  const { challengerCardId, opponentCardId } = rt.escrow;
  const chalId = rt.challengerId;
  const oppId = rt.b?.userId ?? rt.opponentId ?? "";
  // Consume the lock rows BEFORE restoring so a crash mid-settlement can't let
  // startup recovery restore the same cards a second time (prefer a rare loss
  // over any chance of duplication).
  await releaseBattleLock(rt.guildId, chalId, rt.id).catch(() => {});
  if (oppId && oppId !== AI_ID) await releaseBattleLock(rt.guildId, oppId, rt.id).catch(() => {});
  if (!oppId || oppId === AI_ID) {
    // No valid opponent (shouldn't happen for staked PvP) — refund challenger.
    await restoreCardToUser(rt.guildId, chalId, challengerCardId).catch(() => {});
    return;
  }
  if (winnerSide === null) {
    await restoreCardToUser(rt.guildId, chalId, challengerCardId).catch(() => {});
    await restoreCardToUser(rt.guildId, oppId, opponentCardId).catch(() => {});
  } else {
    const winnerId = winnerSide === 0 ? chalId : oppId;
    await restoreCardToUser(rt.guildId, winnerId, challengerCardId).catch(() => {});
    await restoreCardToUser(rt.guildId, winnerId, opponentCardId).catch(() => {});
  }
}

async function endBattleByTimeout(rt: BattleRuntime) {
  if (rt.phase === "ended") return;
  if (rt.phase === "combat" && rt.a && rt.b) {
    rt.log.push("⌛ Battle timed out — winner decided by remaining HP.");
    await finishBattle(rt, decideByHp(rt), "timeout");
    return;
  }
  if (rt.message) {
    await rt.message.edit({
      embeds: [new EmbedBuilder().setColor(0x99aab5).setTitle("⌛ Battle expired").setDescription("This battle timed out during setup.")],
      components: [],
    }).catch(() => {});
  }
  await teardown(rt);
}

async function teardown(rt: BattleRuntime) {
  clearTimer(rt, "turnTimer"); clearTimer(rt, "ttlTimer"); clearTimer(rt, "aiOfferTimer");
  await releaseBattleLock(rt.guildId, rt.challengerId, rt.id).catch(() => {});
  if (rt.opponentId && rt.opponentId !== AI_ID) {
    await releaseBattleLock(rt.guildId, rt.opponentId, rt.id).catch(() => {});
  }
  battles.delete(rt.id);
}

// ── Rendering ────────────────────────────────────────────────────────────────
const VS_IMAGE_NAME = "battle-vs.png";

// Map a live Combatant to the renderer's card description.
function combatantToRenderCard(rt: BattleRuntime, c: Combatant): RenderCard {
  const display = c.cardRarityDisplay;
  return {
    name: c.cardName,
    rarity: c.cardRarity,
    rarityLabel: display ? `${display.emoji} ${display.label}` : (rarityLabel(c.cardRarity, null, rt.displayMap) ?? c.cardRarity),
    rarityColor: display?.color ?? rarityColor(c.cardRarity, null, rt.displayMap),
    cardId: c.cardId,
    cardType: c.cardType,
    artUrl: c.cardImageUrl,
    attack: c.stats.attack,
    special: getMoveset(c.moveset)?.name ?? null,
  };
}

// The pinned VS-image embed that sits ABOVE the battle embed. Optional title is
// used for the dramatic pre-combat reveal; combat renders it title-less so the
// battlefield picture just stays at the top the whole fight.
function vsTop(rt: BattleRuntime, title?: string, image?: Buffer | null): { embed: EmbedBuilder | null; file: AttachmentBuilder | null } {
  const img = image ?? rt.vsImage;
  if (!img) return { embed: null, file: null };
  const embed = new EmbedBuilder()
    .setColor(rarityColorOfSide(rt))
    .setImage(`attachment://${VS_IMAGE_NAME}`);
  if (title) embed.setTitle(title);
  return { embed, file: new AttachmentBuilder(img, { name: VS_IMAGE_NAME }) };
}

function rarityColorOfSide(rt: BattleRuntime): number {
  const active = rt.currentSide === 0 ? rt.a : rt.b;
  return rarityColor(active?.cardRarity ?? "common", null, rt.displayMap) ?? 0xed4245;
}

async function renderCombat(rt: BattleRuntime, opts?: { currentMove?: string; turnEndsAt?: number }) {
  if (!rt.message || !rt.a || !rt.b) return;
  const view = toView(rt, opts?.turnEndsAt);
  const actor = rt.currentSide === 0 ? rt.a : rt.b;
  const components = actor.isAi ? [] : buildMoveComponents(rt, actor);

  // Two-embed layout:
  //   TOP    = recent battle log + current turn (buildBattleLogEmbed)
  //   BOTTOM = HP/Energy/Ultimate status + the combat canvas as its image
  // A one-shot turn animation, if queued, is consumed for this render only.
  const logEmbed = buildBattleLogEmbed(view);
  const statusEmbed = buildBattleStatusEmbed(view, { currentMove: opts?.currentMove });
  const turnImg = rt.turnAnimation;
  rt.turnAnimation = null;
  const combatImg = turnImg ?? rt.vsImage;
  const files: AttachmentBuilder[] = [];
  if (combatImg) {
    statusEmbed.setImage(`attachment://${VS_IMAGE_NAME}`);
    files.push(new AttachmentBuilder(combatImg, { name: VS_IMAGE_NAME }));
  }
  await rt.message.edit({
    content: null,
    embeds: [logEmbed, statusEmbed],
    components,
    files,
  }).catch(() => {});
}

function toView(rt: BattleRuntime, turnEndsAt?: number): BattleView {
  return {
    a: rt.a!, b: rt.b!, turnNumber: rt.turnNumber, currentSide: rt.currentSide,
    staked: rt.staked, log: rt.log, turnEndsAt,
    displayMap: rt.displayMap,
  };
}

function other(rt: BattleRuntime, side: 0 | 1): Combatant {
  return side === 0 ? rt.b! : rt.a!;
}
function foeSide(side: 0 | 1): 0 | 1 { return side === 0 ? 1 : 0; }

// Decide a winner by remaining HP fraction (ties = draw). Used by the turn cap
// and the TTL safety net.
function decideByHp(rt: BattleRuntime): 0 | 1 | null {
  if (!rt.a || !rt.b) return null;
  const aPct = rt.a.hp / rt.a.stats.maxHealth;
  const bPct = rt.b.hp / rt.b.stats.maxHealth;
  return aPct === bPct ? null : aPct > bPct ? 0 : 1;
}

// ── Component builders ───────────────────────────────────────────────────────
function buildChallengeEmbed(rt: BattleRuntime, opponent: User | null, aiOffered = false): EmbedBuilder {
  const e = new EmbedBuilder()
    .setColor(0xed4245)
    .setTitle("⚔️ Battle Challenge!")
    .setDescription(
      `<@${rt.challengerId}> challenges ${opponent ? `<@${opponent.id}>` : "an opponent"} to a card battle!\n\n` +
      `${opponent ? `<@${opponent.id}>, do you accept?` : ""}`,
    )
    .setFooter({ text: aiOffered ? "No response? The challenger can battle the AI instead." : `Waiting for a response… AI offered after ${rt.settings.aiOfferSeconds}s.` });
  return e;
}

function buildChallengeComponents(rt: BattleRuntime, aiOffered = false): ActionRowBuilder<ButtonBuilder>[] {
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`battle:accept:${rt.id}`).setLabel("Accept").setEmoji("✅").setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`battle:decline:${rt.id}`).setLabel("Decline").setEmoji("❌").setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId(`battle:cancel:${rt.id}`).setLabel("Cancel").setStyle(ButtonStyle.Secondary),
  );
  if (rt.settings.aiEnabled) {
    row.addComponents(
      new ButtonBuilder().setCustomId(`battle:ai:${rt.id}`).setLabel("Battle AI Instead").setEmoji("🤖")
        .setStyle(aiOffered ? ButtonStyle.Primary : ButtonStyle.Secondary),
    );
  }
  return [row];
}

function buildAiDifficultyEmbed(_rt: BattleRuntime): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle("🤖 Choose your Arena")
    .setDescription(
      "The AI card scales to the **arena's level** — nothing is locked, but bringing an " +
      "under-levelled card to a high arena is a fast wipe. Grind your card to **Lv 100** to " +
      "breeze the Ascended Arena (and hit **5⭐** for boss raids). Higher arenas pay out more.",
    )
    .addFields(
      ARENA_KEYS.map(k => {
        const a = ARENAS[k];
        const band = a.minLevel === a.maxLevel ? `Lv ${a.minLevel}` : `Lv ${a.minLevel}–${a.maxLevel}`;
        return { name: `${a.emoji} ${a.name}`, value: `${band} · AI Lv ${a.aiLevel} · ×${a.rewardMult} rewards`, inline: true };
      }),
    );
}

function buildAiDifficultyComponents(rt: BattleRuntime): ActionRowBuilder<ButtonBuilder>[] {
  // 6 arenas over two rows (Discord allows ≤5 buttons per row).
  const mk = (k: typeof ARENA_KEYS[number]) =>
    new ButtonBuilder().setCustomId(`battle:aidiff:${rt.id}:${k}`).setLabel(ARENAS[k].name.replace(/ Arena$/, ""))
      .setEmoji(ARENAS[k].emoji).setStyle(ButtonStyle.Secondary);
  const row1 = new ActionRowBuilder<ButtonBuilder>().addComponents(ARENA_KEYS.slice(0, 3).map(mk));
  const row2 = new ActionRowBuilder<ButtonBuilder>().addComponents(ARENA_KEYS.slice(3).map(mk));
  return [row1, row2];
}

function buildPrepEmbed(rt: BattleRuntime): EmbedBuilder {
  const readyMark = (uid: string) => rt.prep.get(uid)?.ready ? "✅ Ready" : "⏳ Preparing…";
  const e = new EmbedBuilder()
    .setColor(0xfaa61a)
    .setTitle("🎴 Prepare for Battle")
    .setDescription("Both fighters: press **Prepare** to choose your card, coin call, and stake — then **Ready** up.")
    .addFields(
      { name: `Challenger — ${rt.challengerName}`, value: readyMark(rt.challengerId), inline: true },
    );
  if (rt.isAi) {
    e.addFields({ name: `Opponent — AI`, value: `${arenaLabel(rt.aiDifficulty)} · ✅ Ready`, inline: true });
  } else if (rt.opponentId) {
    e.addFields({ name: `Opponent — ${rt.opponentName}`, value: readyMark(rt.opponentId), inline: true });
  }
  if (rt.settings.stakingEnabled && !rt.isAi) {
    e.addFields({ name: "💰 Staking", value: "If **both** players stake, the winner takes the loser's card!", inline: false });
  }
  return e;
}

function buildPrepSharedComponents(rt: BattleRuntime): ActionRowBuilder<ButtonBuilder>[] {
  return [new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`battle:prep:${rt.id}`).setLabel("Prepare").setEmoji("🎴").setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`battle:cancel:${rt.id}`).setLabel("Cancel").setStyle(ButtonStyle.Secondary),
  )];
}

function buildPersonalPrepEmbed(rt: BattleRuntime, userId: string): EmbedBuilder {
  const prep = rt.prep.get(userId);
  const cardName = prep?.cardId ? (rt.eligibleCache.get(userId)?.find(c => c.id === prep.cardId)?.name ?? `#${prep.cardId}`) : "—";
  const specName = prep?.specialCardId ? (rt.eligibleCache.get(userId)?.find(c => c.id === prep.specialCardId)?.name ?? `#${prep.specialCardId}`) : "None";
  return new EmbedBuilder()
    .setColor(0xfaa61a)
    .setTitle("Your Battle Prep")
    .addFields(
      { name: "🎴 Card", value: cardName, inline: true },
      { name: "✨ Special", value: specName, inline: true },
      { name: "🪙 Coin", value: prep?.coin ? prep.coin[0].toUpperCase() + prep.coin.slice(1) : "—", inline: true },
      ...(rt.settings.stakingEnabled && !rt.isAi
        ? [{ name: "💰 Stake", value: prep?.stake ? "Yes — card on the line!" : "No", inline: true }]
        : []),
    );
}

const PICKER_PAGE_SIZE = 25;

function buildPersonalPrepComponents(
  rt: BattleRuntime, userId: string, eligible: OwnedBattleCard[],
): ActionRowBuilder<any>[] {
  const prep = rt.prep.get(userId);
  const page = prep?.page ?? 0;
  const totalPages = Math.ceil(eligible.length / PICKER_PAGE_SIZE);
  const safePage = Math.max(0, Math.min(page, totalPages - 1));
  const pageCards = eligible.slice(safePage * PICKER_PAGE_SIZE, (safePage + 1) * PICKER_PAGE_SIZE);

  const cardSelect = new StringSelectMenuBuilder()
    .setCustomId(`battle:pcard:${rt.id}`)
    .setPlaceholder(`🎴 Choose your battle card (${eligible.length} cards, page ${safePage + 1}/${totalPages || 1})`)
    .addOptions(pageCards.map(c => {
      const display = c.displayRarity;
      const rarityTag = display
        ? `${display.emoji} ${display.label}`
        : rarityLabel(c.rarity, null, rt.displayMap);
      return {
        label: c.name.slice(0, 100),
        description: `${rarityTag}${c.owned > 1 ? ` · x${c.owned}` : ""}`,
        value: String(c.id),
        default: prep?.cardId === c.id,
      };
    }));

  const rows: ActionRowBuilder<any>[] = [
    new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(cardSelect),
  ];

  // Pagination row for large collections.
  if (eligible.length > PICKER_PAGE_SIZE) {
    rows.push(new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(`battle:ppage:${rt.id}:prev`).setLabel("◀ Prev")
        .setStyle(ButtonStyle.Secondary).setDisabled(safePage <= 0),
      new ButtonBuilder().setCustomId(`battle:ppage:${rt.id}:next`).setLabel("Next ▶")
        .setStyle(ButtonStyle.Secondary).setDisabled(safePage >= totalPages - 1),
    ));
  }

  if (rt.settings.specialCardsEnabled) {
    const specialSelect = new StringSelectMenuBuilder()
      .setCustomId(`battle:pspecial:${rt.id}`)
      .setPlaceholder("✨ Optional: special support card")
      .addOptions(
        { label: "None", description: "No special support card", value: "none", default: !prep?.specialCardId },
        ...pageCards.slice(0, 24).map(c => {
          const eff = c.config?.specialEffect ?? inferSpecialEffect(c.cardType, c.rarity);
          const def = getEffectDef(eff);
          return {
            label: c.name.slice(0, 100),
            description: def ? `${def.emoji} ${def.label}` : "Support",
            value: String(c.id),
            default: prep?.specialCardId === c.id,
          };
        }),
      );
    rows.push(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(specialSelect));
  }

  const coinRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`battle:pcoin:${rt.id}:heads`).setLabel("Heads").setEmoji("🪙")
      .setStyle(prep?.coin === "heads" ? ButtonStyle.Primary : ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`battle:pcoin:${rt.id}:tails`).setLabel("Tails").setEmoji("🪙")
      .setStyle(prep?.coin === "tails" ? ButtonStyle.Primary : ButtonStyle.Secondary),
  );
  if (rt.settings.stakingEnabled && !rt.isAi) {
    coinRow.addComponents(
      new ButtonBuilder().setCustomId(`battle:pstake:${rt.id}`).setLabel(prep?.stake ? "Staking: ON" : "Stake Card")
        .setEmoji("💰").setStyle(prep?.stake ? ButtonStyle.Danger : ButtonStyle.Secondary),
    );
  }
  rows.push(coinRow);

  rows.push(new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`battle:pready:${rt.id}`).setLabel("Ready").setEmoji("⚔️")
      .setStyle(ButtonStyle.Success).setDisabled(!prep?.cardId),
  ));
  return rows;
}

function buildMoveComponents(rt: BattleRuntime, actor: Combatant): ActionRowBuilder<ButtonBuilder>[] {
  const avail = availableMoves(actor, rt.settings);
  const mk = (move: MoveType, label: string, emoji: string, style: ButtonStyle) =>
    new ButtonBuilder().setCustomId(`battle:move:${rt.id}:${move}`).setLabel(label).setEmoji(emoji)
      .setStyle(style).setDisabled(!avail[move]);
  const row1 = new ActionRowBuilder<ButtonBuilder>().addComponents(
    mk("attack", "Attack", "⚔️", ButtonStyle.Primary),
    mk("special", "Special", "🔥", ButtonStyle.Danger),
    mk("defend", "Defend", "🛡️", ButtonStyle.Secondary),
    mk("charge", "Charge", "⚡", ButtonStyle.Secondary),
    mk("skip", "Skip", "⏭️", ButtonStyle.Secondary),
  );
  const row2 = new ActionRowBuilder<ButtonBuilder>().addComponents(
    mk("special_card", "Special Card", "✨", ButtonStyle.Success),
    mk("ultimate", "Ultimate", "💀", ButtonStyle.Danger),
  );
  return [row1, row2];
}

function moveLabel(move: MoveType): string {
  return ({
    attack: "⚔️ Attack", special: "🔥 Special Attack", defend: "🛡️ Defend",
    special_card: "✨ Special Card", charge: "⚡ Charge", skip: "⏭️ Skip", ultimate: "💀 Ultimate",
  } as Record<MoveType, string>)[move];
}

// ── Utils ────────────────────────────────────────────────────────────────────
function clearTimer(rt: BattleRuntime, key: "turnTimer" | "aiOfferTimer" | "ttlTimer") {
  const t = rt[key];
  if (t) { clearTimeout(t); rt[key] = null; }
}

async function safeEphemeral(
  interaction: ButtonInteraction | StringSelectMenuInteraction, content: string,
): Promise<void> {
  try {
    if (interaction.deferred || interaction.replied) {
      await interaction.followUp({ content, flags: MessageFlags.Ephemeral });
    } else {
      await interaction.reply({ content, flags: MessageFlags.Ephemeral });
    }
  } catch { /* ignore */ }
}

// Startup recovery + periodic stale-lock sweep — call once at bot startup.
// At a cold start there are no in-memory battles, so any surviving lock row is
// from a crashed process: refund every escrowed staked card to its owner and
// wipe the lock table so no player is left stuck "already in a battle".
export function startBattleMaintenance(): void {
  void recoverAbandonedStakes();
  setInterval(() => { void sweepStaleLocks(MAX_BATTLE_MS + 60_000); }, 5 * 60_000);
}

async function recoverAbandonedStakes(): Promise<void> {
  try {
    const locks = await getAllLocks();
    let refunded = 0;
    for (const l of locks) {
      if (l.staked && l.cardId != null) {
        await restoreCardToUser(l.guildId, l.userId, l.cardId).catch(() => {});
        refunded++;
      }
    }
    await deleteAllLocks();
    if (locks.length > 0) {
      logger.info({ clearedLocks: locks.length, refundedStakes: refunded }, "battle: recovered abandoned locks at startup");
    }
  } catch (err) {
    logger.warn({ err }, "battle: startup lock recovery failed (non-fatal)");
  }
}
