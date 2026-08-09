// ─────────────────────────────────────────────────────────────────────────────
// HQ — the turn-for-turn siege.
//
// A siege is now a real battle, not a summary. It runs the SAME combat engine,
// the same move set, the same per-turn attack frames and the same timers as
// `/battle` — so anyone who has fought a battle already knows how to storm a
// castle — with a Clash-style siege layer on top:
//
//   • Both sides take real turns. You pick a move, the garrison answers, and the
//     board re-renders between each — attack for attack.
//   • A knockout does NOT end the fight. It breaks one rank: the next defender
//     steps up (or your next card advances), and the castle takes visible damage.
//   • Progress is DESTRUCTION, not hit points. Wrecking the garrison fills a
//     destruction meter and earns stars — ★ at 50%, ★★ for taking the base,
//     ★★★ for taking it without losing a single card.
//
// The message is two embeds, matching that split:
//   TOP    — the castle itself: the live scene, the destruction scoreboard and
//            the running siege log. The picture IS the log.
//   BOTTOM — the battle proper: both active cards' HP/energy/ultimate, whose
//            turn it is, the turn clock, and the per-turn attack frame.
//
// This module owns the session, the board and the turn loop. It knows nothing
// about capture/tribute/rewards: the caller passes already-built combatants and
// an `applyOutcome` callback that commits the result and returns the result
// screen, so a player base and an AI territory share one engine.
// ─────────────────────────────────────────────────────────────────────────────

import {
  ButtonInteraction, StringSelectMenuInteraction, EmbedBuilder,
  ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder,
  MessageFlags, AttachmentBuilder, type Message,
} from "discord.js";
import { randomBytes } from "crypto";
import type { BattleSettings } from "@workspace/db";
import type { Combatant, MoveType, AiDifficulty } from "../battle/types.js";
import { startOfTurn, resolveMove, availableMoves } from "../battle/combat-engine.js";
import { chooseAiMove } from "../battle/ai-engine.js";
import { powerRating } from "../battle/stat-engine.js";
import { bar, WHITE_LINE } from "../battle/embeds.js";
import { computeMoveVisual } from "../battle/turn-visual.js";
import { getMoveset } from "../battle/movesets.js";
import {
  listBattleItems, getBattleItem, loadGuildBattleItems, applyItemUse, isOffensiveItem,
} from "../battle/items.js";
import { renderSiegeField, renderSiegeFieldStill, type AnimationSpeed } from "../animations/index.js";
import type { SiegeFieldFighter, SiegeFieldInput, SiegeFieldBenchCard } from "../animations/index.js";
import { renderCoinFlip } from "../battle/prep-canvas.js";
import { renderSiegeFrame, type HqBaseView, type SiegeOverlay, type HqRenderDefender } from "./render.js";
import type { HqSiegeConfig } from "./settings.js";
import { logger } from "../../lib/logger.js";

const EPHEMERAL = { flags: MessageFlags.Ephemeral } as const;
// The garrison fights at a competent (not perfect) skill so specials, items and
// passives actually get used and an upset stays possible — same as the headless
// resolver.
const SIEGE_AI: AiDifficulty = "elite";
// Hard stop so a walked-away siege can never pin its target forever.
const MAX_SIEGE_MS = 20 * 60 * 1000;
const DEFAULT_FRAME_MS = 950;

// ── Siege pressure ────────────────────────────────────────────────────────────
// A defender that braces gains a shield bigger than a normal hit, and the battle
// AI rationally braces every turn once it is hurt. In a 1v1 battle that just
// runs the clock out; in a siege — where the attacker must break EVERY rank to
// win — it makes a turtling garrison literally unkillable, so a base could never
// be taken.
//
// Siege pressure is the battering ram. Every commander turn a rank survives, the
// ram bites deeper: chip damage that scales with how long that rank has stalled
// and IGNORES shields, because bracing does nothing about the wall being
// undermined. A rank that trades normally dies long before pressure matters; a
// rank that only turtles gets torn down. The defender's answer is fortification
// (more HP to grind through), not an infinite guard.
const PRESSURE_GRACE_TURNS = 2;   // free turns before the ram starts telling
const PRESSURE_STEP_PCT = 5;      // added % of max HP per stalled turn
const PRESSURE_MAX_PCT = 25;      // ceiling per turn

/** Top embed: the castle scene. */
export const SIEGE_CASTLE_IMAGE = "siege-castle.png";
/** Bottom embed: the per-turn attack frame (`.gif` only when animated). */
const SIEGE_TURN_PNG = "siege-turn.png";
const SIEGE_TURN_GIF = "siege-turn.gif";

// ── Public contract ───────────────────────────────────────────────────────────

export interface SiegeResultView {
  title: string;
  description: string;
  color: number;
  fields?: { name: string; value: string; inline?: boolean }[];
}

export interface SiegeOutcome {
  attackerWon: boolean;
  /** Turns fought (a turn = one side acting, matching /battle's counter). */
  turns: number;
  attackerCardsLost: number;
  defenderCardsLost: number;
  attackerPower: number;
  defenderPower: number;
  /** 0–100. 100 = every defender broken. */
  destructionPct: number;
  /** 0–3, Clash-style. */
  stars: number;
}

export interface SiegeRuntimeConfig {
  guildId: string;
  /** Shared key that stops two assaults hitting one target at once. */
  targetKey?: string;
  starterId: string;            // only this user may command
  attackerName: string;
  targetName: string;
  /** Shown under the castle name — the faction or holder being fought. */
  holderName: string;
  accent: number;
  attackers: Combatant[];       // side 0, strongest first — the DEFAULT column
  /**
   * The whole roster the commander can march, strongest first (side 0). When
   * given, the muster board lets the player hand-pick which cards fill the
   * column instead of always taking the top `attackers.length`. The default
   * column is `attackers`; a chosen subset replaces it. Omit to lock the column.
   */
  attackerPool?: Combatant[];
  defenders: Combatant[];       // side 1, fortified, strongest first
  settings: BattleSettings;
  siege: HqSiegeConfig;
  /** The base/territory scene the castle frame is painted from. */
  baseView: HqBaseView | null;
  /** The attacker's champion, drawn storming the gate. */
  champion: HqRenderDefender | null;
  /** Commit the result (capture / reward / log) and return the result screen. */
  applyOutcome: (outcome: SiegeOutcome) => Promise<SiegeResultView>;
}

type Phase = "muster" | "assault" | "ended";

interface SiegeSession extends SiegeRuntimeConfig {
  id: string;
  phase: Phase;
  ai: number;                   // active attacker index
  di: number;                   // active defender index
  turnNumber: number;
  currentSide: 0 | 1;
  /** The commander's heads/tails call — call it right and your column strikes first. */
  coinCall: "heads" | "tails" | null;
  /** How many cards the column may hold (= the garrison's rank count). */
  columnSize: number;
  /**
   * When true the whole assault is auto-played by the AI with no board renders
   * or timers — the "send them in and tell me how it went" path. The commander
   * gets a DM with the result instead of driving the fight.
   */
  headless: boolean;
  log: string[];
  message?: Message;
  turnTimer?: NodeJS.Timeout;
  ttlTimer?: NodeJS.Timeout;
  processing: boolean;
  // Synchronous input latch: claimed the instant a commander input is accepted,
  // BEFORE the (awaited) interaction ack, so a burst of rapid clicks can't slip
  // multiple moves through the `processing` check while the first is still
  // awaiting deferUpdate. Released when the resulting turn fully resolves.
  inputPending: boolean;
  itemUsesLeft: number;
  attackerPower: number;
  defenderPower: number;
  /** Cached castle frame; only re-rendered when the siege visibly changes. */
  castleImage: Buffer | null;
  castleKey: string;
  /** One-shot per-turn attack frame, consumed by the next render. */
  // The battlefield image currently shown under the board. It PERSISTS across
  // renders (it is not consumed) so a turn's board can paint immediately with
  // the last frame while the new one renders in the background.
  turnFrame: Buffer | null;
  turnFrameIsGif: boolean;
  // Identifies the turn a background render belongs to; a late frame only
  // patches in if it still matches, so a slow render can't stamp a stale image
  // onto a newer turn.
  pendingFrameToken: string | null;
  /** Item equipped for the whole assault, chosen at muster. */
  equippedItemId: string | null;
  /** Ranks fully broken, for the destruction meter. */
  defendersBroken: number;
  /** Commander turns the CURRENT rank has survived — drives siege pressure. */
  rankStall: number;
  /**
   * High-water destruction. A defender that heals (regen, defend, a support
   * item) would otherwise walk the meter BACKWARDS, which no siege scoreboard
   * should ever do — ground taken stays taken.
   */
  peakDestruction: number;
}

const sessions = new Map<string, SiegeSession>();
const activeTargetKeys = new Set<string>();

// ── Replay (auto/skip only) ───────────────────────────────────────────────────
// A player who chose Auto Skip Mode didn't watch the fight, so the clean result
// keeps a "View Replay" button that reveals the blow-by-blow. The session is
// gone by then, so the recap is stashed here under a short-lived id.
interface SiegeReplay { title: string; scoreLine: string; log: string[]; accent: number; targetName: string; }
const replays = new Map<string, SiegeReplay>();
const REPLAY_TTL_MS = 15 * 60 * 1000; // a replay stays viewable for 15 minutes
// A deliberate beat so the result reads as its own screen, not just the last
// combat frame flicking to text.
const RESULT_HOLD_MS = 1300;

/** True while any interactive siege is occupying this base or territory. */
export function isSiegeTargetActive(targetKey: string): boolean {
  return activeTargetKeys.has(targetKey);
}

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));
// Per-frame pacing — a no-op in a headless (send-them-in) siege so it resolves
// instantly instead of playing every beat out.
const pace = (s: SiegeSession) => s.headless ? Promise.resolve() : sleep(frameMs(s));

// Animation pacing follows the guild's battle settings, so a siege moves at the
// same speed as a battle in that server.
function frameMs(s: SiegeSession): number {
  return Math.max(120, Math.min(4000, s.settings.frameDelayMs ?? DEFAULT_FRAME_MS));
}
// The heavy animated arena scene, vs the lighter single-frame attack card.
function sceneAnimated(s: SiegeSession): boolean {
  return s.siege.turnVisuals && s.settings.battleAnimationEnabled && s.settings.battleSceneAnimated;
}
function classicFrames(s: SiegeSession): boolean {
  return s.siege.turnVisuals && s.settings.battleAnimationEnabled && !s.settings.battleSceneAnimated;
}

const MOVE_LABELS: Record<MoveType, string> = {
  attack: "Attack", special: "Special", defend: "Defend", charge: "Charge",
  skip: "Hold", ultimate: "Ultimate", item: "Item", special_card: "Special",
};
function moveLabel(move: MoveType, actor: Combatant): string {
  if (move === "special") return getMoveset(actor.moveset)?.name ?? "Special";
  return MOVE_LABELS[move] ?? move;
}

// ── Destruction & stars ───────────────────────────────────────────────────────
// Progress is measured in wrecked garrison, not raw HP: each defender is an
// equal slice of the base, and the one currently being fought contributes its
// own missing-HP fraction. That makes the meter move on every good hit while
// still making a broken rank feel like a milestone.
function destructionPct(s: SiegeSession): number {
  const total = s.defenders.length;
  if (total === 0) return 100;
  const cur = s.defenders[s.di];
  const partial = cur && cur.hp > 0
    ? 1 - Math.max(0, Math.min(1, cur.hp / Math.max(1, cur.stats.maxHealth)))
    : 0;
  const now = Math.max(0, Math.min(100, ((s.defendersBroken + partial) / total) * 100));
  s.peakDestruction = Math.max(s.peakDestruction, now);
  return s.peakDestruction;
}

// ★ at half the base wrecked, ★★ for taking it, ★★★ for taking it clean.
function starsFor(pct: number, captured: boolean, cardsLost: number): number {
  if (captured) return cardsLost === 0 ? 3 : 2;
  return pct >= 50 ? 1 : 0;
}

// ── Entry ─────────────────────────────────────────────────────────────────────

/**
 * Open the muster board into an already-deferred interaction. The caller has
 * built and fortified both squads; nothing is committed until the assault ends.
 */
export async function startSiege(
  interaction: ButtonInteraction, config: SiegeRuntimeConfig,
): Promise<void> {
  const fail = (msg: string) => interaction.editReply({
    embeds: [new EmbedBuilder().setColor(0xc0392b).setDescription(`❌ ${msg}`)],
    components: [], files: [],
  }).then(() => {}).catch(() => {});

  if (config.attackers.length === 0 || config.defenders.length === 0) {
    await fail("A siege needs cards on both sides."); return;
  }
  if (config.targetKey && activeTargetKeys.has(config.targetKey)) {
    await fail("That target is already under siege. Wait for the current assault to resolve."); return;
  }
  if (config.targetKey) activeTargetKeys.add(config.targetKey);
  await loadGuildBattleItems(config.guildId).catch(() => {});

  // The squad builders are shared with the HEADLESS resolver, which drives both
  // sides with the AI and therefore marks every combatant `isAi`. In here side 0
  // is a person: claim it, or `startTurn` would auto-play the commander's turns
  // and the player would never get a button. Also point the combatant at the
  // real user so the battle embed mentions them instead of rendering "🤖 AI".
  for (const c of config.attackers) {
    c.isAi = false;
    c.userId = config.starterId;
    c.displayName = config.attackerName;
  }
  for (const c of config.defenders) {
    c.isAi = true;
    c.aiDifficulty = SIEGE_AI;
  }
  // The pool is a marching roster the player may re-order into a column; it must
  // obey the same side-0 / non-AI ownership as the active column.
  for (const c of config.attackerPool ?? []) {
    c.isAi = false;
    c.userId = config.starterId;
    c.displayName = config.attackerName;
    c.side = 0;
  }

  const session: SiegeSession = {
    ...config,
    id: randomBytes(4).toString("hex"),
    phase: "muster",
    ai: 0, di: 0, turnNumber: 1, currentSide: 0,
    coinCall: null,
    columnSize: config.attackers.length,
    headless: false,
    log: [],
    processing: false,
    inputPending: false,
    itemUsesLeft: config.siege.itemUses,
    attackerPower: config.attackers.reduce((sum, c) => sum + powerRating(c.stats), 0),
    defenderPower: config.defenders.reduce((sum, c) => sum + powerRating(c.stats), 0),
    castleImage: null, castleKey: "",
    turnFrame: null, turnFrameIsGif: false, pendingFrameToken: null,
    equippedItemId: null,
    defendersBroken: 0,
    rankStall: 0,
    peakDestruction: 0,
  };
  sessions.set(session.id, session);
  session.ttlTimer = setTimeout(() => { void abandon(session); }, MAX_SIEGE_MS);

  // The siege board MUST live on a real channel message (like /battle and
  // /raid), NOT the ephemeral /hq hub reply it was launched from.
  //
  // Why: the runtime renders every frame — the coin toss, each turn, the result
  // — with `message.edit()`, and many of those edits fire from BACKGROUND TIMERS
  // (the AI's answer, the coin animation, the turn clock) with no live
  // interaction to hand. `Message#edit()` routes through the channel endpoint,
  // which an ephemeral message has no route on — editing an ephemeral reply only
  // works through the interaction webhook token (`interaction.editReply`), and
  // even that expires 15 minutes in, short of a full 20-minute siege. On an
  // ephemeral board every render after muster silently no-ops, so the coin flip
  // never shows and the assault freezes on the muster screen. A public channel
  // message makes `message.edit()` work for the whole siege.
  const channel = interaction.channel;
  if (channel?.isSendable()) {
    session.message = await channel.send(await musterPayload(session))
      .then((m) => m as Message)
      .catch((err) => {
        logger.warn({ err, siege: session.id }, "siege board channel.send failed");
        return undefined;
      });
    // Retire the ephemeral hub board so the commander isn't left on a dead
    // mode-picker; the live siege is the channel message from here on.
    if (session.message) {
      await interaction.editReply({
        embeds: [new EmbedBuilder().setColor(session.accent)
          .setTitle(`🏰 Assault on ${session.targetName}`)
          .setDescription("Your siege is live in this channel. ⬇️")],
        components: [], files: [],
      }).catch(() => {});
    }
  }
  // Fallback: no sendable channel (rare — e.g. missing Send Messages perms).
  // Use the ephemeral reply so a board still appears; a long animated siege may
  // stop updating past the 15-minute token window, but short ones resolve.
  if (!session.message) {
    session.message = await interaction.editReply(await musterPayload(session))
      .then((m) => m as Message)
      .catch((err) => {
        logger.warn({ err, siege: session.id }, "siege muster message edit failed");
        return undefined;
      });
  }
  if (!session.message) { await release(session); return; }

  // Post first, render second. Castle/card art can take seconds to decode (or
  // fail at the remote image boundary); waiting for it before creating the
  // board made a valid siege look like the button had done nothing. The board
  // is visible immediately, then receives the rendered castle image.
  await refreshCastle(session);
  if (session.message && session.phase === "muster") {
    await session.message.edit(await musterPayload(session)).catch((err) => {
      logger.warn({ err, siege: session.id }, "siege muster image edit failed");
    });
  }
}

// ── Component routing (hq-hub:ls:<action>:<sid>[:extra]) ──────────────────────
// The `ls` namespace is kept from the previous engine so buttons already sitting
// in a channel keep routing here instead of falling through as unknown.
export async function handleSiegeComponent(
  interaction: ButtonInteraction | StringSelectMenuInteraction,
): Promise<void> {
  const parts = interaction.customId.split(":"); // hq-hub:ls:<action>:<sid>[:extra]
  const action = parts[2];
  // Replay is answered from the stashed recap, not a live session (which has
  // already ended by the time the button exists), so it routes first.
  if (action === "replay") return handleReplay(interaction as ButtonInteraction, parts[3] ?? "");
  const session = sessions.get(parts[3] ?? "");
  if (!session || session.phase === "ended") {
    await interaction.reply({ content: "⌛ This siege has ended.", ...EPHEMERAL }).catch(() => {});
    return;
  }
  if (interaction.user.id !== session.starterId) {
    await interaction.reply({ content: "Only the commander can direct this assault.", ...EPHEMERAL }).catch(() => {});
    return;
  }
  switch (action) {
    case "begin": return handleBegin(interaction as ButtonInteraction, session);
    case "skip": return handleSkip(interaction as ButtonInteraction, session);
    case "coin": return handleCoinCall(interaction as ButtonInteraction, session, parts[4] as "heads" | "tails");
    case "column": return handleColumnOpen(interaction as ButtonInteraction, session);
    case "columnsel": return handleColumnSelect(interaction as StringSelectMenuInteraction, session);
    case "equip": return handleEquipOpen(interaction as ButtonInteraction, session);
    case "equipsel": return handleEquipSelect(interaction as StringSelectMenuInteraction, session);
    case "move": return handleMove(interaction as ButtonInteraction, session, parts[4] as MoveType);
    case "item": return handleItemOpen(interaction as ButtonInteraction, session);
    case "itemsel": return handleItemSelect(interaction as StringSelectMenuInteraction, session);
    case "itemtgt": return handleItemTarget(interaction as StringSelectMenuInteraction, session, parts[4]!);
    case "moves": return handleMovesQuickView(interaction as ButtonInteraction, session);
    case "concede": return handleConcede(interaction as ButtonInteraction, session);
    default:
      await interaction.reply({ content: "Unknown siege action.", ...EPHEMERAL }).catch(() => {});
  }
}

// ── Muster ────────────────────────────────────────────────────────────────────
// The pre-assault board: your column, the garrison, the fortification you're up
// against, and the one item you can carry in. The siege equivalent of /battle's
// prep screen — nothing is committed until Begin Assault.

async function musterPayload(s: SiegeSession) {
  const item = s.equippedItemId ? getBattleItem(s.equippedItemId, s.guildId) : null;
  const embed = new EmbedBuilder()
    .setColor(s.accent)
    .setTitle(`🏰 Muster — assault on ${s.targetName}`)
    .setDescription(
      `**${s.attackerName}** forms up outside **${s.targetName}**, held by **${s.holderName}**.\n\n` +
      `Every card you bring must break a rank of the garrison. Wreck the whole garrison to take the base — ` +
      `**★** at 50% destruction, **★★** for the capture, **★★★** if you do it without losing a card.\n\n` +
      `🪙 **Call the toss** — guess the coin right and your team strikes first. ` +
      `⚔️ **Battle** to command the fight yourself, or ⏩ **Auto Skip Mode** to let your captains ` +
      `auto-resolve the siege and ping you when it's done.`,
    )
    .addFields(
      {
        name: `⚔️ Your column (${s.attackers.length})`,
        value: squadList(s.attackers),
        inline: true,
      },
      {
        name: `🛡️ Garrison (${s.defenders.length})`,
        value: squadList(s.defenders),
        inline: true,
      },
      {
        name: "📊 Strength",
        value: `⚔️ **${s.attackerPower}** vs 🛡️ **${s.defenderPower}**`,
        inline: false,
      },
      {
        name: "🪙 Coin call",
        value: s.coinCall
          ? `You called **${s.coinCall === "heads" ? "Heads" : "Tails"}** — win the toss and you strike first.`
          : "_Not called — the toss will be left to chance._",
        inline: false,
      },
      {
        name: "🎒 Supplies",
        value: item
          ? `${item.emoji} **${item.name}** — ${item.description}\n_Carried by every card in the column._`
          : "_No item equipped._",
        inline: false,
      },
    )
    .setFooter({ text: `${s.itemUsesLeft} field use${s.itemUsesLeft === 1 ? "" : "s"} · ${s.siege.turnSeconds}s per move once the assault starts` });
  if (s.castleImage) embed.setImage(`attachment://${SIEGE_CASTLE_IMAGE}`);

  const canPick = (s.attackerPool?.length ?? 0) > s.columnSize;
  const coinBtn = (call: "heads" | "tails", label: string, emoji: string) =>
    new ButtonBuilder().setCustomId(`hq-hub:ls:coin:${s.id}:${call}`).setLabel(label).setEmoji(emoji)
      .setStyle(s.coinCall === call ? ButtonStyle.Primary : ButtonStyle.Secondary);
  const rows: ActionRowBuilder<ButtonBuilder>[] = [
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(`hq-hub:ls:begin:${s.id}`).setLabel("Battle").setEmoji("⚔️").setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId(`hq-hub:ls:skip:${s.id}`).setLabel("Auto Skip Mode").setEmoji("⏩").setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`hq-hub:ls:concede:${s.id}`).setLabel("Stand down").setEmoji("🏳️").setStyle(ButtonStyle.Secondary),
    ),
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      coinBtn("heads", "Heads", "🪙"),
      coinBtn("tails", "Tails", "🌙"),
      ...(canPick
        ? [new ButtonBuilder().setCustomId(`hq-hub:ls:column:${s.id}`).setLabel("Choose team").setEmoji("🎴").setStyle(ButtonStyle.Secondary)]
        : []),
      new ButtonBuilder().setCustomId(`hq-hub:ls:equip:${s.id}`).setLabel(item ? "Change item" : "Equip item").setEmoji("🎒").setStyle(ButtonStyle.Secondary),
    ),
  ];
  return { embeds: [embed], components: rows, files: castleFiles(s) };
}

function squadList(cards: Combatant[]): string {
  return cards.slice(0, 6).map((c, i) =>
    `${i === 0 ? "**1.**" : `${i + 1}.`} ${c.cardName} · ❤️ ${c.stats.maxHealth} · ⚔️ ${c.stats.attack}`,
  ).join("\n").slice(0, 1024) || "_none_";
}

async function handleEquipOpen(interaction: ButtonInteraction, s: SiegeSession): Promise<void> {
  if (s.phase !== "muster") { await interaction.reply({ content: "The assault has already begun.", ...EPHEMERAL }).catch(() => {}); return; }
  const items = listBattleItems(s.guildId).slice(0, 24);
  if (items.length === 0) { await interaction.reply({ content: "No battle items are configured here.", ...EPHEMERAL }).catch(() => {}); return; }
  const menu = new StringSelectMenuBuilder()
    .setCustomId(`hq-hub:ls:equipsel:${s.id}`)
    .setPlaceholder("Pick the item your column carries")
    .addOptions([
      { label: "No item", value: "none", description: "Travel light", emoji: "🚫" },
      ...items.map(it => ({
        label: it.name.slice(0, 100), value: it.id,
        description: it.description.slice(0, 100), emoji: it.emoji || undefined,
      })),
    ]);
  await interaction.reply({
    content: "🎒 Every card in your column carries the same item into the siege.",
    components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu)], ...EPHEMERAL,
  }).catch(() => {});
}

async function handleEquipSelect(interaction: StringSelectMenuInteraction, s: SiegeSession): Promise<void> {
  const choice = interaction.values[0]!;
  const item = choice === "none" ? null : getBattleItem(choice, s.guildId);
  s.equippedItemId = item?.id ?? null;
  // Mirror /battle: the item lives ON the combatant, so `resolveMove("item")`
  // and the move buttons pick it up with no siege-specific plumbing.
  for (const c of s.attackers) {
    c.itemId = item?.id ?? null;
    c.item = item ?? null;
    c.itemChargesRemaining = item?.charges ?? 0;
    c.itemCooldownRemaining = 0;
  }
  await interaction.update({
    content: item ? `${item.emoji} Your column will carry **${item.name}**.` : "Travelling light.",
    components: [],
  }).catch(() => {});
  if (s.message) await s.message.edit(await musterPayload(s)).catch(() => {});
}

// ── Coin call ─────────────────────────────────────────────────────────────────
async function handleCoinCall(interaction: ButtonInteraction, s: SiegeSession, call: "heads" | "tails"): Promise<void> {
  if (s.phase !== "muster") { await interaction.deferUpdate().catch(() => {}); return; }
  // Tapping the current call clears it (back to chance).
  s.coinCall = s.coinCall === call ? null : call;
  await interaction.update(await musterPayload(s)).catch(() => {});
}

// ── Column selection ──────────────────────────────────────────────────────────
// The player picks which of their cards march, and in what order, up to the
// garrison's rank count. Reuses the already-built pool combatants — nothing is
// committed until Begin Assault / Send them in.
async function handleColumnOpen(interaction: ButtonInteraction, s: SiegeSession): Promise<void> {
  if (s.phase !== "muster") { await interaction.reply({ content: "The assault has already begun.", ...EPHEMERAL }).catch(() => {}); return; }
  const pool = s.attackerPool ?? [];
  if (pool.length === 0) { await interaction.reply({ content: "Your whole roster is already committed.", ...EPHEMERAL }).catch(() => {}); return; }
  const chosen = new Set(s.attackers.map(c => c.cardId));
  const menu = new StringSelectMenuBuilder()
    .setCustomId(`hq-hub:ls:columnsel:${s.id}`)
    .setPlaceholder(`Pick up to ${s.columnSize} card${s.columnSize === 1 ? "" : "s"} for the column`)
    .setMinValues(1)
    .setMaxValues(Math.min(s.columnSize, pool.length, 25))
    .addOptions(pool.slice(0, 25).map(c => ({
      label: c.cardName.slice(0, 100),
      description: `❤️ ${c.stats.maxHealth} · ⚔️ ${c.stats.attack} · 🛡️ ${c.stats.defense}`.slice(0, 100),
      value: String(c.cardId),
      default: chosen.has(c.cardId),
    })));
  await interaction.reply({
    content: `🎴 **Pick your team** — the order you pick is the order they charge the gate. You may bring up to **${s.columnSize}** (one per garrison rank).`,
    components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu)], ...EPHEMERAL,
  }).catch(() => {});
}

async function handleColumnSelect(interaction: StringSelectMenuInteraction, s: SiegeSession): Promise<void> {
  if (s.phase !== "muster") { await interaction.update({ content: "The assault has already begun.", components: [] }).catch(() => {}); return; }
  const pool = s.attackerPool ?? [];
  // Respect the click order so the player controls the charge order.
  const picked = interaction.values
    .map(id => pool.find(c => c.cardId === Number(id)))
    .filter((c): c is Combatant => !!c)
    .slice(0, s.columnSize);
  if (picked.length === 0) { await interaction.update({ content: "Pick at least one card.", components: [] }).catch(() => {}); return; }
  s.attackers = picked;
  // The equipped item lives on each combatant — carry it onto the new column.
  const item = s.equippedItemId ? getBattleItem(s.equippedItemId, s.guildId) : null;
  for (const c of s.attackers) {
    c.itemId = item?.id ?? null;
    c.item = item ?? null;
    c.itemChargesRemaining = item?.charges ?? 0;
    c.itemCooldownRemaining = 0;
  }
  s.attackerPower = s.attackers.reduce((sum, c) => sum + powerRating(c.stats), 0);
  await interaction.update({
    content: `🎴 Team set: ${picked.map(c => `**${c.cardName}**`).join(" → ")}.`,
    components: [],
  }).catch(() => {});
  if (s.message) await s.message.edit(await musterPayload(s)).catch(() => {});
}

// ── Send them in (skip / auto-resolve) ────────────────────────────────────────
// "Sending soldiers off": the captains auto-play the whole siege at speed with no
// board or timers, then the commander is DM'd the result. Reuses the exact same
// engine, break-rank and finish/commit path as a hand-driven assault.
async function handleSkip(interaction: ButtonInteraction, s: SiegeSession): Promise<void> {
  if (s.phase !== "muster") { await interaction.deferUpdate().catch(() => {}); return; }
  await interaction.deferUpdate().catch(() => {});
  s.headless = true;
  s.phase = "assault";
  // Coin toss still decides initiative, silently.
  const call = s.coinCall ?? (Math.random() < 0.5 ? "heads" : "tails");
  const flip: "heads" | "tails" = Math.random() < 0.5 ? "heads" : "tails";
  s.currentSide = call === flip ? 0 : 1;
  pushLog(s, [`📨 **${s.attackerName}** sends the column at **${s.targetName}** and awaits word from the field.`]);
  // Let the muster message acknowledge the send-off while the fight resolves.
  if (s.message) {
    await s.message.edit({
      embeds: [new EmbedBuilder().setColor(s.accent).setTitle("📨 Column deployed")
        .setDescription(`Your captains are storming **${s.targetName}**. You'll be pinged the moment it's decided.`)],
      components: [], files: [],
    }).catch(() => {});
  }
  await startTurn(s);
}

async function handleBegin(interaction: ButtonInteraction, s: SiegeSession): Promise<void> {
  if (s.phase !== "muster") { await interaction.deferUpdate().catch(() => {}); return; }
  await interaction.deferUpdate().catch(() => {});
  s.phase = "assault";
  // ── Coin toss → who strikes first ──────────────────────────────────────────
  // The SAME heads/tails flow as /battle: the toss is random, and calling it
  // right earns the initiative. No call left it to chance.
  const firstSide = await playCoinToss(s);
  s.currentSide = firstSide;
  const lead = s.attackers[0], garrison = s.defenders[0];
  pushLog(s, [
    `⚔️ **${s.attackerName}** throws the column at the walls of **${s.targetName}**.`,
    firstSide === 0 ? "🎯 Your column seizes the initiative — you move first." : "🛡️ The garrison reacts first.",
    lead && garrison ? `🔹 **${lead.cardName}** meets **${garrison.cardName}** at the gate.` : "",
  ]);
  await refreshCastle(s, true);
  await startTurn(s);
}

// Play the heads/tails toss and return who moves first. Reuses /battle's coin
// GIF; a correct call gives the commander (side 0) the opening move.
async function playCoinToss(s: SiegeSession): Promise<0 | 1> {
  const flip: "heads" | "tails" = Math.random() < 0.5 ? "heads" : "tails";
  const call = s.coinCall ?? (Math.random() < 0.5 ? "heads" : "tails");
  const firstSide: 0 | 1 = call === flip ? 0 : 1;
  if (!s.message) return firstSide;
  // Canvas/GIF rendering is best-effort. Never allow a renderer stall to keep
  // the interaction in the cinematic screen indefinitely.
  const anim = await Promise.race([
    renderCoinFlip(flip).catch(() => null),
    sleep(12_000).then(() => null),
  ]);
  if (anim) {
    const coinEmbed = new EmbedBuilder()
      .setColor(0xf1c40f)
      .setTitle("🪙 Coin toss…")
      .setDescription(s.coinCall ? `You called **${s.coinCall === "heads" ? "Heads" : "Tails"}**.` : "_No call — leaving it to fate._")
      .setImage("attachment://coin.gif");
    await s.message.edit({
      content: null, embeds: [coinEmbed],
      files: [new AttachmentBuilder(Buffer.from(anim.buffer), { name: "coin.gif" })], components: [],
    }).catch((err) => {
      logger.warn({ err, siege: s.id }, "siege coin animation edit failed");
    });
    await sleep(Math.max(1500, anim.durationMs));
  }
  const landed = flip === "heads" ? "Heads 🪙" : "Tails 🌙";
  const resultEmbed = new EmbedBuilder()
    .setColor(firstSide === 0 ? 0x4fd06a : s.accent)
    .setTitle(`🪙 ${landed}`)
    .setDescription(firstSide === 0
      ? `You **won the toss** — your column storms the gate first.`
      : `The toss goes to the defenders — the garrison moves first.`);
  await s.message.edit({ content: null, embeds: [resultEmbed], files: [], components: [] }).catch((err) => {
    logger.warn({ err, siege: s.id }, "siege coin result edit failed");
  });
  await sleep(1300);
  return firstSide;
}

// ── Turn loop (mirrors battle-manager) ───────────────────────────────────────

async function startTurn(s: SiegeSession): Promise<void> {
  if (s.phase !== "assault") return;
  const actor = active(s, s.currentSide);
  if (!actor) { await finish(s); return; }

  // The garrison — and, in a headless send-off, BOTH sides — answer on their own,
  // after a beat, exactly like /battle's AI.
  if (actor.isAi || s.headless) {
    await render(s);
    await pace(s);
    const foe = active(s, foeSide(s.currentSide));
    if (!foe) { await finish(s); return; }
    const move = chooseAiMove(actor, foe, s.settings, SIEGE_AI);
    await applyMove(s, s.currentSide, move);
    return;
  }

  clearTurnTimer(s);
  const ms = s.siege.turnSeconds * 1000;
  s.turnTimer = setTimeout(() => {
    pushLog(s, [`⏱️ ${actor.cardName} hesitated — the column presses on regardless.`]);
    void applyMove(s, s.currentSide, "attack");
  }, ms);
  await render(s, { turnEndsAt: Date.now() + ms });
}

async function applyMove(s: SiegeSession, side: 0 | 1, move: MoveType): Promise<void> {
  if (s.phase !== "assault" || s.processing) return;
  s.processing = true;
  clearTurnTimer(s);
  try {
    const actor = active(s, side);
    const foe = active(s, foeSide(side));
    if (!actor || !foe) { await finish(s); return; }

    // Start-of-turn ticks (DoT / regen / freeze / energy regen).
    const start = startOfTurn(actor, s.settings);
    pushLog(s, start.events.map(e => e.text));
    if (start.koed || actor.hp <= 0) {
      if (await breakRank(s, side)) { await finish(s); return; }
      await handOver(s, side);
      return;
    }

    // "Winding up" frame, then the resolved blow — the same two-beat rhythm a
    // battle turn has.
    await render(s, { currentMove: `${actor.cardName} → ${moveLabel(move, actor)}…` });
    await pace(s);

    if (!start.skipped) {
      const foePoolBefore = foe.hp + foe.shield;
      const selfPoolBefore = actor.hp + actor.shield;
      const result = resolveMove(s.settings, actor, foe, move);
      pushLog(s, result.events.map(e => e.text));

      await buildTurnFrame(s, side, move, result, actor, foe, foePoolBefore, selfPoolBefore);
      await render(s);
      await pace(s);

      // The ram keeps working between blows: a rank that refuses to die gets
      // ground down whether or not the commander's swing landed.
      if (side === 0 && foe.hp > 0) applySiegePressure(s, foe);

      // A KO breaks a RANK — it does not end the siege. Check the struck side
      // first (a counter can drop the attacker), then the foe.
      if (actor.hp <= 0 && (await breakRank(s, side))) { await finish(s); return; }
      if (foe.hp <= 0 && (await breakRank(s, foeSide(side)))) { await finish(s); return; }
    } else {
      await render(s);
    }

    await handOver(s, side);
  } catch (err) {
    logger.error({ err, siege: s.id }, "siege move failed");
    s.processing = false;
  }
}

// Chip the rank in front of the column, bypassing any shield. Scales with how
// many commander turns this rank has already survived, so it only ever matters
// against a stall.
function applySiegePressure(s: SiegeSession, defender: Combatant): void {
  s.rankStall++;
  const stalled = s.rankStall - PRESSURE_GRACE_TURNS;
  if (stalled <= 0) return;
  const pct = Math.min(PRESSURE_MAX_PCT, stalled * PRESSURE_STEP_PCT);
  const chip = Math.max(1, Math.round(defender.stats.maxHealth * (pct / 100)));
  defender.hp = Math.max(0, defender.hp - chip);
  pushLog(s, [`🪨 Siege pressure bites — **${defender.cardName}** loses **${chip}** as the wall is undermined.`]);
}

// Pass the turn to the other side, advance the turn counter and enforce the cap.
async function handOver(s: SiegeSession, side: 0 | 1): Promise<void> {
  s.currentSide = foeSide(side);
  if (s.currentSide === 0) s.turnNumber++;
  if (s.turnNumber > s.siege.maxTurns) {
    pushLog(s, ["⌛ The assault stalls — the siege is decided on ground taken."]);
    await finish(s);
    return;
  }
  s.processing = false;
  await startTurn(s);
}

/**
 * A card on `side` has fallen: advance that line. Returns true when the siege is
 * decided (one side has nothing left to send).
 */
async function breakRank(s: SiegeSession, side: 0 | 1): Promise<boolean> {
  if (side === 1) {
    while (s.defenders[s.di] && s.defenders[s.di]!.hp <= 0) {
      pushLog(s, [`💥 **${s.defenders[s.di]!.cardName}** is broken — the wall gives ground.`]);
      s.di++;
      s.defendersBroken++;
    }
    s.rankStall = 0; // a fresh rank starts with an unmarked wall
    await refreshCastle(s, true);
    if (s.di >= s.defenders.length) return true;
    const next = s.defenders[s.di]!;
    pushLog(s, [`🛡️ **${next.cardName}** steps into the breach.`]);
    return false;
  }
  while (s.attackers[s.ai] && s.attackers[s.ai]!.hp <= 0) {
    pushLog(s, [`☠️ **${s.attackers[s.ai]!.cardName}** falls at the wall.`]);
    s.ai++;
  }
  await refreshCastle(s, true);
  if (s.ai >= s.attackers.length) return true;
  const next = s.attackers[s.ai]!;
  pushLog(s, [`⚔️ **${next.cardName}** takes up the assault.`]);
  return false;
}

// Map a live combatant onto the battlefield renderer's fighter view. `hpBefore`
// is only set for the STRUCK card so the field can animate its HP draining.
function fieldFighter(c: Combatant, hpBefore?: number): SiegeFieldFighter {
  return {
    name: c.cardName,
    artUrl: c.cardImageUrl,
    rarity: c.cardRarity,
    rarityColor: c.cardRarityDisplay?.color ?? null,
    hp: Math.max(0, c.hp),
    maxHp: c.stats.maxHealth,
    hpBefore,
    energy: c.energy,
    ultimate: c.ultimate,
  };
}

// Each side's roster minus the active card, ordered "next to step up" first,
// then the fallen — so the battlefield shows the whole column stepping up rank
// by rank even though only the front pair actually trade blows.
function benchOf(col: Combatant[], activeIdx: number): SiegeFieldBenchCard[] {
  const mk = (c: Combatant, fallen: boolean): SiegeFieldBenchCard => ({
    artUrl: c.cardImageUrl, rarity: c.cardRarity,
    rarityColor: c.cardRarityDisplay?.color ?? null, fallen,
  });
  const upcoming = col.filter((_, i) => i > activeIdx).map(c => mk(c, false));
  const fallen = col.filter((_, i) => i < activeIdx).map(c => mk(c, true));
  return [...upcoming, ...fallen];
}

// Pick a battlefield backdrop + floor deterministically from the target, so a
// given base always storms on the same ground across all its turns (and across
// player sieges, AI conquests and open territories alike — every mode routes
// through here).
const FIELD_BACKDROPS = ["castles", "forest", "desert", "fall", "grass"] as const;
const FIELD_FLOORS = ["stone", "marble", "dirt", "blue-stone", "cobblestone"] as const;
function hashStr(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
  return h >>> 0;
}

// side = the side that just moved; attacker is always side 0, defender side 1.
function buildFieldInput(
  s: SiegeSession, side: 0 | 1, move: MoveType,
  visual: ReturnType<typeof computeMoveVisual>, actor: Combatant, foe: Combatant,
  foePoolBefore: number,
): SiegeFieldInput {
  const attackerC = side === 0 ? actor : foe;
  const defenderC = side === 0 ? foe : actor;
  // The struck card is always the FOE of whoever moved.
  const targetBefore = Math.min(foe.stats.maxHealth, Math.max(0, foePoolBefore));
  const h = hashStr(s.targetName || "siege");
  return {
    attacker: fieldFighter(attackerC, attackerC === foe ? targetBefore : undefined),
    defender: fieldFighter(defenderC, defenderC === foe ? targetBefore : undefined),
    actingSide: side,
    moveName: moveLabel(move, actor),
    damage: visual.damage,
    isHit: visual.isHit,
    isCrit: visual.isCrit,
    ko: foe.hp <= 0,
    accent: s.accent,
    turnLabel: `Turn ${s.turnNumber}`,
    backdropKey: FIELD_BACKDROPS[h % FIELD_BACKDROPS.length]!,
    floorKey: FIELD_FLOORS[(h >>> 8) % FIELD_FLOORS.length]!,
    attackerBench: benchOf(s.attackers, s.ai),
    defenderBench: benchOf(s.defenders, s.di),
  };
}

// The one-shot attack frame under the battle embed, in whichever style the
// guild's battle settings use — so a siege turn looks like a battle turn.
async function buildTurnFrame(
  s: SiegeSession, side: 0 | 1, move: MoveType,
  result: ReturnType<typeof resolveMove>, actor: Combatant, foe: Combatant,
  foePoolBefore: number, selfPoolBefore: number,
): Promise<void> {
  if (s.headless || !s.siege.turnVisuals) return;
  if (!(sceneAnimated(s) || classicFrames(s))) return; // animations off → no frame
  const visual = computeMoveVisual(move, result, actor, foe, foePoolBefore, selfPoolBefore);
  const fieldInput = buildFieldInput(s, side, move, visual, actor, foe, foePoolBefore);
  const token = `${s.turnNumber}:${side}:${actor.cardId}:${foe.cardId}:${foePoolBefore}:${selfPoolBefore}`;
  s.pendingFrameToken = token;
  const animated = sceneAnimated(s);
  const speed = s.settings.battleAnimationSpeed as AnimationSpeed;

  // FULLY NON-BLOCKING. The turn NEVER awaits a render — this returns at once and
  // the frame is patched into the board when each stage finishes, so a slow
  // first render (Konva warm-up + several remote card-art fetches) can no longer
  // freeze the fight. The board stays interactive; the battlefield image just
  // catches up a beat later. A still (fast) lands first; animated guilds then
  // upgrade to the GIF. Each patch only applies if it is STILL this turn's frame
  // (pendingFrameToken), so a late render can't stamp a stale image on a newer
  // turn. The previous frame persists in the meantime (render() no longer
  // consumes it), so the board never blanks between turns.
  void (async () => {
    const still = await renderSiegeFieldStill(fieldInput).catch(() => null);
    if (still && s.pendingFrameToken === token && s.phase !== "ended") {
      s.turnFrame = still; s.turnFrameIsGif = false;
      await render(s);
    }
    if (animated) {
      const gif = await renderSiegeField(fieldInput, speed).catch(() => null);
      if (gif && s.pendingFrameToken === token && s.phase !== "ended") {
        s.turnFrame = Buffer.from(gif.buffer); s.turnFrameIsGif = true;
        await render(s);
      }
    }
  })();
}

// ── Items ─────────────────────────────────────────────────────────────────────
// Field items are the siege's supply line: a limited pool of uses that any card
// in the column can spend. Spending one costs the turn, and the garrison answers
// — exactly like using an item in a battle.

async function handleItemOpen(interaction: ButtonInteraction, s: SiegeSession): Promise<void> {
  if (s.phase !== "assault") { await interaction.reply({ content: "The assault hasn't started.", ...EPHEMERAL }).catch(() => {}); return; }
  if (s.processing) { await interaction.reply({ content: "The exchange is resolving — hang on.", ...EPHEMERAL }).catch(() => {}); return; }
  if (s.itemUsesLeft <= 0) { await interaction.reply({ content: "🎒 Your supplies are spent.", ...EPHEMERAL }).catch(() => {}); return; }
  const items = listBattleItems(s.guildId).slice(0, 25);
  if (items.length === 0) { await interaction.reply({ content: "No usable items are configured.", ...EPHEMERAL }).catch(() => {}); return; }
  const menu = new StringSelectMenuBuilder()
    .setCustomId(`hq-hub:ls:itemsel:${s.id}`)
    .setPlaceholder("Call up a field item")
    .addOptions(items.map(it => ({
      label: it.name.slice(0, 100), description: it.description.slice(0, 100),
      emoji: it.emoji || undefined, value: it.id,
    })));
  await interaction.reply({
    content: `🎒 **Field supplies** — **${s.itemUsesLeft}** left. Support items reach any card in your column; offensive ones hit the rank in front of you.`,
    components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu)], ...EPHEMERAL,
  }).catch(() => {});
}

async function handleItemSelect(interaction: StringSelectMenuInteraction, s: SiegeSession): Promise<void> {
  const item = getBattleItem(interaction.values[0], s.guildId);
  if (!item) { await interaction.update({ content: "That item is gone.", components: [] }).catch(() => {}); return; }
  if (isOffensiveItem(item)) { await commitItem(interaction, s, item.id, "def"); return; }

  const canRevive = item.effectType === "heal";
  const opts = s.attackers
    .map((c, i) => ({ c, i }))
    .filter(({ c }) => canRevive || c.hp > 0)
    .map(({ c, i }) => ({
      label: `${i === s.ai ? "★ " : ""}${c.cardName}`.slice(0, 100),
      description: (c.hp <= 0 ? "down — revive" : `${c.hp}/${c.stats.maxHealth} HP`).slice(0, 100),
      value: String(i),
    }));
  if (opts.length === 0) { await interaction.update({ content: "No one in the column can take that.", components: [] }).catch(() => {}); return; }
  const menu = new StringSelectMenuBuilder()
    .setCustomId(`hq-hub:ls:itemtgt:${s.id}:${item.id}`)
    .setPlaceholder(`Who gets the ${item.name}?`.slice(0, 100))
    .addOptions(opts.slice(0, 25));
  await interaction.update({
    content: `${item.emoji} **${item.name}** — ${item.description}\nChoose a card:`,
    components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu)],
  }).catch(() => {});
}

async function handleItemTarget(
  interaction: StringSelectMenuInteraction, s: SiegeSession, itemId: string,
): Promise<void> {
  await commitItem(interaction, s, itemId, interaction.values[0]!);
}

async function commitItem(
  interaction: ButtonInteraction | StringSelectMenuInteraction,
  s: SiegeSession, itemId: string, targetKey: string,
): Promise<void> {
  const item = getBattleItem(itemId, s.guildId);
  const actor = active(s, 0);
  if (!item || !actor) { await interaction.update({ content: "That item can't be used now.", components: [] }).catch(() => {}); return; }
  if (s.processing || s.inputPending || s.itemUsesLeft <= 0 || s.phase !== "assault" || s.currentSide !== 0) {
    await interaction.update({ content: "You can't use an item right now.", components: [] }).catch(() => {});
    return;
  }
  const target = targetKey === "def" ? active(s, 1) : s.attackers[Number(targetKey)];
  if (!target) { await interaction.update({ content: "That target is gone.", components: [] }).catch(() => {}); return; }

  // Claim the turn synchronously so a second interaction can't also spend it;
  // handOver releases it (mirrors applyMove). On any throw we release here.
  s.processing = true;
  try {
    const outcome = applyItemUse(item, actor, target);
    s.itemUsesLeft--;
    pushLog(s, outcome.events.map(e => e.text));
    await interaction.update({ content: `${item.emoji} Called up **${item.name}**.`, components: [] }).catch(() => {});

    // A field item spends the turn; the garrison answers.
    if (target.hp <= 0 && targetKey === "def") {
      if (await breakRank(s, 1)) { await finish(s); return; }
    }
    await handOver(s, 0);
  } catch (err) {
    s.processing = false;
    logger.error({ err, siege: s.id }, "siege item use failed");
  }
}

// ── Read-only reference (mirrors /battle's Moves popup) ──────────────────────
async function handleMovesQuickView(interaction: ButtonInteraction, s: SiegeSession): Promise<void> {
  const actor = active(s, 0);
  if (!actor) { await interaction.reply({ content: "No card is leading the column.", ...EPHEMERAL }).catch(() => {}); return; }
  const ms = actor.movesetDef ?? getMoveset(actor.moveset);
  const item = actor.item ?? getBattleItem(actor.itemId, s.guildId);
  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle(`📖 ${actor.cardName} — Move Set`)
    .setDescription("*Quick reference for this assault — only you can see this.*")
    .addFields(
      {
        name: "🔥 Special",
        value: ms ? `${ms.emoji} **${ms.name}** — ${ms.description}\n⚡ ${ms.energyCost} energy` : "_None assigned._",
        inline: false,
      },
      {
        name: "🎒 Item",
        value: item ? `${item.emoji} **${item.name}** — ${item.description}` : "_No item equipped._",
        inline: false,
      },
      {
        name: "🏰 Siege rules",
        value:
          "A knockout breaks **one rank**, it doesn't end the assault — the next card steps up on whichever " +
          "side lost one. Break the whole garrison to take the base.",
        inline: false,
      },
    );
  await interaction.reply({ embeds: [embed], ...EPHEMERAL }).catch(() => {});
}

async function handleMove(interaction: ButtonInteraction, s: SiegeSession, move: MoveType): Promise<void> {
  if (s.phase !== "assault") { await interaction.deferUpdate().catch(() => {}); return; }
  // Reject if a turn is resolving (processing) OR another click already claimed
  // this turn (inputPending) OR it isn't the commander's turn. inputPending is
  // set SYNCHRONOUSLY below, before the awaited ack, so a mash of clicks can't
  // race multiple moves through this gate.
  if (s.processing || s.inputPending || s.currentSide !== 0) { await interaction.deferUpdate().catch(() => {}); return; }
  s.inputPending = true;
  await interaction.deferUpdate().catch(() => {});
  // applyMove synchronously sets s.processing before its first await, so by the
  // time this call returns its promise the turn is claimed. Drop the pre-ack
  // latch immediately — holding it across the whole turn chain (which recurses
  // through the garrison's answer back to the next commander turn) would leave
  // the buttons greyed on the player's own turn. `processing` guards the rest.
  const p = applyMove(s, 0, move);
  s.inputPending = false;
  await p;
}

async function handleConcede(interaction: ButtonInteraction, s: SiegeSession): Promise<void> {
  await interaction.deferUpdate().catch(() => {});
  if (s.phase === "muster") {
    // Nothing was committed, so standing down just closes the board.
    pushLog(s, ["🏳️ The column stands down."]);
    if (s.message) {
      await s.message.edit({
        embeds: [new EmbedBuilder().setColor(0x9aa0a8).setTitle("🏳️ Stood down")
          .setDescription(`No assault was made on **${s.targetName}**.`)],
        components: [], files: [],
      }).catch(() => {});
    }
    await release(s);
    return;
  }
  s.ai = s.attackers.length; // force a loss
  pushLog(s, ["🏳️ You sound the retreat."]);
  await finish(s);
}

// Reveal the stashed blow-by-blow for an auto-resolved siege. Ephemeral, so each
// viewer gets their own recap and the clean result message is left untouched.
async function handleReplay(interaction: ButtonInteraction, replayId: string): Promise<void> {
  const r = replays.get(replayId);
  if (!r) {
    await interaction.reply({ content: "⌛ This replay has expired.", ...EPHEMERAL }).catch(() => {});
    return;
  }
  const body = r.log.length ? r.log.slice(-16).join("\n").slice(0, 3800) : "_No blows were recorded._";
  const embed = new EmbedBuilder().setColor(r.accent)
    .setTitle(`🔁 Replay — ${r.title}`)
    .setDescription(`Assault on **${r.targetName}**\n${r.scoreLine}\n${WHITE_LINE}\n${body}`);
  await interaction.reply({ embeds: [embed], ...EPHEMERAL }).catch(() => {});
}

// ── Rendering ─────────────────────────────────────────────────────────────────

function pushLog(s: SiegeSession, lines: (string | undefined)[]): void {
  for (const l of lines) if (l && l.trim()) s.log.push(l);
  s.log = s.log.slice(-14);
}

function active(s: SiegeSession, side: 0 | 1): Combatant | undefined {
  return side === 0 ? s.attackers[s.ai] : s.defenders[s.di];
}
function foeSide(side: 0 | 1): 0 | 1 { return side === 0 ? 1 : 0; }

function castleFiles(s: SiegeSession): AttachmentBuilder[] {
  return s.castleImage ? [new AttachmentBuilder(s.castleImage, { name: SIEGE_CASTLE_IMAGE })] : [];
}

// Re-render the castle only when the siege visibly changed (a rank broke, or the
// meter moved a whole step). The buffer is re-sent on every edit — Discord drops
// attachments that aren't resent — but the expensive canvas work is not redone.
async function refreshCastle(s: SiegeSession, force = false): Promise<void> {
  // A headless siege renders no intermediate frames; finish() still paints the
  // final result scene directly.
  if (!s.baseView || s.headless) return;
  const pct = destructionPct(s);
  const key = `${s.di}:${s.ai}:${Math.floor(pct / 5)}:${s.phase}`;
  if (!force && key === s.castleKey && s.castleImage) return;
  const overlay = currentOverlay(s, pct);
  // Race against a timeout: canvas image loads can hang indefinitely if a card
  // image URL stalls. A null result just skips the castle frame this tick.
  const buf = await Promise.race([
    renderSiegeFrame(s.baseView, overlay).catch(() => null),
    sleep(8_000).then(() => null),
  ]);
  if (buf) { s.castleImage = buf; s.castleKey = key; }
}

function currentOverlay(s: SiegeSession, pct: number, banner?: { text: string; color: number }): SiegeOverlay {
  const defeated = new Set<number>();
  for (let i = 0; i < s.di && i < s.defenders.length; i++) defeated.add(i);
  const cardsLost = s.ai;
  const captured = s.di >= s.defenders.length;
  return {
    healthFrac: s.defenders.length === 0 ? 0 : Math.max(0, 1 - pct / 100),
    defeated,
    attacker: s.champion,
    advance: Math.max(0.05, Math.min(1, pct / 100)),
    banner: banner ?? null,
    destructionPct: pct,
    stars: starsFor(pct, captured, cardsLost),
    // The result banner already says how it ended, so the turn strip stands down
    // once it is up.
    turnLabel: banner ? null
      : s.phase === "muster" ? "Muster — the column forms up"
      : `Turn ${s.turnNumber} · ${s.currentSide === 0 ? "your move" : "the garrison answers"}`,
  };
}

// TOP embed: the castle/base itself — the live scene + the destruction
// scoreboard. The running log now lives in its own slim strip below (see
// buildTurnStripEmbed), so this embed is purely "here is the base you're taking
// apart," sitting above the battlefield.
function buildCastleEmbed(s: SiegeSession): EmbedBuilder {
  const pct = destructionPct(s);
  const captured = s.di >= s.defenders.length;
  const stars = starsFor(pct, captured, s.ai);
  const ranksLeft = Math.max(0, s.defenders.length - s.di);
  const embed = new EmbedBuilder()
    .setColor(s.accent)
    .setTitle(`🏰 ${s.targetName} — ${"★".repeat(stars)}${"☆".repeat(3 - stars)} ${Math.round(pct)}%`)
    .setDescription(
      `${bar(Math.round(pct), 100, 14)} **destruction**\n` +
      `🛡️ **${ranksLeft}** rank${ranksLeft === 1 ? "" : "s"} still holding · ⚔️ **${Math.max(0, s.attackers.length - s.ai)}** card${s.attackers.length - s.ai === 1 ? "" : "s"} left in your column`,
    );
  if (s.castleImage) embed.setImage(`attachment://${SIEGE_CASTLE_IMAGE}`);
  return embed;
}

// The routine "X's attack hits for N" lines are already shown on the battlefield
// frame, so the strip keeps only the notable beats and the last line.
const ROUTINE_HIT = /^⚔️ .* hits for /u;
function latestSiegeLines(s: SiegeSession, max = 2): string {
  if (s.log.length === 0) return "_The field is quiet…_";
  const notable = s.log.filter((l, i) => i === s.log.length - 1 || !ROUTINE_HIT.test(l));
  return (notable.length ? notable : s.log).slice(-max).join("\n").slice(0, 600);
}

// MIDDLE embed: the one-line turn-for-turn strip. It sits between the base
// (above) and the battlefield (below) and does two jobs only — show the latest
// move, and ping whoever is on the clock. No stat block, no wall of log: the
// battlefield frame carries the HP/energy, this is just the play-by-play caption
// and the turn call.
function buildTurnStripEmbed(s: SiegeSession, opts?: { currentMove?: string; turnEndsAt?: number }): EmbedBuilder {
  const timer = opts?.turnEndsAt ? ` · ends <t:${Math.floor(opts.turnEndsAt / 1000)}:R>` : "";
  const turnCall = opts?.currentMove
    ? `⚔️ *${opts.currentMove}*`
    : s.currentSide === 1
      ? `🛡️ **Garrison's move…**${timer}`
      : `🔹 <@${s.starterId}> — **your move!**${timer}`;
  return new EmbedBuilder()
    .setColor(s.accent)
    .setDescription(`📜 ${latestSiegeLines(s)}\n${WHITE_LINE}\n**Turn ${s.turnNumber}** · ${turnCall}`)
    .setFooter({ text: `🎒 ${s.itemUsesLeft} field use${s.itemUsesLeft === 1 ? "" : "s"} left · a KO breaks a rank, not the siege` });
}

// BOTTOM embed: the battlefield itself — the animated Clash arena. The image is
// the whole story here (both cards, their HP/energy, the strike), so the embed
// is deliberately bare: just the frame.
function buildBattleEmbed(s: SiegeSession): EmbedBuilder {
  return new EmbedBuilder().setColor(s.accent);
}

function buildControls(s: SiegeSession): ActionRowBuilder<ButtonBuilder>[] {
  const actor = active(s, 0);
  if (!actor || s.currentSide !== 0) return [];
  // While a turn is resolving (or an input is already claimed), grey out every
  // control so the board visibly locks the instant the commander acts — no more
  // clickable-looking buttons during the render/answer, which is what let a
  // player mash "attack" and feel like they were getting extra hits.
  const busy = s.processing || s.inputPending;
  const avail = availableMoves(actor, s.settings);
  const mk = (move: MoveType, label: string, emoji: string, style: ButtonStyle) =>
    new ButtonBuilder().setCustomId(`hq-hub:ls:move:${s.id}:${move}`).setLabel(label).setEmoji(emoji)
      .setStyle(style).setDisabled(busy || !avail[move]);
  const row1 = new ActionRowBuilder<ButtonBuilder>().addComponents(
    mk("attack", "Attack", "⚔️", ButtonStyle.Primary),
    mk("special", "Special", "🔥", ButtonStyle.Danger),
    mk("defend", "Defend", "🛡️", ButtonStyle.Secondary),
    mk("charge", "Charge", "⚡", ButtonStyle.Secondary),
    mk("ultimate", "Ultimate", "💀", ButtonStyle.Danger),
  );
  const row2 = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`hq-hub:ls:item:${s.id}`)
      .setLabel(`Supplies (${s.itemUsesLeft})`).setEmoji("🎒")
      .setStyle(ButtonStyle.Success).setDisabled(busy || s.itemUsesLeft <= 0),
    new ButtonBuilder().setCustomId(`hq-hub:ls:moves:${s.id}`).setLabel("Moves").setEmoji("📖").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`hq-hub:ls:concede:${s.id}`).setLabel("Retreat").setEmoji("🏳️").setStyle(ButtonStyle.Secondary),
  );
  return [row1, row2];
}

async function render(s: SiegeSession, opts?: { currentMove?: string; turnEndsAt?: number }): Promise<void> {
  if (!s.message || s.phase === "ended" || s.headless) return;
  await refreshCastle(s);
  const files = castleFiles(s);
  const battleEmbed = buildBattleEmbed(s);
  // The battlefield frame PERSISTS (it is not consumed): the board can paint the
  // last frame immediately while the new one renders in the background, so it
  // never blanks between turns. Discord drops attachments on edit, so the buffer
  // is re-sent every render — the expensive render is what we avoid repeating.
  const frame = s.turnFrame;
  if (frame) {
    const name = s.turnFrameIsGif ? SIEGE_TURN_GIF : SIEGE_TURN_PNG;
    battleEmbed.setImage(`attachment://${name}`);
    files.push(new AttachmentBuilder(frame, { name }));
  }
  // Ping the commander only at the START of their turn (the render that arms the
  // turn clock), so they get exactly one notification per turn instead of one
  // per intermediate re-render.
  const ping = opts?.turnEndsAt && s.currentSide === 0 && s.phase === "assault";
  await s.message.edit({
    content: ping ? `<@${s.starterId}>` : "",
    embeds: [buildCastleEmbed(s), buildTurnStripEmbed(s, opts), battleEmbed],
    components: buildControls(s),
    files,
    allowedMentions: { users: ping ? [s.starterId] : [] },
  }).catch(() => {});
}

// ── Finish ────────────────────────────────────────────────────────────────────

async function finish(s: SiegeSession): Promise<void> {
  if (s.phase === "ended") return;
  s.phase = "ended";
  s.processing = true;
  clearTurnTimer(s);

  const captured = s.di >= s.defenders.length && s.ai < s.attackers.length;
  const pct = captured ? 100 : destructionPct(s);
  const stars = starsFor(pct, captured, s.ai);
  const outcome: SiegeOutcome = {
    attackerWon: captured,
    turns: s.turnNumber,
    attackerCardsLost: Math.min(s.ai, s.attackers.length),
    defenderCardsLost: Math.min(s.di, s.defenders.length),
    attackerPower: s.attackerPower,
    defenderPower: s.defenderPower,
    destructionPct: Math.round(pct),
    stars,
  };

  let view: SiegeResultView;
  try {
    view = await s.applyOutcome(outcome);
  } catch (err) {
    logger.error({ err, siege: s.id }, "siege applyOutcome failed");
    view = {
      title: captured ? "🚩 Base captured!" : "🛡️ The walls held",
      description: captured ? "You took the base." : "Your assault was broken.",
      color: captured ? 0x4fd06a : 0xc0392b,
    };
  }

  // Final castle frame with the result banner painted on.
  if (s.baseView) {
    const banner = captured
      ? { text: `${s.attackerName} CAPTURED ${s.targetName}`, color: 0xc0392b }
      : { text: `${s.targetName} HELD`, color: 0x4fd06a };
    const buf = await renderSiegeFrame(s.baseView, currentOverlay(s, pct, banner)).catch(() => null);
    if (buf) s.castleImage = buf;
  }

  const scoreLine =
    `${"★".repeat(stars)}${"☆".repeat(3 - stars)} · **${Math.round(pct)}%** destruction · ` +
    `**${outcome.defenderCardsLost}**/${s.defenders.length} ranks broken · ` +
    `**${outcome.attackerCardsLost}** card${outcome.attackerCardsLost === 1 ? "" : "s"} lost`;

  // A player who FOUGHT it watched every blow, so their result recaps the log
  // inline. A player who chose Auto Skip Mode didn't watch — keep their result
  // clean (outcome only) and tuck the fight behind a "View Replay" button.
  const components: ActionRowBuilder<ButtonBuilder>[] = [];
  const embed = new EmbedBuilder().setColor(view.color).setTitle(view.title)
    .setDescription(s.headless
      ? `${view.description}\n${WHITE_LINE}\n${scoreLine}`
      : `${view.description}\n${WHITE_LINE}\n${scoreLine}\n${WHITE_LINE}\n${latestSiegeLines(s, 6)}`);
  if (view.fields?.length) {
    embed.addFields(view.fields.map(f => ({ name: f.name, value: f.value, inline: f.inline ?? true })));
  }
  if (s.castleImage) embed.setImage(`attachment://${SIEGE_CASTLE_IMAGE}`);
  if (s.headless) {
    const replayId = randomBytes(4).toString("hex");
    replays.set(replayId, { title: view.title, scoreLine, log: [...s.log], accent: s.accent, targetName: s.targetName });
    setTimeout(() => replays.delete(replayId), REPLAY_TTL_MS).unref?.();
    components.push(new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(`hq-hub:ls:replay:${replayId}`).setLabel("View Replay").setEmoji("🔁").setStyle(ButtonStyle.Secondary),
    ));
  }
  // A distinct beat before the result lands, so it doesn't flash past — only when
  // a person is watching (a send-off is instant and DM'd).
  if (!s.headless) await sleep(RESULT_HOLD_MS);
  if (s.message) {
    await s.message.edit({ embeds: [embed], components, files: castleFiles(s) }).catch(() => {});
  }
  // Send-off ping: the commander walked away, so DM them the result — "your
  // soldiers are back from the siege". The scene image lives on the (ephemeral)
  // board message; the DM carries the outcome text.
  if (s.headless && s.message) {
    try {
      const user = await s.message.client.users.fetch(s.starterId);
      const dm = new EmbedBuilder().setColor(view.color)
        .setTitle(`📨 ${view.title}`)
        .setDescription(`Your assault on **${s.targetName}** is finished.\n${WHITE_LINE}\n${view.description}\n${WHITE_LINE}\n${scoreLine}`);
      if (view.fields?.length) dm.addFields(view.fields.map(f => ({ name: f.name, value: f.value, inline: f.inline ?? true })));
      await user.send({ embeds: [dm] });
    } catch { /* DMs closed — the board still shows the result. */ }
  }
  await release(s);
}

// The TTL net: a siege nobody finished must not hold its target hostage.
async function abandon(s: SiegeSession): Promise<void> {
  if (s.phase === "ended") return;
  pushLog(s, ["⌛ The siege was abandoned — the column withdraws."]);
  if (s.phase === "muster") {
    if (s.message) {
      await s.message.edit({
        embeds: [new EmbedBuilder().setColor(0x9aa0a8).setTitle("⌛ Assault expired")
          .setDescription(`The column never moved on **${s.targetName}**.`)],
        components: [], files: [],
      }).catch(() => {});
    }
    await release(s);
    return;
  }
  s.ai = s.attackers.length; // an abandoned assault is a failed one
  await finish(s);
}

async function release(s: SiegeSession): Promise<void> {
  s.phase = "ended";
  clearTurnTimer(s);
  if (s.ttlTimer) { clearTimeout(s.ttlTimer); s.ttlTimer = undefined; }
  sessions.delete(s.id);
  if (s.targetKey) activeTargetKeys.delete(s.targetKey);
}

function clearTurnTimer(s: SiegeSession): void {
  if (s.turnTimer) { clearTimeout(s.turnTimer); s.turnTimer = undefined; }
}
