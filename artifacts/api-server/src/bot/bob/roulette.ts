// Bob Roulette — the signature feature. Single-player survival + a turn-based
// multiplayer duel. Fully animated (the message edits through spin frames).
// Losses are always gentle: a small coin dip (never below zero) and a streak
// reset. Bob never destroys real progress.

import {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder,
  type ButtonInteraction, type ChatInputCommandInteraction, type Message, type User,
} from "discord.js";
import { randomBytes } from "crypto";
import {
  getBobSettings, getBobProfile, checkCooldown, grantReward, gameEnabled,
  bumpRouletteStreak, applyCurse,
} from "./db.js";
import { rollForm, pick, speak, ROULETTE_CLICK, ROULETTE_BANG, TITLES, type BobForm } from "./persona.js";
import { bobEmbed, navRow, rewardTail, cooldownReply, sleep, EPHEMERAL, coins } from "./ui.js";
import { recordBobEvent, formatCompletions } from "./progress.js";
import type { BobSettings } from "@workspace/db";

function chamberBar(pos: number, size = 6): string {
  return Array.from({ length: size }, (_, i) => (i === pos ? "●" : "○")).join(" ");
}

// Render helper that works for both slash (reply/editReply) and button
// (update/editReply) interactions.
async function render(
  interaction: ButtonInteraction | ChatInputCommandInteraction,
  first: boolean, embed: EmbedBuilder, components: ActionRowBuilder<ButtonBuilder>[] = [],
): Promise<void> {
  if (first) {
    if (interaction.isChatInputCommand()) await interaction.reply({ embeds: [embed], components });
    else await interaction.update({ embeds: [embed], components }).catch(() => {});
  } else {
    await interaction.editReply({ embeds: [embed], components }).catch(() => {});
  }
}

// ── Single-player roulette ───────────────────────────────────────────────────
export async function playRoulette(interaction: ButtonInteraction | ChatInputCommandInteraction): Promise<void> {
  const guildId = interaction.guildId;
  if (!guildId) { await interaction.reply({ content: "Bob only plays in servers.", ...EPHEMERAL }); return; }
  const settings = await getBobSettings(guildId);
  if (!settings.enabled) { await interaction.reply({ content: "😴 Bob is switched off here.", ...EPHEMERAL }); return; }
  if (!gameEnabled(settings, "roulette")) { await interaction.reply({ content: "🚫 Roulette is disabled here.", ...EPHEMERAL }); return; }
  const cd = await checkCooldown(guildId, interaction.user.id, settings.cooldownSeconds);
  if (!cd.ok) { await cooldownReply(interaction, cd.retryMs); return; }

  const form = rollForm(settings);
  const hardMode = form === "blue"; // Blue Bob loads an extra round.
  const bullets = hardMode ? 2 : 1;

  // Animated load + spin.
  await render(interaction, true, bobEmbed(form, "Roulette",
    `🔫 Bob loads the chamber...\n\n${chamberBar(5)}${hardMode ? "\n\n😈 *Blue Bob loaded a second round. Hard mode — double reward if you live.*" : ""}`));
  for (let i = 4; i >= 0; i--) { await sleep(500); await render(interaction, false, bobEmbed(form, "Roulette", `Spinning...\n\n${chamberBar(i)}`)); }
  await sleep(650);

  const loaded = new Set<number>();
  while (loaded.size < bullets) loaded.add(Math.floor(Math.random() * 6));
  const result = Math.floor(Math.random() * 6);
  const survived = !loaded.has(result);

  const userId = interaction.user.id;
  if (survived) {
    const streak = await bumpRouletteStreak(guildId, userId, true);
    const base = 40 + Math.min(60, streak.streak * 5);
    const coinsWon = hardMode ? base * 2 : base;
    const title = streak.best >= 10 ? TITLES.survivor : undefined;
    const reward = await grantReward(guildId, userId, settings, {
      coins: coinsWon, xp: 30, countGame: true, win: true, interaction: true, title, gambled: 25,
    });
    const completed = [
      ...await recordBobEvent(guildId, userId, "roulette_survive", 1),
      ...await recordBobEvent(guildId, userId, "roulette_win", 1),
    ];
    const line = speak(form, pick(ROULETTE_CLICK[form]));
    const desc = `${line}\n\n🎯 Survival streak: **${streak.streak}**${streak.brokeRecord ? " 🏅 *new record!*" : ""}${rewardTail(reward, coinsWon, 30)}`;
    await render(interaction, false, bobEmbed(form, "Roulette — CLICK", desc), [navRow({ again: "bob:roulette:again" })]);
    const note = formatCompletions(completed);
    if (note) await interaction.followUp({ content: note, ...EPHEMERAL }).catch(() => {});
  } else {
    await bumpRouletteStreak(guildId, userId, false);
    const p = await getBobProfile(guildId, userId);
    const lost = Math.min(p.coins, 15);
    const reward = await grantReward(guildId, userId, settings, {
      coins: -lost, xp: 8, countGame: true, loss: true, interaction: true,
    });
    // 25% chance of a harmless, funny temporary curse.
    let curseNote = "";
    if (Math.random() < 0.25) {
      const curse = pick(CURSES);
      await applyCurse(guildId, userId, curse, 30);
      curseNote = `\n\n🌀 **Bob's curse:** ${curse} *(cosmetic, 30 min, harmless)*`;
    }
    const line = speak(form, pick(ROULETTE_BANG[form]));
    const desc = `${line}${lost > 0 ? `\n\nYou dropped ${coins(lost)}. Your streak resets to 0.` : "\n\nYou had no coins to lose. Small mercies."}${curseNote}\n\nBalance: ${coins(reward.profile.coins)}`;
    await render(interaction, false, bobEmbed(form, "Roulette — BANG!", desc), [navRow({ again: "bob:roulette:again" })]);
  }
}

const CURSES = [
  "🐸 you're a frog now",
  "🤡 clown mode engaged",
  "🧻 cursed with soft luck",
  "🫠 you are Officially Melting",
  "🥔 potato energy",
];

// ── Multiplayer duel ─────────────────────────────────────────────────────────
interface DuelSession {
  id: string;
  guildId: string;
  channelId: string;
  challengerId: string;
  opponentId: string;
  form: BobForm;
  phase: "pending" | "playing" | "ended";
  turnUserId: string;
  rounds: number;
  message?: Message;
  timer?: NodeJS.Timeout;
}
const duels = new Map<string, DuelSession>();
const userDuel = new Map<string, string>(); // guild:user -> sessionId

function uKey(g: string, u: string) { return `${g}:${u}`; }
function newId() { return randomBytes(4).toString("hex"); }

function clearDuel(s: DuelSession) {
  if (s.timer) clearTimeout(s.timer);
  duels.delete(s.id);
  userDuel.delete(uKey(s.guildId, s.challengerId));
  userDuel.delete(uKey(s.guildId, s.opponentId));
}

export async function startDuel(interaction: ChatInputCommandInteraction, opponent: User): Promise<void> {
  const guildId = interaction.guildId;
  if (!guildId) { await interaction.reply({ content: "Duels are server-only.", ...EPHEMERAL }); return; }
  const settings = await getBobSettings(guildId);
  if (!settings.enabled || !gameEnabled(settings, "duel")) { await interaction.reply({ content: "🚫 Duels are off here.", ...EPHEMERAL }); return; }
  if (opponent.bot || opponent.id === interaction.user.id) { await interaction.reply({ content: "Pick a real, different human to duel.", ...EPHEMERAL }); return; }
  if (userDuel.has(uKey(guildId, interaction.user.id)) || userDuel.has(uKey(guildId, opponent.id))) {
    await interaction.reply({ content: "One of you is already in a duel. Finish that first.", ...EPHEMERAL }); return;
  }
  const form = rollForm(settings);
  const s: DuelSession = {
    id: newId(), guildId, channelId: interaction.channelId!, challengerId: interaction.user.id,
    opponentId: opponent.id, form, phase: "pending", turnUserId: interaction.user.id, rounds: 0,
  };
  duels.set(s.id, s);
  userDuel.set(uKey(guildId, s.challengerId), s.id);
  userDuel.set(uKey(guildId, s.opponentId), s.id);

  const embed = bobEmbed(form, "Roulette Duel",
    `<@${interaction.user.id}> challenges <@${opponent.id}> to a **roulette duel**!\n\nTake turns pulling the trigger. First **BANG** loses. Winner takes the glory (and the coins).\n\n<@${opponent.id}>, do you accept?`);
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`bob:duel:accept:${s.id}`).setLabel("Accept").setEmoji("🔫").setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`bob:duel:decline:${s.id}`).setLabel("Decline").setStyle(ButtonStyle.Danger),
  );
  await interaction.reply({ content: `<@${opponent.id}>`, embeds: [embed], components: [row] });
  s.message = await interaction.fetchReply() as Message;
  s.timer = setTimeout(() => { if (s.phase === "pending") { s.message?.edit({ embeds: [bobEmbed(s.form, "Duel expired", "Nobody pulled the trigger in time. Cowards.")], components: [] }).catch(() => {}); clearDuel(s); } }, 60_000);
}

export async function handleBobDuel(interaction: ButtonInteraction, parts: string[]): Promise<void> {
  const action = parts[2];
  const s = duels.get(parts[3] ?? "");
  if (!s) { await interaction.reply({ content: "⌛ This duel has ended or expired.", ...EPHEMERAL }).catch(() => {}); return; }

  if (action === "decline") {
    if (interaction.user.id !== s.opponentId) { await interaction.reply({ content: "Only the challenged player can decline.", ...EPHEMERAL }); return; }
    await interaction.update({ embeds: [bobEmbed(s.form, "Duel declined", `<@${s.opponentId}> chickened out. Bob is not surprised.`)], components: [] }).catch(() => {});
    clearDuel(s); return;
  }
  if (action === "accept") {
    if (interaction.user.id !== s.opponentId) { await interaction.reply({ content: "Only the challenged player can accept.", ...EPHEMERAL }); return; }
    if (s.phase !== "pending") { await interaction.reply({ content: "Already started.", ...EPHEMERAL }); return; }
    s.phase = "playing";
    if (s.timer) clearTimeout(s.timer);
    await interaction.update(duelTurnView(s)).catch(() => {});
    return;
  }
  if (action === "pull") {
    if (s.phase !== "playing") { await interaction.reply({ content: "This duel isn't active.", ...EPHEMERAL }); return; }
    if (interaction.user.id !== s.turnUserId) { await interaction.reply({ content: "Not your turn. Sweat in silence.", ...EPHEMERAL }); return; }
    return resolveDuelPull(interaction, s);
  }
}

function duelTurnView(s: DuelSession): { embeds: EmbedBuilder[]; components: ActionRowBuilder<ButtonBuilder>[] } {
  const embed = bobEmbed(s.form, "Roulette Duel",
    `🔫 <@${s.challengerId}> vs <@${s.opponentId}>\nRound **${s.rounds + 1}**\n\nIt's <@${s.turnUserId}>'s turn. Pull the trigger.`);
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`bob:duel:pull:${s.id}`).setLabel("Pull Trigger").setEmoji("🔫").setStyle(ButtonStyle.Danger));
  return { embeds: [embed], components: [row] };
}

async function resolveDuelPull(interaction: ButtonInteraction, s: DuelSession): Promise<void> {
  s.rounds++;
  // BANG chance ramps each round to keep duels short and tense.
  const bangChance = Math.min(0.55, 1 / 6 + s.rounds * 0.05);
  const bang = Math.random() < bangChance;
  await interaction.update({ embeds: [bobEmbed(s.form, "Roulette Duel", `<@${s.turnUserId}> pulls the trigger...\n\n${chamberBar(Math.floor(Math.random() * 6))}`)], components: [] }).catch(() => {});
  await sleep(900);

  if (!bang) {
    // survive → pass the turn
    s.turnUserId = s.turnUserId === s.challengerId ? s.opponentId : s.challengerId;
    await interaction.editReply({ embeds: [bobEmbed(s.form, "Roulette Duel", `**CLICK.** ${speak(s.form, pick(ROULETTE_CLICK[s.form]))}`)], components: [] }).catch(() => {});
    await sleep(900);
    await interaction.editReply(duelTurnView(s)).catch(() => {});
    return;
  }

  // BANG → current player loses, other wins.
  s.phase = "ended";
  const loserId = s.turnUserId;
  const winnerId = loserId === s.challengerId ? s.opponentId : s.challengerId;
  const settings = await getBobSettings(s.guildId);
  const reward = await grantReward(s.guildId, winnerId, settings, {
    coins: 120, xp: 60, countGame: true, win: true, interaction: true, title: TITLES.gambler, gambled: 25,
  });
  await grantReward(s.guildId, loserId, settings, { coins: 10, xp: 15, countGame: true, loss: true, interaction: true });
  const completed = await recordBobEvent(s.guildId, winnerId, "duel_win", 1);
  await recordBobEvent(s.guildId, loserId, "game_play", 1);

  const desc = `**BANG!** ${speak(s.form, pick(ROULETTE_BANG[s.form]))}\n\n💀 <@${loserId}> is out.\n🏆 <@${winnerId}> wins the duel!${rewardTail(reward, 120, 60)}`;
  await interaction.editReply({ embeds: [bobEmbed(s.form, "Duel Over", desc)], components: [] }).catch(() => {});
  const note = formatCompletions(completed);
  if (note && s.message) await s.message.reply({ content: `<@${winnerId}> ${note}` }).catch(() => {});
  clearDuel(s);
}
