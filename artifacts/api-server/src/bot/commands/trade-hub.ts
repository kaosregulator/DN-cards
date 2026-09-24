// /trade hub — propose, pending, history, accept, decline, gift.
// Buttons (trade_accept / trade_decline) and autocomplete stay on existing handlers.

import {
  SlashCommandBuilder,
  MessageFlags,
  type ChatInputCommandInteraction,
} from "discord.js";
import {
  handleTrade, handleAccept, handleDecline, handleListTrades, handleGift, handleTradeHistory,
} from "./trading.js";

const EPHEMERAL = { flags: MessageFlags.Ephemeral } as const;

export function buildTradeHubCommandJson() {
  return new SlashCommandBuilder()
    .setName("trade")
    .setDescription("Trade cards & shards — propose, pending, history, gift")
    .setDMPermission(false)
    .addSubcommand(sc => sc
      .setName("propose")
      .setDescription("Propose a trade — cards, shards, or both")
      .addUserOption(o => o.setName("user").setDescription("Member to trade with").setRequired(true))
      .addStringOption(o => o.setName("offer").setDescription("Name you are offering").setAutocomplete(true))
      .addStringOption(o => o.setName("want").setDescription("Name you want in return").setAutocomplete(true))
      .addIntegerOption(o => o.setName("offer_shards").setDescription("💠 shards you offer (optional)").setMinValue(1))
      .addIntegerOption(o => o.setName("want_shards").setDescription("💠 shards you want (optional)").setMinValue(1)))
    .addSubcommand(sc => sc
      .setName("pending")
      .setDescription("View your pending trade offers"))
    .addSubcommand(sc => sc
      .setName("history")
      .setDescription("View recent completed trades")
      .addUserOption(o => o.setName("user").setDescription("Whose history to view (default: you)").setRequired(false)))
    .addSubcommand(sc => sc
      .setName("accept")
      .setDescription("Accept a pending trade by ID")
      .addIntegerOption(o => o.setName("id").setDescription("Trade ID from /trade pending").setRequired(true).setMinValue(1)))
    .addSubcommand(sc => sc
      .setName("decline")
      .setDescription("Decline or cancel a trade by ID")
      .addIntegerOption(o => o.setName("id").setDescription("Trade ID from /trade pending").setRequired(true).setMinValue(1)))
    .addSubcommand(sc => sc
      .setName("gift")
      .setDescription("Gift DN Shards to another member")
      .addUserOption(o => o.setName("user").setDescription("Member to send shards to").setRequired(true))
      .addIntegerOption(o => o.setName("amount").setDescription("Amount of 💠 shards to gift").setRequired(true).setMinValue(1)))
    .toJSON();
}

export async function handleTradeHubCommand(interaction: ChatInputCommandInteraction): Promise<void> {
  const sub = interaction.options.getSubcommand(true);
  // Match legacy visibility: pending/history private; propose/accept/decline/gift public.
  const ephemeral = sub === "pending" || sub === "history";
  if (!interaction.deferred && !interaction.replied) {
    await interaction.deferReply(ephemeral ? EPHEMERAL : {});
  }
  switch (sub) {
    case "propose":
      await handleTrade(interaction);
      return;
    case "pending":
      await handleListTrades(interaction);
      return;
    case "history":
      await handleTradeHistory(interaction);
      return;
    case "accept":
      await handleAccept(interaction);
      return;
    case "decline":
      await handleDecline(interaction);
      return;
    case "gift":
      await handleGift(interaction);
      return;
    default:
      await interaction.editReply({ content: "Unknown trade action." });
  }
}
