import {
  PermissionFlagsBits, type GuildMember,
} from "discord.js";
import { isAdmin } from "../db.js";
import { getQuietSettings } from "./models.js";
import type { QuietTheme } from "./quotes.js";

// ─────────────────────────────────────────────────────────────────────────────
// Quiet Mode — shared brand, access wall, helpers.
//
// Roles are NEVER added/removed for Quiet Mode. Channel isolation uses member
// permission overwrites only (see permissions.ts).
// ─────────────────────────────────────────────────────────────────────────────

export const QUIET_BRAND = {
  COLOR: 0x1b2838,       // deep night blue-slate (not purple)
  COLOR_SOFT: 0x3d5a4c,  // muted forest
  COLOR_WARM: 0xc4a35a,  // soft amber accent
  COLOR_OK: 0x6b8f71,    // calm green
  FOOTER: "Quiet Room • Disappear without leaving",
} as const;

export const QUIET_EMOJI = {
  MOON: "🌙",
  SUN: "🌤️",
  MIC: "🎙️",
  THOUGHT: "💭",
  LOCK: "🔒",
} as const;

/** Button / select customId namespace. */
export const QUIET_CUSTOM = {
  READY: "quiet:ready",
} as const;

export function isStaffMember(member: GuildMember): boolean {
  if (member.guild.ownerId === member.id) return true;
  if (member.permissions.has(PermissionFlagsBits.Administrator)) return true;
  if (member.permissions.has(PermissionFlagsBits.ManageGuild)) return true;
  return false;
}

/** Async staff check that also honors DB admin_users. */
export async function isQuietStaff(member: GuildMember): Promise<boolean> {
  if (isStaffMember(member)) return true;
  return isAdmin(member.guild.id, member.id);
}

/**
 * Who may self-enter Quiet Mode:
 *  - feature enabled
 *  - not on blacklist role (unless staff)
 *  - if whitelist role set → must hold it (staff always allowed)
 */
export async function canSelfQuiet(member: GuildMember): Promise<{ ok: boolean; reason?: string }> {
  const settings = await getQuietSettings(member.guild.id);
  if (!settings.enabled) {
    return { ok: false, reason: "Quiet Mode is turned off in this server." };
  }

  const staff = await isQuietStaff(member);
  if (staff) return { ok: true };

  if (settings.blacklistRoleId && member.roles.cache.has(settings.blacklistRoleId)) {
    return { ok: false, reason: "Your role isn't allowed to use Quiet Mode here." };
  }
  if (settings.whitelistRoleId && !member.roles.cache.has(settings.whitelistRoleId)) {
    return {
      ok: false,
      reason: "Quiet Mode is limited to a specific role in this server. Ask staff if you need access.",
    };
  }
  return { ok: true };
}

export function formatDurationLabel(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  if (m <= 0) return `${s}s`;
  if (s === 0) return `${m}:00`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function normalizeTheme(raw: string | null | undefined): QuietTheme | null {
  if (!raw) return null;
  const t = raw.toLowerCase().trim();
  const allowed = new Set([
    "general", "think", "encouragement", "support", "overwhelmed",
    "discord", "hope", "rest", "growth", "tomorrow", "kindness", "calm",
  ]);
  return allowed.has(t) ? (t as QuietTheme) : null;
}
