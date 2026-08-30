// ─────────────────────────────────────────────────────────────────────────────
// /emoji component UI.
//
// Discord allows five action rows, which is exactly what this needs: one select
// each for effect, speed and direction, and a final row of buttons for size and
// format. Every control carries the session token in its customId, so a button
// on an old message still resolves to the right image (or fails cleanly once the
// session has expired).
//
// Direction is rendered disabled for effects that declare `directional: false`,
// rather than hidden — keeping the layout stable between effects means the
// controls don't jump around under the user's cursor.
// ─────────────────────────────────────────────────────────────────────────────

import {
  ActionRowBuilder, ButtonBuilder, ButtonStyle,
  StringSelectMenuBuilder, StringSelectMenuOptionBuilder,
} from "discord.js";
import { EFFECT_SUMMARIES, getEffect } from "../registry/index.js";
import { DIRECTIONS, FORMATS, SIZES, SPEEDS } from "../utils/options.js";
import type { EmojiSession } from "./session.js";

/** customId namespace. One router owns every id starting with this. */
export const CID = "emoji";

/** Build a namespaced customId: `emoji:<action>:<token>`. */
export function cid(action: string, token: string): string {
  return `${CID}:${action}:${token}`;
}

/** Parse a namespaced customId. Returns null when it isn't ours. */
export function parseCid(customId: string): { action: string; token: string } | null {
  const parts = customId.split(":");
  if (parts.length !== 3 || parts[0] !== CID) return null;
  return { action: parts[1]!, token: parts[2]! };
}

const SPEED_LABELS: Record<string, { label: string; emoji: string }> = {
  slow: { label: "Slow", emoji: "🐢" },
  normal: { label: "Normal", emoji: "🚶" },
  fast: { label: "Fast", emoji: "🏃" },
  turbo: { label: "Turbo", emoji: "🚀" },
};

const DIRECTION_LABELS: Record<string, { label: string; emoji: string }> = {
  right: { label: "Right", emoji: "➡️" },
  left: { label: "Left", emoji: "⬅️" },
  up: { label: "Up", emoji: "⬆️" },
  down: { label: "Down", emoji: "⬇️" },
};

function effectRow(session: EmojiSession, token: string): ActionRowBuilder<StringSelectMenuBuilder> {
  const menu = new StringSelectMenuBuilder()
    .setCustomId(cid("effect", token))
    .setPlaceholder("Choose an effect")
    .addOptions(
      EFFECT_SUMMARIES.map(e =>
        new StringSelectMenuOptionBuilder()
          .setLabel(e.name)
          .setValue(e.id)
          .setDescription(e.description.slice(0, 100))
          .setEmoji(e.emoji)
          .setDefault(e.id === session.effect),
      ),
    );
  return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu);
}

function speedRow(session: EmojiSession, token: string): ActionRowBuilder<StringSelectMenuBuilder> {
  const menu = new StringSelectMenuBuilder()
    .setCustomId(cid("speed", token))
    .setPlaceholder("Speed")
    .addOptions(
      SPEEDS.map(s =>
        new StringSelectMenuOptionBuilder()
          .setLabel(`Speed — ${SPEED_LABELS[s]!.label}`)
          .setValue(s)
          .setEmoji(SPEED_LABELS[s]!.emoji)
          .setDefault(s === session.speed),
      ),
    )
    // Speed only affects frame delay, which a still frame doesn't have.
    .setDisabled(session.format === "png");
  return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu);
}

function directionRow(session: EmojiSession, token: string): ActionRowBuilder<StringSelectMenuBuilder> {
  const directional = getEffect(session.effect)?.directional ?? false;
  const menu = new StringSelectMenuBuilder()
    .setCustomId(cid("direction", token))
    .setPlaceholder(directional ? "Direction" : "Direction — not used by this effect")
    .addOptions(
      DIRECTIONS.map(d =>
        new StringSelectMenuOptionBuilder()
          .setLabel(`Direction — ${DIRECTION_LABELS[d]!.label}`)
          .setValue(d)
          .setEmoji(DIRECTION_LABELS[d]!.emoji)
          .setDefault(d === session.direction),
      ),
    )
    .setDisabled(!directional || session.format === "png");
  return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu);
}

function sizeRow(session: EmojiSession, token: string): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    SIZES.map(s =>
      new ButtonBuilder()
        .setCustomId(cid(`size_${s}`, token))
        .setLabel(`${s}px`)
        .setStyle(s === session.size ? ButtonStyle.Primary : ButtonStyle.Secondary),
    ),
  );
}

function actionsRow(session: EmojiSession, token: string): ActionRowBuilder<ButtonBuilder> {
  const formatButtons = FORMATS.map(f =>
    new ButtonBuilder()
      .setCustomId(cid(`format_${f}`, token))
      .setLabel(f.toUpperCase())
      .setEmoji(f === "gif" ? "🎞️" : "🖼️")
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
  return [
    effectRow(session, token),
    speedRow(session, token),
    directionRow(session, token),
    sizeRow(session, token),
    actionsRow(session, token),
  ] as unknown as ActionRowBuilder<never>[];
}

/** One-line summary of the current settings, shown above the preview. */
export function describe(session: EmojiSession, bytes: number): string {
  const effect = getEffect(session.effect);
  const parts = [
    `${effect?.emoji ?? "✨"} **${effect?.name ?? session.effect}**`,
    `\`${session.size}px\``,
    `\`${session.format.toUpperCase()}\``,
  ];
  if (session.format === "gif") {
    parts.push(`\`${session.speed}\``);
    if (effect?.directional) parts.push(`\`${session.direction}\``);
  }
  parts.push(`\`${(bytes / 1024).toFixed(1)} KB\``);
  return parts.join(" · ");
}
