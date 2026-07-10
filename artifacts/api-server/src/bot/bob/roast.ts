// Bob roasting. Bob "thinks", then fires a unique roast whose savagery depends
// on his current form (Blue Bob roasts harder; Upside-Down Bob gets weird).
// Cooldown-gated so it can't be spammed. Posts publicly, tagging the target.

import {
  ActionRowBuilder, UserSelectMenuBuilder,
  type ChatInputCommandInteraction, type ButtonInteraction, type UserSelectMenuInteraction, type User,
} from "discord.js";
import { getBobSettings, checkCooldown, incRoasts, gameEnabled } from "./db.js";
import { rollForm, pick, speak, ROASTS, UPSIDE_ROASTS, formTitle, type BobForm, type RoastCategory } from "./persona.js";
import { bobEmbed, sleep, EPHEMERAL } from "./ui.js";
import { recordBobEvent, formatCompletions } from "./progress.js";

function categoryFor(form: BobForm): RoastCategory {
  const r = Math.random();
  if (form === "blue") return r < 0.45 ? "evil" : r < 0.85 ? "savage" : r < 0.9 ? "refusal" : "friendly";
  // normal
  return r < 0.45 ? "friendly" : r < 0.75 ? "savage" : r < 0.87 ? "wholesome" : r < 0.95 ? "evil" : "refusal";
}

function buildRoast(form: BobForm, targetMention: string): string {
  if (form === "upside") return speak(form, pick(UPSIDE_ROASTS).replace(/\{t\}/g, targetMention));
  const cat = categoryFor(form);
  return speak(form, pick(ROASTS[cat]).replace(/\{t\}/g, targetMention));
}

// Core: run a roast against a target for a given (already-acknowledged) interaction.
async function runRoast(
  interaction: ChatInputCommandInteraction | UserSelectMenuInteraction,
  target: User, deferredPublic: boolean,
): Promise<void> {
  const guildId = interaction.guildId!;
  const settings = await getBobSettings(guildId);
  if (!settings.enabled || !gameEnabled(settings, "roast")) {
    await reply(interaction, deferredPublic, "🚫 Roasting is disabled here.", true); return;
  }
  if (target.id === interaction.client.user!.id) {
    await reply(interaction, deferredPublic, "🔥 Roast myself? I'm flawless. Try a mortal.", true); return;
  }
  const cd = await checkCooldown(guildId, interaction.user.id, Math.max(settings.cooldownSeconds, 6));
  if (!cd.ok) { await reply(interaction, deferredPublic, `⏳ Let the last roast cool for ${Math.ceil(cd.retryMs / 1000)}s.`, true); return; }

  const form = rollForm(settings);
  // "Thinking..." beat.
  await editThinking(interaction, deferredPublic, form);
  await sleep(1400);

  const roast = buildRoast(form, `<@${target.id}>`);
  await incRoasts(guildId, interaction.user.id);
  const completed = await recordBobEvent(guildId, interaction.user.id, "roast", 1);

  const embed = bobEmbed(form, "Roast", roast).setFooter({ text: `Requested by ${interaction.user.username}` });
  await editFinal(interaction, deferredPublic, embed.data.description ?? roast, form, target.id);
  const note = formatCompletions(completed);
  if (note) await interaction.followUp({ content: note, ...EPHEMERAL }).catch(() => {});
}

// ── Slash entry: /bob_roast user:@x  (or /bob roast) ─────────────────────────
export async function handleRoastCommand(interaction: ChatInputCommandInteraction, target: User): Promise<void> {
  if (!interaction.guildId) { await interaction.reply({ content: "Server only.", ...EPHEMERAL }); return; }
  await interaction.deferReply(); // public
  await runRoast(interaction, target, true);
}

// ── Menu entry: show a user picker, then roast the chosen member ──────────────
export function roastPickerRow(): ActionRowBuilder<UserSelectMenuBuilder> {
  return new ActionRowBuilder<UserSelectMenuBuilder>().addComponents(
    new UserSelectMenuBuilder().setCustomId("bob:roast:target").setPlaceholder("🔥 Pick someone to roast…").setMinValues(1).setMaxValues(1));
}

export async function handleRoastPick(interaction: UserSelectMenuInteraction): Promise<void> {
  const target = interaction.users.first();
  if (!target) { await interaction.reply({ content: "No target picked.", ...EPHEMERAL }); return; }
  // Acknowledge by editing the (ephemeral menu) message, then roast publicly in-channel.
  await interaction.update({ content: `🔥 Roasting <@${target.id}>…`, embeds: [], components: [] }).catch(() => {});
  const guildId = interaction.guildId!;
  const settings = await getBobSettings(guildId);
  if (!settings.enabled || !gameEnabled(settings, "roast")) return;
  const cd = await checkCooldown(guildId, interaction.user.id, Math.max(settings.cooldownSeconds, 6));
  if (!cd.ok) { await interaction.followUp({ content: `⏳ Cooldown: ${Math.ceil(cd.retryMs / 1000)}s.`, ...EPHEMERAL }).catch(() => {}); return; }
  const form = rollForm(settings);
  const roast = buildRoast(form, `<@${target.id}>`);
  await incRoasts(guildId, interaction.user.id);
  const completed = await recordBobEvent(guildId, interaction.user.id, "roast", 1);
  const embed = bobEmbed(form, "Roast", roast).setFooter({ text: `Requested by ${interaction.user.username}` });
  if (interaction.channel && "send" in interaction.channel) {
    await (interaction.channel as { send: Function }).send({ content: `<@${target.id}>`, embeds: [embed] }).catch(() => {});
  }
  const note = formatCompletions(completed);
  if (note) await interaction.followUp({ content: note, ...EPHEMERAL }).catch(() => {});
}

// ── reply/edit helpers (unify slash + select) ────────────────────────────────
async function reply(interaction: ChatInputCommandInteraction | UserSelectMenuInteraction, deferred: boolean, content: string, ephemeral: boolean): Promise<void> {
  if (deferred) await interaction.editReply({ content });
  else await interaction.reply({ content, ...(ephemeral ? EPHEMERAL : {}) }).catch(() => {});
}

async function editThinking(interaction: ChatInputCommandInteraction | UserSelectMenuInteraction, deferred: boolean, form: BobForm): Promise<void> {
  const e = bobEmbed(form, "Roast", "🔥 Bob is thinking of something devastating...");
  if (deferred) await interaction.editReply({ embeds: [e] }).catch(() => {});
}

async function editFinal(interaction: ChatInputCommandInteraction | UserSelectMenuInteraction, deferred: boolean, roast: string, form: BobForm, targetId: string): Promise<void> {
  const embed = bobEmbed(form, "Roast", roast).setFooter({ text: `${formTitle(form)} · a Bob production` });
  if (deferred) await interaction.editReply({ content: `<@${targetId}>`, embeds: [embed] }).catch(() => {});
}
