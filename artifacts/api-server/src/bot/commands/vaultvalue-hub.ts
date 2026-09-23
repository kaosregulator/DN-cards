// /vaultvalue — Vault Values hub (valuevaultx.com).
// Folds vaultvalue_info/calc/help/list/postcalc. Handlers + mtcalc buttons unchanged.

import {
  SlashCommandBuilder,
  MessageFlags,
  type ChatInputCommandInteraction,
} from "discord.js";

export function buildVaultValueCommandJson() {
  return new SlashCommandBuilder()
    .setName("vaultvalue")
    .setDescription("Vault Values — look up MT prices, calculator, top list (valuevaultx.com)")
    .setDMPermission(false)
    .addSubcommand(sc => sc
      .setName("info")
      .setDescription("Show details for one item — prices from Vault Values")
      .addStringOption(o => o
        .setName("item")
        .setDescription("Item name to look up")
        .setRequired(true)
        .setAutocomplete(true)))
    .addSubcommand(sc => sc
      .setName("calc")
      .setDescription("Two-sided trade calculator with buttons"))
    .addSubcommand(sc => sc
      .setName("list")
      .setDescription("Top items by value — prices from Vault Values"))
    .addSubcommand(sc => sc
      .setName("help")
      .setDescription("How Vault Values pricing works"))
    .addSubcommand(sc => sc
      .setName("postcalc")
      .setDescription("(Admin) Post a persistent calculator hub in a channel")
      .addChannelOption(o => o
        .setName("channel")
        .setDescription("Channel to post the calculator in")
        .setRequired(true))
      .addChannelOption(o => o
        .setName("result_channel")
        .setDescription("Optional channel for calculation results")
        .setRequired(false)))
    .toJSON();
}

export async function handleVaultValueCommand(interaction: ChatInputCommandInteraction): Promise<void> {
  const sub = interaction.options.getSubcommand(true);
  if (sub === "calc") {
    // Must reply ephemerally without defer — same as legacy /vaultvalue_calc.
    const { handleCalc } = await import("./mttvalues.js");
    await handleCalc(interaction);
    return;
  }
  if (sub === "info") {
    const { handleInfoMTTV } = await import("./mttvalues.js");
    await handleInfoMTTV(interaction);
    return;
  }
  if (sub === "list") {
    const { handleValueList } = await import("./mttvalues.js");
    await handleValueList(interaction);
    return;
  }
  if (sub === "help") {
    const { handleValueHelp } = await import("./mttvalues.js");
    await handleValueHelp(interaction);
    return;
  }
  if (sub === "postcalc") {
    // handlePostCalculator expects an already-deferred ephemeral reply (same as legacy admin path).
    if (!interaction.deferred && !interaction.replied) {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    }
    const { handlePostCalculator } = await import("./mttcalc-hub.js");
    await handlePostCalculator(interaction);
    return;
  }
}
