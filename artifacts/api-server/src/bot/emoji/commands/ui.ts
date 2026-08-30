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
  FileUploadBuilder, LabelBuilder, ModalBuilder,
  StringSelectMenuBuilder, StringSelectMenuOptionBuilder,
} from "discord.js";
import { getManifest } from "../providers/makeemoji/manifest.js";
import type { OptionKey } from "../providers/makeemoji/types.js";
import { FORMATS } from "../utils/options.js";
import type { EmojiSession } from "./session.js";

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
      .setLabel("Upload image")
      .setEmoji("📎")
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
      .setCustomId(cid("done", token))
      .setLabel("Done")
      .setEmoji("✅")
      .setStyle(ButtonStyle.Success),
  );
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

  const file = new AttachmentBuilder(result.buffer, { name: `emoji.${result.format}` });
  const lines = [
    describe(session, result.bytes, result.providerId, result.cached),
    `-# from ${session.sourceLabel}`,
  ];
  if (/avatar/i.test(session.sourceLabel)) {
    lines.push("-# Tip: tap **Upload image** to animate a Discord attachment instead of an avatar.");
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
  // Naming the source matters when a fallback served the request: the user
  // should know when they didn't get MakeEmoji's own output.
  if (providerId !== "makeemoji-api" && providerId !== "makeemoji-browser") {
    parts.push(`⚠️ via \`${providerId}\``);
  }
  if (cached) parts.push("♻️");

  return parts.join(" · ");
}
