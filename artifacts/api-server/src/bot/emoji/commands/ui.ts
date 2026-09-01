// ─────────────────────────────────────────────────────────────────────────────
// /emoji control panel.
//
// Every picker is built from the discovery manifest, so the panel shows exactly
// what MakeEmoji offers. Animation is *not* a truncated select of 25 — with
// ~473 styles that would hide most of the catalog. Instead a "Browse Styles"
// button opens the visual style browser (search, pages, favorites, CDN preview).
//
// Discord allows five action rows, so the panel keeps the last row for format
// and Done, and spends the rest on the most useful secondary controls.
// ─────────────────────────────────────────────────────────────────────────────

import {
  ActionRowBuilder, AttachmentBuilder, ButtonBuilder, ButtonStyle,
  ChannelSelectMenuBuilder, ChannelType,
  FileUploadBuilder, LabelBuilder, ModalBuilder,
  StringSelectMenuBuilder, StringSelectMenuOptionBuilder,
  TextInputBuilder, TextInputStyle, UserSelectMenuBuilder,
} from "discord.js";
import { getManifest } from "../providers/makeemoji/manifest.js";
import type { OptionKey } from "../providers/makeemoji/types.js";
import { FORMATS, extensionFor } from "../utils/options.js";
import type { EmojiSession } from "./session.js";

/**
 * Opening screen: what do you want to animate?
 *
 * This is the first thing `/emoji` shows. Three targets, each one click:
 *   • User   — a native member picker (defaults to the caller, picks anyone)
 *   • Image  — the Discord upload modal
 *   • Server — the guild's own icon
 *
 * Picking any of them loads the source and drops straight into the style
 * browser, so the whole flow is target → styles → generate with no menus in
 * between.
 */
export function buildTargetChooser(token: string) {
  const memberRow = new ActionRowBuilder<UserSelectMenuBuilder>().addComponents(
    new UserSelectMenuBuilder()
      .setCustomId(cid("pick_user", token))
      .setPlaceholder("👤 Animate a member — pick anyone (default: you)")
      .setMinValues(1)
      .setMaxValues(1),
  );

  const otherRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(cid("pick_me", token))
      .setLabel("My avatar")
      .setEmoji("🙂")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(cid("upload", token))
      .setLabel("Upload image")
      .setEmoji("🖼️")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(cid("pick_server", token))
      .setLabel("Server icon")
      .setEmoji("🏠")
      .setStyle(ButtonStyle.Secondary),
  );

  return {
    content: [
      "## 🎨 Make an emoji",
      "**What do you want to animate?**",
      "-# Pick a member below, or use your own avatar, an uploaded image, or this server's icon.",
    ].join("\n"),
    embeds: [],
    files: [],
    components: [memberRow, otherRow] as unknown as ActionRowBuilder<never>[],
  };
}

/** customId namespace. One router owns every id starting with this. */
export const CID = "emoji";

/** Discord's cap on options in one select menu. */
const MAX_SELECT_OPTIONS = 25;

/** Rows available for secondary options: five total, minus styles + format rows. */
const MAX_OPTION_ROWS = 3;

/**
 * Secondary panel options — animation is handled by the style browser, so it is
 * intentionally absent here.
 */
const PANEL_OPTIONS: readonly OptionKey[] = [
  "speed", "direction", "size", "quality", "color", "platform",
];

const LABELS: Record<OptionKey, string> = {
  animation: "Animation", speed: "Speed", direction: "Direction", size: "Size",
  color: "Colour", format: "Format", quality: "Quality", platform: "Platform",
};

export function cid(action: string, token: string): string {
  return `${CID}:${action}:${token}`;
}

/** Parse a namespaced customId. Returns null when it isn't ours. */
export function parseCid(customId: string): { action: string; token: string } | null {
  const parts = customId.split(":");
  if (parts.length !== 3 || parts[0] !== CID) return null;
  return { action: parts[1]!, token: parts[2]! };
}

/** Current value of one manifest-driven setting on a session. */
function currentValue(session: EmojiSession, key: OptionKey): string | undefined {
  switch (key) {
    case "animation": return session.animation;
    case "speed": return session.speed;
    case "direction": return session.direction;
    case "size": return session.size;
    case "color": return session.color;
    case "quality": return session.quality;
    case "platform": return session.platform;
    case "format": return session.format;
  }
}

/**
 * A select row for one option, or null when it can't be rendered as one.
 *
 * Free-text and slider controls have no list to show, so they are left to the
 * slash-command option rather than faked as a dropdown.
 */
function optionRow(
  session: EmojiSession, token: string, key: OptionKey,
): ActionRowBuilder<StringSelectMenuBuilder> | null {
  const control = getManifest().manifest?.controls[key];
  if (!control || control.values.length === 0) return null;
  if (control.kind === "text" || control.kind === "range") return null;

  const selected = currentValue(session, key);
  const values = control.values.slice(0, MAX_SELECT_OPTIONS);

  const menu = new StringSelectMenuBuilder()
    .setCustomId(cid(`set_${key}`, token))
    .setPlaceholder(LABELS[key])
    .addOptions(values.map(v =>
      new StringSelectMenuOptionBuilder()
        .setLabel(`${LABELS[key]} — ${(v.label ?? v.value)}`.slice(0, 100))
        .setValue(v.value.slice(0, 100))
        .setDefault(v.value === selected),
    ));

  return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu);
}

/** Friendly label for the currently applied animation. */
function animationLabel(session: EmojiSession): string {
  const values = getManifest().manifest?.controls.animation?.values ?? [];
  const hit = values.find(v => v.value === session.animation);
  return (hit?.label && hit.label.trim()) || session.animation;
}

function stylesRow(session: EmojiSession, token: string): ActionRowBuilder<ButtonBuilder> {
  const label = animationLabel(session);
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(cid("styles", token))
      .setLabel(`Browse styles — ${label}`.slice(0, 80))
      .setEmoji("🎨")
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(cid("upload", token))
      .setLabel("Upload")
      .setEmoji("📎")
      .setStyle(ButtonStyle.Secondary),
    // Target switches share this row rather than taking one of their own: the
    // panel is already at Discord's five-row limit.
    new ButtonBuilder()
      .setCustomId(cid("target_server", token))
      .setLabel("Server icon")
      .setEmoji("🏠")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(cid("target_me", token))
      .setLabel("My avatar")
      .setEmoji("🙂")
      .setStyle(ButtonStyle.Secondary),
  );
}

/** Modal with Discord's native file-upload control — swap the source mid-session. */
export function buildUploadModal(token: string): ModalBuilder {
  return new ModalBuilder()
    .setCustomId(cid("upload_modal", token))
    .setTitle("Upload an image")
    .addLabelComponents(
      new LabelBuilder()
        .setLabel("Image to animate")
        .setDescription("Pick a PNG, JPG, GIF, or WebP from Discord")
        .setFileUploadComponent(
          new FileUploadBuilder()
            .setCustomId("image")
            .setRequired(true)
            .setMinValues(1)
            .setMaxValues(1),
        ),
    );
}

function actionsRow(session: EmojiSession, token: string): ActionRowBuilder<ButtonBuilder> {
  const formatButtons = FORMATS.map(f =>
    new ButtonBuilder()
      .setCustomId(cid(`format_${f}`, token))
      .setLabel(f.toUpperCase())
      .setStyle(f === session.format ? ButtonStyle.Primary : ButtonStyle.Secondary),
  );

  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    ...formatButtons,
    new ButtonBuilder()
      .setCustomId(cid("post", token))
      .setLabel("Post")
      .setEmoji("📤")
      // Nothing to post until a generation has succeeded.
      .setDisabled(!session.lastResult)
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(cid("done", token))
      .setLabel("Done")
      .setEmoji("✅")
      .setStyle(ButtonStyle.Success),
  );
}

/**
 * Channel picker for sending the finished emoji somewhere.
 *
 * A separate view rather than another row: the control panel already uses all
 * five Discord allows.
 */
export function buildPostPicker(session: EmojiSession, token: string) {
  const picker = new ChannelSelectMenuBuilder()
    .setCustomId(cid("post_pick", token))
    .setPlaceholder("Choose a channel to post it in")
    .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement, ChannelType.PublicThread);

  const back = new ButtonBuilder()
    .setCustomId(cid("post_back", token))
    .setLabel("Back")
    .setEmoji("◀️")
    .setStyle(ButtonStyle.Secondary);

  const size = session.lastResult ? `${(session.lastResult.bytes / 1024).toFixed(1)} KB` : "";
  return {
    content: `📤 **Post this emoji** — ${size}\n-# Or just save the image above; it's a normal attachment.`,
    components: [
      new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(picker),
      new ActionRowBuilder<ButtonBuilder>().addComponents(back),
    ] as unknown as ActionRowBuilder<never>[],
  };
}

/** The full control panel for a session. */
export function buildControls(session: EmojiSession, token: string): ActionRowBuilder<never>[] {
  const rows: ActionRowBuilder<never>[] = [];

  rows.push(stylesRow(session, token) as unknown as ActionRowBuilder<never>);

  for (const key of PANEL_OPTIONS) {
    if (rows.length >= 1 + MAX_OPTION_ROWS) break;
    const row = optionRow(session, token, key);
    if (row) rows.push(row as unknown as ActionRowBuilder<never>);
  }

  rows.push(actionsRow(session, token) as unknown as ActionRowBuilder<never>);
  return rows;
}

/** Rebuild the controls message from a cached generation (no provider call). */
export function buildCachedControlsReply(session: EmojiSession, token: string) {
  const result = session.lastResult;
  if (!result) return null;

  const file = new AttachmentBuilder(result.buffer, { name: `emoji.${extensionFor(result.format)}` });
  const sourceLabel = session.sourceLabel ?? "your image";
  const lines = [
    describe(session, result.bytes, result.providerId, result.cached),
    `-# from ${sourceLabel}`,
  ];
  if (/avatar/i.test(sourceLabel)) {
    lines.push("-# Tip: tap **Upload** to animate your own image, or **Server icon** for this server's picture.");
  }
  // Point users at MakeEmoji's Colour side-control (image-only animation).
  const anim = session.animation ?? "";
  const isNone = /^(gen_btn_)?none$/i.test(anim);
  if (!session.color || session.color === "Normal") {
    lines.push("-# Tip: set **Colour** (e.g. Colors / Rainbow / Stripes) to animate the image itself — works with style **none** or any style.");
  } else if (isNone) {
    lines.push("-# Colour-only mode (style none) — pick a style anytime to layer motion on top.");
  }
  return {
    content: lines.join("\n"),
    embeds: [],
    files: [file],
    components: buildControls(session, token),
  };
}

/** One-line summary of the current settings, shown above the preview. */
export function describe(
  session: EmojiSession, bytes: number, providerId: string, cached: boolean,
): string {
  const parts = [`✨ **${animationLabel(session)}**`, `\`${session.format.toUpperCase()}\``];

  for (const key of ["speed", "direction", "size", "quality", "color", "platform"] as const) {
    const value = currentValue(session, key);
    if (value) parts.push(`\`${value}\``);
  }

  parts.push(`\`${(bytes / 1024).toFixed(1)} KB\``);
  // The offline engine is the normal generator now, so its output carries no
  // warning. `providerId` stays available in logs for diagnostics.
  void providerId;
  if (cached) parts.push("♻️");

  return parts.join(" · ");
}

/**
 * Modal for the Server target.
 *
 * Blank uses the current server's icon; a pasted server ID fetches that guild's
 * icon instead (the bot must be a member of it). This is what lets someone
 * animate any server's picture, not just the one they ran the command in.
 */
export function buildServerModal(token: string): ModalBuilder {
  return new ModalBuilder()
    .setCustomId(cid("server_modal", token))
    .setTitle("Animate a server icon")
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId("server_id")
          .setLabel("Server ID (leave empty for this server)")
          .setStyle(TextInputStyle.Short)
          .setRequired(false)
          .setMinLength(0)
          .setMaxLength(25),
      ),
    );
}
