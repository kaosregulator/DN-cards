import { Client, GatewayIntentBits, Partials, Events } from "discord.js";
import { logger } from "../lib/logger.js";
import { seedDefaultCards } from "./db.js";
import { initSpawnManager, initAllGuilds, handleCatchAttempt, scheduleNextSpawn } from "./spawn-manager.js";
import { handleAdminCommand } from "./commands/admin.js";
import { handleUserCommand } from "./commands/user.js";

const ADMIN_SUBCOMMANDS = new Set([
  "setchannel", "setinterval", "setwindow", "enable", "disable",
  "drop", "addcard", "removecard", "addadmin", "removeadmin",
  "listadmins", "settings",
]);

export async function startBot() {
  const token = process.env["DISCORD_BOT_TOKEN"];
  if (!token) {
    logger.error("DISCORD_BOT_TOKEN not set — bot will not start.");
    return;
  }

  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
      GatewayIntentBits.GuildMembers,
    ],
    partials: [Partials.Channel],
  });

  initSpawnManager(client);

  client.once(Events.ClientReady, async (c) => {
    logger.info({ tag: c.user.tag }, "Discord bot ready");
    await seedDefaultCards();
    await initAllGuilds(client);
  });

  client.on(Events.GuildCreate, async (guild) => {
    logger.info({ guildId: guild.id, name: guild.name }, "Bot joined a new guild");
    scheduleNextSpawn(guild.id);
  });

  client.on(Events.MessageCreate, async (msg) => {
    if (msg.author.bot) return;
    if (!msg.guild) return;

    const content = msg.content.trim();

    // ── Bot commands (prefix: !card) ──────────────────────────────────────────
    if (content.toLowerCase().startsWith("!card")) {
      const args = content.slice("!card".length).trim().split(/\s+/).filter(Boolean);
      const sub = args[0]?.toLowerCase() ?? "";

      if (ADMIN_SUBCOMMANDS.has(sub) || sub === "admin") {
        // Strip "admin" keyword if used as a prefix e.g. "!card admin drop"
        const adminArgs = sub === "admin" ? args.slice(1) : args;
        await handleAdminCommand(msg, adminArgs).catch(err =>
          logger.error({ err }, "Admin command error"),
        );
      } else {
        await handleUserCommand(msg, args).catch(err =>
          logger.error({ err }, "User command error"),
        );
      }
      return;
    }

    // ── Catch attempt — any non-command message in any channel ────────────────
    const caught = await handleCatchAttempt(msg.guild.id, msg.author.id, content).catch(
      (err) => { logger.error({ err }, "Catch attempt error"); return false; },
    );

    if (caught) {
      // Reply handled inside spawn-manager; optionally react
      try { await msg.react("🎉"); } catch { /* ignore */ }
    }
  });

  try {
    await client.login(token);
  } catch (err) {
    logger.error({ err }, "Failed to log in to Discord — check DISCORD_BOT_TOKEN");
  }
}
