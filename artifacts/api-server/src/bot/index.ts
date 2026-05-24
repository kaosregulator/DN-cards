import { Client, GatewayIntentBits, Partials, Events, REST, Routes, type Interaction } from "discord.js";
import { logger } from "../lib/logger.js";
import { seedDefaultCards, burnCard, getOrCreateCurrency } from "./db.js";
import { initSpawnManager, initAllGuilds, handleCatchAttempt, handleClaimButtonClick, scheduleNextSpawn, buildPostDecisionEmbed } from "./spawn-manager.js";
import { handleConfigButton, handleConfigSelect } from "./commands/config-panel.js";
import { checkAchievements, formatUnlockLine } from "./achievements.js";
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

      // ── String select menus (config panel) ─────────────────────────────────
      if (interaction.isStringSelectMenu()) {
        if (interaction.customId.startsWith("config_")) {
          await handleConfigSelect(interaction);
        }
        return;
      }

      // ── Button interactions ────────────────────────────────────────────────
      if (interaction.isButton()) {
        const parts = interaction.customId.split(":");
        const action = parts[0];

        // ── Config panel buttons (toggle, channel set) ─────────────────────
        if (action === "config") {
          await handleConfigButton(interaction);
          return;
        }

        // ── Spawn Claim button (button/both catch mode) ────────────────────
        if (action === "spawn_claim") {
          const [, guildId, spawnId] = parts;
          const result = await handleClaimButtonClick(guildId, spawnId, interaction.user.id);
          if (!result.ok) {
            // self_already = the user who just won is clicking again
            // (double-tap, both-mode type+click race). Silently ack so
            // we don't tell the winner the spawn "expired".
            if (result.reason === "self_already") {
              await interaction.deferUpdate().catch(() => { /* ignore */ });
              return;
            }
            const reasonMsg =
              result.reason === "already_caught" ? "⚡ Too slow! Someone already claimed this card."
              : result.reason === "expired" ? "⏰ That spawn has expired."
              : "❌ This button isn't active right now.";
            await interaction.reply({ content: reasonMsg, flags: MessageFlags.Ephemeral }).catch(() => { /* ignore */ });
          } else {
            await interaction.reply({
              content: `🎯 You claimed it! Check the spawn message for **Burn / Keep / Trade** options.`,
              flags: MessageFlags.Ephemeral,
            }).catch(() => { /* ignore */ });
            const unlocked = await checkAchievements(guildId, interaction.user.id).catch(() => []);
            if (unlocked.length > 0) {
              await interaction.followUp({
                content: "🏆 **Achievement unlocked!**\n" + unlocked.map(formatUnlockLine).join("\n"),
                flags: MessageFlags.Ephemeral,
              }).catch(() => { /* ignore */ });
            }
          }
          return;
        }

        // Spacer buttons are disabled, but Discord may still send a click if
        // the client gets out of sync — silently ack.
        if (action === "spawn_spacer") {
          await interaction.deferUpdate().catch(() => { /* ignore */ });
          return;
        }

        // ── Trade Accept/Decline buttons ───────────────────────────────────
        if (action === "trade_accept" || action === "trade_decline") {
          const tradeId = parseInt(parts[1], 10);
          const { handleTradeButton } = await import("./commands/trading.js");
          await handleTradeButton(interaction, action === "trade_accept" ? "accept" : "decline", tradeId);
          return;
        }

        if (action === "catch_burn" || action === "catch_keep" || action === "catch_trade") {
          const [, guildId, userId, cardIdStr] = parts;
          const cardId = parseInt(cardIdStr, 10);

          if (interaction.user.id !== userId) {
            await interaction.reply({
              content: "❌ These buttons are only for the player who caught this card.",
              flags: MessageFlags.Ephemeral,
            });
            return;
          }

          // Look up the card name for any public announcement.
          const { getAllCards } = await import("./db.js");
          const allCards = await getAllCards();
          const card = allCards.find(c => c.id === cardId);
          const cardName = card?.name ?? "the card";

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
            // Update the spawn embed to show the burn state in-channel.
            const burnedEmbed = await buildPostDecisionEmbed(cardId, userId, "burned");
            if (burnedEmbed) {
              await interaction.message.edit({ embeds: [burnedEmbed], components: [] }).catch(() => { /* may be deleted */ });
            }
            // Private confirmation with full shard balance
            await interaction.reply({
              content:
                `🔥 Card burned! You received 💠 **${result.shardsGained.toLocaleString()} shards**.\n` +
                `New balance: **${currency.shards.toLocaleString()}** 💠 — check \`/shards\` anytime.`,
              flags: MessageFlags.Ephemeral,
            });
            const burnUnlocks = await checkAchievements(guildId, userId).catch(() => []);
            if (burnUnlocks.length > 0) {
              await interaction.followUp({
                content: "🏆 **Achievement unlocked!**\n" + burnUnlocks.map(formatUnlockLine).join("\n"),
                flags: MessageFlags.Ephemeral,
              }).catch(() => { /* ignore */ });
            }
          } else if (action === "catch_keep") {
            const keptEmbed = await buildPostDecisionEmbed(cardId, userId, "kept");
            if (keptEmbed) {
              await interaction.message.edit({ embeds: [keptEmbed], components: [] }).catch(() => { /* may be deleted */ });
            }
            await interaction.reply({
              content: "💾 Kept! The card is in your collection — use `/collection` to view it.",
              flags: MessageFlags.Ephemeral,
            });
          } else {
            // catch_trade — card stays in collection; advertise it publicly
            const tradeEmbed = await buildPostDecisionEmbed(cardId, userId, "trade");
            if (tradeEmbed) {
              await interaction.message.edit({ embeds: [tradeEmbed], components: [] }).catch(() => { /* may be deleted */ });
            }
            await interaction.reply({
              content: `🔄 You're now open to trading **${cardName}**! Others can use /trade to make an offer.`,
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

    // Core card catch detection — pass Discord-stamped timestamp so the
    // spawn-manager can do lag-fair winner selection (earliest sent wins,
    // not earliest processed).
    const result = await handleCatchAttempt(
      msg.guild.id, msg.author.id, content, msg.createdTimestamp,
    ).catch(err => {
      logger.error({ err }, "Catch attempt error");
      return { matched: false, awaiting: false };
    });
    if (result.matched) {
      try { await msg.react("🎯"); } catch { /* ignore */ }
      // Winner is decided inside spawn-manager after a short grace window;
      // achievements for the typing winner are checked there too.
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
