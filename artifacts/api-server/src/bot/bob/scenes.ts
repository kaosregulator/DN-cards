// Bob Scene Engine — the shared storytelling layer every game uses.
//
// Flow for a game: intro scene → player interaction → Bob reaction → animated
// gameplay → suspense → outcome reveal → Bob reaction → reward screen. All of
// it edits ONE embed (no message spam). This module owns the moods, the random
// intro scenes, the reaction banks, and the frame player.

import type { ButtonInteraction, StringSelectMenuInteraction, ChatInputCommandInteraction, EmbedBuilder } from "discord.js";
import { pick, speak, type BobForm } from "./persona.js";
import { bobEmbed, sleep } from "./ui.js";

// ── Moods ────────────────────────────────────────────────────────────────────
export type Mood = "happy" | "evil" | "nervous" | "excited" | "sleepy" | "confused";

export const MOOD_EMOJI: Record<Mood, string> = {
  happy: "😄", evil: "😈", nervous: "😬", excited: "🤩", sleepy: "😴", confused: "🫤",
};

// Roll a mood, biased by form (Blue skews evil, Upside skews confused).
export function rollMood(form: BobForm): Mood {
  const pools: Record<BobForm, Mood[]> = {
    normal: ["happy", "happy", "excited", "nervous", "sleepy", "confused"],
    blue: ["evil", "evil", "excited", "nervous"],
    upside: ["confused", "confused", "sleepy", "evil"],
  };
  return pick(pools[form]);
}

// Short mood-flavoured reaction lines Bob drops mid-game.
export const MOOD_REACTIONS: Record<Mood, readonly string[]> = {
  happy: ["Bob grins.", "Bob is having a great time.", "Bob hums the casino theme.", "Bob gives a thumbs up. He has no thumbs."],
  evil: ["Bob smiles. Too wide.", "Bob is taking notes. For later.", "Bob chuckles in villain.", "Bob polishes the revolver lovingly."],
  nervous: ["Bob sweats. Bots can't sweat. Concerning.", "Bob looks away.", "Bob whistles nervously.", "Bob double-checks the fine print."],
  excited: ["Bob is VIBRATING.", "Bob leans in way too close.", "Bob slams the table. \"LET'S GO.\"", "Bob does a little spin."],
  sleepy: ["Bob yawns mid-deal.", "Bob briefly falls asleep standing up.", "Bob stirs his coffee with the barrel. Wait—", "Bob blinks slowly."],
  confused: ["Bob stares at the rules. Upside down.", "Bob forgot what game this is.", "Bob counts to six. Gets seven.", "Bob looks at you. Then through you."],
};

export function moodLine(mood: Mood): string {
  return `*${MOOD_EMOJI[mood]} ${pick(MOOD_REACTIONS[mood])}*`;
}

// ── Random intro scenes ──────────────────────────────────────────────────────
// Roulette gets its own big bank (it's the signature game); other games share
// a generic host-arrival bank. {p} = player name.
export const ROULETTE_INTROS: Record<BobForm, readonly string[]> = {
  normal: [
    "Bob kicks the door open. \"**{p}!** Perfect timing. The table's warm.\"",
    "Bob is already waiting, feet on the table. \"Took you long enough.\"",
    "Bob drops the revolver on the table with a CLANG. \"Oops. It's fine. Probably.\"",
    "Bob pats his pockets. \"Hang on. I forgot something.\" ...He did not find it.",
    "Bob slides in wearing sunglasses. Indoors. At night. \"Let's gamble.\"",
    "Bob shuffles in with coffee. \"One game before my break. Make it count, {p}.\"",
  ],
  blue: [
    "The lights flicker. Blue Bob is sitting where Bob was. \"He stepped out. **I didn't.**\"",
    "Blue Bob spins the revolver on one finger. \"Insurance? Denied. Sit down, {p}.\"",
    "Blue Bob doesn't look up. \"I loaded it myself. You're welcome.\"",
    "\"Bob couldn't make it,\" says Blue Bob, smiling. \"He's fine. Anyway—\"",
  ],
  upside: [
    "The table is on the ceiling. Bob is also on the ceiling. \"d̸o̷w̶n̷ i̶s̷ u̸p̶, {p}.\"",
    "Upside-Down Bob deals the game before you arrive. \"You already played. Play again first.\"",
    "The revolver spins by itself. Upside-Down Bob watches it. \"It remembers you.\"",
  ],
};

export const GAME_INTROS: Record<BobForm, readonly string[]> = {
  normal: [
    "Bob cracks his knuckles. \"Alright {p}, house rules: I make them up.\"",
    "Bob appears in a dealer vest two sizes too small. \"Welcome, welcome.\"",
    "Bob wipes the table with his sleeve. \"Freshly cleaned. Let's play.\"",
    "\"Step right up, {p},\" says Bob, shuffling absolutely nothing.",
  ],
  blue: [
    "Blue Bob taps the table twice. \"House always wins. I'm the house.\"",
    "Blue Bob smiles. \"I've already seen how this ends for you, {p}.\"",
  ],
  upside: [
    "The game starts before Bob arrives. He arrives anyway. Backwards.",
    "\"W̶e̷l̸c̶o̷m̷e̶ back,\" says Upside-Down Bob, for the first time.",
  ],
};

export function introLine(form: BobForm, playerName: string, roulette = false): string {
  const bank = roulette ? ROULETTE_INTROS[form] : GAME_INTROS[form];
  return speak(form, pick(bank).replace(/\{p\}/g, playerName));
}

// ── Suspense beats ───────────────────────────────────────────────────────────
export const SUSPENSE: readonly string[] = [
  "…", "… …", "Bob leans in.", "Bob covers his eyes. Peeks.", "The room goes quiet.", "Somewhere, a coin drops.",
];

// ── Frame player ─────────────────────────────────────────────────────────────
export interface SceneFrame { embed: EmbedBuilder; delayMs: number }

type AnyInteraction = ButtonInteraction | StringSelectMenuInteraction | ChatInputCommandInteraction;

// Plays frames by editing the SAME message. Works for slash + component
// interactions, first-frame ack included.
export async function playFrames(interaction: AnyInteraction, frames: SceneFrame[]): Promise<void> {
  for (let i = 0; i < frames.length; i++) {
    const f = frames[i]!;
    if (i === 0 && !interaction.deferred && !interaction.replied) {
      if (interaction.isChatInputCommand()) await interaction.reply({ embeds: [f.embed], components: [] });
      else await interaction.update({ embeds: [f.embed], components: [] }).catch(() => {});
    } else {
      await interaction.editReply({ embeds: [f.embed], components: [] }).catch(() => {});
    }
    if (f.delayMs > 0) await sleep(f.delayMs);
  }
}

// Convenience: build a frame in Bob's voice with optional avatar + player badge.
export function frame(
  form: BobForm, title: string, text: string, delayMs: number,
  opts: { avatar?: string | null; player?: { name: string; icon?: string } } = {},
): SceneFrame {
  const e = bobEmbed(form, title, text, opts.avatar);
  if (opts.player) e.setAuthor({ name: opts.player.name, iconURL: opts.player.icon });
  return { embed: e, delayMs };
}
