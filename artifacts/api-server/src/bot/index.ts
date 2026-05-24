import { Client, GatewayIntentBits, Partials, Events, REST, Routes, type Interaction } from "discord.js";
import { logger } from "../lib/logger.js";
import { seedDefaultCards, burnCard, getOrCreateCurrency } from "./db.js";
import { initSpawnManager, initAllGuilds, handleCatchAttempt, scheduleNextSpawn } from "./spawn-manager.js";
import { checkAchievements, formatUnlockLine } from "./achievements.js";
import type { TextChannel } from "discord.js";
import { handleAdminCommand } from "./commands/admin.js";
import { handleUserCommand } from "./commands/user.js";
import { handlePrefixCommand } from "./commands/prefix.js";
import { handleWizardStep } from "./commands/setup-wizard.js";
import { handleCardWizardStep, handleCardEditStep } from "./commands/card-wizard.js";
import { handleLoadSet, handleUnloadSet, handleListSets } from "./commands/cardset.js";
import { handleAutocomplete } from "./commands/autocomplete.js";
import {
  buildCommands, USER_COMMAND_NAMES, ADMIN_COMMAND_NAMES, CARDSET_COMMAND_NAMES,
} from "./commands/register.js";
import { MessageFlags } from "discord.js";

export async function startBot() {
  const token = process.env["DISCORD_BOT_TOKEN"];
  if (!token) { logger.error("DISCORD_BOT_TOKEN not set — bot will not start."); return; }

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
    await registerCommands(c.user.id, token, client);
  });

  client.on(Events.GuildCreate, async (guild) => {
    logger.info({ guildId: guild.id, name: guild.name }, "Bot joined guild");
    scheduleNextSpawn(guild.id);
    const rest = new REST().setToken(token);
    await rest
      .put(Routes.applicationGuildCommands(client.user!.id, guild.id), { body: buildCommands() })
      .catch(err => logger.error({ err, guildId: guild.id }, "Failed to register guild commands on join"));
  });

  // ── Interactions: slash commands + buttons ────────────────────────────────
  client.on(Events.InteractionCreate, async (interaction: Interaction) => {
    try {
      // ── Autocomplete (card / set suggestions as user types) ───────────────
      if (interaction.isAutocomplete()) {
        await handleAutocomplete(interaction);
        return;
      }

      // ── Button interactions ────────────────────────────────────────────────
      if (interaction.isButton()) {
        const parts = interaction.customId.split(":");
        const action = parts[0];

        if (action === "catch_burn" || action === "catch_keep") {
          const [, guildId, userId, cardIdStr] = parts;
          const cardId = parseInt(cardIdStr, 10);

          if (interaction.user.id !== userId) {
            await interaction.reply({
              content: "❌ These buttons are only for the player who caught this card.",
              flags: MessageFlags.Ephemeral,
            });
            return;
          }

          if (action === "catch_burn") {
            const result = await burnCard(guildId, userId, cardId);
            if (!result.success) {
              await interaction.reply({
                content: "❌ Couldn't burn the card — it may have already been burned.",
                flags: MessageFlags.Ephemeral,
              });
              return;
            }
            const currency = await getOrCreateCurrency(guildId, userId);
            // Public message: generic, no balance leak
            await interaction.message.edit({
              content: `🔥 <@${userId}> burned the card.`,
              components: [],
            }).catch(() => { /* may be deleted */ });
            // Private confirmation with full shard balance
            await interaction.reply({
              content:
                `🔥 Card burned! You received 💠 **${result.shardsGained.toLocaleString()} shards**.\n` +
                `New balance: **${currency.shards.toLocaleString()}** 💠 — check \`/shards\` anytime.`,
              flags: MessageFlags.Ephemeral,
            });
            // Achievement check (e.g. Pyromaniac)
            const burnUnlocks = await checkAchievements(guildId, userId).catch(() => []);
            if (burnUnlocks.length > 0) {
              await interaction.followUp({
                content: "🏆 **Achievement unlocked!**\n" + burnUnlocks.map(formatUnlockLine).join("\n"),
                flags: MessageFlags.Ephemeral,
              }).catch(() => { /* ignore */ });
            }
          } else {
            await interaction.message.edit({
              content: `💾 <@${userId}> kept the card.`,
              components: [],
            }).catch(() => { /* may be deleted */ });
            await interaction.reply({
              content: "💾 Kept! The card is in your collection — use `/collection` to view it.",
              flags: MessageFlags.Ephemeral,
            });
          }
        }
        return;
      }

      // ── Slash commands ─────────────────────────────────────────────────────
      if (!interaction.isChatInputCommand()) return;
      const cmd = interaction.commandName;

      if (USER_COMMAND_NAMES.has(cmd)) {
        await handleUserCommand(interaction, cmd);
      } else if (ADMIN_COMMAND_NAMES.has(cmd)) {
        await handleAdminCommand(interaction, cmd);
      } else if (CARDSET_COMMAND_NAMES.has(cmd)) {
        if (cmd === "loadset") await handleLoadSet(interaction);
        else if (cmd === "unloadset") await handleUnloadSet(interaction);
        else if (cmd === "listsets") await handleListSets(interaction);
      }
    } catch (err) {
      logger.error({ err }, "Interaction error");
      try {
        const msg = "❌ Something went wrong. Please try again.";
        if ("deferred" in interaction && interaction.deferred) {
          await (interaction as any).editReply(msg);
        } else if ("replied" in interaction && !(interaction as any).replied) {
          await (interaction as any).reply({ content: msg, flags: MessageFlags.Ephemeral });
        }
      } catch { /* ignore */ }
    }
  });

  // ── Messages: prefix commands → setup wizard → card wizard → catch ────────
  client.on(Events.MessageCreate, async (msg) => {
    if (msg.author.bot || !msg.guild) return;
    const content = msg.content.trim();

    // ! prefix commands (admin setup and config)
    if (content.startsWith("!")) {
      await handlePrefixCommand(msg).catch(err => logger.error({ err }, "Prefix command error"));
      return;
    }

    // Setup wizard step responses
    const setupConsumed = await handleWizardStep(msg).catch(() => false);
    if (setupConsumed) return;

    // Card creation wizard step responses
    const cardConsumed = await handleCardWizardStep(msg).catch(() => false);
    if (cardConsumed) return;

    // Card edit wizard step responses
    const editConsumed = await handleCardEditStep(msg).catch(() => false);
    if (editConsumed) return;

    // Core card catch detection
    const caught = await handleCatchAttempt(msg.guild.id, msg.author.id, content).catch(err => {
      logger.error({ err }, "Catch attempt error");
      return false;
    });
    if (caught) {
      try { await msg.react("🎉"); } catch { /* ignore */ }
      const unlocked = await checkAchievements(msg.guild.id, msg.author.id).catch(() => []);
      if (unlocked.length > 0) {
        const ch = msg.channel as TextChannel;
        await ch.send({
          content:
            `🏆 <@${msg.author.id}> unlocked **${unlocked.length}** achievement` +
            `${unlocked.length === 1 ? "" : "s"}!\n` +
            unlocked.map(formatUnlockLine).join("\n"),
        }).catch(() => { /* ignore */ });
      }
    }
  });

  await client.login(token).catch(err => {
    logger.error({ err }, "Failed to login — check DISCORD_BOT_TOKEN");
  });
}

// ── Register: clear globals, register guild-only (instant, no propagation lag) ──
async function registerCommands(appId: string, token: string, client: Client) {
  const rest = new REST().setToken(token);
  const commands = buildCommands();

  // Wipe ALL global commands — eliminates any old /card or duplicated globals
  await rest
    .put(Routes.applicationCommands(appId), { body: [] })
    .then(() => logger.info("Global slash commands cleared"))
    .catch(err => logger.error({ err }, "Failed to clear global commands"));

  // Register guild-specific only — instant effect, no 1-hour propagation
  for (const [, guild] of client.guilds.cache) {
    await rest
      .put(Routes.applicationGuildCommands(appId, guild.id), { body: commands })
      .then(() => logger.info({ guildId: guild.id }, "Guild slash commands registered"))
      .catch(err => logger.error({ err, guildId: guild.id }, "Guild command registration failed"));
  }
}
