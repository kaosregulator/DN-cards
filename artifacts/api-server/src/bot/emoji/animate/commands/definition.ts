// ─────────────────────────────────────────────────────────────────────────────
// /animate slash-command definition.
//
// A NEW command that adds to /emoji without touching it. It stays option-light:
// everything can be driven from the interactive panel it opens, but a few
// options let a power user go straight to renders — "target this emoji, make it
// yawn". Intensity is the one fixed choice (Subtle → INSANE); the rest resolve
// to the same panel controls.
// ─────────────────────────────────────────────────────────────────────────────

import { SlashCommandBuilder } from "discord.js";

export function buildAnimateCommandJson() {
  return new SlashCommandBuilder()
    .setName("animate")
    .setDescription("Animate any emoji — recompose real motion onto a custom emoji, photo, meme or avatar")
    .setDMPermission(false)
    .addStringOption(o => o
      .setName("emoji")
      .setDescription("Target: a custom emoji (:pepe:), any emoji (😀🐹💎), or leave blank to pick"))
    .addStringOption(o => o
      .setName("describe")
      .setDescription("What should it do? e.g. yawning, yelling, crying, laughing, nodding"))
    .addStringOption(o => o
      .setName("intensity")
      .setDescription("How strong? (default: Normal)")
      .addChoices(
        { name: "🍃 Subtle", value: "subtle" },
        { name: "🙂 Normal", value: "normal" },
        { name: "🔥 Dramatic", value: "dramatic" },
        { name: "💥 INSANE", value: "insane" },
      ))
    .addUserOption(o => o.setName("user").setDescription("Animate a member's avatar instead"))
    .addAttachmentOption(o => o.setName("image").setDescription("Animate an uploaded image"))
    .addStringOption(o => o.setName("url").setDescription("Animate an image from a link"))
    .addBooleanOption(o => o.setName("server").setDescription("Animate this server's icon"))
    .toJSON();
}
