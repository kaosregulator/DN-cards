// ─────────────────────────────────────────────────────────────────────────────
// Target resolution — "what do you want to animate?"
//
// The whole point is that the target is the USER'S emoji, whatever it is. This
// turns each way of naming one into a fetchable image URL that loadSource (the
// shared SSRF-guarded fetch + normalise) then turns into bytes:
//
//   • a custom Discord emoji — <:name:id> / <a:name:id> / a raw id — resolved
//     through the public emoji CDN, so it works even for an emoji from a server
//     the bot isn't in (the priority case)
//   • any Unicode emoji — 😀🐹💎 — via Noto's static PNG for that codepoint
//   • a member avatar, this server's icon, an uploaded image, or a URL — exactly
//     as /emoji already resolves them
//
// Nothing here fetches: it only builds a Source. loadSource does the network.
// ─────────────────────────────────────────────────────────────────────────────

import type { ChatInputCommandInteraction } from "discord.js";
import { EmojiError } from "../../utils/errors.js";

/** Avatars/icons are fetched large so there's detail before downscaling. */
const AVATAR_SIZE = 256;

export interface Target {
  url: string;
  label: string;
}

/** Discord custom-emoji mention: <:name:id> or <a:name:id>. */
const CUSTOM_EMOJI = /^<(a)?:(\w{2,32}):(\d{15,25})>$/;
/** A bare custom-emoji id someone pasted. */
const BARE_ID = /^(\d{15,25})$/;

/** cdn URL for a custom emoji id. Always request PNG for a clean still to warp. */
export function customEmojiUrl(id: string): string {
  return `https://cdn.discordapp.com/emojis/${id}.png?size=${AVATAR_SIZE}`;
}

/**
 * Codepoint path for a Unicode emoji, the way Noto names its assets: lowercase
 * hex codepoints joined by "_", with the VS16 (fe0f) presentation selector
 * dropped (Noto omits it). Returns null when the string isn't emoji-like.
 */
export function notoCodepoint(input: string): string | null {
  const cps: string[] = [];
  for (const ch of input) {
    const cp = ch.codePointAt(0);
    if (cp === undefined) continue;
    if (cp === 0xfe0f) continue; // variation selector-16
    // Skip plain ASCII / whitespace — not an emoji.
    if (cp <= 0x7f) return null;
    cps.push(cp.toString(16));
  }
  return cps.length ? cps.join("_") : null;
}

/** Noto static PNG for a Unicode emoji. */
export function unicodeEmojiUrl(codepoint: string): string {
  return `https://fonts.gstatic.com/s/e/notoemoji/latest/${codepoint}/512.png`;
}

/**
 * Parse the free-text `emoji` option into a Source. Recognises a custom-emoji
 * mention, a bare id, or a Unicode emoji. Throws a clean error otherwise.
 */
export function targetFromEmojiString(raw: string): Target {
  const value = raw.trim();

  const custom = CUSTOM_EMOJI.exec(value);
  if (custom) {
    const [, , name, id] = custom;
    return { url: customEmojiUrl(id!), label: `:${name}:` };
  }
  if (BARE_ID.test(value)) {
    return { url: customEmojiUrl(value), label: "that emoji" };
  }

  const cp = notoCodepoint(value);
  if (cp) {
    return { url: unicodeEmojiUrl(cp), label: value };
  }

  throw new EmojiError(
    "no_source",
    "That doesn't look like an emoji. Paste a custom emoji (like `:pepe:`), any emoji (😀🐹💎), or upload an image.",
  );
}

/** The guild's own icon, or null when unset. */
function serverIcon(interaction: ChatInputCommandInteraction): Target | null {
  const guild = interaction.guild;
  const url = guild?.iconURL({ extension: "png", size: AVATAR_SIZE });
  return url ? { url, label: `${guild!.name}'s icon` } : null;
}

/**
 * Resolve the target in priority order: an explicit emoji string, an attachment,
 * a named member's avatar, the server icon, a URL, then the caller's own avatar
 * so the command always has something to animate.
 */
export function resolveTarget(interaction: ChatInputCommandInteraction): Target {
  const emoji = interaction.options.getString("emoji")?.trim();
  if (emoji) return targetFromEmojiString(emoji);

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

  if (interaction.options.getBoolean("server")) {
    const icon = serverIcon(interaction);
    if (!icon) throw new EmojiError("no_source", "This server doesn't have an icon set.");
    return icon;
  }

  const url = interaction.options.getString("url");
  if (url) return { url: url.trim(), label: "your link" };

  return {
    url: interaction.user.displayAvatarURL({ extension: "png", size: AVATAR_SIZE }),
    label: "your avatar",
  };
}

/** Whether any target-selecting option was supplied on the command. */
export function hasNamedTarget(interaction: ChatInputCommandInteraction): boolean {
  return Boolean(
    interaction.options.getString("emoji")
    || interaction.options.getAttachment("image")
    || interaction.options.getUser("user")
    || interaction.options.getString("url")
    || interaction.options.getBoolean("server"),
  );
}
