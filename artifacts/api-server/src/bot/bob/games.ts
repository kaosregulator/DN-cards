// Bob mini-games. Each is a short, animated, button-driven flow that edits the
// same message. All share cooldown + reward + stat plumbing and roll a Bob form
// per play (Blue Bob doubles rewards; Upside-Down Bob may invert the outcome).

import {
  ActionRowBuilder, ButtonBuilder, ButtonStyle,
  type ButtonInteraction,
} from "discord.js";
import { getBobSettings, getBobProfile, checkCooldown, grantReward, gameEnabled, applyCurse } from "./db.js";
import { rollForm, pick, speak, WIN_LINES, LOSS_LINES, type BobForm } from "./persona.js";
import { bobEmbed, animate, navRow, rewardTail, cooldownReply, sleep, EPHEMERAL } from "./ui.js";
import { recordBobEvent, formatCompletions } from "./progress.js";
import type { BobSettings } from "@workspace/db";

export const GAME_KEYS = ["coinflip", "dice", "hl", "slots", "wheel", "emoji"] as const;
export type GameKey = typeof GAME_KEYS[number];

export const GAME_META: Record<GameKey, { label: string; emoji: string }> = {
  coinflip: { label: "Coin Flip", emoji: "🪙" },
  dice: { label: "Dice Roll", emoji: "🎲" },
  hl: { label: "Higher or Lower", emoji: "🔼" },
  slots: { label: "Slots", emoji: "🎰" },
  wheel: { label: "Lucky Wheel", emoji: "🎡" },
  emoji: { label: "Guess the Emoji", emoji: "❓" },
};

interface Outcome { coins: number; xp: number; jackpot?: boolean; won: boolean }

// Apply Blue (double) / Upside (invert) form modifiers to a base outcome.
function applyForm(form: BobForm, base: Outcome): Outcome {
  let o = { ...base };
  if (form === "upside" && Math.random() < 0.5) {
    // Reverse outcome — a loss becomes a small win and vice versa.
    o = o.won ? { coins: Math.round(o.coins * 0.4) || 5, xp: 8, won: false } : { coins: 25, xp: 20, won: true };
  }
  if (form === "blue" && o.won) { o.coins *= 2; o.xp = Math.round(o.xp * 1.5); }
  return o;
}

async function finish(
  interaction: ButtonInteraction, form: BobForm, settings: BobSettings,
  headline: string, outcome: Outcome, gameKey: GameKey, againId: string,
): Promise<void> {
  const guildId = interaction.guildId!;
  const userId = interaction.user.id;
  const reward = await grantReward(guildId, userId, settings, {
    coins: outcome.coins, xp: outcome.xp, gambled: Math.max(outcome.coins, 25),
    countGame: true, win: outcome.won, loss: !outcome.won, jackpot: outcome.jackpot, interaction: true,
  });
  // Task/quest progress.
  const completed = await recordBobEvent(guildId, userId, "game_play", 1);
  if (outcome.won) completed.push(...await recordBobEvent(guildId, userId, "game_win", 1));
  if (outcome.jackpot) completed.push(...await recordBobEvent(guildId, userId, "jackpot", 1));

  const line = speak(form, outcome.won ? pick(WIN_LINES[form]) : pick(LOSS_LINES[form]));
  const embed = bobEmbed(form, GAME_META[gameKey].label, `${headline}\n\n${line}${rewardTail(reward, outcome.coins, outcome.xp)}`);
  const note = formatCompletions(completed);
  await interaction.editReply({ embeds: [embed], components: [navRow({ again: againId })] }).catch(() => {});
  if (note) await interaction.followUp({ content: note, ...EPHEMERAL }).catch(() => {});
}

// Gate: settings enabled + game enabled + cooldown. Returns form + settings or null.
async function gate(interaction: ButtonInteraction, gameKey: GameKey): Promise<{ form: BobForm; settings: BobSettings } | null> {
  const guildId = interaction.guildId!;
  const settings = await getBobSettings(guildId);
  if (!settings.enabled) { await interaction.reply({ content: "😴 Bob is switched off in this server. Ask an admin to run `/bob_admin`.", ...EPHEMERAL }); return null; }
  if (!gameEnabled(settings, gameKey)) { await interaction.reply({ content: `🚫 **${GAME_META[gameKey].label}** is disabled here.`, ...EPHEMERAL }); return null; }
  const cd = await checkCooldown(guildId, interaction.user.id, settings.cooldownSeconds);
  if (!cd.ok) { await cooldownReply(interaction, cd.retryMs); return null; }
  return { form: rollForm(settings), settings };
}

// ── Router ───────────────────────────────────────────────────────────────────
export async function handleBobGame(interaction: ButtonInteraction, parts: string[]): Promise<void> {
  // bob:game:<key>:<action>[:data...]
  const key = parts[2] as GameKey;
  const action = parts[3];
  if (!GAME_KEYS.includes(key)) { await interaction.reply({ content: "Unknown game.", ...EPHEMERAL }); return; }
  if (action === "open") return openGame(interaction, key);
  switch (key) {
    case "coinflip": return playCoinflip(interaction, parts[4]!);
    case "dice": return playDice(interaction);
    case "hl": return playHigherLower(interaction, action!, parts.slice(4));
    case "slots": return playSlots(interaction);
    case "wheel": return playWheel(interaction);
    case "emoji": return playEmoji(interaction, parts.slice(4));
  }
}

// Open screen (the game's start UI). Uses interaction.update so it fits the menu.
async function openGame(interaction: ButtonInteraction, key: GameKey): Promise<void> {
  const settings = await getBobSettings(interaction.guildId!);
  const form = rollForm(settings);
  switch (key) {
    case "coinflip": {
      const embed = bobEmbed(form, "Coin Flip", "Call it in the air. Heads or tails?");
      const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId("bob:game:coinflip:pick:heads").setLabel("Heads").setEmoji("👑").setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId("bob:game:coinflip:pick:tails").setLabel("Tails").setEmoji("🪙").setStyle(ButtonStyle.Primary),
      );
      await interaction.update({ embeds: [embed], components: [row, navRow()] }).catch(() => {});
      return;
    }
    case "dice": {
      const embed = bobEmbed(form, "Dice Roll", "You vs Bob. Highest roll wins. Bob does not cheat. Much.");
      const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId("bob:game:dice:roll").setLabel("Roll").setEmoji("🎲").setStyle(ButtonStyle.Success));
      await interaction.update({ embeds: [embed], components: [row, navRow()] }).catch(() => {});
      return;
    }
    case "hl": {
      const n = 1 + Math.floor(Math.random() * 9); // 1-9
      const embed = bobEmbed(form, "Higher or Lower", `The number is **${n}**.\nWill the next (1–10) be higher or lower?`);
      const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId(`bob:game:hl:higher:${n}`).setLabel("Higher").setEmoji("🔼").setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(`bob:game:hl:lower:${n}`).setLabel("Lower").setEmoji("🔽").setStyle(ButtonStyle.Primary),
      );
      await interaction.update({ embeds: [embed], components: [row, navRow()] }).catch(() => {});
      return;
    }
    case "slots": {
      const embed = bobEmbed(form, "Slots", "Pull the lever. Three-of-a-kind = jackpot. 🎰");
      const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId("bob:game:slots:spin").setLabel("Spin").setEmoji("🎰").setStyle(ButtonStyle.Success));
      await interaction.update({ embeds: [embed], components: [row, navRow()] }).catch(() => {});
      return;
    }
    case "wheel": {
      const embed = bobEmbed(form, "Lucky Wheel", "Spin the wheel of questionable fortune. 🎡");
      const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId("bob:game:wheel:spin").setLabel("Spin").setEmoji("🎡").setStyle(ButtonStyle.Success));
      await interaction.update({ embeds: [embed], components: [row, navRow()] }).catch(() => {});
      return;
    }
    case "emoji": {
      const set = pick(EMOJI_SETS);
      const correct = Math.floor(Math.random() * set.options.length);
      const embed = bobEmbed(form, "Guess the Emoji", `${set.clue}\n\nWhich emoji fits? Tap fast.`);
      const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
        set.options.map((e, i) => new ButtonBuilder().setCustomId(`bob:game:emoji:pick:${i}:${correct}`).setLabel(e).setStyle(ButtonStyle.Secondary)),
      );
      await interaction.update({ embeds: [embed], components: [row, navRow()] }).catch(() => {});
      return;
    }
  }
}

// ── Coin Flip ────────────────────────────────────────────────────────────────
async function playCoinflip(interaction: ButtonInteraction, choice: string): Promise<void> {
  const g = await gate(interaction, "coinflip"); if (!g) return;
  const { form, settings } = g;
  await animate(interaction, [
    { embed: bobEmbed(form, "Coin Flip", "🪙 Flipping..."), delayMs: 700 },
    { embed: bobEmbed(form, "Coin Flip", "🪙 ⟳ ...tumbling..."), delayMs: 700 },
  ]);
  const result = Math.random() < 0.5 ? "heads" : "tails";
  const won = result === choice;
  const outcome = applyForm(form, won ? { coins: 30, xp: 20, won: true } : { coins: 0, xp: 8, won: false });
  await finish(interaction, form, settings, `It's **${result.toUpperCase()}**! You called ${choice}.`, outcome, "coinflip", "bob:game:coinflip:open");
}

// ── Dice ─────────────────────────────────────────────────────────────────────
async function playDice(interaction: ButtonInteraction): Promise<void> {
  const g = await gate(interaction, "dice"); if (!g) return;
  const { form, settings } = g;
  await animate(interaction, [
    { embed: bobEmbed(form, "Dice Roll", "🎲 Rolling..."), delayMs: 700 },
    { embed: bobEmbed(form, "Dice Roll", "🎲🎲 ...bouncing..."), delayMs: 700 },
  ]);
  const you = 1 + Math.floor(Math.random() * 6);
  const bob = 1 + Math.floor(Math.random() * 6);
  const won = you > bob;
  const tie = you === bob;
  const base: Outcome = tie ? { coins: 10, xp: 10, won: false } : won ? { coins: 35, xp: 22, won: true } : { coins: 0, xp: 8, won: false };
  const outcome = applyForm(form, base);
  const head = `You rolled **${you}** 🎲 · Bob rolled **${bob}** 🎲 — ${tie ? "a tie!" : won ? "you win!" : "Bob wins."}`;
  await finish(interaction, form, settings, head, outcome, "dice", "bob:game:dice:open");
}

// ── Higher or Lower ──────────────────────────────────────────────────────────
async function playHigherLower(interaction: ButtonInteraction, dir: string, data: string[]): Promise<void> {
  const g = await gate(interaction, "hl"); if (!g) return;
  const { form, settings } = g;
  const base = Number(data[0]);
  await animate(interaction, [{ embed: bobEmbed(form, "Higher or Lower", "🎴 Revealing..."), delayMs: 800 }]);
  let next = 1 + Math.floor(Math.random() * 10);
  if (next === base) next = next === 10 ? 9 : next + 1; // avoid exact tie
  const won = dir === "higher" ? next > base : next < base;
  const outcome = applyForm(form, won ? { coins: 40, xp: 25, won: true } : { coins: 0, xp: 8, won: false });
  await finish(interaction, form, settings, `It was **${next}** (you said ${dir} than ${base}).`, outcome, "hl", "bob:game:hl:open");
}

// ── Slots ────────────────────────────────────────────────────────────────────
const SLOT_SYMBOLS = ["🍒", "🍋", "🔔", "⭐", "💎", "🪙"];
async function playSlots(interaction: ButtonInteraction): Promise<void> {
  const g = await gate(interaction, "slots"); if (!g) return;
  const { form, settings } = g;
  const roll = () => pick(SLOT_SYMBOLS);
  await animate(interaction, [
    { embed: bobEmbed(form, "Slots", `[ ${roll()} | ${roll()} | ${roll()} ]\nSpinning...`), delayMs: 600 },
    { embed: bobEmbed(form, "Slots", `[ ${roll()} | ${roll()} | ${roll()} ]\nSpinning...`), delayMs: 600 },
  ]);
  const reels = [roll(), roll(), roll()];
  const allSame = reels[0] === reels[1] && reels[1] === reels[2];
  const twoSame = reels[0] === reels[1] || reels[1] === reels[2] || reels[0] === reels[2];
  const jackpot = allSame && reels[0] === "💎";
  const base: Outcome = allSame ? { coins: jackpot ? 250 : 150, xp: 70, won: true, jackpot } : twoSame ? { coins: 40, xp: 22, won: true } : { coins: 0, xp: 6, won: false };
  const outcome = applyForm(form, base);
  const head = `[ ${reels.join(" | ")} ]${jackpot ? "\n💎 **JACKPOT!** 💎" : allSame ? "\n🎉 Three of a kind!" : twoSame ? "\nTwo match — small win." : ""}`;
  await finish(interaction, form, settings, head, outcome, "slots", "bob:game:slots:open");
}

// ── Lucky Wheel ──────────────────────────────────────────────────────────────
const WHEEL = [
  { label: "Nothing 💨", coins: 0, xp: 6, won: false },
  { label: "Small win 🪙", coins: 25, xp: 15, won: true },
  { label: "Nice! 🪙🪙", coins: 60, xp: 30, won: true },
  { label: "Big win 💰", coins: 120, xp: 45, won: true },
  { label: "JACKPOT 💎", coins: 250, xp: 70, won: true, jackpot: true },
  { label: "Bob's Curse 😈", coins: 0, xp: 10, won: false, curse: true },
];
async function playWheel(interaction: ButtonInteraction): Promise<void> {
  const g = await gate(interaction, "wheel"); if (!g) return;
  const { form, settings } = g;
  await animate(interaction, [
    { embed: bobEmbed(form, "Lucky Wheel", "🎡 ◔ spinning..."), delayMs: 600 },
    { embed: bobEmbed(form, "Lucky Wheel", "🎡 ◑ spinning..."), delayMs: 600 },
    { embed: bobEmbed(form, "Lucky Wheel", "🎡 ◕ slowing..."), delayMs: 600 },
  ]);
  const seg = pick(WHEEL);
  if ((seg as { curse?: boolean }).curse) {
    await applyCurse(interaction.guildId!, interaction.user.id, "🐸 turned into a frog (cosmetic, harmless)", 30);
  }
  const outcome = applyForm(form, { coins: seg.coins, xp: seg.xp, won: seg.won, jackpot: (seg as { jackpot?: boolean }).jackpot });
  await finish(interaction, form, settings, `The wheel lands on: **${seg.label}**`, outcome, "wheel", "bob:game:wheel:open");
}

// ── Guess the Emoji ──────────────────────────────────────────────────────────
const EMOJI_SETS = [
  { clue: "🔫 Bob's favourite dangerous pastime", options: ["🎲", "🍕", "🚀", "🐸"] },
  { clue: "💎 The jackpot symbol", options: ["🍒", "💎", "🔔", "🍋"] },
  { clue: "🔵 What colour is evil Bob?", options: ["🟢", "🔴", "🔵", "🟡"] },
  { clue: "🎯 The 'you hit it' emoji", options: ["🎯", "💤", "🧊", "🥔"] },
  { clue: "🎉 The celebration one", options: ["😴", "🎉", "🧻", "🥶"] },
];
async function playEmoji(interaction: ButtonInteraction, data: string[]): Promise<void> {
  const g = await gate(interaction, "emoji"); if (!g) return;
  const { form, settings } = g;
  const picked = Number(data[0]);
  const correct = Number(data[1]);
  await animate(interaction, [{ embed: bobEmbed(form, "Guess the Emoji", "🤔 Checking..."), delayMs: 600 }]);
  await sleep(150);
  const won = picked === correct;
  const outcome = applyForm(form, won ? { coins: 30, xp: 20, won: true } : { coins: 0, xp: 6, won: false });
  await finish(interaction, form, settings, won ? "✅ Correct!" : "❌ Nope!", outcome, "emoji", "bob:game:emoji:open");
}
