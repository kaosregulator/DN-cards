// Bob talking. A local personality engine drives replies out of the box (no API
// key needed). If an admin enables `ai_talking` AND ANTHROPIC_API_KEY is set,
// Bob upgrades to real Claude-generated banter, seeded with his form persona and
// a short rolling memory of the conversation. Any AI failure silently falls back
// to the local lines, so Bob is never speechless.

import {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder,
  TextInputStyle, EmbedBuilder,
  type ChatInputCommandInteraction, type ButtonInteraction, type ModalSubmitInteraction,
} from "discord.js";
import { getBobSettings, getBobProfile, pushMemory, clearMemory, activeCurse } from "./db.js";
import { rollForm, localTalkReply, GREETINGS, pick, speak, formTitle, type BobForm } from "./persona.js";
import { bobEmbed, EPHEMERAL } from "./ui.js";
import { recordBobEvent, formatCompletions } from "./progress.js";
import type { BobMemory } from "@workspace/db";
import { logger } from "../../lib/logger.js";

const AI_MODEL = "claude-haiku-4-5-20251001";

// Produce Bob's reply to a message, update memory, and record the talk event.
export async function bobReply(guildId: string, userId: string, form: BobForm, message: string): Promise<string> {
  const settings = await getBobSettings(guildId);
  const profile = await getBobProfile(guildId, userId);

  let reply: string | null = null;
  if (settings.aiTalking && process.env["ANTHROPIC_API_KEY"]) {
    reply = await aiReply(form, message, profile.memory).catch(err => {
      logger.debug({ err }, "bob AI reply failed; falling back to local");
      return null;
    });
  }
  if (!reply) reply = localTalkReply(form, message);

  await pushMemory(guildId, userId, [{ role: "user", text: message.slice(0, 300) }, { role: "bob", text: reply.slice(0, 300) }]);
  await recordBobEvent(guildId, userId, "talk", 1).catch(() => undefined);
  return reply;
}

// Optional Claude backend. Kept dependency-free via fetch. Short + safe.
async function aiReply(form: BobForm, message: string, memory: BobMemory[]): Promise<string | null> {
  const persona = {
    normal: "You are Bob: a funny, friendly, slightly sarcastic and chaotic Discord game-host NPC. Playful, never mean-spirited.",
    blue: "You are Blue Bob: Bob's evil, trolling, competitive alter ego. Cocky and savage but still comedic — never truly cruel, slurs, or harmful.",
    upside: "You are Upside-Down Bob: a glitched, cryptic, surreal version of Bob. Reply in short, weird, paradoxical riddles.",
  }[form];
  const system = `${persona} Keep replies to 1-2 short sentences. Stay in character. No markdown headers. Never break character to mention being an AI.`;
  const messages = [
    ...memory.slice(-6).map(m => ({ role: m.role === "user" ? "user" as const : "assistant" as const, content: m.text })),
    { role: "user" as const, content: message.slice(0, 400) },
  ];
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), 8000);
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": process.env["ANTHROPIC_API_KEY"]!,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({ model: AI_MODEL, max_tokens: 120, system, messages }),
      signal: ctrl.signal,
    });
    if (!res.ok) return null;
    const data = await res.json() as { content?: { type: string; text?: string }[] };
    const text = data.content?.find(c => c.type === "text")?.text?.trim();
    return text ? speak(form, text) : null;
  } finally {
    clearTimeout(to);
  }
}

// ── Menu / command surfaces ──────────────────────────────────────────────────
export function talkIntro(form: BobForm, curse: string | null): EmbedBuilder {
  const embed = bobEmbed(form, "Talk to Bob",
    `${speak(form, pick(GREETINGS[form]))}\n\nHit **Say Something** to chat with me. I remember the last few things you said — for better or worse.`);
  if (curse) embed.addFields({ name: "🌀 Active curse", value: curse, inline: false });
  return embed;
}

export function talkComponents(): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId("bob:talk:say").setLabel("Say Something").setEmoji("💬").setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId("bob:talk:forget").setLabel("Make Bob Forget").setEmoji("🧠").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId("bob:menu:home").setLabel("Menu").setEmoji("🏠").setStyle(ButtonStyle.Secondary),
  );
}

// Slash: /bob_talk [message]
export async function handleTalkCommand(interaction: ChatInputCommandInteraction, message: string | null): Promise<void> {
  if (!interaction.guildId) { await interaction.reply({ content: "Server only.", ...EPHEMERAL }); return; }
  const settings = await getBobSettings(interaction.guildId);
  const form = rollForm(settings);
  if (!message) {
    const profile = await getBobProfile(interaction.guildId, interaction.user.id);
    await interaction.reply({ embeds: [talkIntro(form, activeCurse(profile))], components: [talkComponents()], ...EPHEMERAL });
    return;
  }
  await interaction.deferReply();
  const reply = await bobReply(interaction.guildId, interaction.user.id, form, message);
  await interaction.editReply({ embeds: [bobEmbed(form, "Talk", `**You:** ${message.slice(0, 200)}\n\n**${formTitle(form)}:** ${reply}`)] });
}

// Button: open the "say something" modal.
export async function handleTalkSay(interaction: ButtonInteraction): Promise<void> {
  const modal = new ModalBuilder().setCustomId("bob:talk:modal").setTitle("Say something to Bob");
  modal.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(
    new TextInputBuilder().setCustomId("msg").setLabel("Your message").setStyle(TextInputStyle.Paragraph).setMaxLength(400).setRequired(true)));
  await interaction.showModal(modal);
}

// Modal submit: Bob replies (ephemeral so it doesn't spam the channel).
export async function handleTalkModal(interaction: ModalSubmitInteraction): Promise<void> {
  if (!interaction.guildId) return;
  await interaction.deferReply(EPHEMERAL);
  const message = interaction.fields.getTextInputValue("msg");
  const settings = await getBobSettings(interaction.guildId);
  const form = rollForm(settings);
  const reply = await bobReply(interaction.guildId, interaction.user.id, form, message);
  const completed = await recordBobEvent(interaction.guildId, interaction.user.id, "talk", 0); // already counted in bobReply
  const embed = bobEmbed(form, "Talk", `**You:** ${message.slice(0, 200)}\n\n**${formTitle(form)}:** ${reply}`);
  await interaction.editReply({ embeds: [embed], components: [talkComponents()] });
  const note = formatCompletions(completed);
  if (note) await interaction.followUp({ content: note, ...EPHEMERAL }).catch(() => {});
}

export async function handleTalkForget(interaction: ButtonInteraction): Promise<void> {
  if (!interaction.guildId) return;
  await clearMemory(interaction.guildId, interaction.user.id);
  await interaction.reply({ content: "🧠 Poof. I've forgotten everything. Who are you again?", ...EPHEMERAL });
}
