import { Client, GatewayIntentBits, Partials, Events } from "discord.js";
import { logger } from "../lib/logger.js";
import { seedDefaultCards } from "./db.js";
import { initSpawnManager, initAllGuilds, handleCatchAttempt, scheduleNextSpawn } from "./spawn-manager.js";
import { handleAdminCommand } from "./commands/admin.js";
import { handleUserCommand } from "./commands/user.js";

// All commands that require admin auth
const ADMIN_SUBCOMMANDS = new Set([
  "setchannel", "setinterval", "setwindow", "enable", "disable",
  "drop", "addcard", "addlimited", "addevent", "give", "giveshards",
  "removecard", "addadmin", "removeadmin", "listadmins", "settings",
  "tradingenable", "tradingdisable", "settradechannel",
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
    logger.info({ tag: c.user.tag }, "DN Cards bot ready");
    await seedDefaultCards();
    await initAllGuilds(client);
  });

  client.on(Events.GuildCreate, async (guild) => {
    logger.info({ guildId: guild.id, name: guild.name }, "Bot joined guild");
    scheduleNextSpawn(guild.id);
  });

  client.on(Events.MessageCreate, async (msg) => {
    if (msg.author.bot) return;
    if (!msg.guild) return;

    const content = msg.content.trim();
    const lower = content.toLowerCase();

    // ── Command handling (prefix: !card) ──────────────────────────────────────
    if (lower.startsWith("!card")) {
      const args = content.slice("!card".length).trim().split(/\s+/).filter(Boolean);
      const sub = args[0]?.toLowerCase() ?? "";

      // Support "!card admin <subcmd>" as alias
      const effectiveArgs = sub === "admin" ? args.slice(1) : args;
      const effectiveSub = effectiveArgs[0]?.toLowerCase() ?? "";

      if (ADMIN_SUBCOMMANDS.has(sub) || sub === "admin") {
        await handleAdminCommand(msg, effectiveArgs).catch(err =>
          logger.error({ err }, "Admin command error"),
        );
      } else {
        await handleUserCommand(msg, args).catch(err =>
          logger.error({ err }, "User command error"),
        );
      }
      return;
    }

    // ── Catch attempt — any non-command message ───────────────────────────────
    const caught = await handleCatchAttempt(msg.guild.id, msg.author.id, content).catch(err => {
      logger.error({ err }, "Catch attempt error");
      return false;
    });
    if (caught) {
      try { await msg.react("🎉"); } catch { /* ignore */ }
    }
  });

  await client.login(token).catch(err => {
    logger.error({ err }, "Failed to login — check DISCORD_BOT_TOKEN");
  });
}
