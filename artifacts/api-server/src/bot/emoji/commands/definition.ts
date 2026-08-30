// ─────────────────────────────────────────────────────────────────────────────
// /emoji slash-command definition.
//
// The MakeEmoji settings are AUTOCOMPLETE options, not fixed choices. Fixed
// choices are baked into the command when it is registered with Discord, which
// would mean shipping a list of animation names — and we are not allowed to
// invent those. Autocomplete resolves against the discovery manifest at the
// moment the user types, so the menu always reflects what the site really offers
// and updates the instant a new manifest is dropped in.
//
// Only `format` is a fixed choice: the three containers are the integration's
// own contract, not a vocabulary read off the site.
// ─────────────────────────────────────────────────────────────────────────────

import { SlashCommandBuilder } from "discord.js";
import { FORMATS } from "../utils/options.js";

const FORMAT_LABELS: Record<string, string> = {
  gif: "GIF (animated, widest support)",
  webp: "WebP (animated, smaller files)",
  apng: "APNG (animated PNG, best quality)",
};

const FORMAT_CHOICES = FORMATS.map(f => ({
  name: FORMAT_LABELS[f] ?? f.toUpperCase(),
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
      .setDescription("Upload an image from Discord to animate"))
    .addUserOption(o => o
      .setName("user")
      .setDescription("Or use a member's avatar (defaults to yours)"))
    .addStringOption(o => o
      .setName("url")
      .setDescription("Or paste a public image URL"))
    .addStringOption(o => o
      .setName("animation")
      .setDescription("Animation to apply")
      .setAutocomplete(true))
    .addStringOption(o => o
      .setName("speed")
      .setDescription("Playback speed")
      .setAutocomplete(true))
    .addStringOption(o => o
      .setName("direction")
      .setDescription("Direction, for animations that travel or rotate")
      .setAutocomplete(true))
    .addStringOption(o => o
      .setName("size")
      .setDescription("Output size")
      .setAutocomplete(true))
    .addStringOption(o => o
      .setName("color")
      .setDescription("Colour modifier")
      .setAutocomplete(true))
    .addStringOption(o => o
      .setName("quality")
      .setDescription("Quality / compression")
      .setAutocomplete(true))
    .addStringOption(o => o
      .setName("platform")
      .setDescription("Platform preset")
      .setAutocomplete(true))
    .addStringOption(o => o
      .setName("format")
      .setDescription("Output format (default: GIF)")
      .addChoices(...FORMAT_CHOICES))
    .toJSON();
}
