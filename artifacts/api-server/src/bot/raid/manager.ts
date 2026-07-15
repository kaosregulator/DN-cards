// Raid manager — the live co-op boss fight. Runs entirely in memory (like live
// battles) since raids never risk a player's cards. Drives a single message
// through: lobby (join / pick card) → simultaneous-action rounds → clear/wipe.

import {
  ChatInputCommandInteraction, ButtonInteraction, StringSelectMenuInteraction,
  EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
  StringSelectMenuBuilder, MessageFlags, type Message,
} from "discord.js";
import { randomBytes } from "crypto";
import { db, cardProgressTable } from "@workspace/db";
import type { BattleSettings, RaidBoss } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import type { Combatant, MoveType } from "../battle/types.js";
import type { Rarity } from "../cards-data.js";
import { getBattleSettings, rarityAllowed } from "../battle/config-engine.js";
import { getOwnedBattleCards, getOrCreateProfile } from "../battle/db.js";
import type { OwnedBattleCard } from "../battle/db.js";
import { bar, WHITE_LINE } from "../battle/embeds.js";
import { starsForLevel, starString, levelForStars } from "../cards/leveling.js";
import { toAbsoluteImageUrl } from "../image-url.js";
import { logger } from "../../lib/logger.js";
import { getBossByName } from "./db.js";
import {
  buildBossCombatant, buildPlayerCombatant, resolveRaidRound,
  BOSS_USER_ID, type PartyMemberSpec,
} from "./engine.js";

const EPHEMERAL = { flags: MessageFlags.Ephemeral } as const;
const MAX_ROUNDS = 25;
const ROUND_TIMEOUT_MS = 60_000;
const LOBBY_TTL_MS = 5 * 60_000;

interface PartySlot {
  member: PartyMemberSpec;
  combatant?: Combatant;
}

interface RaidSession {
  id: string;
  guildId: string;
  channelId: string;
  starterId: string;
  boss: RaidBoss;
  settings: BattleSettings;
  phase: "lobby" | "fight" | "ended";
  party: Map<string, PartySlot>;   // userId → slot
  bossCombatant?: Combatant;
  roundNumber: number;
  pendingActions: Map<string, MoveType>;
  resolving: boolean;
  recentLog: string[];
  message?: Message;
  timer?: NodeJS.Timeout;
}

const sessions = new Map<string, RaidSession>();
const userSession = new Map<string, string>(); // "guild:user" → sessionId

function uKey(guildId: string, userId: string): string { return `${guildId}:${userId}`; }

function livingSlots(session: RaidSession): PartySlot[] {
  return [...session.party.values()].filter(s => (s.combatant?.hp ?? 0) > 0);
}

function newId(): string { return randomBytes(4).toString("hex"); }

// ── Entry: /raid start ───────────────────────────────────────────────────────
export async function startRaid(interaction: ChatInputCommandInteraction, bossName: string): Promise<void> {
  const guild = interaction.guild;
  if (!guild) { await interaction.reply({ content: "Raids can only be started in a server.", ...EPHEMERAL }); return; }
  const guildId = guild.id;
  const settings = await getBattleSettings(guildId);
  if (!settings.enabled || !settings.setupComplete) {
    await interaction.reply({ content: "🛠️ The battle system must be set up first (`/battle_admin` → Setup Wizard).", ...EPHEMERAL });
    return;
  }
  if (userSession.has(uKey(guildId, interaction.user.id))) {
    await interaction.reply({ content: "You're already in a raid. Finish or leave it first.", ...EPHEMERAL });
    return;
  }
  const boss = await getBossByName(guildId, bossName);
  if (!boss || !boss.enabled) {
    await interaction.reply({ content: `❌ No enabled boss called "**${bossName}**". Ask an admin to create one with \`/raid_admin create\`, or see \`/raid bosses\`.`, ...EPHEMERAL });
    return;
  }

  const id = newId();
  const session: RaidSession = {
    id, guildId, channelId: interaction.channelId!, starterId: interaction.user.id,
    boss, settings, phase: "lobby", party: new Map(), roundNumber: 1,
    pendingActions: new Map(), resolving: false, recentLog: [],
  };
  sessions.set(id, session);

  await interaction.reply({ embeds: [buildLobbyEmbed(session)], components: buildLobbyComponents(session) });
  session.message = await interaction.fetchReply() as Message;
  armTimer(session, LOBBY_TTL_MS);
}

// ── Component router (buttons + select) ──────────────────────────────────────
export async function handleRaidComponent(
  interaction: ButtonInteraction | StringSelectMenuInteraction,
): Promise<void> {
  const parts = interaction.customId.split(":"); // raid:<action>:<sid>[:extra]
  const action = parts[1];
  const sid = parts[2];
  const session = sessions.get(sid);
  if (!session) {
    await interaction.reply({ content: "⌛ This raid has ended or expired.", ...EPHEMERAL }).catch(() => {});
    return;
  }
  switch (action) {
    case "join": return handleJoin(interaction as ButtonInteraction, session);
    case "pick": return handlePick(interaction as StringSelectMenuInteraction, session);
    case "leave": return handleLeave(interaction as ButtonInteraction, session);
    case "begin": return handleBegin(interaction as ButtonInteraction, session);
    case "cancel": return handleCancel(interaction as ButtonInteraction, session);
    case "act": return handleAct(interaction as ButtonInteraction, session, parts[3] as MoveType);
    default:
      await interaction.reply({ content: "Unknown raid action.", ...EPHEMERAL }).catch(() => {});
  }
}

// ── Lobby: join → pick a card ────────────────────────────────────────────────
async function handleJoin(interaction: ButtonInteraction, session: RaidSession): Promise<void> {
  if (session.phase !== "lobby") { await interaction.reply({ content: "This raid has already started.", ...EPHEMERAL }); return; }
  const userId = interaction.user.id;
  if (session.party.has(userId)) { await interaction.reply({ content: "You're already in this raid. Pick again below to swap your card.", ...EPHEMERAL }); return; }
  if (session.party.size >= session.boss.maxPlayers) { await interaction.reply({ content: "This raid party is full.", ...EPHEMERAL }); return; }
  const otherSid = userSession.get(uKey(session.guildId, userId));
  if (otherSid && otherSid !== session.id) { await interaction.reply({ content: "You're already in another raid.", ...EPHEMERAL }); return; }

  const { eligible, reason } = await eligibleCards(session, userId);
  if (eligible.length === 0) {
    await interaction.reply({ content: reason ?? "You have no cards eligible for this raid.", ...EPHEMERAL });
    return;
  }

  const menu = new StringSelectMenuBuilder()
    .setCustomId(`raid:pick:${session.id}`)
    .setPlaceholder("Choose the card you'll bring to the raid")
    .addOptions(eligible.slice(0, 25).map(e => ({
      label: `${e.card.name}`.slice(0, 100),
      description: `${e.card.rarity} · Lv ${e.level} · ${starString(e.stars)}`.slice(0, 100),
      value: String(e.card.id),
    })));
  await interaction.reply({
    content: "🃏 Pick your fighter for this raid:",
    components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu)],
    ...EPHEMERAL,
  });
}

async function handlePick(interaction: StringSelectMenuInteraction, session: RaidSession): Promise<void> {
  if (session.phase !== "lobby") { await interaction.update({ content: "This raid has already started.", components: [] }).catch(() => {}); return; }
  const userId = interaction.user.id;
  const cardId = parseInt(interaction.values[0], 10);
  const { eligible } = await eligibleCards(session, userId);
  const pick = eligible.find(e => e.card.id === cardId);
  if (!pick) { await interaction.update({ content: "That card is no longer eligible.", components: [] }).catch(() => {}); return; }

  session.party.set(userId, {
    member: {
      userId, displayName: interaction.user.username,
      card: pick.card, cardLevel: pick.level, cardStars: pick.stars,
    },
  });
  userSession.set(uKey(session.guildId, userId), session.id);
  await interaction.update({ content: `✅ You joined with **${pick.card.name}** (${starString(pick.stars)}).`, components: [] }).catch(() => {});
  await refreshLobby(session);
}

async function handleLeave(interaction: ButtonInteraction, session: RaidSession): Promise<void> {
  const userId = interaction.user.id;
  if (session.phase === "fight") { await interaction.reply({ content: "You can't leave once the fight has started — see it through!", ...EPHEMERAL }); return; }
  if (!session.party.has(userId)) { await interaction.reply({ content: "You're not in this raid.", ...EPHEMERAL }); return; }
  session.party.delete(userId);
  userSession.delete(uKey(session.guildId, userId));
  await interaction.reply({ content: "👋 You left the raid party.", ...EPHEMERAL });
  await refreshLobby(session);
}

async function handleCancel(interaction: ButtonInteraction, session: RaidSession): Promise<void> {
  if (interaction.user.id !== session.starterId) { await interaction.reply({ content: "Only the raid starter can cancel.", ...EPHEMERAL }); return; }
  await interaction.reply({ content: "🚫 Raid cancelled.", ...EPHEMERAL });
  if (session.message) {
    await session.message.edit({ embeds: [new EmbedBuilder().setTitle("🚫 Raid cancelled").setColor(0x95a5a6).setDescription(`The raid on **${session.boss.name}** was cancelled.`)], components: [] }).catch(() => {});
  }
  teardown(session);
}

async function handleBegin(interaction: ButtonInteraction, session: RaidSession): Promise<void> {
  if (interaction.user.id !== session.starterId) { await interaction.reply({ content: "Only the raid starter can begin the fight.", ...EPHEMERAL }); return; }
  if (session.phase !== "lobby") { await interaction.reply({ content: "The fight has already started.", ...EPHEMERAL }); return; }
  if (session.party.size < session.boss.minPlayers) {
    await interaction.reply({ content: `You need at least **${session.boss.minPlayers}** players to start this raid.`, ...EPHEMERAL });
    return;
  }
  await interaction.deferUpdate().catch(() => {});
  session.phase = "fight";
  const party = [...session.party.values()].map(s => s.member);
  session.bossCombatant = buildBossCombatant(session.boss, session.settings, party);
  for (const slot of session.party.values()) {
    slot.combatant = buildPlayerCombatant(slot.member, session.settings);
  }
  session.recentLog = [`⚔️ The party descends on **${session.boss.name}**! Choose your actions.`];
  await renderFight(session);
  armRoundTimer(session);
}

// ── Fight: collect one action per living player, then resolve ─────────────────
async function handleAct(interaction: ButtonInteraction, session: RaidSession, move: MoveType): Promise<void> {
  if (session.phase !== "fight") { await interaction.reply({ content: "The raid isn't in a fighting phase.", ...EPHEMERAL }); return; }
  const slot = session.party.get(interaction.user.id);
  if (!slot || !slot.combatant) { await interaction.reply({ content: "You're not in this raid.", ...EPHEMERAL }); return; }
  if (slot.combatant.hp <= 0) { await interaction.reply({ content: "💀 Your fighter is down — the rest of the party fights on.", ...EPHEMERAL }); return; }
  if (session.resolving) { await interaction.reply({ content: "The round is resolving — hang on.", ...EPHEMERAL }); return; }

  session.pendingActions.set(interaction.user.id, move);
  const label = MOVE_LABEL[move] ?? move;
  await interaction.reply({ content: `🎯 Locked in: **${label}**. Waiting for the rest of the party…`, ...EPHEMERAL });

  const living = livingSlots(session);
  if (living.every(s => session.pendingActions.has(s.member.userId))) {
    await resolveRound(session);
  }
}

async function resolveRound(session: RaidSession): Promise<void> {
  if (session.resolving || session.phase !== "fight") return;
  session.resolving = true;
  if (session.timer) { clearTimeout(session.timer); session.timer = undefined; }

  try {
    const boss = session.bossCombatant!;
    const players = [...session.party.values()].map(s => s.combatant!);
    const result = resolveRaidRound({
      settings: session.settings, boss, players,
      actions: session.pendingActions, roundNumber: session.roundNumber,
      enrageTurn: session.boss.enrageTurn,
    });
    session.pendingActions.clear();
    session.recentLog = result.events.map(e => e.text).slice(-8);

    if (result.bossKoed) { await finishRaid(session, "clear"); return; }
    if (result.wiped) { await finishRaid(session, "wipe"); return; }
    if (session.roundNumber >= MAX_ROUNDS) { await finishRaid(session, "timeout"); return; }

    session.roundNumber++;
    session.resolving = false;
    await renderFight(session);
    armRoundTimer(session);
  } catch (err) {
    logger.error({ err, raidId: session.id }, "raid round resolution failed");
    session.resolving = false;
  }
}

function armRoundTimer(session: RaidSession): void {
  if (session.timer) clearTimeout(session.timer);
  session.timer = setTimeout(() => { void resolveRound(session); }, ROUND_TIMEOUT_MS);
}

// ── Rewards / end ────────────────────────────────────────────────────────────
async function finishRaid(session: RaidSession, outcome: "clear" | "wipe" | "timeout"): Promise<void> {
  session.phase = "ended";
  if (session.timer) { clearTimeout(session.timer); session.timer = undefined; }
  const boss = session.boss;

  let rewardNote = "";
  if (outcome === "clear") {
    const survivors = [...session.party.values()].filter(s => (s.combatant?.hp ?? 0) > 0);
    const { addShards } = await import("../db.js");
    const { grantCardBattleXp } = await import("../cards/leveling.js");
    for (const s of survivors) {
      await addShards(session.guildId, s.member.userId, boss.rewardShards).catch(() => {});
      await grantCardBattleXp(session.guildId, s.member.userId, s.member.card.id, s.member.card.rarity as Rarity, "win", boss.rewardCardXp).catch(() => {});
    }
    // Downed members still get a consolation of card XP (a "loss").
    for (const s of session.party.values()) {
      if ((s.combatant?.hp ?? 0) > 0) continue;
      await grantCardBattleXp(session.guildId, s.member.userId, s.member.card.id, s.member.card.rarity as Rarity, "loss").catch(() => {});
    }
    rewardNote = `🏆 **Victory!** ${survivors.length} survivor(s) each earned 💠 **${boss.rewardShards.toLocaleString()}** and +${boss.rewardCardXp} card XP.`;
    try {
      const { recordQuestEvent } = await import("../quests/engine.js");
      for (const s of survivors) await recordQuestEvent(session.guildId, s.member.userId, "battle_win", 1);
    } catch { /* non-fatal */ }
  } else if (outcome === "wipe") {
    rewardNote = `💀 **Wipe!** The party fell to **${boss.name}**. Regroup, level your cards, and try again.`;
  } else {
    rewardNote = `⌛ **${boss.name}** outlasted the party after ${MAX_ROUNDS} rounds. Bring more firepower next time.`;
  }

  // Giveaway progress — every party member (survivors AND downed) gets raid
  // participation credit, plus an even share of the damage the party dealt to
  // the boss as their contribution. Best-effort; never blocks the raid.
  try {
    const { recordGiveawayEvent } = await import("../giveaway/engine.js");
    const { awardPlayerXp, XP } = await import("../player/xp.js");
    const bc = session.bossCombatant;
    const bossDamage = bc ? Math.max(0, bc.stats.maxHealth - Math.max(0, bc.hp)) : 0;
    const share = session.party.size > 0 ? Math.round(bossDamage / session.party.size) : 0;
    for (const s of session.party.values()) {
      await recordGiveawayEvent(session.guildId, s.member.userId, "raid_join", 1);
      if (share > 0) await recordGiveawayEvent(session.guildId, s.member.userId, "raid_damage", share);
      // Unified account XP: a raid clear pays more than a participation-only run.
      await awardPlayerXp(session.guildId, s.member.userId, "raid", outcome === "clear" ? XP.raidClear : XP.raidParticipate);
    }
  } catch { /* non-fatal */ }

  if (session.message) {
    await session.message.edit({ embeds: [buildEndEmbed(session, outcome, rewardNote)], components: [] }).catch(() => {});
  }
  teardown(session);
}

function teardown(session: RaidSession): void {
  if (session.timer) { clearTimeout(session.timer); session.timer = undefined; }
  for (const userId of session.party.keys()) userSession.delete(uKey(session.guildId, userId));
  sessions.delete(session.id);
}

// ── Eligibility ──────────────────────────────────────────────────────────────
async function eligibleCards(session: RaidSession, userId: string): Promise<{
  eligible: { card: OwnedBattleCard; level: number; stars: number }[]; reason?: string;
}> {
  const { boss, settings, guildId } = session;
  const [owned, levels, profile] = await Promise.all([
    getOwnedBattleCards(guildId, userId),
    getUserCardLevels(guildId, userId),
    getOrCreateProfile(guildId, userId),
  ]);
  if (profile.level < boss.minPlayerLevel) {
    return { eligible: [], reason: `🔒 You must be **battle level ${boss.minPlayerLevel}** to join this raid (you're level ${profile.level}). Win battles in \`/battle\` to level up.` };
  }
  const eligible = owned
    .filter(c => c.owned > 0)
    .filter(c => (c.config?.enabled ?? true))
    .filter(c => rarityAllowed(settings, (c.config?.rarity as Rarity) || (c.rarity as Rarity)))
    .map(c => { const level = levels.get(c.id) ?? 1; return { card: c, level, stars: starsForLevel(level) }; })
    .filter(e => e.stars >= boss.minStars)
    .sort((a, b) => b.stars - a.stars || b.level - a.level);

  if (eligible.length === 0) {
    return { eligible, reason: `🔒 This raid needs a **${boss.minStars}-star** card (${starString(boss.minStars)}) — reach card **Level ${levelForStars(boss.minStars)}**. Level cards by fielding them in \`/battle\`; check \`/level\`.` };
  }
  return { eligible };
}

async function getUserCardLevels(guildId: string, userId: string): Promise<Map<number, number>> {
  const rows = await db.select({ cardId: cardProgressTable.cardId, level: cardProgressTable.level })
    .from(cardProgressTable)
    .where(and(eq(cardProgressTable.guildId, guildId), eq(cardProgressTable.userId, userId)));
  return new Map(rows.map(r => [r.cardId, r.level]));
}

// ── Rendering ────────────────────────────────────────────────────────────────
const MOVE_LABEL: Record<string, string> = {
  attack: "⚔️ Attack", special: "✨ Special", defend: "🛡️ Defend", charge: "⚡ Charge",
};

function buildLobbyEmbed(session: RaidSession): EmbedBuilder {
  const b = session.boss;
  const members = [...session.party.values()].map(s =>
    `• <@${s.member.userId}> — **${s.member.card.name}** ${starString(s.member.cardStars)}`).join("\n") || "*No one has joined yet.*";
  const embed = new EmbedBuilder()
    .setTitle(`🐉 RAID — ${b.name}`)
    .setColor(0xc0392b)
    .setDescription(
      (b.description ? `*${b.description}*\n\n` : "") +
      `A co-op boss fight for **${b.minPlayers}–${b.maxPlayers}** players. Coordinate — the boss focuses the weakest and **sweeps** the whole party.\n\n` +
      `**Entry:** a ${starString(b.minStars)} card (Lv ${levelForStars(b.minStars)}+)` +
      (b.minPlayerLevel > 1 ? ` · battle level **${b.minPlayerLevel}+**` : "") + "\n" +
      `**Reward on clear:** 💠 ${b.rewardShards.toLocaleString()} + ${b.rewardCardXp} card XP each`,
    )
    .addFields({ name: `👥 Party (${session.party.size}/${b.maxPlayers})`, value: members, inline: false })
    .setFooter({ text: "Click Join to pick your card · Starter clicks Begin when ready" });
  const thumb = toAbsoluteImageUrl(b.imageUrl);
  if (thumb) embed.setThumbnail(thumb);
  return embed;
}

function buildLobbyComponents(session: RaidSession): ActionRowBuilder<ButtonBuilder>[] {
  const canBegin = session.party.size >= session.boss.minPlayers;
  return [new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`raid:join:${session.id}`).setLabel("Join").setEmoji("🃏").setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`raid:leave:${session.id}`).setLabel("Leave").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`raid:begin:${session.id}`).setLabel("Begin").setEmoji("⚔️").setStyle(ButtonStyle.Success).setDisabled(!canBegin),
    new ButtonBuilder().setCustomId(`raid:cancel:${session.id}`).setLabel("Cancel").setStyle(ButtonStyle.Danger),
  )];
}

async function refreshLobby(session: RaidSession): Promise<void> {
  if (session.phase !== "lobby" || !session.message) return;
  await session.message.edit({ embeds: [buildLobbyEmbed(session)], components: buildLobbyComponents(session) }).catch(() => {});
}

function buildFightEmbed(session: RaidSession): EmbedBuilder {
  const boss = session.bossCombatant!;
  const hpPct = Math.max(0, Math.min(100, Math.round((boss.hp / boss.stats.maxHealth) * 100)));
  const embed = new EmbedBuilder()
    .setTitle(`🐉 ${boss.cardName} — Round ${session.roundNumber}`)
    .setColor(0xe74c3c)
    .setDescription(
      `**Boss HP**\n${bar(boss.hp, boss.stats.maxHealth, 16)}  **${Math.max(0, boss.hp).toLocaleString()}** / ${boss.stats.maxHealth.toLocaleString()} HP (${hpPct}%)` +
      (boss.status.length ? `\n${boss.status.map(s => `${s.emoji} ${s.label} (${s.turns})`).join(" ")}` : ""),
    );
  const partyLines = [...session.party.values()].map(s => {
    const c = s.combatant!;
    const acted = session.pendingActions.has(s.member.userId) ? " ✅" : "";
    if (c.hp <= 0) return `💀 <@${s.member.userId}> **${c.cardName}** — *downed*`;
    const shield = c.shield > 0 ? ` 🛡️${c.shield}` : "";
    return `❤️ <@${s.member.userId}> **${c.cardName}**${acted}\n${bar(c.hp, c.stats.maxHealth, 10)} ${c.hp}/${c.stats.maxHealth}${shield} · ⚡${c.energy}`;
  });
  embed.addFields({ name: `👥 Party ${WHITE_LINE}`, value: partyLines.join(`\n${WHITE_LINE}\n`) || "—", inline: false });
  if (session.recentLog.length) embed.addFields({ name: `📜 Battle log ${WHITE_LINE}`, value: session.recentLog.join(`\n${WHITE_LINE}\n`).slice(0, 1024), inline: false });
  embed.setFooter({ text: "Everyone picks an action — the round resolves once all living fighters act (or after 60s)." });
  if (boss.cardImageUrl) embed.setImage(boss.cardImageUrl);
  return embed;
}

function buildFightComponents(session: RaidSession): ActionRowBuilder<ButtonBuilder>[] {
  const moves: MoveType[] = ["attack", "special", "defend", "charge"];
  return [new ActionRowBuilder<ButtonBuilder>().addComponents(
    moves.map(m => new ButtonBuilder()
      .setCustomId(`raid:act:${session.id}:${m}`)
      .setLabel(MOVE_LABEL[m] ?? m)
      .setStyle(m === "attack" ? ButtonStyle.Danger : m === "defend" ? ButtonStyle.Primary : ButtonStyle.Secondary)),
  )];
}

async function renderFight(session: RaidSession): Promise<void> {
  if (!session.message) return;
  await session.message.edit({ embeds: [buildFightEmbed(session)], components: buildFightComponents(session) }).catch(() => {});
}

function buildEndEmbed(session: RaidSession, outcome: "clear" | "wipe" | "timeout", note: string): EmbedBuilder {
  const color = outcome === "clear" ? 0x2ecc71 : 0x7f8c8d;
  const title = outcome === "clear" ? "🏆 Raid Batch Finished" : "🐉 Raid Batch Finished";
  const boss = session.bossCombatant!;
  const bossMax = boss.stats.maxHealth;
  const bossHp = Math.max(0, boss.hp);
  const damageDealt = bossMax - bossHp;
  const hpPct = Math.max(0, Math.min(100, Math.round((bossHp / bossMax) * 100)));
  const bossHpLine = `${bar(bossHp, bossMax, 16)} **${bossHp.toLocaleString()}** / ${bossMax.toLocaleString()} HP (${hpPct}%)`;

  const partyLines = [...session.party.values()].map(s => {
    const c = s.combatant!;
    const alive = c.hp > 0;
    const shield = c.shield > 0 ? ` · 🛡️ ${c.shield}` : "";
    const hpLine = alive ? `${bar(c.hp, c.stats.maxHealth, 10)} ${c.hp}/${c.stats.maxHealth} HP${shield}` : "downed";
    return `${alive ? "❤️" : "💀"} <@${s.member.userId}> · **${c.cardName}**\n${hpLine}`;
  });

  const embed = new EmbedBuilder()
    .setTitle(title)
    .setColor(color)
    .setDescription(
      `**Boss HP**\n${bossHpLine}\n${WHITE_LINE}\n` +
      `**Damage Dealt** · **${damageDealt.toLocaleString()}** damage across the party`
    )
    .addFields(
      { name: `👥 Party Cards ${WHITE_LINE}`, value: partyLines.join(`\n${WHITE_LINE}\n`) || "—", inline: false },
      { name: `🎁 Rewards ${WHITE_LINE}`, value: note, inline: false },
    )
    .setFooter({ text: `Raid lasted ${session.roundNumber} round(s) · ${session.party.size} fighter(s) fielded their own cards` });
  if (boss.cardImageUrl) embed.setImage(boss.cardImageUrl);
  return embed;
}

// ── TTL / lobby-abandon cleanup ──────────────────────────────────────────────
function armTimer(session: RaidSession, ms: number): void {
  if (session.timer) clearTimeout(session.timer);
  session.timer = setTimeout(() => {
    if (session.phase === "lobby") {
      if (session.message) session.message.edit({ embeds: [new EmbedBuilder().setTitle("⌛ Raid expired").setColor(0x95a5a6).setDescription(`The lobby for **${session.boss.name}** expired before it started.`)], components: [] }).catch(() => {});
      teardown(session);
    }
  }, ms);
}
