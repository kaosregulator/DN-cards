// Operations Center — /ops_admin command.
// Subcommands: setup, configure, complete, cancel, notes, stats, rebuild.

import {
  type ChatInputCommandInteraction,
  type ButtonInteraction,
  type StringSelectMenuInteraction,
  type ModalSubmitInteraction,
  type Client,
  ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder,
  MessageFlags, ChannelType, EmbedBuilder,
} from "discord.js";
import { logger } from "../../lib/logger.js";
import {
  getOpsGuildConfig, upsertOpsGuildConfig,
  getOpsTypeConfig, upsertOpsTypeConfig, getAllOpsTypeConfigs,
  getOpsBoard, upsertOpsBoard, deleteOpsBoard, getAllOpsBoards,
  getOrCreateOpsActive, getOpsStats, getOpsQueue,
} from "./db.js";
import {
  resolveOpConfig, buildAdminConfigListEmbed, buildAdminTypeConfigEmbed,
  buildSetupSuccessEmbed, buildSetupAlreadyEmbed, buildStatsEmbed, buildQueueEmbed,
} from "./embeds.js";
import { buildAdminTypeSelect, buildAdminTypeConfigRows } from "./buttons.js";
import { completeOp, setOpNotes, refreshBoard } from "./runtime.js";
import { isOpsAdmin } from "./permissions.js";
import { ALL_OP_KEYS, OP_DEFAULTS, type OpKey } from "./types.js";

// ── /ops_admin dispatch ───────────────────────────────────────────────────────

export async function handleOpsAdminCommand(
  interaction: ChatInputCommandInteraction,
  client: Client,
): Promise<void> {
  if (!interaction.guild || !interaction.member) {
    await interaction.reply({ content: "❌ Must be used inside a server.", flags: MessageFlags.Ephemeral });
    return;
  }

  const guildId = interaction.guild.id;
  const isAdmin = await isOpsAdmin(guildId, interaction.guild.members.cache.get(interaction.user.id) ?? await interaction.guild.members.fetch(interaction.user.id));

  if (!isAdmin) {
    await interaction.reply({ content: "❌ You need admin permissions to use this command.", flags: MessageFlags.Ephemeral });
    return;
  }

  const sub = interaction.options.getSubcommand(true);

  switch (sub) {
    case "setup": return handleSetup(interaction, client);
    case "configure": return handleConfigure(interaction, client);
    case "complete": return handleComplete(interaction, client);
    case "cancel": return handleCancel(interaction, client);
    case "notes": return handleNotes(interaction, client);
    case "stats": return handleStats(interaction, client);
    case "rebuild": return handleRebuild(interaction, client);
    default:
      await interaction.reply({ content: "❌ Unknown subcommand.", flags: MessageFlags.Ephemeral });
  }
}

// ── Setup ─────────────────────────────────────────────────────────────────────

async function handleSetup(interaction: ChatInputCommandInteraction, client: Client): Promise<void> {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const guildId = interaction.guild!.id;
  const channel = interaction.options.getChannel("channel", true);
  const staffRole = interaction.options.getRole("staff_role");

  const existing = await getOpsGuildConfig(guildId);
  if (existing?.enabled && existing.opsChannelId) {
    await interaction.editReply({ embeds: [buildSetupAlreadyEmbed(existing.opsChannelId)] });
    return;
  }

  // Save guild config
  await upsertOpsGuildConfig(guildId, {
    enabled: true,
    opsChannelId: channel.id,
    staffRoleId: staffRole?.id ?? null,
  });

  // Post permanent board embeds for all enabled types
  const fetchedChannel = await client.channels.fetch(channel.id).catch(() => null);
  if (!fetchedChannel?.isTextBased()) {
    await interaction.editReply("❌ Cannot post to that channel. Make sure the bot has send permissions there.");
    return;
  }

  const typeConfigs = await getAllOpsTypeConfigs(guildId);
  const cfgMap = new Map(typeConfigs.map(c => [c.opKey as OpKey, c]));

  let posted = 0;
  for (const opKey of ALL_OP_KEYS) {
    const cfg = cfgMap.get(opKey) ?? null;
    if (cfg && !cfg.enabled) continue;

    try {
      const resolved = resolveOpConfig(opKey, cfg);
      const active = await getOrCreateOpsActive(guildId, opKey);
      const { buildBoardEmbed } = await import("./embeds.js");
      const { buildBoardRows } = await import("./buttons.js");

      const embed = buildBoardEmbed(resolved, active, [], 0);
      const rows = buildBoardRows(resolved, active, false);

      const msg = await (fetchedChannel as import("discord.js").TextChannel).send({
        embeds: [embed],
        components: rows.slice(0, 5),
      });
      await upsertOpsBoard(guildId, opKey, channel.id, msg.id);
      posted++;
    } catch (err) {
      logger.warn({ err, opKey }, "ops: failed to post board embed during setup");
    }
  }

  await interaction.editReply({ embeds: [buildSetupSuccessEmbed(channel.id, posted)] });
}

// ── Configure ─────────────────────────────────────────────────────────────────

async function handleConfigure(interaction: ChatInputCommandInteraction, client: Client): Promise<void> {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const guildId = interaction.guild!.id;
  const [guildCfg, typeConfigs] = await Promise.all([
    getOpsGuildConfig(guildId),
    getAllOpsTypeConfigs(guildId),
  ]);

  const embed = buildAdminConfigListEmbed(guildCfg, typeConfigs);
  const selectRow = buildAdminTypeSelect();

  await interaction.editReply({ embeds: [embed], components: [selectRow] });
}

// ── Complete / cancel ─────────────────────────────────────────────────────────

async function handleComplete(interaction: ChatInputCommandInteraction, client: Client): Promise<void> {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const guildId = interaction.guild!.id;
  const opKey = interaction.options.getString("type", true) as OpKey;

  const active = await getOrCreateOpsActive(guildId, opKey);
  if (active.status !== "active") {
    await interaction.editReply("❌ No active operation for that type.");
    return;
  }

  await completeOp(client, guildId, opKey, "completed");
  await interaction.editReply("✅ Operation marked as complete.");
}

async function handleCancel(interaction: ChatInputCommandInteraction, client: Client): Promise<void> {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const guildId = interaction.guild!.id;
  const opKey = interaction.options.getString("type", true) as OpKey;

  const active = await getOrCreateOpsActive(guildId, opKey);
  if (active.status !== "active") {
    await interaction.editReply("❌ No active operation for that type.");
    return;
  }

  await completeOp(client, guildId, opKey, "cancelled");
  await interaction.editReply("✅ Operation cancelled.");
}

// ── Notes ─────────────────────────────────────────────────────────────────────

async function handleNotes(interaction: ChatInputCommandInteraction, client: Client): Promise<void> {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const guildId = interaction.guild!.id;
  const opKey = interaction.options.getString("type", true) as OpKey;
  const notes = interaction.options.getString("text", true);

  const active = await getOrCreateOpsActive(guildId, opKey);
  if (active.status !== "active") {
    await interaction.editReply("❌ No active operation for that type.");
    return;
  }

  await setOpNotes(client, guildId, opKey, notes);
  await interaction.editReply("✅ Notes updated on the board.");
}

// ── Stats ─────────────────────────────────────────────────────────────────────

async function handleStats(interaction: ChatInputCommandInteraction, _client: Client): Promise<void> {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const guildId = interaction.guild!.id;
  const stats = await getOpsStats(guildId);
  await interaction.editReply({ embeds: [buildStatsEmbed(stats)] });
}

// ── Rebuild ───────────────────────────────────────────────────────────────────

async function handleRebuild(interaction: ChatInputCommandInteraction, client: Client): Promise<void> {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const guildId = interaction.guild!.id;
  const guildCfg = await getOpsGuildConfig(guildId);

  if (!guildCfg?.opsChannelId) {
    await interaction.editReply("❌ Run `/ops_admin setup` first to configure a channel.");
    return;
  }

  const channel = await client.channels.fetch(guildCfg.opsChannelId).catch(() => null);
  if (!channel?.isTextBased()) {
    await interaction.editReply("❌ Cannot find the configured ops channel. Re-run `/ops_admin setup` with a new channel.");
    return;
  }

  const typeConfigs = await getAllOpsTypeConfigs(guildId);
  const cfgMap = new Map(typeConfigs.map(c => [c.opKey as OpKey, c]));

  let rebuilt = 0;
  for (const opKey of ALL_OP_KEYS) {
    const cfg = cfgMap.get(opKey) ?? null;
    if (cfg && !cfg.enabled) continue;

    try {
      const resolved = resolveOpConfig(opKey, cfg);
      const active = await getOrCreateOpsActive(guildId, opKey);
      const { buildBoardEmbed } = await import("./embeds.js");
      const { buildBoardRows } = await import("./buttons.js");

      const embed = buildBoardEmbed(resolved, active, [], 0);
      const rows = buildBoardRows(resolved, active, false);

      const msg = await (channel as import("discord.js").TextChannel).send({
        embeds: [embed],
        components: rows.slice(0, 5),
      });
      await upsertOpsBoard(guildId, opKey, guildCfg.opsChannelId, msg.id);
      rebuilt++;
    } catch (err) {
      logger.warn({ err, opKey }, "ops: failed to rebuild board");
    }
  }

  await interaction.editReply(`✅ Rebuilt **${rebuilt}** board embed${rebuilt !== 1 ? "s" : ""} in <#${guildCfg.opsChannelId}>.`);
}

// ── Admin configure button interactions ───────────────────────────────────────

export async function handleOpsAdminButton(
  interaction: ButtonInteraction,
  client: Client,
): Promise<void> {
  if (!interaction.guild) return;
  const guildId = interaction.guild.id;
  const member = interaction.guild.members.cache.get(interaction.user.id) ?? await interaction.guild.members.fetch(interaction.user.id);
  if (!(await isOpsAdmin(guildId, member))) {
    await interaction.reply({ content: "❌ Admin only.", flags: MessageFlags.Ephemeral });
    return;
  }

  const parts = interaction.customId.split(":");
  // ops:admin_btn:<action>:<opKey?>
  const action = parts[2];
  const opKey = parts[3] as OpKey | undefined;

  if (action === "cfg_back") {
    const [guildCfg, typeConfigs] = await Promise.all([
      getOpsGuildConfig(guildId),
      getAllOpsTypeConfigs(guildId),
    ]);
    await interaction.update({
      embeds: [buildAdminConfigListEmbed(guildCfg, typeConfigs)],
      components: [buildAdminTypeSelect()],
    });
    return;
  }

  if (!opKey) return;
  const cfg = await getOpsTypeConfig(guildId, opKey);
  const resolved = resolveOpConfig(opKey, cfg);

  if (action === "toggle") {
    const newEnabled = !(cfg?.enabled ?? true);
    await upsertOpsTypeConfig(guildId, opKey, { enabled: newEnabled });
    const updatedCfg = await getOpsTypeConfig(guildId, opKey);
    const updatedResolved = resolveOpConfig(opKey, updatedCfg);
    await interaction.update({
      embeds: [buildAdminTypeConfigEmbed(updatedResolved, updatedCfg)],
      components: buildAdminTypeConfigRows(opKey, updatedResolved.enabled),
    });
    void refreshBoard(client, guildId, opKey);
    return;
  }

  // All other actions open a modal
  const modal = buildAdminModal(action, opKey, resolved);
  if (!modal) {
    await interaction.reply({ content: "❌ Unknown action.", flags: MessageFlags.Ephemeral });
    return;
  }
  await interaction.showModal(modal);
}

function buildAdminModal(action: string, opKey: OpKey, resolved: { label: string; description: string; color: number; footerText: string | null; thumbnailUrl: string | null; bannerUrl: string | null; requiredResponders: number; timeoutMinutes: number; maxQueueSize: number }): ModalBuilder | null {
  const def = OP_DEFAULTS[opKey];
  const modal = new ModalBuilder().setCustomId(`ops:admin_modal:${action}:${opKey}`);

  switch (action) {
    case "setname": {
      modal.setTitle(`Rename — ${def.label}`);
      modal.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder().setCustomId("value").setLabel("Display Name").setStyle(TextInputStyle.Short)
          .setMaxLength(50).setRequired(true).setValue(resolved.label),
      ));
      break;
    }
    case "setdesc": {
      modal.setTitle(`Description — ${def.label}`);
      modal.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder().setCustomId("value").setLabel("Description").setStyle(TextInputStyle.Paragraph)
          .setMaxLength(300).setRequired(false).setValue(resolved.description),
      ));
      break;
    }
    case "setcolor": {
      modal.setTitle(`Color — ${def.label}`);
      modal.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder().setCustomId("value").setLabel("Hex Color (#RRGGBB)").setStyle(TextInputStyle.Short)
          .setMaxLength(7).setRequired(false).setPlaceholder("#FF5722"),
      ));
      break;
    }
    case "setfooter": {
      modal.setTitle(`Footer — ${def.label}`);
      modal.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder().setCustomId("value").setLabel("Footer Text").setStyle(TextInputStyle.Short)
          .setMaxLength(80).setRequired(false).setValue(resolved.footerText ?? ""),
      ));
      break;
    }
    case "setrequired": {
      modal.setTitle(`Required Responders — ${def.label}`);
      modal.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder().setCustomId("value").setLabel("Required Responders (1–50)").setStyle(TextInputStyle.Short)
          .setMaxLength(3).setRequired(true).setValue(String(resolved.requiredResponders)),
      ));
      break;
    }
    case "settimeout": {
      modal.setTitle(`Timeout — ${def.label}`);
      modal.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder().setCustomId("value").setLabel("Timeout (minutes, 5–1440)").setStyle(TextInputStyle.Short)
          .setMaxLength(4).setRequired(true).setValue(String(resolved.timeoutMinutes)),
      ));
      break;
    }
    case "setmaxqueue": {
      modal.setTitle(`Max Queue — ${def.label}`);
      modal.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder().setCustomId("value").setLabel("Max Queue Size (1–20)").setStyle(TextInputStyle.Short)
          .setMaxLength(2).setRequired(true).setValue(String(resolved.maxQueueSize)),
      ));
      break;
    }
    case "setthumb": {
      modal.setTitle(`Thumbnail — ${def.label}`);
      modal.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder().setCustomId("value").setLabel("Thumbnail Image URL").setStyle(TextInputStyle.Short)
          .setMaxLength(500).setRequired(false).setValue(resolved.thumbnailUrl ?? ""),
      ));
      break;
    }
    case "setbanner": {
      modal.setTitle(`Banner — ${def.label}`);
      modal.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder().setCustomId("value").setLabel("Banner Image URL").setStyle(TextInputStyle.Short)
          .setMaxLength(500).setRequired(false).setValue(resolved.bannerUrl ?? ""),
      ));
      break;
    }
    default: return null;
  }

  return modal;
}

// ── Admin configure select interaction ────────────────────────────────────────

export async function handleOpsAdminSelect(
  interaction: StringSelectMenuInteraction,
  client: Client,
): Promise<void> {
  if (!interaction.guild) return;
  const guildId = interaction.guild.id;
  const member = interaction.guild.members.cache.get(interaction.user.id) ?? await interaction.guild.members.fetch(interaction.user.id);
  if (!(await isOpsAdmin(guildId, member))) {
    await interaction.reply({ content: "❌ Admin only.", flags: MessageFlags.Ephemeral });
    return;
  }

  const opKey = interaction.values[0] as OpKey;
  const cfg = await getOpsTypeConfig(guildId, opKey);
  const resolved = resolveOpConfig(opKey, cfg);

  await interaction.update({
    embeds: [buildAdminTypeConfigEmbed(resolved, cfg)],
    components: buildAdminTypeConfigRows(opKey, resolved.enabled),
  });
}

// ── Admin modal submit ────────────────────────────────────────────────────────

export async function handleOpsAdminModalSubmit(
  interaction: ModalSubmitInteraction,
  client: Client,
  action: string,
  opKey: OpKey,
): Promise<void> {
  if (!interaction.guild) return;
  const guildId = interaction.guild.id;

  await interaction.deferUpdate();

  const rawValue = interaction.fields.getTextInputValue("value").trim();

  const patch: Record<string, unknown> = {};
  switch (action) {
    case "setname": patch.displayName = rawValue || null; break;
    case "setdesc": patch.description = rawValue || null; break;
    case "setcolor": patch.color = /^#[0-9a-fA-F]{6}$/.test(rawValue) ? rawValue : null; break;
    case "setfooter": patch.footerText = rawValue || null; break;
    case "setrequired": patch.requiredResponders = Math.max(1, Math.min(50, parseInt(rawValue, 10) || 1)); break;
    case "settimeout": patch.timeoutMinutes = Math.max(5, Math.min(1440, parseInt(rawValue, 10) || 60)); break;
    case "setmaxqueue": patch.maxQueueSize = Math.max(1, Math.min(20, parseInt(rawValue, 10) || 5)); break;
    case "setthumb": patch.thumbnailUrl = rawValue || null; break;
    case "setbanner": patch.bannerUrl = rawValue || null; break;
  }

  await upsertOpsTypeConfig(guildId, opKey, patch as Parameters<typeof upsertOpsTypeConfig>[2]);
  const updatedCfg = await getOpsTypeConfig(guildId, opKey);
  const resolved = resolveOpConfig(opKey, updatedCfg);

  await interaction.editReply({
    embeds: [buildAdminTypeConfigEmbed(resolved, updatedCfg)],
    components: buildAdminTypeConfigRows(opKey, resolved.enabled),
  });

  void refreshBoard(client, guildId, opKey);
}
