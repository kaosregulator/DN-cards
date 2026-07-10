// Thin slash-command wrappers for Bob. Each is a flat top-level command
// (/bob, /bob_roulette, /bob_duel, …) matching the project's underscore naming.

import type { ChatInputCommandInteraction } from "discord.js";
import { openBobMenu } from "./menu.js";
import { playRoulette, startDuel } from "./roulette.js";
import { handleRoastCommand } from "./roast.js";
import { handleTalkCommand } from "./talk.js";
import { buildStatsEmbed, buildLeaderboardEmbed, leaderboardSelect } from "./stats.js";
import { getBobSettings } from "./db.js";
import { rollForm } from "./persona.js";
import { EPHEMERAL } from "./ui.js";
import type { BobBoard } from "./db.js";

export const handleBob = openBobMenu;
export const handleBobRoulette = playRoulette;

export async function handleBobDuel(interaction: ChatInputCommandInteraction): Promise<void> {
  await startDuel(interaction, interaction.options.getUser("user", true));
}

export async function handleBobRoast(interaction: ChatInputCommandInteraction): Promise<void> {
  await handleRoastCommand(interaction, interaction.options.getUser("user", true));
}

export async function handleBobTalk(interaction: ChatInputCommandInteraction): Promise<void> {
  await handleTalkCommand(interaction, interaction.options.getString("message"));
}

export async function handleBobStats(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!interaction.guildId) { await interaction.reply({ content: "Server only.", ...EPHEMERAL }); return; }
  await interaction.deferReply(EPHEMERAL);
  const target = interaction.options.getUser("user") ?? interaction.user;
  const form = rollForm(await getBobSettings(interaction.guildId));
  await interaction.editReply({ embeds: [await buildStatsEmbed(interaction.guildId, target.id, form, target.username)] });
}

export async function handleBobLeaderboard(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!interaction.guildId) { await interaction.reply({ content: "Server only.", ...EPHEMERAL }); return; }
  await interaction.deferReply(EPHEMERAL);
  const board = (interaction.options.getString("board") ?? "coins") as BobBoard;
  const form = rollForm(await getBobSettings(interaction.guildId));
  await interaction.editReply({ embeds: [await buildLeaderboardEmbed(interaction.guildId, board, form)], components: [leaderboardSelect(board)] });
}
