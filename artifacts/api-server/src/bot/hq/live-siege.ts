// ─────────────────────────────────────────────────────────────────────────────
// HQ — interactive turn-by-turn siege.
//
// The auto-resolvers (siege.ts / siege-battle.ts) decide a siege headlessly. This
// runs the SAME combat engine as a LIVE, click-through fight — the attacker picks
// a move (or an item) each round, exactly like /battle, and watches the garrison
// fight back turn by turn.
//
// It's a sequential gauntlet: the attacker's active card duels the garrison's
// active card; a knockout advances that side's line (the survivor keeps its HP)
// until one side is out. The attacker is the human; every defender is driven by
// the battle AI. One button click = one full round (the attacker's move, then the
// garrison's answer), so the fight always waits on the player.
//
// This module owns the session, the board and the turn loop. It knows nothing
// about capture/tribute/rewards: the caller passes already-built combatants and
// an `applyOutcome` callback that commits the result and returns the result text,
// so a base siege and a territory siege share one engine.
// ─────────────────────────────────────────────────────────────────────────────

import {
  ButtonInteraction, StringSelectMenuInteraction, EmbedBuilder,
  ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder,
  MessageFlags, AttachmentBuilder, type Message,
} from "discord.js";
import { randomBytes } from "crypto";
import type { BattleSettings } from "@workspace/db";
import type { Combatant, MoveType, AiDifficulty } from "../battle/types.js";
import { startOfTurn, resolveMove } from "../battle/combat-engine.js";
import { chooseAiMove } from "../battle/ai-engine.js";
import { powerRating } from "../battle/stat-engine.js";
import { bar, WHITE_LINE } from "../battle/embeds.js";
import {
  listBattleItems, getBattleItem, loadGuildBattleItems, applyItemUse, isOffensiveItem,
} from "../battle/items.js";
import { logger } from "../../lib/logger.js";

const EPHEMERAL = { flags: MessageFlags.Ephemeral } as const;
const SIEGE_AI: AiDifficulty = "elite";
const TURN_TIMEOUT_MS = 90_000;
const MAX_ROUNDS = 60;
const SIEGE_ITEM_USES = 3;
export const LIVE_SIEGE_IMAGE = "siege-base.png";

export interface LiveSiegeResultView {
  title: string;
  description: string;
  color: number;
  fields?: { name: string; value: string; inline?: boolean }[];
}

export interface LiveSiegeOutcome {
  attackerWon: boolean;
  rounds: number;
  attackerCardsLost: number;
  defenderCardsLost: number;
  attackerPower: number;
  defenderPower: number;
}

export interface LiveSiegeConfig {
  guildId: string;
  starterId: string;            // only this user may act
  attackerName: string;
  targetName: string;
  accent: number;               // embed colour
  attackers: Combatant[];       // side 0, strongest first
  defenders: Combatant[];       // side 1, fortified, strongest first
  settings: BattleSettings;
  baseImage?: Buffer | null;    // optional base scene shown on the board
  /** Commit the result (capture / reward / log) and return the result screen. */
  applyOutcome: (outcome: LiveSiegeOutcome) => Promise<LiveSiegeResultView>;
}

interface LiveSiegeSession extends LiveSiegeConfig {
  id: string;
  ai: number;                   // attacker active index
  di: number;                   // defender active index
  round: number;
  log: string[];
  message?: Message;
  timer?: NodeJS.Timeout;
  resolving: boolean;
  ended: boolean;
  itemUsesLeft: number;
  attackerPower: number;
  defenderPower: number;
}

const sessions = new Map<string, LiveSiegeSession>();

const MOVE_LABEL: Record<string, string> = {
  attack: "⚔️ Attack", special: "✨ Special", defend: "🛡️ Defend", charge: "⚡ Charge",
};

function sleep(ms: number): Promise<void> { return new Promise(r => setTimeout(r, ms)); }

// ── Entry ─────────────────────────────────────────────────────────────────────
// Post the opening board into the (already-deferred) interaction and arm the
// turn loop. The caller has built + fortified the combatants.
export async function startLiveSiege(
  interaction: ButtonInteraction, config: LiveSiegeConfig,
): Promise<void> {
  if (config.attackers.length === 0 || config.defenders.length === 0) {
    await interaction.editReply({
      embeds: [new EmbedBuilder().setColor(0xc0392b).setDescription("❌ A live siege needs cards on both sides.")],
      components: [],
    }).catch(() => {});
    return;
  }
  await loadGuildBattleItems(config.guildId).catch(() => {});
  const session: LiveSiegeSession = {
    ...config,
    id: randomBytes(4).toString("hex"),
    ai: 0, di: 0, round: 1, log: [`⚔️ **${config.attackerName}** marches on **${config.targetName}** — the assault begins!`],
    resolving: false, ended: false, itemUsesLeft: SIEGE_ITEM_USES,
    attackerPower: config.attackers.reduce((s, c) => s + powerRating(c.stats), 0),
    defenderPower: config.defenders.reduce((s, c) => s + powerRating(c.stats), 0),
  };
  sessions.set(session.id, session);

  const files = session.baseImage ? [new AttachmentBuilder(session.baseImage, { name: LIVE_SIEGE_IMAGE })] : [];
  await interaction.editReply({
    embeds: [buildBoard(session)], components: buildControls(session), files,
  }).catch(() => {});
  session.message = await interaction.fetchReply().catch(() => undefined) as Message | undefined;
  armTimer(session);
}

// ── Component routing (hq-hub:ls:<action>:<sid>[:extra]) ──────────────────────
export async function handleLiveSiegeComponent(
  interaction: ButtonInteraction | StringSelectMenuInteraction,
): Promise<void> {
  const parts = interaction.customId.split(":"); // hq-hub:ls:<action>:<sid>[:extra]
  const action = parts[2];
  const sid = parts[3]!;
  const session = sessions.get(sid);
  if (!session || session.ended) {
    await interaction.reply({ content: "⌛ This siege has ended.", ...EPHEMERAL }).catch(() => {});
    return;
  }
  if (interaction.user.id !== session.starterId) {
    await interaction.reply({ content: "Only the attacker can command this siege.", ...EPHEMERAL }).catch(() => {});
    return;
  }
  switch (action) {
    case "move": return handleMove(interaction as ButtonInteraction, session, parts[4] as MoveType);
    case "item": return handleItemOpen(interaction as ButtonInteraction, session);
    case "itemsel": return handleItemSelect(interaction as StringSelectMenuInteraction, session);
    case "itemtgt": return handleItemTarget(interaction as StringSelectMenuInteraction, session, parts[4]!);
    case "concede": return handleConcede(interaction as ButtonInteraction, session);
    default:
      await interaction.reply({ content: "Unknown siege action.", ...EPHEMERAL }).catch(() => {});
  }
}

// ── A round: the attacker's move, then the garrison's answer ──────────────────
async function handleMove(interaction: ButtonInteraction, session: LiveSiegeSession, move: MoveType): Promise<void> {
  if (session.resolving) { await interaction.deferUpdate().catch(() => {}); return; }
  await interaction.deferUpdate().catch(() => {});
  await runRound(session, move);
}

// Resolve one full round. `attackerAction` is either a move or an already-applied
// item (in which case the attacker's strike is skipped but the garrison answers).
async function runRound(session: LiveSiegeSession, attackerMove: MoveType | null): Promise<void> {
  if (session.resolving || session.ended) return;
  session.resolving = true;
  clearTimer(session);
  try {
    const atk = session.attackers[session.ai];
    const def = session.defenders[session.di];
    if (!atk || !def) { await finish(session); return; }

    // Attacker's turn: start-of-turn ticks, then their chosen move (unless they
    // spent the turn on an item, which was already applied).
    if (attackerMove) {
      const st = startOfTurn(atk, session.settings);
      pushLog(session, st.events.map(e => e.text));
      if (!st.koed && !st.skipped && atk.hp > 0) {
        const r = resolveMove(session.settings, atk, def, attackerMove);
        pushLog(session, r.events.map(e => e.text));
      }
    }
    if (advanceIfDead(session)) { await finish(session); return; }

    // Garrison's answer: AI move against the attacker's active card.
    const atk2 = session.attackers[session.ai];
    const def2 = session.defenders[session.di];
    if (atk2 && def2 && def2.hp > 0) {
      const st = startOfTurn(def2, session.settings);
      pushLog(session, st.events.map(e => e.text));
      if (!st.koed && !st.skipped && def2.hp > 0) {
        const aiMove = chooseAiMove(def2, atk2, session.settings, SIEGE_AI);
        const r = resolveMove(session.settings, def2, atk2, aiMove);
        pushLog(session, [`🛡️ ${def2.cardName}: ${r.events.map(e => e.text).join(" ") || "holds the line."}`]);
      }
    }
    if (advanceIfDead(session)) { await finish(session); return; }

    session.round++;
    if (session.round > MAX_ROUNDS) { await finish(session); return; }
    session.resolving = false;
    await render(session);
    armTimer(session);
  } catch (err) {
    logger.error({ err, siege: session.id }, "live siege round failed");
    session.resolving = false;
  }
}

// Advance either line past a knocked-out active card. Returns true when the
// siege is decided (one side has no cards left).
function advanceIfDead(session: LiveSiegeSession): boolean {
  while (session.defenders[session.di] && session.defenders[session.di]!.hp <= 0) {
    pushLog(session, [`💥 **${session.defenders[session.di]!.cardName}** falls — the next defender steps up.`]);
    session.di++;
  }
  while (session.attackers[session.ai] && session.attackers[session.ai]!.hp <= 0) {
    pushLog(session, [`☠️ **${session.attackers[session.ai]!.cardName}** is down — your next card advances.`]);
    session.ai++;
  }
  return session.di >= session.defenders.length || session.ai >= session.attackers.length;
}

// ── Items (heal/shield your own squad; grenade the garrison) ──────────────────
async function handleItemOpen(interaction: ButtonInteraction, session: LiveSiegeSession): Promise<void> {
  if (session.resolving) { await interaction.reply({ content: "The round is resolving — hang on.", ...EPHEMERAL }); return; }
  if (session.itemUsesLeft <= 0) { await interaction.reply({ content: "🎒 You're out of field items for this siege.", ...EPHEMERAL }); return; }
  const items = listBattleItems(session.guildId).slice(0, 25);
  if (items.length === 0) { await interaction.reply({ content: "No usable items are configured.", ...EPHEMERAL }); return; }
  const menu = new StringSelectMenuBuilder()
    .setCustomId(`hq-hub:ls:itemsel:${session.id}`)
    .setPlaceholder("Choose a field item")
    .addOptions(items.map(it => ({ label: it.name.slice(0, 100), description: it.description.slice(0, 100), emoji: it.emoji || undefined, value: it.id })));
  await interaction.reply({
    content: `🎒 **Field items** — **${session.itemUsesLeft}** left. Support items can heal any of *your* cards; offensive items hit the garrison.`,
    components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu)], ...EPHEMERAL,
  });
}

async function handleItemSelect(interaction: StringSelectMenuInteraction, session: LiveSiegeSession): Promise<void> {
  const item = getBattleItem(interaction.values[0], session.guildId);
  if (!item) { await interaction.update({ content: "That item is gone.", components: [] }).catch(() => {}); return; }
  if (isOffensiveItem(item)) { await commitItem(interaction, session, item.id, "def"); return; }

  // Support: pick which of your cards (active or benched, living; heals revive).
  const canRevive = item.effectType === "heal";
  const opts = session.attackers
    .map((c, i) => ({ c, i }))
    .filter(({ c }) => canRevive || c.hp > 0)
    .map(({ c, i }) => ({
      label: `${i === session.ai ? "★ " : ""}${c.cardName}`.slice(0, 100),
      description: (c.hp <= 0 ? "downed — revive" : `${c.hp}/${c.stats.maxHealth} HP`).slice(0, 100),
      value: String(i),
    }));
  const menu = new StringSelectMenuBuilder()
    .setCustomId(`hq-hub:ls:itemtgt:${session.id}:${item.id}`)
    .setPlaceholder(`Who gets the ${item.name}?`.slice(0, 100))
    .addOptions(opts.slice(0, 25));
  await interaction.update({
    content: `${item.emoji} **${item.name}** — ${item.description}\nChoose one of your cards:`,
    components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu)],
  }).catch(() => {});
}

async function handleItemTarget(interaction: StringSelectMenuInteraction, session: LiveSiegeSession, itemId: string): Promise<void> {
  await commitItem(interaction, session, itemId, interaction.values[0]!);
}

// Apply an item (targetKey = "def" for the garrison, or an attacker index), spend
// a use + the attacker's turn, then let the garrison answer.
async function commitItem(
  interaction: ButtonInteraction | StringSelectMenuInteraction,
  session: LiveSiegeSession, itemId: string, targetKey: string,
): Promise<void> {
  const item = getBattleItem(itemId, session.guildId);
  const actor = session.attackers[session.ai];
  if (!item || !actor) { await interaction.update({ content: "That item can't be used now.", components: [] }).catch(() => {}); return; }
  if (session.resolving || session.itemUsesLeft <= 0) { await interaction.update({ content: "You can't use an item right now.", components: [] }).catch(() => {}); return; }

  const target = targetKey === "def" ? session.defenders[session.di] : session.attackers[Number(targetKey)];
  if (!target) { await interaction.update({ content: "That target is gone.", components: [] }).catch(() => {}); return; }

  const outcome = applyItemUse(item, actor, target);
  session.itemUsesLeft--;
  pushLog(session, outcome.events.map(e => e.text));
  await interaction.update({ content: `${item.emoji} Used **${item.name}**.`, components: [] }).catch(() => {});

  // Using an item is the attacker's action for the round — the garrison answers.
  await runRound(session, null);
}

async function handleConcede(interaction: ButtonInteraction, session: LiveSiegeSession): Promise<void> {
  await interaction.deferUpdate().catch(() => {});
  session.ai = session.attackers.length; // force a loss
  pushLog(session, ["🏳️ You sound the retreat."]);
  await finish(session);
}

// ── Finish ────────────────────────────────────────────────────────────────────
async function finish(session: LiveSiegeSession): Promise<void> {
  if (session.ended) return;
  session.ended = true;
  session.resolving = true;
  clearTimer(session);
  const attackerWon = session.di >= session.defenders.length && session.ai < session.attackers.length;
  const outcome: LiveSiegeOutcome = {
    attackerWon,
    rounds: session.round,
    attackerCardsLost: attackerWon ? session.ai : session.attackers.length,
    defenderCardsLost: attackerWon ? session.defenders.length : session.di,
    attackerPower: session.attackerPower,
    defenderPower: session.defenderPower,
  };

  let view: LiveSiegeResultView;
  try {
    view = await session.applyOutcome(outcome);
  } catch (err) {
    logger.error({ err, siege: session.id }, "live siege applyOutcome failed");
    view = {
      title: attackerWon ? "🚩 Base captured!" : "🛡️ The walls held",
      description: attackerWon ? "You took the base." : "Your assault was broken.",
      color: attackerWon ? 0x4fd06a : 0xc0392b,
    };
  }

  const embed = new EmbedBuilder().setColor(view.color).setTitle(view.title)
    .setDescription(`${view.description}\n${WHITE_LINE}\n**Siege log**\n${session.log.slice(-6).join("\n").slice(0, 1400)}`);
  if (view.fields?.length) embed.addFields(view.fields.map(f => ({ name: f.name, value: f.value, inline: f.inline ?? true })));
  const files = session.baseImage ? [new AttachmentBuilder(session.baseImage, { name: LIVE_SIEGE_IMAGE })] : [];
  if (session.baseImage) embed.setImage(`attachment://${LIVE_SIEGE_IMAGE}`);
  if (session.message) await session.message.edit({ embeds: [embed], components: [], files }).catch(() => {});
  sessions.delete(session.id);
}

// ── Rendering ─────────────────────────────────────────────────────────────────
function pushLog(session: LiveSiegeSession, lines: string[]): void {
  for (const l of lines) if (l && l.trim()) session.log.push(l);
  session.log = session.log.slice(-10);
}

function statusLine(c: Combatant): string {
  return c.status.length ? `\n${c.status.map(s => `${s.emoji} ${s.label}(${s.turns})`).join(" ")}` : "";
}

function buildBoard(session: LiveSiegeSession): EmbedBuilder {
  const atk = session.attackers[session.ai];
  const def = session.defenders[session.di];
  const atkBench = Math.max(0, session.attackers.length - session.ai - 1);
  const defBench = Math.max(0, session.defenders.length - session.di - 1);

  const embed = new EmbedBuilder().setColor(session.accent)
    .setTitle(`⚔️ Siege — ${session.targetName} · Round ${session.round}`)
    .setDescription(session.log.join(`\n${WHITE_LINE}\n`).slice(0, 2000));
  if (atk) {
    const shield = atk.shield > 0 ? ` 🛡️${atk.shield}` : "";
    embed.addFields({
      name: `⚔️ Your card — ${atk.cardName}${atkBench > 0 ? ` (+${atkBench} in reserve)` : ""}`,
      value: `${bar(Math.max(0, atk.hp), atk.stats.maxHealth, 12)} ${Math.max(0, atk.hp)}/${atk.stats.maxHealth}${shield} · ⚡${atk.energy}${statusLine(atk)}`,
      inline: false,
    });
  }
  if (def) {
    const shield = def.shield > 0 ? ` 🛡️${def.shield}` : "";
    embed.addFields({
      name: `🛡️ Garrison — ${def.cardName}${defBench > 0 ? ` (+${defBench} holding)` : ""}`,
      value: `${bar(Math.max(0, def.hp), def.stats.maxHealth, 12)} ${Math.max(0, def.hp)}/${def.stats.maxHealth}${shield} · ⚡${def.energy}${statusLine(def)}`,
      inline: false,
    });
  }
  embed.setFooter({ text: `🎒 ${session.itemUsesLeft} items left · one click = one round (you strike, the garrison answers)` });
  if (session.baseImage) embed.setImage(`attachment://${LIVE_SIEGE_IMAGE}`);
  return embed;
}

function buildControls(session: LiveSiegeSession): ActionRowBuilder<ButtonBuilder>[] {
  const moves: MoveType[] = ["attack", "special", "defend", "charge"];
  const row1 = new ActionRowBuilder<ButtonBuilder>().addComponents(
    moves.map(m => new ButtonBuilder()
      .setCustomId(`hq-hub:ls:move:${session.id}:${m}`)
      .setLabel(MOVE_LABEL[m] ?? m)
      .setStyle(m === "attack" ? ButtonStyle.Danger : m === "defend" ? ButtonStyle.Primary : ButtonStyle.Secondary)),
  );
  row1.addComponents(new ButtonBuilder().setCustomId(`hq-hub:ls:item:${session.id}`).setLabel("Item").setEmoji("🎒").setStyle(ButtonStyle.Success));
  const row2 = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`hq-hub:ls:concede:${session.id}`).setLabel("Retreat").setEmoji("🏳️").setStyle(ButtonStyle.Secondary),
  );
  return [row1, row2];
}

async function render(session: LiveSiegeSession): Promise<void> {
  if (!session.message) return;
  const files = session.baseImage ? [new AttachmentBuilder(session.baseImage, { name: LIVE_SIEGE_IMAGE })] : [];
  await session.message.edit({ embeds: [buildBoard(session)], components: buildControls(session), files }).catch(() => {});
}

// ── Timeout: idle attackers get auto-resolved rather than hanging ─────────────
function armTimer(session: LiveSiegeSession): void {
  clearTimer(session);
  session.timer = setTimeout(() => { void autoFinish(session); }, TURN_TIMEOUT_MS);
}
function clearTimer(session: LiveSiegeSession): void {
  if (session.timer) { clearTimeout(session.timer); session.timer = undefined; }
}

// On idle, play out the rest of the siege automatically (attacker auto-attacks)
// so a walked-away siege still resolves and frees its state.
async function autoFinish(session: LiveSiegeSession): Promise<void> {
  if (session.ended || session.resolving) return;
  pushLog(session, ["⌛ You hesitated — your cards press the assault on their own."]);
  let guard = 0;
  while (!session.ended && session.ai < session.attackers.length && session.di < session.defenders.length && guard++ < MAX_ROUNDS) {
    await runRound(session, "attack");
    if (session.resolving && !session.ended) break; // a nested finish is in flight
    await sleep(0);
  }
  if (!session.ended) await finish(session);
}
