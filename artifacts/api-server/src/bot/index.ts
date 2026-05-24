import { Client, GatewayIntentBits, Partials, Events, REST, Routes, type Interaction } from "discord.js";
import { logger } from "../lib/logger.js";
import { seedDefaultCards } from "./db.js";
import { initSpawnManager, initAllGuilds, handleCatchAttempt, scheduleNextSpawn } from "./spawn-manager.js";
import { handleAdminCommand } from "./commands/admin.js";
import { handleUserCommand } from "./commands/user.js";
import { buildCommands } from "./commands/register.js";

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

  // ── Register slash commands once ready ──────────────────────────────────────
  client.once(Events.ClientReady, async (c) => {
    logger.info({ tag: c.user.tag }, "DN Cards bot ready");
    await seedDefaultCards();
    await initAllGuilds(client);
    await registerCommands(c.user.id, token, client);
  });

  // ── New guild: register commands + schedule spawns ──────────────────────────
  client.on(Events.GuildCreate, async (guild) => {
    logger.info({ guildId: guild.id, name: guild.name }, "Bot joined guild");
    scheduleNextSpawn(guild.id);
    const rest = new REST().setToken(token);
    await rest
      .put(Routes.applicationGuildCommands(client.user!.id, guild.id), {
        body: buildCommands(),
      })
      .catch(err => logger.error({ err, guildId: guild.id }, "Failed to register guild commands"));
  });

  // ── Slash command handling ──────────────────────────────────────────────────
  client.on(Events.InteractionCreate, async (interaction: Interaction) => {
    if (!interaction.isChatInputCommand()) return;
    if (interaction.commandName !== "card") return;

    const subGroup = interaction.options.getSubcommandGroup(false);
    const sub = interaction.options.getSubcommand();

    try {
      if (subGroup === "admin") {
        await handleAdminCommand(interaction, sub);
      } else {
        await handleUserCommand(interaction, sub);
      }
    } catch (err) {
      logger.error({ err, sub, subGroup }, "Slash command error");
      try {
        const msg = "❌ Something went wrong. Please try again.";
        if (interaction.deferred || interaction.replied) {
          await interaction.editReply(msg);
        } else {
          await interaction.reply({ content: msg, ephemeral: true });
        }
      } catch { /* ignore */ }
    }
  });

  // ── Text catch detection (core mechanic — keep as text) ─────────────────────
  client.on(Events.MessageCreate, async (msg) => {
    if (msg.author.bot) return;
    if (!msg.guild) return;
    // Ignore anything that looks like a slash command or old prefix command
    const content = msg.content.trim();
    if (content.startsWith("/") || content.startsWith("!")) return;

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

// ── Register commands globally + per-guild for instant availability ───────────
async function registerCommands(appId: string, token: string, client: Client) {
  const rest = new REST().setToken(token);
  const commands = buildCommands();

  // Register globally (works in all guilds, may take up to 1h on first use)
  await rest
    .put(Routes.applicationCommands(appId), { body: commands })
    .then(() => logger.info("Global slash commands registered"))
    .catch(err => logger.error({ err }, "Global command registration failed"));

  // Also register per-guild for instant availability in current servers
  for (const [, guild] of client.guilds.cache) {
    await rest
      .put(Routes.applicationGuildCommands(appId, guild.id), { body: commands })
      .then(() => logger.info({ guildId: guild.id }, "Guild slash commands registered"))
      .catch(err => logger.error({ err, guildId: guild.id }, "Guild command registration failed"));
  }
}
