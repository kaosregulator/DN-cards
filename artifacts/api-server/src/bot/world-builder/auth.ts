// ─────────────────────────────────────────────────────────────────────────────
// World Builder admin gate — reuse Discord bot admin_users + Administrator.
// Demo / local open mode for Cursor Cloud & ?demo without Discord OAuth.
// ─────────────────────────────────────────────────────────────────────────────

import type { Request } from "express";
import { PermissionsBitField } from "discord.js";
import { isAdmin } from "../db.js";
import { getBotClient } from "../client-holder.js";
import { HOME_GUILD_ID } from "../home-guild.js";

/**
 * Open World Builder writes when:
 *  - WORLD_BUILDER_OPEN=1, or
 *  - NODE_ENV=development and WORLD_BUILDER_OPEN is not explicitly "0"
 *
 * Production Discord path still requires guild admin.
 */
export function worldBuilderOpenMode(): boolean {
  const flag = process.env["WORLD_BUILDER_OPEN"]?.trim();
  if (flag === "1" || flag === "true") return true;
  if (flag === "0" || flag === "false") return false;
  return process.env["NODE_ENV"] !== "production";
}

/**
 * True when the user owns the home guild or holds Discord's Administrator
 * permission there — the same "owner OR Administrator" acceptance every other
 * admin surface (setup wizard, config panel, …) already grants. The Activity's
 * /status endpoint has no interaction to read permissions from, so we resolve
 * them from the bot client (GuildMembers intent is enabled).
 */
export async function isHomeGuildDiscordAdmin(userId: string | null): Promise<boolean> {
  if (!userId || !HOME_GUILD_ID) return false;
  const guild = getBotClient()?.guilds.cache.get(HOME_GUILD_ID);
  if (!guild) return false;
  if (guild.ownerId === userId) return true;
  try {
    const member = guild.members.cache.get(userId) ?? await guild.members.fetch(userId);
    return member.permissions.has(PermissionsBitField.Flags.Administrator);
  } catch {
    return false; // user not in guild / fetch failed
  }
}

/** Precedence for World Builder edit access (pure — unit-tested). */
export function resolveCanEdit(flags: {
  openMode: boolean;
  discordAdminOverride?: boolean;
  isGuildOwnerOrAdmin: boolean;
  isDbAdmin: boolean;
}): boolean {
  if (flags.openMode) return true;
  if (flags.discordAdminOverride) return true;
  return flags.isGuildOwnerOrAdmin || flags.isDbAdmin;
}

export async function canEditWorld(
  userId: string | null,
  opts?: { discordAdmin?: boolean },
): Promise<boolean> {
  if (worldBuilderOpenMode()) return true;
  if (opts?.discordAdmin) return true;
  if (!userId) return false;
  // Accept home-guild owner / Discord Administrator OR an explicit admin_users
  // row — matching the rest of the app, not DB rows alone.
  const [ownerOrAdmin, dbAdmin] = await Promise.all([
    isHomeGuildDiscordAdmin(userId),
    HOME_GUILD_ID ? isAdmin(HOME_GUILD_ID, userId).catch(() => false) : Promise.resolve(false),
  ]);
  return resolveCanEdit({
    openMode: false,
    isGuildOwnerOrAdmin: ownerOrAdmin,
    isDbAdmin: dbAdmin,
  });
}

/** Header used by local demo harness (no Discord token). */
export function isDemoBuilderRequest(req: Request): boolean {
  return req.header("x-world-builder-demo") === "1" && worldBuilderOpenMode();
}
