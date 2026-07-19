// ─────────────────────────────────────────────────────────────────────────────
// /card_recycle (internal command key "tradein") — Card Fusion
//
// Thin dispatcher into cards/fusion.ts. Star Rank is the single progression
// axis: Fuse spends duplicates + Scrap to raise a card's Star Rank; Recycle
// turns spare duplicates into Scrap.
// ─────────────────────────────────────────────────────────────────────────────

import type {
  ChatInputCommandInteraction, ButtonInteraction, StringSelectMenuInteraction,
} from "discord.js";
import {
  handleFusionCommand, handleFusionComponent,
} from "../cards/fusion.js";

export async function handleTradein(interaction: ChatInputCommandInteraction): Promise<void> {
  await handleFusionCommand(interaction);
}

// Routes all recycle:* button + select-menu interactions.
export async function handleRecycleButton(
  interaction: ButtonInteraction | StringSelectMenuInteraction,
): Promise<void> {
  await handleFusionComponent(interaction);
}
