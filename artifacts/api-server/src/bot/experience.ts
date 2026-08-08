// ─────────────────────────────────────────────────────────────────────────────
// Experience presentation resolution.
//
// GAME LOGIC ≠ RENDERER. Each experience (HQ / Battle / Raid / Packs) produces
// authoritative state; HOW it is shown is a per-guild admin choice with a
// primary mode and a fallback. This module is the single place that knows the
// allowed modes, the labels, and how to resolve the effective presentation —
// used by both the `/config` UI and the feature commands.
// ─────────────────────────────────────────────────────────────────────────────

import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from "discord.js";
import type { GuildSettings } from "@workspace/db";

export type PresentationMode =
  | "activity" | "discord_png" | "discord_embed" | "animated_image" | "disabled";

export type ExperienceKey = "hq" | "battle" | "raid" | "pack";

export interface ExperienceMeta {
  key: ExperienceKey;
  label: string;
  emoji: string;
  /** Modes an admin may pick for this experience (order = menu order). */
  modes: PresentationMode[];
  primaryField: keyof GuildSettings;
  fallbackField: keyof GuildSettings;
}

export const MODE_LABELS: Record<PresentationMode, string> = {
  activity: "🎮 Live Activity",
  discord_png: "🖼 Discord PNG",
  discord_embed: "📋 Discord Embed",
  animated_image: "✨ Animated Image",
  disabled: "🚫 Disabled",
};

export const EXPERIENCES: ExperienceMeta[] = [
  {
    key: "hq", label: "Headquarters", emoji: "🏰",
    modes: ["activity", "discord_png", "disabled"],
    primaryField: "hqPresentation", fallbackField: "hqFallback",
  },
  {
    key: "battle", label: "Battles", emoji: "⚔️",
    modes: ["activity", "discord_embed", "discord_png", "disabled"],
    primaryField: "battlePresentation", fallbackField: "battleFallback",
  },
  {
    key: "raid", label: "Raids", emoji: "🐉",
    modes: ["activity", "discord_embed", "discord_png", "disabled"],
    primaryField: "raidPresentation", fallbackField: "raidFallback",
  },
  {
    key: "pack", label: "Pack Openings", emoji: "🎁",
    modes: ["activity", "animated_image", "discord_embed", "disabled"],
    primaryField: "packPresentation", fallbackField: "packFallback",
  },
];

export function experienceByKey(key: string): ExperienceMeta | undefined {
  return EXPERIENCES.find((e) => e.key === key);
}

export function getPrimary(settings: GuildSettings, key: ExperienceKey): PresentationMode {
  const meta = experienceByKey(key)!;
  const v = settings[meta.primaryField] as PresentationMode;
  return meta.modes.includes(v) ? v : meta.modes[1] ?? "disabled";
}

export function getFallback(settings: GuildSettings, key: ExperienceKey): PresentationMode {
  const meta = experienceByKey(key)!;
  const v = settings[meta.fallbackField] as PresentationMode;
  // Fallback must never itself be "activity" (it's what we fall back FROM).
  if (v === "activity") return meta.modes.find((m) => m !== "activity" && m !== "disabled") ?? "disabled";
  return meta.modes.includes(v) ? v : "disabled";
}

/**
 * Resolve the mode to actually use right now. `activityAvailable` lets a command
 * degrade to the fallback when the Activity can't launch (env unset, etc.).
 */
export function resolvePresentation(
  settings: GuildSettings, key: ExperienceKey, activityAvailable: boolean,
): PresentationMode {
  const primary = getPrimary(settings, key);
  if (primary === "activity" && !activityAvailable) return getFallback(settings, key);
  return primary;
}

/** Is the Activity client configured for this deployment? (env gate) */
export function activityConfigured(): boolean {
  return !!(process.env["DISCORD_CLIENT_ID"]?.trim() && process.env["ACTIVITY_URL"]?.trim());
}

/** The Activity launch URL, if configured (used by feature commands' buttons). */
export function activityUrl(): string | null {
  return process.env["ACTIVITY_URL"]?.trim() || null;
}

/**
 * A "launch the Live Activity" button row for a feature command — returned ONLY
 * when the guild set that experience to `activity` AND the Activity is
 * configured. Null otherwise, so callers simply render nothing and their
 * existing (fallback) presentation stands untouched. Kept as its own row/message
 * so it never collides with a hub's own component rows.
 */
export function experienceLaunchRow(
  settings: GuildSettings, key: ExperienceKey,
): ActionRowBuilder<ButtonBuilder> | null {
  if (getPrimary(settings, key) !== "activity") return null;
  const url = activityUrl();
  if (!url || !process.env["DISCORD_CLIENT_ID"]?.trim()) return null;
  const meta = experienceByKey(key)!;
  let target = url;
  try {
    const u = new URL(url);
    u.searchParams.set("exp", key);
    target = u.toString();
  } catch { /* non-URL env value — use as-is */ }
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setStyle(ButtonStyle.Link)
      .setURL(target)
      .setEmoji("🎮")
      .setLabel(`Open Live ${meta.label}`),
  );
}
