// Shared Bob UI helpers — embeds in the active form's colours, animation timing,
// cooldown replies, and reward formatting. Keeps every game/screen consistent.

import {
  EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags,
  type ButtonInteraction, type StringSelectMenuInteraction, type ChatInputCommandInteraction,
} from "discord.js";
import { FORMS, formTitle, pick, QUIPS, type BobForm } from "./persona.js";
import { COINS_EMOJI, type RewardResult } from "./db.js";

export const EPHEMERAL = { flags: MessageFlags.Ephemeral } as const;

export function sleep(ms: number): Promise<void> { return new Promise(r => setTimeout(r, ms)); }

export function bobEmbed(form: BobForm, title: string, description: string, avatarUrl?: string | null): EmbedBuilder {
  const e = new EmbedBuilder()
    .setColor(FORMS[form].color)
    .setTitle(formTitle(form, title))
    .setDescription(description);
  if (avatarUrl) e.setThumbnail(avatarUrl);
  return e;
}

// A little footer flavour line, form-appropriate.
export function quipFooter(form: BobForm): string {
  return pick(QUIPS[form]);
}

export function coins(n: number): string { return `${COINS_EMOJI} ${n.toLocaleString()}`; }

// Format the reward/level/title tail shown after a game resolves.
export function rewardTail(r: RewardResult, deltaCoins: number, deltaXp: number): string {
  const parts: string[] = [];
  if (deltaCoins > 0) parts.push(`+${coins(deltaCoins)}`);
  else if (deltaCoins < 0) parts.push(`−${coins(Math.abs(deltaCoins))}`);
  if (deltaXp > 0) parts.push(`+⭐ ${deltaXp} XP`);
  let tail = parts.length ? `\n\n**Reward:** ${parts.join(" · ")} · Balance: ${coins(r.profile.coins)}` : `\n\nBalance: ${coins(r.profile.coins)}`;
  if (r.leveledTo) tail += `\n📈 **Level up!** You're now level **${r.leveledTo}**.`;
  if (r.newTitle) tail += `\n🏷️ **New title unlocked:** ${r.newTitle}`;
  return tail;
}

// Standard cooldown message.
export async function cooldownReply(interaction: ButtonInteraction | ChatInputCommandInteraction, retryMs: number): Promise<void> {
  const secs = Math.ceil(retryMs / 1000);
  const msg = `⏳ Easy, tiger. Bob needs **${secs}s** to recover from your last stunt.`;
  if (interaction.isChatInputCommand()) await interaction.reply({ content: msg, ...EPHEMERAL });
  else await interaction.reply({ content: msg, ...EPHEMERAL });
}

// A single-row "Back to menu" / "Play again" button set.
export function navRow(opts: { again?: string; menu?: boolean } = {}): ActionRowBuilder<ButtonBuilder> {
  const row = new ActionRowBuilder<ButtonBuilder>();
  if (opts.again) row.addComponents(new ButtonBuilder().setCustomId(opts.again).setLabel("Play Again").setEmoji("🔁").setStyle(ButtonStyle.Success));
  if (opts.menu !== false) row.addComponents(new ButtonBuilder().setCustomId("bob:menu:home").setLabel("Menu").setEmoji("🏠").setStyle(ButtonStyle.Secondary));
  return row;
}

// Animate a component message through frames (edits the same message).
export async function animate(
  interaction: ButtonInteraction | StringSelectMenuInteraction,
  frames: { embed: EmbedBuilder; delayMs: number }[],
): Promise<void> {
  for (let i = 0; i < frames.length; i++) {
    const f = frames[i]!;
    if (i === 0 && !interaction.deferred && !interaction.replied) {
      await interaction.update({ embeds: [f.embed], components: [] }).catch(() => {});
    } else {
      await interaction.editReply({ embeds: [f.embed], components: [] }).catch(() => {});
    }
    if (f.delayMs > 0) await sleep(f.delayMs);
  }
}

export { FORMS };
