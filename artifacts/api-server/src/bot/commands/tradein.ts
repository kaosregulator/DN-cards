// ─────────────────────────────────────────────────────────────────────────────
// /card_recycle (internal command key "tradein") — Card Recycle
//
// Replaces the old rarity Trade-In. Recycling consumes DUPLICATE copies of a
// single owned card from the existing collection to raise that card's Star Rank
// by one (see cards/stars.ts). Rarity is never changed; inventory counting is
// unchanged. One normal copy is always preserved as the card itself.
// ─────────────────────────────────────────────────────────────────────────────

import type { ChatInputCommandInteraction, ButtonInteraction } from "discord.js";
import {
  EmbedBuilder, MessageFlags,
  ActionRowBuilder, ButtonBuilder, ButtonStyle,
} from "discord.js";
import {
  getCardByName, getCardById, getOrCreateGuildSettings,
  getRarityContext, getRarityDisplayOverrides, getCardDisplayRarity,
} from "../db.js";
import { toAbsoluteImageUrl } from "../image-url.js";
import {
  recycleQuote, recycleCard, recycleCost, starRankString, MAX_STAR,
} from "../cards/stars.js";
import { handleRecycleHubCommand, handleRecycleComponent, handleRecycleConfirmButton } from "../cards/recycle-generator.js";

const EPHEMERAL = { flags: MessageFlags.Ephemeral } as const;

async function displayFor(guildId: string, card: { id: number; rarity: string }) {
  const [ctx, settings, displayMap] = await Promise.all([
    getRarityContext(guildId),
    getOrCreateGuildSettings(guildId),
    getRarityDisplayOverrides(guildId),
  ]);
  return getCardDisplayRarity(card, ctx, settings, displayMap);
}

function recycleRow(cardId: number, disabled: boolean): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`recycle:do:${cardId}`)
      .setLabel("♻️ Recycle")
      .setStyle(ButtonStyle.Success)
      .setDisabled(disabled),
  );
}

export async function handleTradein(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!interaction.guild) return;
  const guildId = interaction.guild.id;
  const userId = interaction.user.id;
  if (!interaction.deferred && !interaction.replied) await interaction.deferReply(EPHEMERAL).catch(() => {});

  const name = interaction.options.getString("name")?.trim();

  // No name provided → launch the interactive Recycle Card Generator hub.
  if (!name) {
    await handleRecycleHubCommand(interaction);
    return;
  }

  const card = await getCardByName(name, guildId);
  if (!card) {
    await interaction.editReply(`❌ Couldn't find a card called **${name}**. Use the autocomplete to pick one you own, or run \`/recycle\` without a name for the generator.`);
    return;
  }

  // Named card → show the interactive selected-card view (with canvas) instead of the old text embed.
  const { buildRecycleSelectedMessage } = await import("../cards/recycle-generator.js");
  const msg = await buildRecycleSelectedMessage(guildId, userId, card.id);
  if (typeof msg === "string") {
    await interaction.editReply({ content: msg, embeds: [], components: [], files: [] });
    return;
  }
  await interaction.editReply(msg);
}

// Button: recycle:do:<cardId> — confirm and perform one recycle step.
export async function handleRecycleButton(interaction: ButtonInteraction): Promise<void> {
  // Route the new interactive generator actions to the generator handler, and the
  // legacy recycle:do confirm to the animated confirm handler.
  const parts = interaction.customId.split(":");
  if (parts[0] !== "recycle") return;
  if (parts[1] === "select" || parts[1] === "back" || parts[1] === "search-modal" || parts[1] === "search-select") {
    await handleRecycleComponent(interaction);
    return;
  }
  if (parts[1] === "merge-all") {
    const { handleRecycleMergeAll } = await import("../cards/recycle-generator.js");
    await handleRecycleMergeAll(interaction);
    return;
  }
  await handleRecycleConfirmButton(interaction);
}

// Kept for compatibility with any older imports.
export const TRADEIN_COST = recycleCost(0);
