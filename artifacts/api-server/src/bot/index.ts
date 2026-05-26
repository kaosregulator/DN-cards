import { Client, GatewayIntentBits, Partials, Events, REST, Routes, type Interaction } from "discord.js";
import { logger } from "../lib/logger.js";
import { burnCard, getOrCreateCurrency } from "./db.js";
import { initSpawnManager, initAllGuilds, handleCatchAttempt, handleClaimButtonClick, scheduleNextSpawn, buildPostDecisionEmbed, buildDisabledDecisionRow } from "./spawn-manager.js";
import { handleConfigButton, handleConfigSelect, handleRatesSelect, handlePacksSelect } from "./commands/config-panel.js";
import { handleSetChannelsPick, handleSetChannelsApply } from "./commands/setchannels.js";
import { handleAdminHubButton, handleAdminHubModal } from "./commands/admin-hub.js";
import { checkAchievements, formatUnlockLine } from "./achievements.js";
import { handleAdminCommand } from "./commands/admin.js";
import { handleUserCommand } from "./commands/user.js";
import { handlePrefixCommand, getGuildPrefix } from "./commands/prefix.js";
import {
  handleSetupButton, handleSetupSelect, handleSetupModalSubmit,
} from "./commands/setup-wizard.js";
import { handleCardWizardStep, handleCardEditStep } from "./commands/card-wizard.js";
import { handleLoadSet, handleUnloadSet, handleListSets } from "./commands/cardset.js";
import { handleAutocomplete } from "./commands/autocomplete.js";
import {
  buildCommands, USER_COMMAND_NAMES, ADMIN_COMMAND_NAMES, CARDSET_COMMAND_NAMES,
} from "./commands/register.js";
import { MessageFlags, EmbedBuilder } from "discord.js";
import { createSetupLink } from "../lib/setup-link.js";
import { setBotClient } from "./client-holder.js";

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
  setBotClient(client);

  client.once(Events.ClientReady, async (c) => {
    logger.info({ tag: c.user.tag }, "DN Cards bot ready");
    // Default 27-card roster is NOT auto-seeded — admins opt-in from `!setup`
    // ("Load Defaults" button) or `/loadset defaults:true`. Keeps fresh
    // servers free to load only their own custom roster.
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

    // DM the server owner a one-time dashboard setup link. Best-effort —
    // if their DMs are off, they can run /dashboard later.
    try {
      const owner = await guild.fetchOwner();
      const { url, expiresAt } = await createSetupLink({
        discordUserId: owner.id,
        guildId: guild.id,
        ttlHours: 72,
      });
      const embed = new EmbedBuilder()
        .setColor(0x5865f2)
        .setTitle("👋 Welcome to DN Cards!")
        .setDescription(
          `Thanks for adding **DN Cards** to **${guild.name}**.\n\n` +
          `Open this link to set up your **web dashboard** login (pick a username + password). ` +
          `You can manage card art, server settings, and message customization from there.\n\n` +
          `🔗 ${url}\n\n` +
          `**Expires:** <t:${Math.floor(expiresAt.getTime() / 1000)}:R>\n` +
          `Need a fresh link later? Run \`/dashboard\` in your server.\n\n` +
          `Quick start: run \`/welcome\` for the public intro, then \`/setup\` to configure spawning.`,
        );
      await owner.send({ embeds: [embed] });
    } catch (err) {
      logger.warn({ err, guildId: guild.id }, "Could not DM server owner with dashboard setup link");
    }
  });

  // ── Interactions: slash commands + buttons ────────────────────────────────
  client.on(Events.InteractionCreate, async (interaction: Interaction) => {
    try {
      // ── Autocomplete (card / set suggestions as user types) ───────────────
      if (interaction.isAutocomplete()) {
        await handleAutocomplete(interaction);
        return;
      }

      // ── String select menus (config panel + setup panel) ──────────────────
      if (interaction.isStringSelectMenu()) {
        if (interaction.customId.startsWith("config_")) {
          await handleConfigSelect(interaction);
        } else if (interaction.customId.startsWith("rates_")) {
          await handleRatesSelect(interaction);
        } else if (interaction.customId.startsWith("packs_")) {
          await handlePacksSelect(interaction);
        } else if (interaction.customId.startsWith("setup_")) {
          await handleSetupSelect(interaction);
        } else if (interaction.customId === "setchannels:pick") {
          await handleSetChannelsPick(interaction);
        }
        return;
      }

      // ── Channel select menus (/setchannels step 2) ─────────────────────────
      if (interaction.isChannelSelectMenu()) {
        if (interaction.customId.startsWith("setchannels:set:")) {
          await handleSetChannelsApply(interaction);
        }
        return;
      }

      // ── Modal submissions (admin hub + setup test card) ───────────────────
      if (interaction.isModalSubmit()) {
        if (interaction.customId.startsWith("adminhub:")) {
          await handleAdminHubModal(interaction);
        } else if (interaction.customId.startsWith("setup_")) {
          await handleSetupModalSubmit(interaction);
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

        // ── Setup wizard panel buttons ─────────────────────────────────────
        if (action === "setup") {
          await handleSetupButton(interaction);
          return;
        }

        // ── Admin hub buttons ─────────────────────────────────────────────
        if (action === "adminhub") {
          await handleAdminHubButton(interaction);
          return;
        }

        // ── Spawn Claim button (button/both catch mode) ────────────────────
        if (action === "spawn_claim") {
          // Defer immediately — Discord only gives 3s to acknowledge, and
          // handleClaimButtonClick does DB work that can exceed that.
          await interaction.deferReply({ flags: MessageFlags.Ephemeral }).catch(() => { /* ignore */ });
          const [, guildId, spawnId] = parts;
          const result = await handleClaimButtonClick(guildId, spawnId, interaction.user.id);
          if (!result.ok) {
            // self_already = the user who just won is clicking again
            // (double-tap, both-mode type+click race). Silently ack so
            // we don't tell the winner the spawn "expired".
            if (result.reason === "self_already") {
              await interaction.editReply({
                content: "✅ You've already claimed it — pick **Burn / Keep / Trade** above.",
              }).catch(() => { /* ignore */ });
              return;
            }
            const reasonMsg =
              result.reason === "already_caught" ? "⚡ Too slow! Someone already claimed this card."
              : result.reason === "expired" ? "✅ You've already claimed it — pick **Burn / Keep / Trade** above."
              : result.reason === "timed_out" ? `⏱️ You're timed out from catching cards until <t:${Math.floor(result.timedOutUntil!.getTime() / 1000)}:f>.`
              : "❌ This button isn't active right now.";
            await interaction.editReply({ content: reasonMsg }).catch(() => { /* ignore */ });
          } else {
            await interaction.editReply({
              content: `🎯 You claimed it! Check the spawn message for **Burn / Keep / Trade** options.`,
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
          const [, guildId, userId, cardIdStr, shinyFlag] = parts;
          const cardId = parseInt(cardIdStr, 10);
          // 5th segment present only on burn buttons minted after the shiny
          // rollout; pre-rollout buttons fall back to non-shiny (correct since
          // those pre-existed the feature).
          const isShinyCatch = shinyFlag === "1";

          if (interaction.user.id !== userId) {
            await interaction.reply({
              content: "❌ These buttons are only for the player who caught this card.",
              flags: MessageFlags.Ephemeral,
            }).catch(() => { /* ignore */ });
            return;
          }

          // Defer immediately — DB work + embed rebuild + message edit can
          // easily exceed Discord's 3-second interaction window, especially
          // under load. Without this, burns "succeed" silently and the user
          // re-clicks → "already burned" loop.
          await interaction.deferReply({ flags: MessageFlags.Ephemeral }).catch(() => { /* ignore */ });

          // Look up the card name for any public announcement.
          const { getAllCards } = await import("./db.js");
          const allCards = await getAllCards();
          const card = allCards.find(c => c.id === cardId);
          const cardName = card?.name ?? "the card";
          const burnValue = card?.burnValue ?? 0;

          if (action === "catch_burn") {
            const result = await burnCard(guildId, userId, cardId, 1, { shiny: isShinyCatch });
            if (!result.success) {
              // Silently ack — this only fires on rare double-click races
              // after the defer fix. Showing an error message confused users
              // more than the silent no-op does.
              await interaction.deleteReply().catch(() => { /* ignore */ });
              return;
            }
            const currency = await getOrCreateCurrency(guildId, userId);
            // Update the spawn embed to show the burn state in-channel.
            const burnedEmbed = await buildPostDecisionEmbed(cardId, userId, "burned", guildId);
            if (burnedEmbed) {
              await interaction.message.edit({
                embeds: [burnedEmbed],
                components: [buildDisabledDecisionRow(guildId, userId, cardId, burnValue, "burn")],
              }).catch(() => { /* may be deleted */ });
            }
            // Private confirmation with full shard balance
            await interaction.editReply({
              content:
                `🔥 Card burned! You received 💠 **${result.shardsGained.toLocaleString()} shards**.\n` +
                `New balance: **${currency.shards.toLocaleString()}** 💠 — check \`/shards\` anytime.`,
            }).catch(() => { /* ignore */ });
            const burnUnlocks = await checkAchievements(guildId, userId).catch(() => []);
            if (burnUnlocks.length > 0) {
              await interaction.followUp({
                content: "🏆 **Achievement unlocked!**\n" + burnUnlocks.map(formatUnlockLine).join("\n"),
                flags: MessageFlags.Ephemeral,
              }).catch(() => { /* ignore */ });
            }
          } else if (action === "catch_keep") {
            const keptEmbed = await buildPostDecisionEmbed(cardId, userId, "kept", guildId);
            if (keptEmbed) {
              await interaction.message.edit({
                embeds: [keptEmbed],
                components: [buildDisabledDecisionRow(guildId, userId, cardId, burnValue, "keep")],
              }).catch(() => { /* may be deleted */ });
            }
            await interaction.editReply({
              content: "💾 Kept! The card is in your collection — use `/collection` to view it.",
            }).catch(() => { /* ignore */ });
          } else {
            // catch_trade — card stays in collection; advertise it publicly
            const tradeEmbed = await buildPostDecisionEmbed(cardId, userId, "trade", guildId);
            if (tradeEmbed) {
              await interaction.message.edit({
                embeds: [tradeEmbed],
                components: [buildDisabledDecisionRow(guildId, userId, cardId, burnValue, "trade")],
              }).catch(() => { /* may be deleted */ });
            }
            await interaction.editReply({
              content: `🔄 You're now open to trading **${cardName}**! Others can use /trade to make an offer.`,
            }).catch(() => { /* ignore */ });
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

    // prefix commands (admin setup and config) — prefix is configurable per-guild
    const prefix = await getGuildPrefix(msg.guild.id);
    if (content.startsWith(prefix)) {
      await handlePrefixCommand(msg, prefix).catch(err => logger.error({ err }, "Prefix command error"));
      return;
    }

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
      return { matched: false, awaiting: false, timedOutUntil: undefined as Date | undefined };
    });
    if (result.matched) {
      if (result.timedOutUntil) {
        try {
          await msg.reply({
            content: `⏱️ <@${msg.author.id}> you're timed out from catching cards until <t:${Math.floor(result.timedOutUntil.getTime() / 1000)}:f>.`,
            allowedMentions: { users: [msg.author.id] },
          });
        } catch { /* ignore */ }
        return;
      }
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
