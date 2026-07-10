// Central router for every Bob component interaction (customId prefix `bob:`).
// Buttons, select menus, and the talk modal all funnel through here.

import type {
  ButtonInteraction, StringSelectMenuInteraction, UserSelectMenuInteraction, ModalSubmitInteraction,
} from "discord.js";
import { handleBobMenu, handleTitleEquip } from "./menu.js";
import { handleBobGame } from "./games.js";
import { playRoulette, handleRouletteAction, handleBobDuel } from "./roulette.js";
import { handleRoastPick } from "./roast.js";
import { handleTalkSay, handleTalkModal, handleTalkForget } from "./talk.js";
import { handleBobEvent } from "./events.js";
import { buildLeaderboardEmbed, leaderboardSelect } from "./stats.js";
import { getBobSettings } from "./db.js";
import { rollForm } from "./persona.js";
import { logger } from "../../lib/logger.js";
import type { BobBoard } from "./db.js";

export function isBobComponent(customId: string): boolean {
  return customId.startsWith("bob:");
}

// If a handler throws (often mid-animation, after the interaction was already
// acknowledged), log it and try to leave the user a note instead of a silent
// "This interaction failed".
async function guard(interaction: ButtonInteraction | StringSelectMenuInteraction | UserSelectMenuInteraction, fn: () => Promise<void>): Promise<void> {
  try { await fn(); }
  catch (err) {
    logger.warn({ err, customId: interaction.customId }, "bob component handler error");
    try {
      const msg = "🤖 Bob glitched mid-thought. Try that again.";
      if (interaction.replied || interaction.deferred) await interaction.followUp({ content: msg, flags: 64 }).catch(() => {});
      else await interaction.reply({ content: msg, flags: 64 }).catch(() => {});
    } catch { /* ignore */ }
  }
}

// Buttons.
export async function handleBobButton(interaction: ButtonInteraction): Promise<void> {
  const parts = interaction.customId.split(":"); // bob:<area>:<...>
  await guard(interaction, async () => {
    switch (parts[1]) {
      case "menu": return handleBobMenu(interaction, parts[2] ?? "home");
      case "game": return handleBobGame(interaction, parts);
      case "roulette":
        if (parts[2] === "act") return handleRouletteAction(interaction, parts);
        return playRoulette(interaction);
      case "duel": return handleBobDuel(interaction, parts);
      case "event": return handleBobEvent(interaction, parts);
      case "talk":
        if (parts[2] === "say") return handleTalkSay(interaction);
        if (parts[2] === "forget") return handleTalkForget(interaction);
        return;
      default: return;
    }
  });
}

// String select menus.
export async function handleBobSelect(interaction: StringSelectMenuInteraction): Promise<void> {
  await guard(interaction, async () => {
    const parts = interaction.customId.split(":");
    if (parts[1] === "title") return handleTitleEquip(interaction);
    if (parts[1] === "board") {
      const board = interaction.values[0] as BobBoard;
      const form = rollForm(await getBobSettings(interaction.guildId!));
      await interaction.update({ embeds: [await buildLeaderboardEmbed(interaction.guildId!, board, form)], components: [leaderboardSelect(board)] }).catch(() => {});
    }
  });
}

// User select menu (roast target picker).
export async function handleBobUserSelect(interaction: UserSelectMenuInteraction): Promise<void> {
  await guard(interaction, async () => {
    const parts = interaction.customId.split(":");
    if (parts[1] === "roast") return handleRoastPick(interaction);
  });
}

// Modal submit (talk).
export async function handleBobModal(interaction: ModalSubmitInteraction): Promise<void> {
  if (interaction.customId === "bob:talk:modal") return handleTalkModal(interaction);
}
