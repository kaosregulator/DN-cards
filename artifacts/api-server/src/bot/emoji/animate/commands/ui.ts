// ─────────────────────────────────────────────────────────────────────────────
// /animate — Discord UI builders.
//
// Pure view functions: each returns { content, files, components } for one
// screen. All customIds are namespaced `animate:<action>:<token>[:extra]` so one
// router (animate.ts) owns every button, select and modal. The flow:
//
//   target → compose (pick a vibe / describe / custom pieces) → gallery (a few
//   renders to choose from) → finish (post / save) — with a Debug view that
//   shows what the detector found, so any custom emoji can be verified.
// ─────────────────────────────────────────────────────────────────────────────

import {
  ActionRowBuilder, AttachmentBuilder, ButtonBuilder, ButtonStyle, ModalBuilder,
  StringSelectMenuBuilder, TextInputBuilder, TextInputStyle, UserSelectMenuBuilder,
} from "discord.js";
import { GESTURES } from "../library/gestures.js";
import { INTENSITIES } from "../types.js";
import type { Intensity, MotionLibrary, Region } from "../types.js";
import { explain, credit } from "../engine/explain.js";
import type { AnimateSession } from "./session.js";

export const CID = "animate";

export function cid(action: string, token: string, extra?: string | number): string {
  return extra === undefined ? `${CID}:${action}:${token}` : `${CID}:${action}:${token}:${extra}`;
}

export function parseCid(customId: string): { action: string; token: string; extra?: string } | null {
  const parts = customId.split(":");
  if (parts.length < 3 || parts[0] !== CID) return null;
  return { action: parts[1]!, token: parts[2]!, extra: parts[3] };
}

const INTENSITY_META: Record<Intensity, { emoji: string; label: string }> = {
  subtle: { emoji: "🍃", label: "Subtle" },
  normal: { emoji: "🙂", label: "Normal" },
  dramatic: { emoji: "🔥", label: "Dramatic" },
  insane: { emoji: "💥", label: "INSANE" },
};

// ── shared rows ──────────────────────────────────────────────────────────────

function gestureRow(token: string): ActionRowBuilder<StringSelectMenuBuilder> {
  const menu = new StringSelectMenuBuilder()
    .setCustomId(cid("gesture", token))
    .setPlaceholder("🎭 Pick a vibe — or Describe your own below")
    .addOptions(GESTURES.slice(0, 25).map(g => ({
      label: g.name, value: g.id, emoji: g.emoji, description: `e.g. "${g.match[0] ?? g.name.toLowerCase()}"`.slice(0, 90),
    })));
  return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu);
}

function intensityRow(session: AnimateSession, token: string): ActionRowBuilder<StringSelectMenuBuilder> {
  const menu = new StringSelectMenuBuilder()
    .setCustomId(cid("intensity", token))
    .setPlaceholder("Intensity")
    .addOptions(INTENSITIES.map(i => ({
      label: INTENSITY_META[i].label, value: i, emoji: INTENSITY_META[i].emoji,
      default: session.intensity === i,
    })));
  return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu);
}

function detectionLine(session: AnimateSession): string {
  const f = session.features;
  if (!f) return "";
  if (f.confidence >= 0.28 && f.eyes.length) {
    return `-# 🔍 Detected: ${f.eyes.length} eye(s)${f.mouth ? " + mouth" : ""} on your target — motion will move those.`;
  }
  return "-# 🔍 No clear face detected — I'll animate the whole thing (bounce, spin, effects). Try **Debug** to see.";
}

// ── target chooser ─────────────────────────────────────────────────────────

export function buildTargetChooser(token: string) {
  const memberRow = new ActionRowBuilder<UserSelectMenuBuilder>().addComponents(
    new UserSelectMenuBuilder()
      .setCustomId(cid("pick_user", token))
      .setPlaceholder("👤 Animate a member's avatar")
      .setMinValues(1).setMaxValues(1),
  );
  const otherRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(cid("pick_me", token)).setLabel("My avatar").setEmoji("🙂").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(cid("upload", token)).setLabel("Upload image").setEmoji("🖼️").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(cid("pick_server", token)).setLabel("Server icon").setEmoji("🏠").setStyle(ButtonStyle.Secondary),
  );
  return {
    content: [
      "## 🎬 Animate an emoji",
      "**What do you want to animate?**",
      "-# Pick a member below, use your avatar, upload an image — or re-run `/animate emoji:` with a custom or Unicode emoji (😀🐹💎).",
    ].join("\n"),
    files: [] as AttachmentBuilder[],
    components: [memberRow, otherRow] as unknown as ActionRowBuilder<never>[],
  };
}

// ── compose screen ───────────────────────────────────────────────────────────

export function buildComposeScreen(session: AnimateSession, token: string) {
  const buttons = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(cid("describe", token)).setLabel("Describe…").setEmoji("✍️").setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(cid("pieces", token)).setLabel("Custom pieces").setEmoji("🧩").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(cid("debug", token)).setLabel("Debug").setEmoji("🔍").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(cid("target", token)).setLabel("Change target").setEmoji("🎯").setStyle(ButtonStyle.Secondary),
  );
  return {
    content: [
      `## 🎬 Animating **${session.sourceLabel ?? "your target"}**`,
      "Pick a vibe, or **Describe…** what it should do (yawning, yelling, crying, nodding…).",
      detectionLine(session),
    ].filter(Boolean).join("\n"),
    files: [] as AttachmentBuilder[],
    components: [gestureRow(token), intensityRow(session, token), buttons] as unknown as ActionRowBuilder<never>[],
  };
}

// ── candidate gallery ──────────────────────────────────────────────────────

export function buildGallery(session: AnimateSession, token: string) {
  const files = session.candidates.map((c, i) =>
    new AttachmentBuilder(c.buffer, { name: `take-${i + 1}.gif` }));

  const pickRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    session.candidates.slice(0, 5).map((c, i) =>
      new ButtonBuilder()
        .setCustomId(cid("pick", token, i))
        .setLabel(`${i + 1} · ${c.recipe.label}`.slice(0, 40))
        .setStyle(ButtonStyle.Primary)),
  );
  const actions = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(cid("more", token)).setLabel("More takes").setEmoji("🎲").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(cid("describe", token)).setLabel("Describe…").setEmoji("✍️").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(cid("pieces", token)).setLabel("Custom pieces").setEmoji("🧩").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(cid("target", token)).setLabel("Target").setEmoji("🎯").setStyle(ButtonStyle.Secondary),
  );

  const lines = [
    `## 🎬 ${session.candidates.length} take(s) — pick your favourite`,
    session.prompt ? `**“${session.prompt}”** · ${INTENSITY_META[session.intensity].emoji} ${INTENSITY_META[session.intensity].label}` : `${INTENSITY_META[session.intensity].emoji} ${INTENSITY_META[session.intensity].label}`,
    ...session.candidates.map((c, i) => `**${i + 1}.** ${explain(c.recipe)}${c.credit ? ` — -# ${c.credit}` : ""}`),
    detectionLine(session),
  ].filter(Boolean);

  return {
    content: lines.join("\n").slice(0, 1900),
    files,
    components: [pickRow, intensityRow(session, token), actions] as unknown as ActionRowBuilder<never>[],
  };
}

// ── finish ───────────────────────────────────────────────────────────────────

export function buildFinishScreen(session: AnimateSession, token: string) {
  const chosen = session.selected != null ? session.candidates[session.selected] : undefined;
  if (!chosen) {
    return { content: "✅ Done! Run `/animate` any time.", files: [] as AttachmentBuilder[], components: [] as ActionRowBuilder<never>[] };
  }
  const file = new AttachmentBuilder(chosen.buffer, { name: "animation.gif" });
  const kb = (chosen.bytes / 1024).toFixed(1);
  const over = chosen.bytes > 262_144;
  const lines = [
    "## ✅ Your animation is ready",
    `${explain(chosen.recipe)} · \`GIF\` · ${kb} KB`,
    chosen.credit ? `-# ${chosen.credit}` : "",
    "-# **Save:** tap the image → Save. **Share:** Post it below.",
    over ? "-# ⚠️ Over Discord's 256 KB custom-emoji limit — try a lower intensity or smaller size." : "",
  ].filter(Boolean);
  const actions = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(cid("post", token)).setLabel("Post to channel").setEmoji("📤").setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(cid("back", token)).setLabel("Back to takes").setEmoji("↩️").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(cid("pieces", token)).setLabel("Custom pieces").setEmoji("🧩").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(cid("dismiss", token)).setLabel("Dismiss").setEmoji("🗑️").setStyle(ButtonStyle.Secondary),
  );
  return { content: lines.join("\n"), files: [file], components: [actions] as unknown as ActionRowBuilder<never>[] };
}

// ── custom piece picker ───────────────────────────────────────────────────────

function trackSelect(
  lib: MotionLibrary, region: Region, token: string, current: string | undefined,
  placeholder: string, effectMulti = false,
): ActionRowBuilder<StringSelectMenuBuilder> {
  const tracks = lib.tracks.filter(t => t.region === region).slice(0, 24);
  const options = [
    { label: "— none —", value: "none", default: !current && !effectMulti },
    ...tracks.map(t => ({
      label: `${t.name}`.slice(0, 100), value: t.id, emoji: t.emoji,
      description: `${t.source.glyph} ${t.source.name}`.slice(0, 90),
      default: effectMulti ? undefined : current === t.id,
    })),
  ];
  const menu = new StringSelectMenuBuilder()
    .setCustomId(cid(effectMulti ? "pick_effect" : `pick_${region}`, token))
    .setPlaceholder(placeholder)
    .addOptions(options);
  if (effectMulti) menu.setMinValues(0).setMaxValues(Math.min(3, tracks.length || 1));
  return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu);
}

export function buildPiecePicker(session: AnimateSession, token: string, lib: MotionLibrary) {
  const rows = [
    trackSelect(lib, "global", token, session.picks.global, "🌀 Whole-emoji motion (bob, nod, shake, spin…)"),
    trackSelect(lib, "eyes", token, session.picks.eyes, "👀 Eyes (blink, wink, squint…)"),
    trackSelect(lib, "mouth", token, session.picks.mouth, "👄 Mouth (yawn, shout, grin…)"),
    trackSelect(lib, "effect", token, undefined, "✨ Effects (tears, sparkles, steam…)", true),
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(cid("render_custom", token)).setLabel("Render").setEmoji("🎬").setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(cid("compose", token)).setLabel("Back").setEmoji("↩️").setStyle(ButtonStyle.Secondary),
    ),
  ];
  return {
    content: [
      "## 🧩 Build it piece by piece",
      "Borrow each movement from a different source — eyes from one, mouth from another. Only bands your target actually has will move.",
      detectionLine(session),
    ].filter(Boolean).join("\n"),
    files: [] as AttachmentBuilder[],
    components: rows as unknown as ActionRowBuilder<never>[],
  };
}

// ── modals ─────────────────────────────────────────────────────────────────

export function buildDescribeModal(token: string, current: string): ModalBuilder {
  return new ModalBuilder()
    .setCustomId(cid("describe_submit", token))
    .setTitle("Describe the animation")
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId("prompt")
          .setLabel("What should it do?")
          .setPlaceholder("yawning · yelling · crying · nodding yes · blowing a kiss")
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setMaxLength(120)
          .setValue(current.slice(0, 120)),
      ),
    );
}

export { credit };
