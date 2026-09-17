import { db, setupTokensTable } from "@workspace/db";
import { randomBytes } from "node:crypto";
import { isHomeGuild } from "../bot/home-guild.js";
import { publicBaseUrl } from "./runtime-env.js";

// Generates a one-time setup URL the recipient can open in a browser to claim
// (or reset) a dashboard login. Used by the bot when joining a guild and by
// the /dashboard slash command.
export async function createSetupLink(opts: {
  discordUserId: string;
  guildId?: string | null;
  ttlHours?: number;
}): Promise<{ token: string; url: string; expiresAt: Date }> {
  if (opts.guildId && !isHomeGuild(opts.guildId)) {
    throw new Error("Dashboard setup links are only available for the home guild.");
  }
  const ttlMs = (opts.ttlHours ?? 24) * 60 * 60 * 1000;
  const token = randomBytes(24).toString("base64url");
  const expiresAt = new Date(Date.now() + ttlMs);
  await db.insert(setupTokensTable).values({
    token,
    issuedToDiscordId: opts.discordUserId,
    guildId: opts.guildId ?? null,
    expiresAt,
  });
  const base = publicBaseUrl("http://localhost");
  // Dashboard is served at /dashboard; the setup route lives under that prefix.
  return { token, url: `${base}/dashboard/setup/${token}`, expiresAt };
}
