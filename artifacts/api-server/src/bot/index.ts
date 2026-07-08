import {
  Client, GatewayIntentBits, Partials, Events, REST, Routes, type Interaction,
  ChannelType, PermissionFlagsBits, type Guild, type TextChannel,
} from "discord.js";
import { logger } from "../lib/logger.js";
import { burnCard, getOrCreateCurrency, getAllCards } from "./db.js";
import { handleEditCardSelect, handleEditCardModal } from "./commands/edit-card.js";
import { handleEditUserInteraction, handleEditUserModal } from "./commands/edit-user.js";
import { handleTradeButton } from "./commands/trading.js";
import { initSpawnManager, initAllGuilds, handleCatchAttempt, handleClaimButtonClick, scheduleNextSpawn, buildPostDecisionEmbed, buildDisabledDecisionRow, markDecisionMade } from "./spawn-manager.js";
import { handleConfigButton, handleConfigSelect, handleRatesSelect, handlePacksSelect, handleRatesCustomModal, handleCustomPackModal, handlePacksNamesModal, handlePacksDescModal, handleCustomPackTypesSelect } from "./commands/config-panel.js";
import { handleSetsHubButton, handleSetsHubSelect, handleSetsHubModal } from "./commands/sets-panel.js";
import { handleSetAdminHubButton, handleSetAdminHubSelect, handleSetAdminHubWeightSelect, handleSetAdminHubModal } from "./commands/set-admin-hub.js";
import { handleRarityEditButton, handleRarityEditSelect, handleRarityEditModal, handleRarityHubButton, handleRarityHubSelect, handleRarityHubModal } from "./commands/rarity-admin.js";
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
import { handleAutocomplete } from "./commands/autocomplete.js";
import { handleMenuCommand } from "./commands/menu.js";
import { handleEditPackCommand } from "./commands/editpack.js";
import { handleDNValuesSearch, handleDNValuesList, handleDNValuesInfo, handleDNValuesAutocomplete, handleDNValuesCalculator, handleDNValuesCalcButton, handleDNValuesCalcModal, handleDNValuesHelp } from "./commands/dnvalues.js";
import { handlePostCalculator, handleDntCalcButton, handleDntCalcModal } from "./commands/dntcalc.js";
import { handleBattleCommand } from "./commands/battle.js";
import {
  handleBattleAdminCommand, handleBattleAdminButton, handleBattleAdminSelect,
  handleBattleAdminChannelSelect, handleBattleAdminModal,
} from "./commands/battle-admin.js";
import { handleBattleComponent, startBattleMaintenance } from "./battle/battle-manager.js";
import {
  buildCommands, USER_COMMAND_NAMES, ADMIN_COMMAND_NAMES,
} from "./commands/register.js";
import { MessageFlags, EmbedBuilder } from "discord.js";
import { createSetupLink } from "../lib/setup-link.js";
import { setBotClient } from "./client-holder.js";
import { isHomeGuild } from "./home-guild.js";

/**
 * Send a public welcome message when the bot joins a new guild.
 * Tries the guild's system channel first, then the first text channel where we
 * have permission to send messages. Best-effort — failures are logged, not thrown.
 */
async function sendGuildWelcome(guild: Guild): Promise<void> {
  const me = guild.members.me;
  const requiredPerms = PermissionFlagsBits.ViewChannel | PermissionFlagsBits.SendMessages | PermissionFlagsBits.EmbedLinks;
  const canWrite = (ch: typeof guild.channels.cache extends Map<string, infer V> ? V : never): ch is TextChannel =>
    (ch.type === ChannelType.GuildText || ch.type === ChannelType.GuildAnnouncement) &&
    ch.permissionsFor(me ?? guild.client.user.id)?.has(requiredPerms) === true;

  const writableFallback = guild.channels.cache
    .filter(canWrite)
    .sort((a, b) => a.position - b.position)
    .values();

  const systemChannel = guild.systemChannel && canWrite(guild.systemChannel) ? guild.systemChannel : null;
  const candidates = systemChannel
    ? [systemChannel, ...writableFallback].filter((ch, i, arr) => arr.findIndex(c => c.id === ch.id) === i)
    : [...writableFallback];

  const embed = new EmbedBuilder()
    .setColor(0xe63946)
    .setTitle("🃏 DN Cards has arrived!")
    .setDescription(
      "Welcome to **DN Cards** — DarkNight's military collectible card game for Discord. " +
      "Tanks, jets, warships, bosses, and community cards drop randomly. Catch them, trade them, flex them."
    )
    .addFields(
      {
        name: "🛠️ Admins — set up in 3 steps",
        value:
          "1. Run `/admin setup` in your spawn channel to configure drops, rarity, and catch mode.\n" +
          "2. Run `/admin set-hub` to activate a card set (spawns only pull from the active set).\n" +
          (isHomeGuild(guild.id)
            ? "3. Run `/admin dashboard` to get your web dashboard login link.\n"
            : "3. The web dashboard is only available for the home server.\n") +
          "Need the full guide? Run `/adminhelp` or `/welcomeadmin`.",
      },
      {
        name: "🎮 Players — start here",
        value:
          "• `/cards welcome` — full game guide\n" +
          "• `/cards daily` — free shards every day\n" +
          "• `/cards pack` — buy card packs\n" +
          "• Type card names when they drop to catch them",
      },
      {
        name: "💡 Need help?",
        value:
          "Admins: `/adminhelp` · Players: `/help`\n" +
          "Website: https://dncards.com",
      },
    );

  for (const ch of candidates) {
    try {
      await ch.send({ embeds: [embed] });
      return;
    } catch (err) {
      logger.warn({ err, guildId: guild.id, channelId: ch.id }, "Could not send guild join welcome message");
    }
  }

  logger.info({ guildId: guild.id }, "No suitable channel for guild join welcome message");
}

export async function startBot() {
  const token = process.env["DISCORD_BOT_TOKEN"];
  if (!token) { logger.error("DISCORD_BOT_TOKEN not set — bot will not start."); return; }

  const { HOME_GUILD_ID } = await import("./home-guild.js");
  if (!HOME_GUILD_ID) {
    logger.warn(
      "HOME_GUILD_ID is not set. Guilds can still manage their own cards/sets, " +
      "but the admin dashboard will be unavailable until HOME_GUILD_ID is configured. " +
      "Set it to your home server's Discord guild ID in the environment variables.",
    );
  } else {
    logger.info({ homeGuildId: HOME_GUILD_ID }, "Tenant isolation active — each server manages its own cards/sets");
  }

  // --- Multi-instance guard ---
  // Discord allows only one gateway connection per token. If both the dev
  // workflow and the published deployment connect with the same token they
  // race and slash commands route to whichever is currently winning the
  // gateway lease. Default behaviour: only the published deployment connects.
  // Override in dev with FORCE_DISCORD_LOGIN=1 (use a separate dev token!).
  const isDeployment = process.env["REPLIT_DEPLOYMENT"] === "1";
  const force = process.env["FORCE_DISCORD_LOGIN"] === "1";
  const processType = isDeployment ? "deployment" : "dev";
  const buildId = process.env["REPLIT_DEPLOYMENT_ID"] ?? process.env["REPL_SLUG"] ?? "local";
  const dbHost = (() => {
    const url = process.env["DATABASE_URL"] ?? "";
    const m = url.match(/@([^/:]+)/);
    return m ? m[1] : "unknown";
  })();
  logger.info(
    { processType, buildId, dbHost, isDeployment, willLogin: isDeployment || force },
    "Bot startup banner",
  );
  if (!isDeployment && !force) {
    logger.warn(
      "Skipping Discord login: this is a dev process and FORCE_DISCORD_LOGIN!=1. " +
      "The published deployment owns the bot token. Set FORCE_DISCORD_LOGIN=1 with a SEPARATE dev token to override.",
    );
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
  setBotClient(client);

  client.once(Events.ClientReady, async (c) => {
    logger.info(
      {
        tag: c.user.tag,
        guildCount: c.guilds.cache.size,
        guildIds: [...c.guilds.cache.keys()],
        processType: process.env["REPLIT_DEPLOYMENT"] === "1" ? "deployment" : "dev",
        buildId: process.env["REPLIT_DEPLOYMENT_ID"] ?? "local",
        pid: process.pid,
      },
      "DN Cards bot ready",
    );
    // Default 27-card roster is NOT auto-seeded — admins opt-in from `!setup`
    // ("Load Defaults" button) or `/setadmin load file:<.json>`. Keeps fresh
    // servers free to load only their own custom roster.
    await initAllGuilds(client);
    // Boot-time backfill is no longer needed; sets are managed via the
    // first-class sets + card_set_memberships tables.
    startBattleMaintenance();
    await registerCommands(c.user.id, token, client);
  });

  client.on(Events.GuildCreate, async (guild) => {
    logger.info({ guildId: guild.id, name: guild.name }, "Bot joined guild");
    scheduleNextSpawn(guild.id);
    await sendGuildWelcome(guild);
    const rest = new REST().setToken(token);
    await rest
      .put(Routes.applicationGuildCommands(client.user!.id, guild.id), { body: buildCommands() })
      .catch(err => logger.error({ err, guildId: guild.id }, "Failed to register guild commands on join"));

    // DM the server owner a one-time dashboard setup link — only for the home
    // guild, because the dashboard is home-guild-only. Other servers still get a
    // friendly welcome DM with setup guidance. Best-effort — if DMs are off,
    // they can run /admin setup in the server.
    try {
      const owner = await guild.fetchOwner();
      let description = `Thanks for adding **DN Cards** to **${guild.name}**.\n\n`;
      if (isHomeGuild(guild.id)) {
        const { url, expiresAt } = await createSetupLink({
          discordUserId: owner.id,
          guildId: guild.id,
          ttlHours: 72,
        });
        description +=
          `Open this link to set up your **web dashboard** login (pick a username + password). ` +
          `You can manage card art, server settings, and message customization from there.\n\n` +
          `🔗 ${url}\n\n` +
          `**Expires:** <t:${Math.floor(expiresAt.getTime() / 1000)}:R>\n` +
          `Need a fresh link later? Run \`/admin dashboard\` in your server.\n\n`;
      } else {
        description +=
          "The web dashboard is only available for the home server. " +
          "Guild-scoped settings and commands are managed right here in Discord.\n\n";
      }
      description += `Quick start: run \`/cards welcome\` for the public intro, then \`/admin setup\` to configure spawning.`;
      const embed = new EmbedBuilder()
        .setColor(0x5865f2)
        .setTitle("👋 Welcome to DN Cards!")
        .setDescription(description);
      await owner.send({ embeds: [embed] });
    } catch (err) {
      logger.warn({ err, guildId: guild.id }, "Could not DM server owner with welcome/setup link");
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
        if (interaction.customId.startsWith("custompack:types:")) {
          await handleCustomPackTypesSelect(interaction);
        if (interaction.customId.startsWith("battle:")) {
          await handleBattleComponent(interaction);
        } else if (interaction.customId.startsWith("battleadmin:")) {
          await handleBattleAdminSelect(interaction);
        } else if (interaction.customId.startsWith("config_")) {
          await handleConfigSelect(interaction);
        } else if (interaction.customId.startsWith("rates_")) {
          await handleRatesSelect(interaction);
        } else if (interaction.customId.startsWith("packs_")) {
          await handlePacksSelect(interaction);
        } else if (interaction.customId.startsWith("setup_")) {
          await handleSetupSelect(interaction);
        } else if (interaction.customId === "setchannels:pick") {
          await handleSetChannelsPick(interaction);
        } else if (interaction.customId === "sets:pick") {
          await handleSetsHubSelect(interaction);
        } else if (interaction.customId === "setadminhub:select") {
          await handleSetAdminHubSelect(interaction);
        } else if (interaction.customId.startsWith("setadminhub:weight:")) {
          await handleSetAdminHubWeightSelect(interaction);
        } else if (interaction.customId.startsWith("editcard:")) {
          await handleEditCardSelect(interaction);
        } else if (interaction.customId.startsWith("edituser:menu:")) {
          await handleEditUserInteraction(interaction);
        } else if (interaction.customId === "rarity_edit:select") {
          await handleRarityEditSelect(interaction);
        } else if (
          interaction.customId.startsWith("rarity_hub:settings:select") ||
          interaction.customId.startsWith("rarity_hub:economy:select") ||
          interaction.customId.startsWith("rarity_hub:custom:select:") ||
          interaction.customId === "rarity_hub:order:select"
        ) {
          await handleRarityHubSelect(interaction);
        }
        return;
      }

      // ── Channel select menus (/setchannels step 2) ─────────────────────────
      if (interaction.isChannelSelectMenu()) {
        if (interaction.customId.startsWith("setchannels:set:")) {
          await handleSetChannelsApply(interaction);
        } else if (interaction.customId.startsWith("battleadmin:")) {
          await handleBattleAdminChannelSelect(interaction);
        }
        return;
      }

      // ── Modal submissions (admin hub + setup test card + custom mix) ─────
      if (interaction.isModalSubmit()) {
        if (interaction.customId.startsWith("battleadmin:")) {
          await handleBattleAdminModal(interaction);
        } else if (interaction.customId.startsWith("adminhub:")) {
          await handleAdminHubModal(interaction);
        } else if (interaction.customId.startsWith("setup_")) {
          await handleSetupModalSubmit(interaction);
        } else if (interaction.customId === "rates_custom") {
          await handleRatesCustomModal(interaction);
        } else if (interaction.customId.startsWith("sets:modal:")) {
          await handleSetsHubModal(interaction);
        } else if (interaction.customId.startsWith("setadminhub:modal:")) {
          await handleSetAdminHubModal(interaction);
        } else if (interaction.customId.startsWith("editcard:modal:")) {
          await handleEditCardModal(interaction);
        } else if (interaction.customId.startsWith("edituser:modal:")) {
          await handleEditUserModal(interaction);
        } else if (interaction.customId.startsWith("rarity_edit:modal:")) {
          await handleRarityEditModal(interaction);
        } else if (interaction.customId.startsWith("rarity_hub:modal:")) {
          await handleRarityHubModal(interaction);
        } else if (interaction.customId.startsWith("packs_custom_modal:")) {
          await handleCustomPackModal(interaction);
        } else if (interaction.customId === "packs_names_modal") {
          await handlePacksNamesModal(interaction);
        } else if (interaction.customId === "packs_desc_modal") {
          await handlePacksDescModal(interaction);
        } else if (interaction.customId.startsWith("dncalc_modal:")) {
          await handleDNValuesCalcModal(interaction);
        } else if (interaction.customId.startsWith("dntcalc_modal:")) {
          await handleDntCalcModal(interaction);
        }
        return;
      }

      // ── Button interactions ────────────────────────────────────────────────
      if (interaction.isButton()) {
        const parts = interaction.customId.split(":");
        const action = parts[0];

        // ── DN values calculator hub buttons ───────────────────────────────
        if (action === "dncalc") {
          await handleDNValuesCalcButton(interaction);
          return;
        }

        if (action === "dntcalc") {
          await handleDntCalcButton(interaction);
        // ── Battle system buttons (challenge, prep, combat moves) ──────────
        if (action === "battle") {
          await handleBattleComponent(interaction);
          return;
        }

        // ── Battle admin hub buttons ───────────────────────────────────────
        if (action === "battleadmin") {
          await handleBattleAdminButton(interaction);
          return;
        }

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

        // ── Sets hub panel buttons ─────────────────────────────────────────
        if (action === "sets") {
          await handleSetsHubButton(interaction);
          return;
        }

        // ── Set admin hub buttons ──────────────────────────────────────────
        if (action === "setadminhub") {
          await handleSetAdminHubButton(interaction);
          return;
        }

        // ── Rarity hub + display edit panel buttons ────────────────────────
        if (action === "rarity_hub") {
          await handleRarityHubButton(interaction);
          return;
        }

        if (action === "rarity_edit") {
          await handleRarityEditButton(interaction);
          return;
        }

        // ── Spawn Claim button (button/both catch mode) ────────────────────
        if (action === "spawn_claim") {
          const [, guildId, spawnId] = parts;
          // Ack IMMEDIATELY (before any DB call). Discord gives us a 3s window
          // to respond; under spawn fan-out load the catchCard + markCaught
          // round-trip can edge past that, leaving the user with a silent
          // "interaction failed" and the need to click twice. deferUpdate
          // here parks the interaction so we can take as long as we need.
          await interaction.deferUpdate().catch(() => { /* ignore */ });
          const result = await handleClaimButtonClick(guildId, spawnId, interaction.user.id);
          if (!result.ok) {
            // self_already / expired = the winner is double-tapping their own
            // claim. Silently ack — the spawn embed above already shows the
            // Burn/Keep/Trade buttons, no need for a redundant "scroll up" nag.
            if (result.reason === "self_already" || result.reason === "expired") {
              return;
            }
            const reasonMsg =
              result.reason === "already_caught" ? "⚡ Too slow! Someone already claimed this card."
              : result.reason === "timed_out" ? `⏱️ You're timed out from catching cards until <t:${Math.floor(result.timedOutUntil!.getTime() / 1000)}:f>.`
              : "❌ This button isn't active right now.";
            await interaction.followUp({ content: reasonMsg, flags: MessageFlags.Ephemeral }).catch(() => { /* ignore */ });
          } else {
            // Successful claim — already acked above. The spawn embed updates
            // to "CLAIMED" with the Burn/Keep/Trade row in the same message,
            // so a separate ephemeral confirmation is just noise.
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
            });
            return;
          }

          // Look up the card name for any public announcement.
          const allCards = await getAllCards(guildId);
          const card = allCards.find(c => c.id === cardId);
          const cardName = card?.name ?? "the card";
          const burnValue = card?.burnValue ?? 0;

          // Mark decision FIRST so the 90s auto-keep timer can't race ahead
          // and overwrite this embed while we're still computing the reply.
          markDecisionMade(guildId, userId, cardId);

          // Lock the buttons IMMEDIATELY by replacing the row with its disabled
          // sibling before doing any DB work. This single update() both acks the
          // interaction (avoiding the 3s timeout under load) and rules out the
          // double-click race that previously let a fast second tap fire Burn
          // twice — the second click would then hit the "may have already been
          // burned" path even though the user only meant to click once.
          const chosen = action === "catch_burn" ? "burn"
            : action === "catch_keep" ? "keep" : "trade";
          await interaction.update({
            components: [buildDisabledDecisionRow(guildId, userId, cardId, burnValue, chosen)],
          }).catch(() => { /* may be deleted */ });

          if (action === "catch_burn") {
            const result = await burnCard(guildId, userId, cardId, 1, { shiny: isShinyCatch });
            if (!result.success) {
              await interaction.followUp({
                content: "❌ Couldn't burn the card — it may have already been burned.",
                flags: MessageFlags.Ephemeral,
              }).catch(() => { /* ignore */ });
              return;
            }
            const currency = await getOrCreateCurrency(guildId, userId);
            // Update the spawn embed to show the burn state in-channel. The
            // disabled row is already in place from the update() above.
            const burnedEmbed = await buildPostDecisionEmbed(cardId, userId, "burned", guildId);
            if (burnedEmbed) {
              await interaction.message.edit({
                embeds: [burnedEmbed],
                components: [buildDisabledDecisionRow(guildId, userId, cardId, burnValue, "burn")],
              }).catch(() => { /* may be deleted */ });
            }
            // Private confirmation with full shard balance
            await interaction.followUp({
              content:
                `🔥 Card burned! You received 💠 **${result.shardsGained.toLocaleString()} shards**.\n` +
                `New balance: **${currency.shards.toLocaleString()}** 💠 — check \`/cards shards\` anytime.`,
              flags: MessageFlags.Ephemeral,
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
            await interaction.followUp({
              content: "💾 Kept! The card is in your collection — use `/cards collection` to view it.",
              flags: MessageFlags.Ephemeral,
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
            await interaction.followUp({
              content: `🔄 You're now open to trading **${cardName}**! Others can use /trade to make an offer.`,
              flags: MessageFlags.Ephemeral,
            }).catch(() => { /* ignore */ });
          }
        }
        return;
      }

      // ── Slash commands ─────────────────────────────────────────────────────
      if (!interaction.isChatInputCommand()) return;
      const cmd = interaction.commandName;

      if (cmd === "battle") {
        await handleBattleCommand(interaction, interaction.options.getSubcommand(true));
      } else if (cmd === "battleadmin") {
        await handleBattleAdminCommand(interaction);
      } else if (cmd === "cards") {
        await handleUserCommand(interaction, interaction.options.getSubcommand(true));
      } else if (cmd === "admin") {
        const adminSubcommand = interaction.options.getSubcommand(true);
        const legacyName = ({
          hub: "adminhub",
          "set-hub": "sethub",
          "set-manager": "set_admin",
          welcome: "welcomeadmin",
          help: "adminhelp",
        } as Record<string, string>)[adminSubcommand] ?? adminSubcommand;
        await handleAdminCommand(interaction, legacyName);
      } else if (cmd === "menu") {
        await handleMenuCommand(interaction);
      } else if (cmd === "editpack") {
        await handleEditPackCommand(interaction);
      } else if (cmd === "dnvaluesearch") {
        await handleDNValuesSearch(interaction);
      } else if (cmd === "dnvaluelist") {
        await handleDNValuesList(interaction);
      } else if (cmd === "dnvalueinfo") {
        await handleDNValuesInfo(interaction);
      } else if (cmd === "dnvaluecalc") {
        await handleDNValuesCalculator(interaction);
      } else if (cmd === "postcalculator") {
        await handlePostCalculator(interaction);
      } else if (cmd === "dnhelp") {
        await handleDNValuesHelp(interaction);
      } else if (USER_COMMAND_NAMES.has(cmd)) {
        await handleUserCommand(interaction, cmd);
      } else if (ADMIN_COMMAND_NAMES.has(cmd)) {
        await handleAdminCommand(interaction, cmd);
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
      msg.guild.id, msg.author.id, content, msg.createdTimestamp, msg.channel.id,
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
