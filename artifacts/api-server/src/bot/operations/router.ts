// Operations Center — interaction router.
// Handles all ops:* customId interactions and dispatches to the right handler.

import type {
  ButtonInteraction, StringSelectMenuInteraction, ModalSubmitInteraction, Client,
} from "discord.js";
import { MessageFlags } from "discord.js";
import { isOpsComponent, ALL_OP_KEYS, type OpKey } from "./types.js";
import { joinOp, leaveOp, completeOp, refreshBoard } from "./runtime.js";
import { isOpsAdmin } from "./permissions.js";
import {
  handleSupportTypeSelect, handleSupportModalSubmit,
} from "./command.js";
import {
  handleOpsAdminButton, handleOpsAdminSelect, handleOpsAdminModalSubmit,
} from "./admin.js";
import { getOpsQueue, getOrCreateOpsActive } from "./db.js";
import { getOpsTypeConfig } from "./db.js";
import { resolveOpConfig, buildQueueEmbed } from "./embeds.js";

export { isOpsComponent };

// ── Button router ─────────────────────────────────────────────────────────────

export async function handleOpsButton(
  interaction: ButtonInteraction,
  client: Client,
): Promise<void> {
  if (!interaction.guild) return;
  const guildId = interaction.guild.id;
  const parts = interaction.customId.split(":");
  // ops:<area>:<action>:<opKey?>
  const area = parts[1];   // "btn" | "admin_btn"
  const action = parts[2];
  const opKey = parts[3] as OpKey | undefined;

  if (area === "admin_btn") {
    return handleOpsAdminButton(interaction, client);
  }

  // ── Public board buttons ──────────────────────────────────────────────────
  if (area === "btn") {
    if (!opKey || !ALL_OP_KEYS.includes(opKey)) {
      await interaction.reply({ content: "❌ Unknown operation.", flags: MessageFlags.Ephemeral });
      return;
    }

    switch (action) {
      case "join": {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const result = await joinOp(client, guildId, opKey, interaction.user.id);
        if (result.alreadyIn) {
          await interaction.editReply("You're already in this operation.");
        } else if (!result.ok) {
          await interaction.editReply(`❌ ${result.message ?? "Cannot join right now."}`);
        } else {
          await interaction.editReply("✅ You joined the operation! The board has been updated.");
        }
        break;
      }

      case "leave": {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        await leaveOp(client, guildId, opKey, interaction.user.id);
        await interaction.editReply("You've left the operation.");
        break;
      }

      case "request": {
        // Redirect to /support flow — open the wizard modal for this op type
        const { buildSupportWizardEmbed } = await import("./embeds.js");
        const { buildSupportTypeSelect } = await import("./buttons.js");
        const { getOpsGuildConfig, getAllOpsTypeConfigs } = await import("./db.js");
        const guildCfg = await getOpsGuildConfig(guildId);
        if (!guildCfg?.enabled) {
          await interaction.reply({ content: "❌ Operations Center is disabled.", flags: MessageFlags.Ephemeral });
          return;
        }
        const typeConfigs = await getAllOpsTypeConfigs(guildId);
        const cfgMap = new Map(typeConfigs.map(c => [c.opKey as OpKey, c]));
        const enabledKeys = ALL_OP_KEYS.filter(key => cfgMap.get(key)?.enabled !== false);
        const embed = buildSupportWizardEmbed();
        const selectRow = buildSupportTypeSelect(enabledKeys);
        await interaction.reply({ embeds: [embed], components: [selectRow], flags: MessageFlags.Ephemeral });
        break;
      }

      case "complete":
      case "cancel": {
        // Admin only
        const member = interaction.guild.members.cache.get(interaction.user.id)
          ?? await interaction.guild.members.fetch(interaction.user.id);
        if (!(await isOpsAdmin(guildId, member))) {
          await interaction.reply({ content: "❌ Admin only.", flags: MessageFlags.Ephemeral });
          return;
        }
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const outcome = action === "complete" ? "completed" : "cancelled";
        await completeOp(client, guildId, opKey, outcome);
        await interaction.editReply(`✅ Operation ${outcome}.`);
        break;
      }

      case "queue": {
        // Show queue (admin only)
        const member = interaction.guild.members.cache.get(interaction.user.id)
          ?? await interaction.guild.members.fetch(interaction.user.id);
        if (!(await isOpsAdmin(guildId, member))) {
          await interaction.reply({ content: "❌ Admin only.", flags: MessageFlags.Ephemeral });
          return;
        }
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const queue = await getOpsQueue(guildId, opKey);
        const cfg = await getOpsTypeConfig(guildId, opKey);
        const resolved = resolveOpConfig(opKey, cfg);
        await interaction.editReply({ embeds: [buildQueueEmbed(queue, resolved.label)] });
        break;
      }

      case "deploy":
      case "busy": {
        // Status acknowledgement buttons — no-op for now, just ack
        await interaction.reply({
          content: action === "deploy"
            ? "🚀 Marked as deployed!"
            : "⏳ Marked as busy — standing by.",
          flags: MessageFlags.Ephemeral,
        });
        break;
      }

      case "history": {
        await interaction.reply({
          content: "📋 Operation history coming soon.",
          flags: MessageFlags.Ephemeral,
        });
        break;
      }

      case "noop": {
        await interaction.reply({ content: "ℹ️ This button provides information only.", flags: MessageFlags.Ephemeral });
        break;
      }

      default:
        await interaction.reply({ content: "❌ Unknown action.", flags: MessageFlags.Ephemeral });
    }
  }
}

// ── Select menu router ────────────────────────────────────────────────────────

export async function handleOpsSelect(
  interaction: StringSelectMenuInteraction,
  client: Client,
): Promise<void> {
  const parts = interaction.customId.split(":");
  const area = parts[1]; // "select" | "admin_select"

  if (area === "select" && parts[2] === "type") {
    return handleSupportTypeSelect(interaction, client);
  }

  if (area === "admin_select" && parts[2] === "cfg") {
    return handleOpsAdminSelect(interaction, client);
  }
}

// ── Modal router ──────────────────────────────────────────────────────────────

export async function handleOpsModal(
  interaction: ModalSubmitInteraction,
  client: Client,
): Promise<void> {
  const parts = interaction.customId.split(":");
  const area = parts[1]; // "modal"
  const sub = parts[2];  // "wizard" | "admin_modal" sub-action

  if (sub === "wizard") {
    const opKey = parts[3] as OpKey;
    return handleSupportModalSubmit(interaction, client, opKey);
  }

  if (area === "admin_modal") {
    // customId is ops:admin_modal:<action>:<opKey>
    const action = parts[2];
    const opKey = parts[3] as OpKey;
    return handleOpsAdminModalSubmit(interaction, client, action, opKey);
  }
}
