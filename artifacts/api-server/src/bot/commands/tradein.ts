// ─────────────────────────────────────────────────────────────────────────────
// /card_recycle (internal command key "tradein") — Card Progression Hub
//
// Dispatches all recycle:* button/select interactions to the appropriate
// handler in recycle-generator.ts.
// ─────────────────────────────────────────────────────────────────────────────

import type { ChatInputCommandInteraction, ButtonInteraction, StringSelectMenuInteraction } from "discord.js";
import {
  handleRecycleHubCommand, handleRecycleComponent,
  handleRecycleScrapButton, handleRecycleFuse, handleRecycleAscend,
  handleRecycleMergeAll, handleRecycleConfirmButton,
} from "../cards/recycle-generator.js";
import { recycleCost } from "../cards/stars.js";

export async function handleTradein(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!interaction.guild) return;
  if (!interaction.deferred && !interaction.replied) await interaction.deferReply({ flags: 64 }).catch(() => {});

  const name = interaction.options.getString("name")?.trim();

  // No name provided → launch the interactive hub.
  if (!name) {
    await handleRecycleHubCommand(interaction);
    return;
  }

  // Named card → show the selected-card view directly.
  const { getCardByName } = await import("../db.js");
  const card = await getCardByName(name, interaction.guild.id);
  if (!card) {
    await interaction.editReply(`❌ Couldn't find a card called **${name}**. Run \`/recycle\` without a name to use the hub.`);
    return;
  }
  const { buildRecycleSelectedMessage } = await import("../cards/recycle-generator.js");
  const msg = await buildRecycleSelectedMessage(interaction.guild.id, interaction.user.id, card.id);
  if (typeof msg === "string") {
    await interaction.editReply({ content: msg, embeds: [], components: [], files: [] });
    return;
  }
  await interaction.editReply(msg);
}

// Route all recycle:* button/select interactions.
export async function handleRecycleButton(interaction: ButtonInteraction | StringSelectMenuInteraction): Promise<void> {
  const parts = interaction.customId.split(":");
  if (parts[0] !== "recycle") return;
  const sub = parts[1];

  // New progression actions
  if (sub === "scrap")  { await handleRecycleScrapButton(interaction as ButtonInteraction); return; }
  if (sub === "fuse")   { await handleRecycleFuse(interaction as ButtonInteraction); return; }
  if (sub === "ascend") { await handleRecycleAscend(interaction as ButtonInteraction); return; }

  // Legacy / hub navigation
  if (sub === "merge-all") { await handleRecycleMergeAll(interaction as ButtonInteraction); return; }
  if (sub === "do")         { await handleRecycleConfirmButton(interaction as ButtonInteraction); return; }

  // Hub navigation + search select
  if (sub === "select" || sub === "back" || sub === "search") {
    await handleRecycleComponent(interaction as ButtonInteraction | StringSelectMenuInteraction);
    return;
  }
}

// Kept for compatibility with any older imports.
export const TRADEIN_COST = recycleCost(0);
