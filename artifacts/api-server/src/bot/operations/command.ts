// Operations Center — /support user command.
// Opens an ephemeral dropdown; user picks a type, fills a quick modal, submits.

import {
  type ChatInputCommandInteraction,
  type StringSelectMenuInteraction,
  type ModalSubmitInteraction,
  ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder,
  MessageFlags,
} from "discord.js";
import { getOpsGuildConfig, getOpsTypeConfig, getAllOpsTypeConfigs } from "./db.js";
import { buildSupportTypeSelect } from "./buttons.js";
import { buildSupportWizardEmbed } from "./embeds.js";
import { startOp } from "./runtime.js";
import { ALL_OP_KEYS, OP_DEFAULTS, type OpKey } from "./types.js";
import type { Client } from "discord.js";

// ── /support ──────────────────────────────────────────────────────────────────

export async function handleSupportCommand(
  interaction: ChatInputCommandInteraction,
  client: Client,
): Promise<void> {
  if (!interaction.guild) {
    await interaction.reply({ content: "❌ Must be used inside a server.", flags: MessageFlags.Ephemeral });
    return;
  }

  const guildId = interaction.guild.id;
  const guildCfg = await getOpsGuildConfig(guildId);

  if (!guildCfg?.enabled) {
    await interaction.reply({
      content: "❌ Operations Center is not set up in this server. An admin can run `/ops_admin setup` to get started.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  // Build list of enabled op types
  const typeConfigs = await getAllOpsTypeConfigs(guildId);
  const cfgMap = new Map(typeConfigs.map(c => [c.opKey as OpKey, c]));
  const enabledKeys = ALL_OP_KEYS.filter(key => cfgMap.get(key)?.enabled !== false);

  if (enabledKeys.length === 0) {
    await interaction.reply({
      content: "❌ No operation types are enabled. An admin can enable them via `/ops_admin configure`.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const embed = buildSupportWizardEmbed();
  const selectRow = buildSupportTypeSelect(enabledKeys);

  await interaction.reply({
    embeds: [embed],
    components: [selectRow],
    flags: MessageFlags.Ephemeral,
  });
}

// ── Type select → open modal ──────────────────────────────────────────────────

export async function handleSupportTypeSelect(
  interaction: StringSelectMenuInteraction,
  client: Client,
): Promise<void> {
  const opKey = interaction.values[0] as OpKey;
  if (!opKey || !ALL_OP_KEYS.includes(opKey)) {
    await interaction.reply({ content: "❌ Unknown operation type.", flags: MessageFlags.Ephemeral });
    return;
  }

  const def = OP_DEFAULTS[opKey];

  const modal = new ModalBuilder()
    .setCustomId(`ops:modal:wizard:${opKey}`)
    .setTitle(`${def.emoji} ${def.label}`);

  const objectiveInput = new TextInputBuilder()
    .setCustomId("objective")
    .setLabel("Objective (optional)")
    .setStyle(TextInputStyle.Short)
    .setMaxLength(200)
    .setRequired(false)
    .setPlaceholder("Briefly describe the situation…");

  const respondersInput = new TextInputBuilder()
    .setCustomId("responders_needed")
    .setLabel("Responders Needed")
    .setStyle(TextInputStyle.Short)
    .setMaxLength(3)
    .setRequired(true)
    .setValue("1")
    .setPlaceholder("How many people do you need?");

  const robloxInput = new TextInputBuilder()
    .setCustomId("roblox_link")
    .setLabel("Roblox Server Link (optional)")
    .setStyle(TextInputStyle.Short)
    .setMaxLength(300)
    .setRequired(false)
    .setPlaceholder("https://www.roblox.com/games/…");

  modal.addComponents(
    new ActionRowBuilder<TextInputBuilder>().addComponents(objectiveInput),
    new ActionRowBuilder<TextInputBuilder>().addComponents(respondersInput),
    new ActionRowBuilder<TextInputBuilder>().addComponents(robloxInput),
  );

  await interaction.showModal(modal);
}

// ── Modal submit → start op ───────────────────────────────────────────────────

export async function handleSupportModalSubmit(
  interaction: ModalSubmitInteraction,
  client: Client,
  opKey: OpKey,
): Promise<void> {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  if (!interaction.guild) {
    await interaction.editReply("❌ Must be used inside a server.");
    return;
  }

  const guildId = interaction.guild.id;
  const objective = interaction.fields.getTextInputValue("objective").trim() || null;
  const robloxLink = interaction.fields.getTextInputValue("roblox_link").trim() || null;
  const respondersRaw = interaction.fields.getTextInputValue("responders_needed").trim();
  const respondersNeeded = Math.max(1, Math.min(50, parseInt(respondersRaw, 10) || 1));

  const result = await startOp(
    client, guildId, opKey,
    interaction.user.id, objective, robloxLink, respondersNeeded,
  );

  if (!result.ok) {
    await interaction.editReply(`❌ ${result.error ?? "Could not start operation."}`);
    return;
  }

  if (result.queued) {
    await interaction.editReply(
      `📋 You are **#${result.queuePosition}** in the queue for this operation. ` +
      `You'll be promoted automatically when the current one finishes.`,
    );
  } else {
    await interaction.editReply("✅ Operation started! Check the operations board.");
  }
}
