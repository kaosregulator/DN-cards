// ─────────────────────────────────────────────────────────────────────────────
// /emoji control panel.
//
// Every picker is built from the discovery manifest, so the panel shows exactly
// what MakeEmoji offers. An option the manifest doesn't describe gets no row at
// all — better a smaller panel than a control that silently does nothing.
//
// Discord allows five action rows, so the panel shows the manifest options that
// matter most (animation first) and always keeps the last row for format and
// Done.
// ─────────────────────────────────────────────────────────────────────────────

import {
  ActionRowBuilder, ButtonBuilder, ButtonStyle,
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

/** Rows available for manifest options: five total, minus the format/Done row. */
const MAX_OPTION_ROWS = 4;

/** Panel order — animation matters most, so it never gets cut. */
const PANEL_OPTIONS: readonly OptionKey[] = [
  "animation", "speed", "direction", "size", "quality", "color", "platform",
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

  for (const key of PANEL_OPTIONS) {
    if (rows.length >= MAX_OPTION_ROWS) break;
    const row = optionRow(session, token, key);
    if (row) rows.push(row as unknown as ActionRowBuilder<never>);
  }

  rows.push(actionsRow(session, token) as unknown as ActionRowBuilder<never>);
  return rows;
}

/** One-line summary of the current settings, shown above the preview. */
export function describe(
  session: EmojiSession, bytes: number, providerId: string, cached: boolean,
): string {
  const parts = [`✨ **${session.animation}**`, `\`${session.format.toUpperCase()}\``];

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
