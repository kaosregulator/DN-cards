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
  bumpRouletteStreak, applyCurse, bobImage,
} from "./db.js";
import { rollForm, pick, speak, ROULETTE_CLICK, ROULETTE_BANG, TITLES, type BobForm } from "./persona.js";
import { bobEmbed, navRow, rewardTail, cooldownReply, sleep, EPHEMERAL, coins } from "./ui.js";
import { rollMood, moodLine, introLine, playFrames, frame, SUSPENSE, type Mood } from "./scenes.js";
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

// ── Single-player roulette — Bob's signature scene game ─────────────────────
//
// Not one fixed script: a random intro scene, a mood, PLAYER CHOICES (spin /
// pull / random / trust Bob / walk away / raise risk), and rare special events.
// State (bullets, risk) rides in the button customIds so it survives restarts.
export async function playRoulette(interaction: ButtonInteraction | ChatInputCommandInteraction): Promise<void> {
  const guildId = interaction.guildId;
  if (!guildId) { await interaction.reply({ content: "Bob only plays in servers.", ...EPHEMERAL }); return; }
  const settings = await getBobSettings(guildId);
  if (!settings.enabled) { await interaction.reply({ content: "😴 Bob is switched off here.", ...EPHEMERAL }); return; }
  if (!gameEnabled(settings, "roulette")) { await interaction.reply({ content: "🚫 Roulette is disabled here.", ...EPHEMERAL }); return; }
  const cd = await checkCooldown(guildId, interaction.user.id, settings.cooldownSeconds);
  if (!cd.ok) { await cooldownReply(interaction, cd.retryMs); return; }

  const form = rollForm(settings);
  const mood = rollMood(form);
  const avatar = bobImage(settings, "roulette", form);
  const player = { name: interaction.user.username, icon: interaction.user.displayAvatarURL() };
  const bullets = form === "blue" ? 2 : 1;

  // 1) Intro scene (random) → 2) choices.
  await playFrames(interaction, [
    frame(form, "Roulette", introLine(form, player.name, true), 1500, { avatar, player }),
    frame(form, "Roulette", `${moodLine(mood)}\n\n🔫 The revolver sits on the table.\n${loadFrame(bullets)}`, 900, { avatar, player }),
  ]);
  await showChoices(interaction, form, mood, bullets, 1, avatar, player);
}

interface PlayerBadge { name: string; icon?: string }

// The choice screen. Options rotate — not every option appears every round.
async function showChoices(
  interaction: ButtonInteraction | ChatInputCommandInteraction,
  form: BobForm, mood: Mood, bullets: number, risk: number,
  avatar: string | null, player: PlayerBadge, note = "",
): Promise<void> {
  const ownerId = interaction.user.id;
  const id = (a: string) => `bob:roulette:act:${a}:${bullets}:${risk}:${ownerId}`;
  const buttons: ButtonBuilder[] = [
    new ButtonBuilder().setCustomId(id("pull")).setLabel("Pull Trigger").setEmoji("🔫").setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId(id("spin")).setLabel("Spin Chamber").setEmoji("🔄").setStyle(ButtonStyle.Primary),
  ];
  // Rotating extras — 2 of 4 appear each round.
  const extras: ButtonBuilder[] = [
    new ButtonBuilder().setCustomId(id("random")).setLabel("Random Choice").setEmoji("🎲").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(id("trust")).setLabel("Trust Bob").setEmoji("😈").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(id("risk")).setLabel("Raise Risk").setEmoji("💰").setStyle(ButtonStyle.Secondary).setDisabled(bullets >= 3),
    new ButtonBuilder().setCustomId(id("walk")).setLabel("Walk Away").setEmoji("🏃").setStyle(ButtonStyle.Secondary),
  ];
  for (let i = extras.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [extras[i], extras[j]] = [extras[j]!, extras[i]!]; }
  buttons.push(...extras.slice(0, 2));

  const desc = `${note ? note + "\n\n" : ""}Cylinder: ${loadFrame(bullets)}\n` +
    `Risk: **x${risk}** ${risk > 1 ? "💰" : ""} · Survive for **${40 * risk}+ coins**` +
    (bullets > 1 ? `\n⚠️ **${bullets} bullets loaded.**` : "") +
    `\n\nYour move, **${player.name}**.`;
  const embed = bobEmbed(form, "Roulette — your move", desc, avatar);
  embed.setAuthor({ name: player.name, iconURL: player.icon });
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(buttons);
  if (interaction.isButton() && !interaction.deferred && !interaction.replied) {
    await interaction.update({ embeds: [embed], components: [row] }).catch(() => {});
  } else {
    await interaction.editReply({ embeds: [embed], components: [row] }).catch(() => {});
  }
}

// Button entry for the choice actions (routed from router.ts).
export async function handleRouletteAction(interaction: ButtonInteraction, parts: string[]): Promise<void> {
  // bob:roulette:act:<action>:<bullets>:<risk>:<ownerId>
  const ownerId = parts[6];
  if (!ownerId || interaction.user.id !== ownerId) {
    await interaction.reply({ content: "🔒 This roulette game belongs to someone else. Run `/bob_roulette` to start your own.", ...EPHEMERAL }).catch(() => {});
    return;
  }
  const guildId = interaction.guildId!;
  const settings = await getBobSettings(guildId);
  const form = rollForm(settings);
  const mood = rollMood(form);
  const avatar = bobImage(settings, "roulette", form);
  const player = { name: interaction.user.username, icon: interaction.user.displayAvatarURL() };
  let action = parts[3] ?? "pull";
  let bullets = Math.max(1, Math.min(3, Number(parts[4]) || 1));
  let risk = Math.max(1, Math.min(4, Number(parts[5]) || 1));

  if (action === "random") action = pick(["pull", "spin", "trust"] as const);

  switch (action) {
    case "spin": {
      await playFrames(interaction, [
        frame(form, "Roulette", `🔄 You give the cylinder a lazy spin...\n\n${pick(SPIN_FRAMES)}\n\n${moodLine(mood)}`, 1100, { avatar, player }),
      ]);
      return showChoices(interaction, form, mood, bullets, risk, avatar, player, speak(form, pick(["\"Stalling. Respect.\"", "\"Spin it all you like. Physics is on MY side.\"", "\"Ooh, dramatic.\""])));
    }
    case "risk": {
      bullets = Math.min(3, bullets + 1);
      risk = Math.min(4, risk + 1);
      return showChoices(interaction, form, mood, bullets, risk, avatar, player,
        speak(form, `💰 **Another round slides in.** Bob whistles. \"Bold. Payout's now x${risk}.\"`));
    }
    case "walk": {
      const reward = await grantReward(guildId, interaction.user.id, settings, { xp: 6, interaction: true });
      const line = speak(form, pick([
        "\"Smart. Boring, but smart.\"", "\"The duck lives to waddle another day.\"",
        "\"Leaving? I'll tell everyone you screamed.\"",
      ]));
      await interaction.update({
        embeds: [bobEmbed(form, "Roulette — walked away 🏃", `${line}\n\n+⭐ 6 XP for self-preservation.\nBalance: ${coins(reward.profile.coins)}`, avatar)],
        components: [navRow({ again: "bob:roulette:again" })],
      }).catch(() => {});
      return;
    }
    case "trust": {
      // Bob pulls for you. Normal Bob is kind-ish; Blue Bob is... Blue Bob.
      const surviveChance = form === "blue" ? 0.45 : form === "upside" ? 0.5 : 0.66;
      await playFrames(interaction, [
        frame(form, "Roulette", speak(form, pick([
          "😈 You hand Bob the revolver. He looks TOO happy about it.",
          "😈 \"You trust me? That's your first mistake today.\"",
          "😈 Bob takes the gun. \"I've only dropped this twice.\"",
        ])), 1400, { avatar, player }),
        frame(form, "Roulette", `${pick(SUSPENSE)}\n\n${pick(SPIN_FRAMES)}`, 1200, { avatar, player }),
      ]);
      return resolvePull(interaction, form, mood, bullets, risk, avatar, player, Math.random() < surviveChance, true);
    }
    case "pull":
    default: {
      await playFrames(interaction, [
        frame(form, "Roulette", `🔫 You raise the barrel...\n\n${moodLine(mood)}`, 1000, { avatar, player }),
        frame(form, "Roulette", `${pick(SUSPENSE)}`, 900, { avatar, player }),
        frame(form, "Roulette", "**squeeze...**", 1100, { avatar, player }),
      ]);
      const survived = Math.random() < (6 - bullets) / 6;
      return resolvePull(interaction, form, mood, bullets, risk, avatar, player, survived, false);
    }
  }
}

// ── Special events (rare outcome twists) ─────────────────────────────────────
type Special =
  | { key: "golden"; line: string } | { key: "lucky"; line: string } | { key: "duck"; line: string }
  | { key: "cheat"; line: string } | { key: "bobshot"; line: string } | { key: "mystery"; line: string }
  | { key: "jackpot"; line: string };

function rollSpecial(): Special | null {
  const r = Math.random();
  if (r < 0.03) return { key: "jackpot", line: "✨ The chamber glows. **JACKPOT CHAMBER!**" };
  if (r < 0.06) return { key: "golden", line: "🪙 A **GOLDEN CHAMBER** — the casing is solid gold!" };
  if (r < 0.09) return { key: "duck", line: "🦆 ...a **rubber duck** pops out. It squeaks. Menacingly." };
  if (r < 0.12) return { key: "cheat", line: "🫳 Bob's hand blurs. Did he just **swap the cylinder?!**" };
  if (r < 0.145) return { key: "bobshot", line: "🫡 Bob grabs the gun. \"MY TURN.\" **Bob takes the shot.**" };
  if (r < 0.175) return { key: "mystery", line: "🎁 A **mystery box** drops out of the chamber???" };
  if (r < 0.20) return { key: "lucky", line: "🍀 A four-leaf clover is jammed in the mechanism. **Lucky shot!**" };
  return null;
}

// Shared outcome resolution for pull/trust.
async function resolvePull(
  interaction: ButtonInteraction, form: BobForm, mood: Mood, bullets: number, risk: number,
  avatar: string | null, player: PlayerBadge, survivedRoll: boolean, trusted: boolean,
): Promise<void> {
  const guildId = interaction.guildId!;
  const userId = interaction.user.id;
  const settings = await getBobSettings(guildId);
  const special = rollSpecial();
  let survived = survivedRoll;
  if (special?.key === "lucky") survived = true;
  if (special?.key === "cheat") survived = !survived;         // Bob flips fate
  if (special?.key === "duck" || special?.key === "bobshot") survived = true;

  if (special) {
    await playFrames(interaction, [frame(form, "Roulette — wait, what?", special.line, 1400, { avatar, player })]);
  }

  if (survived) {
    const streak = await bumpRouletteStreak(guildId, userId, true);
    let coinsWon = (40 + Math.min(60, streak.streak * 5)) * risk;
    let extra = "";
    if (special?.key === "golden") { coinsWon *= 3; extra = "\n🪙 Golden chamber: **x3 coins!**"; }
    if (special?.key === "jackpot") { coinsWon += 300; extra = "\n✨ Jackpot chamber: **+300!**"; }
    if (special?.key === "mystery") { const m = 10 + Math.floor(Math.random() * 290); coinsWon += m; extra = `\n🎁 Mystery box: **+${m}!**`; }
    if (special?.key === "duck") { coinsWon = Math.max(coinsWon, 50); extra = "\n🦆 The duck approves. Bonus coins."; }
    if (special?.key === "bobshot") { extra = "\n🫡 Bob survived too. Unfortunately. He pays you for the entertainment."; coinsWon += 40; }
    const title = streak.best >= 10 ? TITLES.survivor : undefined;
    const reward = await grantReward(guildId, userId, settings, {
      coins: coinsWon, xp: 30 * risk, countGame: true, win: true, interaction: true, title, gambled: 25 * risk,
      jackpot: special?.key === "jackpot",
    });
    const completed = [
      ...await recordBobEvent(guildId, userId, "roulette_survive", 1),
      ...await recordBobEvent(guildId, userId, "roulette_win", 1),
      ...(special?.key === "jackpot" ? await recordBobEvent(guildId, userId, "jackpot", 1) : []),
    ];
    const line = speak(form, trusted ? pick([
      "\"See? I'm SO trustworthy.\" Bob takes 10% emotionally.",
      "\"You doubted me. I felt it. Rude.\"",
    ]) : pick(ROULETTE_CLICK[form]));
    const winImg = bobImage(settings, "win", form) ?? avatar;
    const desc = `**CLICK.**\n\n${line}${extra}\n\n🎯 Survival streak: **${streak.streak}**${streak.brokeRecord ? " 🏅 *new record!*" : ""}${rewardTail(reward, coinsWon, 30 * risk)}\n\n${moodLine(mood)}`;
    await interaction.editReply({ embeds: [withPlayer(bobEmbed(form, "Roulette — CLICK 😅", desc, winImg), player)], components: [navRow({ again: "bob:roulette:again" })] }).catch(() => {});
    const note = formatCompletions(completed);
    if (note) await interaction.followUp({ content: note, ...EPHEMERAL }).catch(() => {});
  } else {
    await bumpRouletteStreak(guildId, userId, false);
    const p = await getBobProfile(guildId, userId);
    const lost = Math.min(p.coins, 15 * risk);
    const reward = await grantReward(guildId, userId, settings, { coins: -lost, xp: 8, countGame: true, loss: true, interaction: true });
    let curseNote = "";
    if (Math.random() < 0.25) {
      const curse = pick(CURSES);
      await applyCurse(guildId, userId, curse, 30);
      curseNote = `\n🌀 **Bob's curse:** ${curse} *(cosmetic, 30 min, harmless)*`;
    }
    const line = speak(form, trusted ? pick([
      "\"Whoops.\" Bob does not look sorry.",
      "\"In my defence... no, I've got nothing. That was funny.\"",
    ]) : pick(ROULETTE_BANG[form]));
    const loseImg = bobImage(settings, "lose", form) ?? avatar;
    const desc = `**BANG!** 💥\n\n${line}\n\n${lost > 0 ? `You dropped ${coins(lost)}. Streak resets.` : "Nothing to lose. Somehow, still embarrassing."}${curseNote}\nBalance: ${coins(reward.profile.coins)}\n\n${moodLine(mood)}`;
    await interaction.editReply({ embeds: [withPlayer(bobEmbed(form, "Roulette — BANG! 💥", desc, loseImg), player)], components: [navRow({ again: "bob:roulette:again" })] }).catch(() => {});
  }
}

function withPlayer(e: ReturnType<typeof bobEmbed>, player: PlayerBadge) {
  return e.setAuthor({ name: player.name, iconURL: player.icon });
}

// Chamber load display: filled rounds slide into a 6-slot cylinder.
function loadFrame(bullets: number): string {
  const slots = Array.from({ length: 6 }, (_, i) => (i < bullets ? "🔴" : "⚪"));
  return `${slots.join(" ")}`;
}

// Cylinder spin frames — the marker races around the 6 chambers.
const SPIN_FRAMES = [
  "🔴 ⚪ ⚪ ⚪ ⚪ ⚪   ↻",
  "⚪ ⚪ 🔴 ⚪ ⚪ ⚪   ↻",
  "⚪ ⚪ ⚪ ⚪ 🔴 ⚪   ↻",
  "⚪ 🔴 ⚪ ⚪ ⚪ ⚪   ·",
];

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

  const avatar = bobImage(settings, "roulette", form);
  const embed = bobEmbed(form, "Roulette Duel",
    `<@${interaction.user.id}> challenges <@${opponent.id}> to a **roulette duel**!\n\nTake turns pulling the trigger. First **BANG** loses. Winner takes the glory (and the coins).\n\n<@${opponent.id}>, do you accept?`, avatar);
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`bob:duel:accept:${s.id}`).setLabel("Accept").setEmoji("🔫").setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`bob:duel:decline:${s.id}`).setLabel("Decline").setStyle(ButtonStyle.Danger),
  );
  await interaction.reply({ content: `<@${opponent.id}>`, embeds: [embed], components: [row] });
  s.message = await interaction.fetchReply() as Message;
  s.timer = setTimeout(() => { if (s.phase === "pending") { s.message?.edit({ embeds: [bobEmbed(s.form, "Duel expired", "Nobody pulled the trigger in time. Cowards.", bobImage(settings, "roulette", form))], components: [] }).catch(() => {}); clearDuel(s); } }, 60_000);
}

export async function handleBobDuel(interaction: ButtonInteraction, parts: string[]): Promise<void> {
  const action = parts[2];
  const s = duels.get(parts[3] ?? "");
  if (!s) { await interaction.reply({ content: "⌛ This duel has ended or expired.", ...EPHEMERAL }).catch(() => {}); return; }

  if (action === "decline") {
    if (interaction.user.id !== s.opponentId) { await interaction.reply({ content: "Only the challenged player can decline.", ...EPHEMERAL }); return; }
    await interaction.update({ embeds: [bobEmbed(s.form, "Duel declined", `<@${s.opponentId}> chickened out. Bob is not surprised.`, bobImage(await getBobSettings(s.guildId), "roulette", s.form))], components: [] }).catch(() => {});
    clearDuel(s); return;
  }
  if (action === "accept") {
    if (interaction.user.id !== s.opponentId) { await interaction.reply({ content: "Only the challenged player can accept.", ...EPHEMERAL }); return; }
    if (s.phase !== "pending") { await interaction.reply({ content: "Already started.", ...EPHEMERAL }); return; }
    s.phase = "playing";
    if (s.timer) clearTimeout(s.timer);
    await interaction.update(await duelTurnView(s)).catch(() => {});
    return;
  }
  if (action === "pull") {
    if (s.phase !== "playing") { await interaction.reply({ content: "This duel isn't active.", ...EPHEMERAL }); return; }
    if (interaction.user.id !== s.turnUserId) { await interaction.reply({ content: "Not your turn. Sweat in silence.", ...EPHEMERAL }); return; }
    return resolveDuelPull(interaction, s);
  }
}

async function duelTurnView(s: DuelSession): Promise<{ embeds: EmbedBuilder[]; components: ActionRowBuilder<ButtonBuilder>[] }> {
  const settings = await getBobSettings(s.guildId);
  const avatar = bobImage(settings, "roulette", s.form);
  const embed = bobEmbed(s.form, "Roulette Duel",
    `🔫 <@${s.challengerId}> vs <@${s.opponentId}>\nRound **${s.rounds + 1}**\n\nIt's <@${s.turnUserId}>'s turn. Pull the trigger.`, avatar);
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`bob:duel:pull:${s.id}`).setLabel("Pull Trigger").setEmoji("🔫").setStyle(ButtonStyle.Danger));
  return { embeds: [embed], components: [row] };
}

async function resolveDuelPull(interaction: ButtonInteraction, s: DuelSession): Promise<void> {
  const settings = await getBobSettings(s.guildId);
  const avatar = bobImage(settings, "roulette", s.form);
  s.rounds++;
  // BANG chance ramps each round to keep duels short and tense.
  const bangChance = Math.min(0.55, 1 / 6 + s.rounds * 0.05);
  const bang = Math.random() < bangChance;
  await interaction.update({ embeds: [bobEmbed(s.form, "Roulette Duel", `<@${s.turnUserId}> pulls the trigger...\n\n${chamberBar(Math.floor(Math.random() * 6))}`, avatar)], components: [] }).catch(() => {});
  await sleep(900);

  if (!bang) {
    // survive → pass the turn
    s.turnUserId = s.turnUserId === s.challengerId ? s.opponentId : s.challengerId;
    await interaction.editReply({ embeds: [bobEmbed(s.form, "Roulette Duel", `**CLICK.** ${speak(s.form, pick(ROULETTE_CLICK[s.form]))}`, avatar)], components: [] }).catch(() => {});
    await sleep(900);
    await interaction.editReply(await duelTurnView(s)).catch(() => {});
    return;
  }

  // BANG → current player loses, other wins.
  s.phase = "ended";
  const loserId = s.turnUserId;
  const winnerId = loserId === s.challengerId ? s.opponentId : s.challengerId;
  const reward = await grantReward(s.guildId, winnerId, settings, {
    coins: 120, xp: 60, countGame: true, win: true, interaction: true, title: TITLES.gambler, gambled: 25,
  });
  await grantReward(s.guildId, loserId, settings, { coins: 10, xp: 15, countGame: true, loss: true, interaction: true });
  const completed = await recordBobEvent(s.guildId, winnerId, "duel_win", 1);
  await recordBobEvent(s.guildId, loserId, "game_play", 1);

  const desc = `**BANG!** ${speak(s.form, pick(ROULETTE_BANG[s.form]))}\n\n💀 <@${loserId}> is out.\n🏆 <@${winnerId}> wins the duel!${rewardTail(reward, 120, 60)}`;
  await interaction.editReply({ embeds: [bobEmbed(s.form, "Duel Over", desc, bobImage(settings, "roulette", s.form))], components: [] }).catch(() => {});
  const note = formatCompletions(completed);
  if (note && s.message) await s.message.reply({ content: `<@${winnerId}> ${note}` }).catch(() => {});
  clearDuel(s);
}
