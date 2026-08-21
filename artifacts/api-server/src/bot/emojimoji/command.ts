// ─────────────────────────────────────────────────────────────────────────────
// /emojimoji — turn any image (upload / avatar / URL) into an animated emote.
// Flow: run the command → pick an effect from a dropdown → a preview GIF renders
// privately → press Send to post it to the channel. Nothing third-party: the
// effects are our own canvas transforms (see effects.ts).
// ─────────────────────────────────────────────────────────────────────────────

import {
  ActionRowBuilder, AttachmentBuilder, ButtonBuilder, ButtonStyle,
  StringSelectMenuBuilder, MessageFlags,
  type ChatInputCommandInteraction, type StringSelectMenuInteraction,
  type ButtonInteraction, type TextBasedChannel,
} from "discord.js";
import sharp from "sharp";
import { EMOJI_EFFECTS, renderEmojiGif } from "./effects.js";
import { logger } from "../../lib/logger.js";

interface Session { url: string; userId: string; expires: number; gif?: Buffer; effect?: string; }
const sessions = new Map<string, Session>();
const TTL = 10 * 60 * 1000;

function token(): string { return Math.random().toString(36).slice(2, 10); }
function sweep(): void { const now = Date.now(); for (const [k, s] of sessions) if (s.expires < now) sessions.delete(k); }

function selectRow(tok: string): ActionRowBuilder<StringSelectMenuBuilder> {
  const menu = new StringSelectMenuBuilder()
    .setCustomId(`emojimoji:pick:${tok}`)
    .setPlaceholder("Choose an animation…")
    .addOptions(EMOJI_EFFECTS.map((e) => ({ label: e.name, value: e.id, emoji: e.emoji, description: e.desc.slice(0, 100) })));
  return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu);
}

function sendRow(tok: string, effectName: string): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`emojimoji:send:${tok}`).setStyle(ButtonStyle.Success).setEmoji("▶️").setLabel(`Send “${effectName}”`),
  );
}

// Resolve the target image URL from the command options (attachment → user → url
// → the caller's own avatar).
function resolveSource(interaction: ChatInputCommandInteraction): string | null {
  const att = interaction.options.getAttachment("image");
  if (att) {
    if (att.contentType && !att.contentType.startsWith("image/")) return null;
    return att.url;
  }
  const user = interaction.options.getUser("user");
  if (user) return user.displayAvatarURL({ extension: "png", size: 256 });
  const url = interaction.options.getString("url");
  if (url) return /^https?:\/\//i.test(url) ? url : null;
  return interaction.user.displayAvatarURL({ extension: "png", size: 256 });
}

// Download the source and flatten it to a single 256px PNG frame for the encoder.
async function fetchImage(url: string): Promise<Buffer | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > 12_000_000) return null;
    return await sharp(buf)
      .resize(256, 256, { fit: "inside", withoutEnlargement: true })
      .png()
      .toBuffer();
  } catch { return null; }
}

export async function handleEmojimoji(interaction: ChatInputCommandInteraction): Promise<void> {
  sweep();
  const url = resolveSource(interaction);
  if (!url) {
    await interaction.reply({ content: "❌ Give me an image — an upload, a user, or an image URL.", flags: MessageFlags.Ephemeral });
    return;
  }
  const tok = token();
  sessions.set(tok, { url, userId: interaction.user.id, expires: Date.now() + TTL });
  await interaction.reply({
    content: "🪄 **Emojimoji** — pick an animation to preview it, then Send it to the channel.",
    components: [selectRow(tok)],
    flags: MessageFlags.Ephemeral,
  });
}

export async function handleEmojimojiSelect(interaction: StringSelectMenuInteraction): Promise<void> {
  const tok = interaction.customId.split(":")[2] ?? "";
  const s = sessions.get(tok);
  if (!s || s.userId !== interaction.user.id) {
    await interaction.reply({ content: "⌛ That emojimoji session expired — run `/emojimoji` again.", flags: MessageFlags.Ephemeral });
    return;
  }
  const effectId = interaction.values[0]!;
  const eff = EMOJI_EFFECTS.find((e) => e.id === effectId);
  await interaction.deferUpdate();
  try {
    const src = await fetchImage(s.url);
    if (!src) { await interaction.editReply({ content: "❌ Couldn't read that image. Try a PNG/JPG/GIF." }); return; }
    const gif = await renderEmojiGif(src, effectId);
    if (!gif) { await interaction.editReply({ content: "❌ Couldn't render that effect. Try another." }); return; }
    s.gif = gif; s.effect = effectId; s.expires = Date.now() + TTL;
    await interaction.editReply({
      content: `Preview — **${eff?.name ?? effectId}** ${eff?.emoji ?? ""}. Pick another to change it, or Send it below.`,
      files: [new AttachmentBuilder(gif, { name: "emojimoji.gif" })],
      components: [selectRow(tok), sendRow(tok, eff?.name ?? "emoji")],
    });
  } catch (err) {
    logger.error({ err }, "emojimoji: preview failed");
    await interaction.editReply({ content: "❌ Something went wrong rendering that. Try again." });
  }
}

export async function handleEmojimojiButton(interaction: ButtonInteraction): Promise<void> {
  const tok = interaction.customId.split(":")[2] ?? "";
  const s = sessions.get(tok);
  if (!s || s.userId !== interaction.user.id || !s.gif) {
    await interaction.reply({ content: "⌛ Nothing to send — pick an effect first, or run `/emojimoji` again.", flags: MessageFlags.Ephemeral });
    return;
  }
  const eff = EMOJI_EFFECTS.find((e) => e.id === s.effect);
  const channel = interaction.channel as TextBasedChannel | null;
  if (!channel || !("send" in channel)) {
    await interaction.reply({ content: "❌ I can't post here.", flags: MessageFlags.Ephemeral });
    return;
  }
  await interaction.deferUpdate();
  try {
    await channel.send({
      content: `${eff?.emoji ?? "🪄"} emojimoji by <@${interaction.user.id}>`,
      files: [new AttachmentBuilder(s.gif, { name: "emojimoji.gif" })],
    });
    await interaction.editReply({ content: "✅ Sent to the channel!", components: [], files: [] });
    sessions.delete(tok);
  } catch (err) {
    logger.error({ err }, "emojimoji: send failed");
    await interaction.editReply({ content: "❌ Couldn't post it — do I have permission to send here?" });
  }
}
