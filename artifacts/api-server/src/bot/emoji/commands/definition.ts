// ─────────────────────────────────────────────────────────────────────────────
// /emoji slash-command definition.
//
// The effect choices are generated from the registry rather than written out, so
// adding an effect surfaces it in the slash menu with no edit here. Discord caps
// a choice list at 25; the registry is asserted against that so an overflow
// fails loudly at startup instead of silently truncating the list.
// ─────────────────────────────────────────────────────────────────────────────

import { SlashCommandBuilder } from "discord.js";
import { EFFECT_SUMMARIES } from "../registry/index.js";
import { DIRECTIONS, FORMATS, SIZES, SPEEDS } from "../utils/options.js";

/** Discord's hard limit on choices for a single option. */
const MAX_CHOICES = 25;

if (EFFECT_SUMMARIES.length > MAX_CHOICES) {
  throw new Error(
    `Too many emoji effects for a slash-command choice list ` +
    `(${EFFECT_SUMMARIES.length} > ${MAX_CHOICES}). Switch the effect option to autocomplete.`,
  );
}

const EFFECT_CHOICES = EFFECT_SUMMARIES.map(e => ({
  name: `${e.emoji} ${e.name} — ${e.description}`.slice(0, 100),
  value: e.id,
}));

const SPEED_CHOICES = SPEEDS.map(s => ({
  name: s.charAt(0).toUpperCase() + s.slice(1),
  value: s,
}));

const DIRECTION_CHOICES = DIRECTIONS.map(d => ({
  name: d.charAt(0).toUpperCase() + d.slice(1),
  value: d,
}));

const SIZE_CHOICES = SIZES.map(s => ({
  name: `${s}×${s}`,
  value: String(s),
}));

const FORMAT_CHOICES = FORMATS.map(f => ({
  name: f === "gif" ? "GIF (animated)" : "PNG (still)",
  value: f,
}));

/** `/emoji` — consumed by commands/register.ts. */
export function buildEmojiCommandJson() {
  return new SlashCommandBuilder()
    .setName("emoji")
    .setDescription("Turn any image into an animated emoji")
    .setDMPermission(false)
    .addAttachmentOption(o => o
      .setName("image")
      .setDescription("The image to animate (defaults to your avatar)"))
    .addUserOption(o => o
      .setName("user")
      .setDescription("Use a member's avatar instead"))
    .addStringOption(o => o
      .setName("url")
      .setDescription("Or a public image URL"))
    .addStringOption(o => o
      .setName("effect")
      .setDescription("Animation to apply (default: shake)")
      .addChoices(...EFFECT_CHOICES))
    .addStringOption(o => o
      .setName("speed")
      .setDescription("Playback speed (default: normal)")
      .addChoices(...SPEED_CHOICES))
    .addStringOption(o => o
      .setName("direction")
      .setDescription("Direction, for effects that travel or rotate (default: right)")
      .addChoices(...DIRECTION_CHOICES))
    .addStringOption(o => o
      .setName("size")
      .setDescription("Emoji size in pixels (default: 128)")
      .addChoices(...SIZE_CHOICES))
    .addStringOption(o => o
      .setName("format")
      .setDescription("Output format (default: GIF)")
      .addChoices(...FORMAT_CHOICES))
    .toJSON();
}
