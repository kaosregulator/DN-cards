// ─────────────────────────────────────────────────────────────────────────────
// World Builder admin gate — reuse Discord bot admin_users + Administrator.
// Demo / local open mode for Cursor Cloud & ?demo without Discord OAuth.
// ─────────────────────────────────────────────────────────────────────────────

import type { Request } from "express";
import { isAdmin } from "../db.js";
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

export async function canEditWorld(
  userId: string | null,
  opts?: { discordAdmin?: boolean },
): Promise<boolean> {
  if (worldBuilderOpenMode()) return true;
  if (!userId || !HOME_GUILD_ID) return false;
  if (opts?.discordAdmin) return true;
  return isAdmin(HOME_GUILD_ID, userId);
}

/** Header used by local demo harness (no Discord token). */
export function isDemoBuilderRequest(req: Request): boolean {
  return req.header("x-world-builder-demo") === "1" && worldBuilderOpenMode();
}
