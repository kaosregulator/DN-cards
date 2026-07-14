// Operations Center — permission helpers.
// Reuses the same tiered admin check as the rest of the bot.

import { type GuildMember, PermissionFlagsBits } from "discord.js";
import { isAdmin } from "../db.js";

/**
 * Returns true if the member has operations-center admin rights.
 * Tier 1 — server owner
 * Tier 2 — Discord Administrator permission
 * Tier 3 — bot admin_users table entry
 */
export async function isOpsAdmin(guildId: string, member: GuildMember): Promise<boolean> {
  // Server owner always wins
  if (member.guild.ownerId === member.id) return true;

  // Native Discord administrator permission
  if (member.permissions.has(PermissionFlagsBits.Administrator)) return true;

  // Bot-managed admin list (same table used by /admin commands)
  return isAdmin(guildId, member.id);
}

/**
 * Returns true if the member can use the /support command.
 * Currently everyone can; hook here if you add approval modes later.
 */
export function canRequestOp(_guildId: string, _member: GuildMember): boolean {
  return true;
}
