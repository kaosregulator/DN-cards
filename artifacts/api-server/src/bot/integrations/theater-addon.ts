/**
 * theater-addon.ts — Host-side hook for the optional DarkNight Theater add-on.
 *
 * This is the ONLY place the DN-Cards bot knows about the Theater. Everything
 * here is:
 *   • Opt-in — the whole add-on is inert unless `THEATER_ADDON_ENABLED=1`.
 *   • Additive — no DN-Cards command, handler, DB, or route is changed.
 *   • Isolated — the add-on lives under `addons/theater/` with its OWN
 *     package.json / node_modules / build. It is imported at RUNTIME via a
 *     computed specifier so esbuild never bundles it into the api-server output
 *     (keeping the Theater's dependencies fully separate from the host's).
 *
 * When enabled, the add-on:
 *   1. registers its slash commands to the HOME GUILD ONLY (never globally), and
 *   2. runs the Theater's own web server + interaction handlers in-process,
 *      sharing the DN-Cards bot client (one bot token → one Activity).
 *
 * Enable it by setting, in the environment:
 *   THEATER_ADDON_ENABLED=1
 *   THEATER_PORT=8080                 # a publicly-exposed port for the Activity
 *   PUBLIC_BASE_URL / DISCORD_CLIENT_ID / DISCORD_CLIENT_SECRET / SESSION_SECRET
 *   MEDIA_DIR                         # see addons/theater/.env.example
 * plus the existing HOME_GUILD_ID (already set for DN-Cards).
 */
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { Client } from "discord.js";
import { logger } from "../../lib/logger.js";

export const THEATER_ADDON_ENABLED =
  process.env["THEATER_ADDON_ENABLED"] === "1";

// Absolute directory of the add-on. Overridable for non-standard layouts; by
// default it sits at <repo>/addons/theater and the server runs from the repo
// root (process.cwd()), matching the Replit/VM deployment.
function addonDir(): string {
  return (
    process.env["THEATER_ADDON_DIR"]?.trim() ||
    path.resolve(process.cwd(), "addons/theater")
  );
}

// Computed (non-literal) specifiers → esbuild leaves these as runtime imports
// instead of trying to bundle the add-on and its Express-4 dependency tree.
function fileUrl(rel: string): string {
  return pathToFileURL(path.join(addonDir(), rel)).href;
}

// Slash-command JSON the Theater owns. Loaded once and appended ONLY to the
// home guild's registration body (see commandsBodyForHomeGuild).
let cachedTheaterCommands: unknown[] = [];
let commandsLoaded = false;

/**
 * Preload the Theater slash-command definitions. Safe to call when disabled
 * (returns []). Call once before command registration.
 */
export async function loadTheaterCommands(): Promise<unknown[]> {
  if (!THEATER_ADDON_ENABLED) return [];
  if (commandsLoaded) return cachedTheaterCommands;
  try {
    const mod: { theaterCommands?: unknown[] } = await import(fileUrl("src/plugin.js"));
    cachedTheaterCommands = Array.isArray(mod.theaterCommands) ? mod.theaterCommands : [];
    commandsLoaded = true;
    logger.info(
      { count: cachedTheaterCommands.length },
      "Theater add-on: slash commands loaded (home-guild only)",
    );
  } catch (err) {
    logger.error({ err }, "Theater add-on: failed to load slash commands — DN-Cards unaffected");
    cachedTheaterCommands = [];
  }
  return cachedTheaterCommands;
}

/**
 * Given the base DN-Cards command body and the guild being registered, return
 * the body to actually PUT for that guild. Theater commands are appended ONLY
 * for the home guild; every other guild gets the untouched DN-Cards body.
 */
export function commandsBodyForGuild<T>(
  baseCommands: T[],
  guildId: string,
  homeGuildId: string | null,
): (T | unknown)[] {
  if (!THEATER_ADDON_ENABLED) return baseCommands;
  if (!homeGuildId || guildId !== homeGuildId) return baseCommands;
  return [...baseCommands, ...cachedTheaterCommands];
}

/**
 * Start the Theater add-on in-process against the shared host bot client.
 * No-op when disabled. Never throws into the caller — a Theater failure must
 * not affect DN-Cards.
 */
export async function startTheaterAddon(client: Client): Promise<void> {
  if (!THEATER_ADDON_ENABLED) return;
  try {
    const { HOME_GUILD_ID } = await import("../home-guild.js");
    const port = Number(process.env["THEATER_PORT"] ?? "8080");
    const mod: {
      startTheaterAddon: (opts: {
        client: Client;
        port: number;
        homeGuildId: string | null;
      }) => Promise<unknown>;
    } = await import(fileUrl("src/addon-entry.js"));
    await mod.startTheaterAddon({ client, port, homeGuildId: HOME_GUILD_ID });
    logger.info({ port, homeGuildId: HOME_GUILD_ID }, "DarkNight Theater add-on started");
  } catch (err) {
    logger.error({ err }, "Theater add-on failed to start — DN-Cards continues normally");
  }
}
