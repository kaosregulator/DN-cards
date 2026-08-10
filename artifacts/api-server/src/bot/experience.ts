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
  type MessageComponentInteraction, type ChatInputCommandInteraction,
} from "discord.js";
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

/**
 * Can this deployment offer the Live Activity at all? Native in-Discord launch
 * needs only the Discord app (Activities enabled on it in the Developer Portal —
 * which we can't introspect here), so the env gate is just the client id.
 * ACTIVITY_URL is the optional browser fallback, not a requirement.
 */
export function activityConfigured(): boolean {
  return !!process.env["DISCORD_CLIENT_ID"]?.trim();
}

/** The Activity launch URL, if configured (used by feature commands' buttons). */
export function activityUrl(): string | null {
  return process.env["ACTIVITY_URL"]?.trim() || null;
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
  // Native launch only needs the Discord app (Activities enabled on it); it does
  // NOT require ACTIVITY_URL — that's just the browser fallback.
  if (getPrimary(settings, key) !== "activity") return null;
  if (!process.env["DISCORD_CLIENT_ID"]?.trim()) return null;
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
    let target = url;
    try {
      const u = new URL(url);
      u.searchParams.set("exp", key);
      target = u.toString();
    } catch { /* non-URL env value — use as-is */ }
    row.addComponents(
      new ButtonBuilder().setStyle(ButtonStyle.Link).setURL(target).setLabel("Open in browser"),
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

/**
 * `/siege` — an UNCONDITIONAL Activity launcher used as a backup / diagnostic.
 *
 * Unlike the `/hq` launch button, this bypasses every gate — it does NOT read
 * `hqPresentation`, and it does NOT require DISCORD_CLIENT_ID to be set on the
 * bot. It simply asks Discord to open the Activity via the native LAUNCH_ACTIVITY
 * response. That isolates ONE question: can Discord open this app's Activity at
 * all? If this works but the `/hq` button never appears, the fault is the
 * per-guild presentation setting; if even this fails, the fault is the Discord
 * app's Activity configuration (Activities not enabled / no entry point), not
 * our command code.
 *
 * NOTE: `launchActivity()` IS the interaction response (callback type 12), so we
 * must NOT defer first — call it as the very first reply, then fall back to an
 * ephemeral message if the host refuses.
 */
export async function handleSiegeLaunchCommand(interaction: ChatInputCommandInteraction): Promise<void> {
  try {
    await interaction.launchActivity();
  } catch {
    const url = activityUrl();
    await interaction.reply({
      content: url
        ? `🎮 Couldn't open the in-Discord Activity. Open it in a browser instead: ${url}\n_(If this keeps failing, check that Activities are enabled for this app in the Discord Developer Portal.)_`
        : "🎮 The Live Activity couldn't launch. This usually means Activities aren't enabled for this app (Developer Portal → Activities → Settings → enable an entry point).",
      flags: MessageFlags.Ephemeral,
    }).catch(() => {});
  }
}
