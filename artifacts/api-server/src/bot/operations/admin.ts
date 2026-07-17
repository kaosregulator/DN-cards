// Operations Center — /ops_admin command.
// Subcommands: setup, configure, complete, cancel, notes, stats, rebuild.

import {
  type ChatInputCommandInteraction,
  type ButtonInteraction,
  type StringSelectMenuInteraction,
  type ChannelSelectMenuInteraction,
  type ModalSubmitInteraction,
  type Client,
  type TextChannel,
  ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder,
  MessageFlags, ChannelType, EmbedBuilder,
} from "discord.js";
import { logger } from "../../lib/logger.js";
import {
  getOpsGuildConfig, upsertOpsGuildConfig,
  getOpsTypeConfig, upsertOpsTypeConfig, getAllOpsTypeConfigs,
  getOpsBoard, upsertOpsBoard, deleteOpsBoard, getAllOpsBoards,
  getOrCreateOpsActive, getOpsStats, getOpsQueue,
  getOpsQueueCount, getOpsResponders,
} from "./db.js";
import {
  resolveOpConfig, buildAdminConfigListEmbed, buildAdminTypeConfigEmbed,
  buildStatsEmbed, buildQueueEmbed, buildDeployListEmbed,
} from "./embeds.js";
import {
  buildAdminTypeSelect, buildAdminTypeConfigRows,
  buildDeployPanelSelect, buildDeployChannelSelect,
} from "./buttons.js";
import { completeOp, setOpNotes, refreshBoard } from "./runtime.js";
import { isOpsAdmin } from "./permissions.js";
import { ALL_OP_KEYS, OP_DEFAULTS, type OpKey } from "./types.js";
import { extractVibrantColor } from "./vibrant-color.js";

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
    case "panel": return handlePanel(interaction, client);
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
  // `channel` is now the default channel used for staff pings only. Panels are
  // placed individually via the deploy picker so they never all pile into one
  // channel (which was the old spam problem).
  const channel = interaction.options.getChannel("channel", true);
  const staffRole = interaction.options.getRole("staff_role");

  // Save/refresh guild config. Setup is now re-runnable — it never mass-posts
  // boards, so running it again just updates the default channel / staff role.
  await upsertOpsGuildConfig(guildId, {
    enabled: true,
    opsChannelId: channel.id,
    staffRoleId: staffRole?.id ?? null,
  });

  // Hand straight off to the deploy picker so the admin sends each panel to the
  // channel they want, one at a time.
  await renderDeployPicker(interaction, guildId,
    `✅ Operations Center enabled. Staff pings will use <#${channel.id}>.\n` +
    "Now pick each panel and choose where it should live 👇");
}

// ── Deploy panels (pick a panel → pick a channel) ─────────────────────────────

/** Render (or re-render) the ephemeral deploy picker into the current reply. */
async function renderDeployPicker(
  interaction: ChatInputCommandInteraction,
  guildId: string,
  notice?: string,
): Promise<void> {
  const [boards, typeConfigs] = await Promise.all([
    getAllOpsBoards(guildId),
    getAllOpsTypeConfigs(guildId),
  ]);
  const placed = new Map(boards.map(b => [b.opKey as OpKey, b.channelId]));
  const cfgMap = new Map(typeConfigs.map(c => [c.opKey as OpKey, { displayName: c.displayName, enabled: c.enabled }]));
  await interaction.editReply({
    embeds: [buildDeployListEmbed(placed, typeConfigs, notice)],
    components: [buildDeployPanelSelect(placed, cfgMap)],
  });
}

async function handlePanel(interaction: ChatInputCommandInteraction, client: Client): Promise<void> {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const guildId = interaction.guild!.id;
  const guildCfg = await getOpsGuildConfig(guildId);
  if (!guildCfg?.enabled) {
    await interaction.editReply("❌ Run `/ops_admin setup` first to enable the Operations Center.");
    return;
  }
  await renderDeployPicker(interaction, guildId);
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

  if (!guildCfg?.enabled) {
    await interaction.editReply("❌ Run `/ops_admin setup` first to enable the Operations Center.");
    return;
  }

  // Rebuild each board IN THE CHANNEL IT WAS DEPLOYED TO — respecting per-panel
  // placement. Panels that were never deployed are skipped (use `/ops_admin
  // panel` to place them).
  const boards = await getAllOpsBoards(guildId);
  if (boards.length === 0) {
    await interaction.editReply("❌ No panels have been deployed yet. Use `/ops_admin panel` to place them.");
    return;
  }

  const typeConfigs = await getAllOpsTypeConfigs(guildId);
  const cfgMap = new Map(typeConfigs.map(c => [c.opKey as OpKey, c]));

  let rebuilt = 0;
  for (const board of boards) {
    const opKey = board.opKey as OpKey;
    const cfg = cfgMap.get(opKey) ?? null;
    if (cfg && !cfg.enabled) continue;

    try {
      const channel = await client.channels.fetch(board.channelId).catch(() => null) as import("discord.js").TextChannel | null;
      if (!channel?.isTextBased()) continue;

      // Delete the old (possibly stale) message before reposting.
      const oldMsg = await channel.messages.fetch(board.messageId).catch(() => null);
      await oldMsg?.delete().catch(() => {});

      const resolved = resolveOpConfig(opKey, cfg);
      const active = await getOrCreateOpsActive(guildId, opKey);
      const responders = active.id ? await getOpsResponders(active.id) : [];
      const queueCount = await getOpsQueueCount(guildId, opKey);
      const { buildBoardEmbed } = await import("./embeds.js");
      const { buildBoardRows } = await import("./buttons.js");

      const embed = buildBoardEmbed(resolved, active, responders, queueCount);
      const rows = buildBoardRows(resolved, active, false);

      const msg = await channel.send({ embeds: [embed], components: rows.slice(0, 5) });
      await upsertOpsBoard(guildId, opKey, board.channelId, msg.id);
      rebuilt++;
    } catch (err) {
      logger.warn({ err, opKey }, "ops: failed to rebuild board");
    }
  }

  await interaction.editReply(`✅ Rebuilt **${rebuilt}** panel${rebuilt !== 1 ? "s" : ""} in their deployed channels.`);
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

// ── Deploy picker interactions ────────────────────────────────────────────────

/** Step 1 → 2: a panel was chosen; show the channel picker for it. */
export async function handleOpsDeployPanelSelect(
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
  const board = await getOpsBoard(guildId, opKey);

  const embed = new EmbedBuilder()
    .setColor(resolved.color)
    .setTitle(`${resolved.emoji} Deploy — ${resolved.label}`)
    .setDescription(
      (board ? `Currently in <#${board.channelId}>.\n\n` : "") +
      "Pick the channel this panel should be sent to. " +
      "The old copy (if any) is removed automatically.",
    );

  await interaction.update({ embeds: [embed], components: [buildDeployChannelSelect(opKey)] });
}

/** Step 2: a channel was chosen; (re)post the board there and update the DB. */
export async function handleOpsDeployChannelSelect(
  interaction: ChannelSelectMenuInteraction,
  client: Client,
): Promise<void> {
  if (!interaction.guild) return;
  const guildId = interaction.guild.id;
  const member = interaction.guild.members.cache.get(interaction.user.id) ?? await interaction.guild.members.fetch(interaction.user.id);
  if (!(await isOpsAdmin(guildId, member))) {
    await interaction.reply({ content: "❌ Admin only.", flags: MessageFlags.Ephemeral });
    return;
  }

  await interaction.deferUpdate();

  const opKey = interaction.customId.split(":")[2] as OpKey;
  const picked = interaction.channels.first();
  if (!picked) {
    await renderDeployPickerFrom(interaction, guildId, "❌ No channel picked.");
    return;
  }

  const target = await client.channels.fetch(picked.id).catch(() => null) as TextChannel | null;
  if (!target?.isTextBased()) {
    await renderDeployPickerFrom(interaction, guildId, "❌ That channel can't receive messages. Pick a text channel.");
    return;
  }

  const cfg = await getOpsTypeConfig(guildId, opKey);
  const resolved = resolveOpConfig(opKey, cfg);

  // Remove the previous board message (wherever it was) so we don't leave a dead copy.
  const prev = await getOpsBoard(guildId, opKey);
  if (prev) {
    const prevChannel = await client.channels.fetch(prev.channelId).catch(() => null) as TextChannel | null;
    if (prevChannel?.isTextBased()) {
      const prevMsg = await prevChannel.messages.fetch(prev.messageId).catch(() => null);
      await prevMsg?.delete().catch(() => {});
    }
  }

  try {
    const active = await getOrCreateOpsActive(guildId, opKey);
    const queueCount = await getOpsQueueCount(guildId, opKey);
    const responders = active.id ? await getOpsResponders(active.id) : [];
    const { buildBoardEmbed } = await import("./embeds.js");
    const { buildBoardRows } = await import("./buttons.js");

    const embed = buildBoardEmbed(resolved, active, responders, queueCount);
    const rows = buildBoardRows(resolved, active, false);

    const msg = await target.send({ embeds: [embed], components: rows.slice(0, 5) });
    await upsertOpsBoard(guildId, opKey, target.id, msg.id);

    await renderDeployPickerFrom(interaction, guildId, `✅ **${resolved.label}** deployed to <#${target.id}>.`);
  } catch (err) {
    logger.warn({ err, opKey, channelId: target.id }, "ops: failed to deploy panel");
    await renderDeployPickerFrom(interaction, guildId, "❌ Couldn't post there — check the bot's permissions in that channel.");
  }
}

/** Re-render the deploy picker into an existing component interaction's reply. */
async function renderDeployPickerFrom(
  interaction: StringSelectMenuInteraction | ChannelSelectMenuInteraction,
  guildId: string,
  notice?: string,
): Promise<void> {
  const [boards, typeConfigs] = await Promise.all([
    getAllOpsBoards(guildId),
    getAllOpsTypeConfigs(guildId),
  ]);
  const placed = new Map(boards.map(b => [b.opKey as OpKey, b.channelId]));
  const cfgMap = new Map(typeConfigs.map(c => [c.opKey as OpKey, { displayName: c.displayName, enabled: c.enabled }]));
  await interaction.editReply({
    embeds: [buildDeployListEmbed(placed, typeConfigs, notice)],
    components: [buildDeployPanelSelect(placed, cfgMap)],
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

  // Auto-extract an embed color from a new thumbnail/banner when no custom color is set.
  if ((action === "setthumb" || action === "setbanner") && rawValue) {
    const currentCfg = await getOpsTypeConfig(guildId, opKey);
    if (!currentCfg?.color) {
      const vibrantColor = await extractVibrantColor(rawValue);
      if (vibrantColor != null) {
        patch.color = `#${vibrantColor.toString(16).padStart(6, "0")}`;
      }
    }
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
