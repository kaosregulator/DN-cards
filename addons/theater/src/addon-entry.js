// ============================================================================
//  addon-entry.js — DN-Cards ⇄ DarkNight Theater integration entrypoint
//
//  This file is ADDITIVE. It does not modify any existing Theater module; it
//  only wires the Theater's own building blocks (its interaction router, its
//  Express web server, its WebSocket sync) into an already-running host bot
//  (DN-Cards) so the whole feature runs in-process WITHOUT a second bot login.
//
//  Why in-process: a Discord Activity belongs to ONE application/bot token, so
//  the Theater must share the host bot's gateway connection. We attach an extra
//  interactionCreate listener that ONLY handles Theater-owned interactions and
//  no-ops on everything else, leaving every DN-Cards handler untouched.
//
//  Why its own web server (not mounted on the host Express app): the host runs
//  Express 5 and owns "/api"; the Theater targets Express 4 route semantics and
//  also serves "/api", "/media", "/ws", etc. at the root. To preserve the
//  Theater EXACTLY as it ships, we spin up its own Express 4 app + HTTP server
//  on its own port here (resolved from this file's own node_modules), so there
//  are no route collisions and no path-to-regexp differences to work around.
//
//  Home-guild safeguard: Theater slash commands are registered to the home
//  guild only (see the host-side hook). If a Theater interaction somehow arrives
//  from any other guild, we reply with a safe-guard notice instead of running.
// ============================================================================

import http from 'node:http';
import express from 'express'; // resolves to the addon's OWN Express 4
import { Events } from 'discord.js';
import { setDiscordClient } from './bot/clientRef.js';
import { routeInteraction } from './bot/handlers/index.js';
import { wireControlPanelRefresh } from './bot/handlers/theater.js';
import { mountTheater } from './web/server.js';
import { attachWebSocket } from './web/ws.js';
import { THEATER_COMMAND_NAMES, THEATER_CUSTOMID_PREFIXES } from './plugin.js';
import { syncLibrary } from './services/library-store.js';
import { log } from './logger.js';

function safeguardMessage(homeGuildId) {
  return (
    '🎬 **DarkNight Theater is only available in its home server.**\n' +
    'This add-on is registered to the home guild' +
    (homeGuildId ? ` (\`${homeGuildId}\`)` : '') +
    ' and cannot be used here.'
  );
}

// Does this interaction belong to the Theater feature? (command name or the
// custom-id prefixes the Theater owns). Anything else is left for the host bot.
function ownsInteraction(interaction) {
  try {
    if (interaction.isChatInputCommand?.()) {
      return THEATER_COMMAND_NAMES.includes(interaction.commandName);
    }
    const id = interaction.customId;
    if (typeof id === 'string') {
      return THEATER_CUSTOMID_PREFIXES.some((p) => id.startsWith(p));
    }
  } catch {
    /* ignore */
  }
  return false;
}

/**
 * Start the Theater add-on against an EXISTING host discord.js client.
 *
 * @param {object}   opts
 * @param {import('discord.js').Client} opts.client        the host bot client (shared)
 * @param {number}   opts.port          port for the Theater's own web server
 * @param {string}   [opts.homeGuildId] restrict Theater commands to this guild
 * @returns {Promise<{ app: import('express').Express, server: import('node:http').Server }>}
 */
export async function startTheaterAddon({ client, port, homeGuildId } = {}) {
  if (!client) throw new Error('startTheaterAddon: a host client is required');

  // Let the Theater web layer (the /host "start party" endpoint) post control
  // panels and create Activity invites using the SAME bot client.
  setDiscordClient(client);

  // Extra, non-destructive interaction listener. It ignores anything the
  // Theater doesn't own, so all DN-Cards handlers keep running unchanged.
  client.on(Events.InteractionCreate, async (interaction) => {
    if (!ownsInteraction(interaction)) return;

    // Home-guild safeguard for the case where the commands are visible from
    // another server (e.g. if an operator ever registered them globally).
    if (homeGuildId && interaction.guildId && interaction.guildId !== homeGuildId) {
      try {
        if (interaction.isRepliable?.() && !interaction.replied && !interaction.deferred) {
          await interaction.reply({ content: safeguardMessage(homeGuildId), ephemeral: true });
        }
      } catch {
        /* ignore */
      }
      return;
    }

    return routeInteraction(interaction);
  });

  // Keep the live control panel in sync (Theater's own wiring).
  if (client.isReady?.()) wireControlPanelRefresh();
  else client.once(Events.ClientReady, () => wireControlPanelRefresh());

  // The Theater's own web server (Activity + API + WS sync + host uploader) on
  // its own port, using its own Express 4 — mounted exactly as it ships.
  const app = express();
  mountTheater(app);
  const server = http.createServer(app);
  attachWebSocket(server);

  await new Promise((resolve) => {
    server.listen(port, () => {
      log.info(`🎬 DarkNight Theater add-on web listening on :${port}`);
      resolve();
    });
  });

  // Scan the media folder on boot so dropped-in files are ready immediately.
  syncLibrary().catch((err) => log.warn('Theater initial media scan skipped:', err?.message ?? err));

  return { app, server };
}
