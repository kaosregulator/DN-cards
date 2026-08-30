// ─────────────────────────────────────────────────────────────────────────────
// /emoji — turn any image into an animated Discord emoji.
//
// The command renders once immediately, then hands the user a live control panel
// they can keep adjusting: every change re-renders from the cached source, so
// tweaking speed or size costs one render rather than a fresh download.
//
// Two entry points, matching how index.ts routes interactions:
//   • handleEmojiCommand    — the slash command itself
//   • handleEmojiInteraction — every component whose customId starts `emoji:`
// ─────────────────────────────────────────────────────────────────────────────

import {
  AttachmentBuilder, MessageFlags,
  type ChatInputCommandInteraction, type Interaction,
  type MessageComponentInteraction,
} from "discord.js";
import { logger } from "../../../lib/logger.js";
import { DEFAULT_EFFECT, hasEffect } from "../registry/index.js";
import { renderEmoji } from "../renderer/render.js";
import { EmojiError, toEmojiError } from "../utils/errors.js";
import { loadSource } from "../utils/source.js";
import {
  DEFAULT_DIRECTION, DEFAULT_FORMAT, DEFAULT_SIZE, DEFAULT_SPEED,
  parseDirection, parseFormat, parseSize, parseSpeed,
} from "../utils/options.js";
import { buildControls, describe, parseCid } from "./ui.js";
import { createSession, endSession, getSession, touchSession, type EmojiSession } from "./session.js";

/** Discord rejects custom emoji uploads above 256 KB. */
const DISCORD_EMOJI_LIMIT = 256 * 1024;

/** Avatars are fetched at 512 so there is detail to work with before downscaling. */
const AVATAR_SIZE = 512;

/** Where the source image came from. */
interface Source { url: string; label: string }

/**
 * Pick the image to animate, in priority order: an explicit attachment, then a
 * named member's avatar, then a URL, and finally the caller's own avatar so the
 * command always does something useful even with no options at all.
 */
function resolveSource(interaction: ChatInputCommandInteraction): Source {
  const attachment = interaction.options.getAttachment("image");
  if (attachment) {
    const type = attachment.contentType?.toLowerCase() ?? "";
    if (type && !type.startsWith("image/")) {
      throw new EmojiError("not_an_image", "That attachment isn't an image.");
    }
    return { url: attachment.url, label: attachment.name ?? "your upload" };
  }

  const user = interaction.options.getUser("user");
  if (user) {
    return {
      url: user.displayAvatarURL({ extension: "png", size: AVATAR_SIZE }),
      label: `${user.username}'s avatar`,
    };
  }

  const url = interaction.options.getString("url");
  if (url) return { url: url.trim(), label: "your link" };

  return {
    url: interaction.user.displayAvatarURL({ extension: "png", size: AVATAR_SIZE }),
    label: "your avatar",
  };
}

/** Render the session's current settings into a Discord-ready message payload. */
async function buildReply(session: EmojiSession, token: string) {
  const result = await renderEmoji(session.image, {
    effect: session.effect,
    speed: session.speed,
    direction: session.direction,
    size: session.size,
    format: session.format,
  });

  const file = new AttachmentBuilder(result.buffer, { name: `emoji.${result.format}` });

  const lines = [describe(session, result.bytes), `-# from ${session.sourceLabel}`];
  if (result.bytes > DISCORD_EMOJI_LIMIT) {
    // Still send it — it's a perfectly good GIF, just not uploadable as a custom
    // emoji. Say so rather than silently handing over a file that will be
    // rejected at the point of use.
    lines.push(
      "-# ⚠️ Over Discord's 256 KB custom-emoji limit — try a smaller size or a slower speed.",
    );
  }

  return { content: lines.join("\n"), files: [file], components: buildControls(session, token) };
}

/** Turn any failure into a short, user-facing message. */
function failureMessage(err: unknown): string {
  const emojiError = toEmojiError(err);
  if (emojiError.code === "internal") {
    logger.error({ err }, "emoji render failed unexpectedly");
  }
  return `❌ ${emojiError.message}`;
}

export async function handleEmojiCommand(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply();

  try {
    const source = resolveSource(interaction);
    const image = await loadSource(source.url);

    const requestedEffect = interaction.options.getString("effect");
    const { token, session } = createSession({
      image,
      ownerId: interaction.user.id,
      sourceLabel: source.label,
      effect: requestedEffect && hasEffect(requestedEffect) ? requestedEffect : DEFAULT_EFFECT,
      speed: parseSpeed(interaction.options.getString("speed") ?? DEFAULT_SPEED),
      direction: parseDirection(interaction.options.getString("direction") ?? DEFAULT_DIRECTION),
      size: parseSize(interaction.options.getString("size") ?? DEFAULT_SIZE),
      format: parseFormat(interaction.options.getString("format") ?? DEFAULT_FORMAT),
    });

    await interaction.editReply(await buildReply(session, token));
  } catch (err) {
    await interaction.editReply({ content: failureMessage(err), files: [], components: [] });
  }
}

export async function handleEmojiInteraction(interaction: Interaction): Promise<void> {
  if (!interaction.isMessageComponent()) return;

  const parsed = parseCid(interaction.customId);
  if (!parsed) return;

  const { action, token } = parsed;
  const session = getSession(token);

  if (!session) {
    await interaction.reply({
      content: "⌛ That emoji session has expired. Run `/emoji` again to start a new one.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  // The controls belong to whoever ran the command. Anyone else gets a private
  // nudge rather than silently hijacking the render.
  if (interaction.user.id !== session.ownerId) {
    await interaction.reply({
      content: "🔒 These controls belong to whoever ran `/emoji`. Run your own to get a set!",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (action === "done") {
    endSession(token);
    await interaction.update({ components: [] });
    return;
  }

  const patch = patchFor(action, interaction);
  if (!patch) return;

  // Defer first: a render can outlast Discord's 3-second interaction window.
  await interaction.deferUpdate();

  const updated = touchSession(token, patch);
  if (!updated) return;

  try {
    await interaction.editReply(await buildReply(updated, token));
  } catch (err) {
    await interaction.editReply({ content: failureMessage(err), files: [], components: [] });
  }
}

/** Translate a control's customId action into a session patch. */
function patchFor(
  action: string,
  interaction: MessageComponentInteraction,
): Partial<EmojiSession> | null {
  if (interaction.isStringSelectMenu()) {
    const value = interaction.values[0];
    if (!value) return null;
    switch (action) {
      case "effect":
        return hasEffect(value) ? { effect: value } : null;
      case "speed": return { speed: parseSpeed(value) };
      case "direction": return { direction: parseDirection(value) };
      default: return null;
    }
  }

  if (interaction.isButton()) {
    if (action.startsWith("size_")) {
      return { size: parseSize(action.slice("size_".length)) };
    }
    if (action.startsWith("format_")) {
      return { format: parseFormat(action.slice("format_".length)) };
    }
  }

  return null;
}
