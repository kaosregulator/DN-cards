// ─────────────────────────────────────────────────────────────────────────────
// /emoji slash-command definition.
//
// Intentionally option-free: `/emoji` opens an interactive dashboard where the
// target, style and every setting are chosen with buttons and menus. Keeping the
// slash surface bare makes the entry point obvious and moves all the controls to
// where they belong — inside the flow.
// ─────────────────────────────────────────────────────────────────────────────

import { SlashCommandBuilder } from "discord.js";

/** `/emoji` — consumed by commands/register.ts. */
export function buildEmojiCommandJson() {
  // Deliberately option-free. Everything — target, style, size, speed, format —
  // is chosen in the interactive dashboard the command opens, so the slash
  // surface stays a single, obvious entry point.
  return new SlashCommandBuilder()
    .setName("emoji")
    .setDescription("Make an animated emoji from any avatar, image, or server icon")
    .setDMPermission(false)
    .toJSON();
}
