// ─────────────────────────────────────────────────────────────────────────────
// Experience presentation resolution.
//
// GAME LOGIC ≠ RENDERER. Each experience (HQ / Battle / Raid / Packs) produces
// authoritative state; HOW it is shown is a per-guild admin choice with a
// primary mode and a fallback. This module is the single place that knows the
// allowed modes, the labels, and how to resolve the effective presentation —
// used by both the `/config` UI and the feature commands.
// ─────────────────────────────────────────────────────────────────────────────

import {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags,
  type MessageComponentInteraction,
} from "discord.js";
import type { GuildSettings } from "@workspace/db";
import { resolvedEnv, resolvedHttpUrl } from "../lib/runtime-env.js";

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
    // Headquarters is a Discord-native experience only. The old HQ Phaser
    // Activity was removed, so "activity" is intentionally NOT an option here —
    // /hq renders as a Discord PNG/embed hub and never launches the Activity.
    key: "hq", label: "Headquarters", emoji: "🏰",
    modes: ["discord_png", "disabled"],
    primaryField: "hqPresentation", fallbackField: "hqFallback",
  },
  {
    // Battle IS the Live Activity — launching it opens the walkable world +
    // real duel. This is the only experience that maps to the Phaser Activity.
    key: "battle", label: "Battles", emoji: "⚔️",
    modes: ["activity", "discord_embed", "discord_png", "disabled"],
    primaryField: "battlePresentation", fallbackField: "battleFallback",
  },
  {
    // Raids and Pack openings have no dedicated scene in the Activity (it only
    // hosts the world + duel). "activity" is intentionally omitted so their
    // launch buttons never open the wrong scene — they stay Discord-native.
    key: "raid", label: "Raids", emoji: "🐉",
    modes: ["discord_embed", "discord_png", "disabled"],
    primaryField: "raidPresentation", fallbackField: "raidFallback",
  },
  {
    key: "pack", label: "Pack Openings", emoji: "🎁",
    modes: ["animated_image", "discord_embed", "disabled"],
    primaryField: "packPresentation", fallbackField: "packFallback",
  },
];

export function experienceByKey(key: string): ExperienceMeta | undefined {
  return EXPERIENCES.find((e) => e.key === key);
}

export function getPrimary(settings: GuildSettings, key: ExperienceKey): PresentationMode {
  const meta = experienceByKey(key)!;
  const v = settings[meta.primaryField] as PresentationMode;
  if (meta.modes.includes(v)) return v;
  // Default when the stored value isn't valid for this experience (e.g. a guild
  // that had HQ set to the now-removed "activity"): the first non-activity mode.
  return meta.modes.find((m) => m !== "activity") ?? "disabled";
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

/**
 * Can this deployment offer the Live Activity at all? Native in-Discord launch
 * needs only the Discord app (Activities enabled on it in the Developer Portal —
 * which we can't introspect here), so the env gate is just the client id.
 * ACTIVITY_URL is the optional browser fallback, not a requirement.
 */
export function activityConfigured(): boolean {
  return resolvedEnv("DISCORD_CLIENT_ID") !== null;
}

/** The Activity launch URL, if configured (used by feature commands' buttons). */
export function activityUrl(): string | null {
  return resolvedHttpUrl("ACTIVITY_URL");
}

// custom_id prefix for the NATIVE launch button. Clicking it makes the bot
// respond with Discord's LAUNCH_ACTIVITY callback, which opens the Activity in
// the current TEXT-CHANNEL context — no voice channel, no browser.
export const LAUNCH_PREFIX = "explaunch";

/**
 * A "launch the Live Activity" button row for a feature command — returned ONLY
 * when the guild set that experience to `activity` AND the app is configured.
 * Null otherwise, so callers render nothing and their existing (fallback)
 * presentation stands untouched. Kept as its own row/message so it never
 * collides with a hub's own component rows.
 *
 * PRIMARY = a native custom_id button → `interaction.launchActivity()` (opens
 * inside Discord from the text channel). SECONDARY (optional) = a plain URL
 * link, shown only when ACTIVITY_URL is set, as a browser fallback.
 */
export function experienceLaunchRow(
  settings: GuildSettings, key: ExperienceKey,
): ActionRowBuilder<ButtonBuilder> | null {
  // Headquarters has no Live Activity anymore (the old HQ Phaser game was
  // removed) — /hq is a Discord-only hub, so never offer an Activity launch.
  if (key === "hq") return null;
  // Native launch only needs the Discord app (Activities enabled on it); it does
  // NOT require ACTIVITY_URL — that's just the browser fallback.
  if (getPrimary(settings, key) !== "activity") return null;
  if (!activityConfigured()) return null;
  const meta = experienceByKey(key)!;

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setStyle(ButtonStyle.Primary)
      .setCustomId(`${LAUNCH_PREFIX}:${key}`)
      .setEmoji("🎮")
      .setLabel(`Open Live ${meta.label}`),
  );

  // Optional browser fallback link (kept if useful; never the primary path).
  const url = activityUrl();
  if (url) {
    const u = new URL(url);
    u.searchParams.set("exp", key);
    row.addComponents(
      new ButtonBuilder().setStyle(ButtonStyle.Link).setURL(u.toString()).setLabel("Open in browser"),
    );
  }
  return row;
}

/**
 * Handle a click on the native launch button: respond with Discord's
 * LAUNCH_ACTIVITY callback so the Activity opens in the text-channel context.
 * If the app doesn't have Activities enabled (or the SDK/host can't launch), we
 * degrade gracefully to an ephemeral message pointing at the browser fallback.
 */
export async function handleExperienceLaunch(interaction: MessageComponentInteraction): Promise<void> {
  try {
    await interaction.launchActivity();
  } catch {
    const url = activityUrl();
    await interaction.reply({
      content: url
        ? `🎮 Couldn't open the in-Discord Activity here. You can open it in a browser instead: ${url}`
        : "🎮 The Live Activity isn't available right now. Your server's fallback presentation still works.",
      flags: MessageFlags.Ephemeral,
    }).catch(() => {});
  }
}
