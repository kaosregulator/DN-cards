// /vaultvalue — true panel hub (ONE slash). Buttons + modals, no subcommands.

import type {
  ChatInputCommandInteraction,
  ButtonInteraction,
  ChannelSelectMenuInteraction,
  ModalSubmitInteraction,
} from "discord.js";
import {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelSelectMenuBuilder,
  ChannelType,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  MessageFlags,
  PermissionFlagsBits,
} from "discord.js";
import { withOptionValues } from "./option-proxy.js";

const EPHEMERAL = { flags: MessageFlags.Ephemeral } as const;

export function buildVaultValueCommandJson() {
  return new SlashCommandBuilder()
    .setName("vaultvalue")
    .setDescription("Vault Values — MT prices, calculator, top list (valuevaultx.com)")
    .setDMPermission(false)
    .toJSON();
}

function hubEmbed(): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(0xf59e0b)
    .setTitle("📦 Vault Values Hub")
    .setDescription(
      [
        "Military Tycoon prices from [valuevaultx.com](https://valuevaultx.com).",
        "",
        "**Info** — look up one item",
        "**Calc** — two-sided trade calculator",
        "**List** — top items by value",
        "**Help** — how pricing works",
        "**Post Calc** — (admin) pin a calculator in a channel",
      ].join("\n"),
    )
    .setFooter({ text: "One slash · panel actions · valuevaultx.com" });
}

function hubRows(isAdmin: boolean) {
  const rows = [
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId("vvhub:info").setLabel("Info").setEmoji("🔎").setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId("vvhub:calc").setLabel("Calculator").setEmoji("🧮").setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId("vvhub:list").setLabel("Top list").setEmoji("📊").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId("vvhub:help").setLabel("Help").setEmoji("❓").setStyle(ButtonStyle.Secondary),
    ),
  ];
  if (isAdmin) {
    rows.push(
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId("vvhub:postcalc").setLabel("Post calculator").setEmoji("📌").setStyle(ButtonStyle.Danger),
      ),
    );
  }
  return rows;
}

export async function handleVaultValueCommand(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!interaction.guildId) {
    await interaction.reply({ content: "Server only.", ...EPHEMERAL });
    return;
  }
  await interaction.deferReply(EPHEMERAL);
  const isAdmin = !!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator);
  await interaction.editReply({ embeds: [hubEmbed()], components: hubRows(isAdmin) });
}

export async function handleVaultValueHubComponent(
  interaction: ButtonInteraction | ChannelSelectMenuInteraction,
): Promise<void> {
  const id = interaction.customId;

  if (id === "vvhub:info" && interaction.isButton()) {
    const modal = new ModalBuilder()
      .setCustomId("vvhub:modal:info")
      .setTitle("Vault Values lookup")
      .addComponents(
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder().setCustomId("item").setLabel("Item name")
            .setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(100)
            .setPlaceholder("e.g. M1 Abrams"),
        ),
      );
    await interaction.showModal(modal);
    return;
  }

  if (id === "vvhub:calc" && interaction.isButton()) {
    const { handleCalc } = await import("./mttvalues.js");
    await handleCalc(interaction as unknown as ChatInputCommandInteraction);
    return;
  }

  if (id === "vvhub:list" && interaction.isButton()) {
    const { handleValueList } = await import("./mttvalues.js");
    await handleValueList(interaction as unknown as ChatInputCommandInteraction);
    return;
  }

  if (id === "vvhub:help" && interaction.isButton()) {
    const { handleValueHelp } = await import("./mttvalues.js");
    await handleValueHelp(interaction as unknown as ChatInputCommandInteraction);
    return;
  }

  if (id === "vvhub:postcalc" && interaction.isButton()) {
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
      await interaction.reply({ content: "Administrator only.", ...EPHEMERAL });
      return;
    }
    const row = new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(
      new ChannelSelectMenuBuilder()
        .setCustomId("vvhub:postcalc_channel")
        .setPlaceholder("Channel to post the calculator in")
        .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
        .setMinValues(1)
        .setMaxValues(1),
    );
    await interaction.reply({
      content: "Pick the channel for the persistent calculator hub:",
      components: [row],
      ...EPHEMERAL,
    });
    return;
  }

  if (id === "vvhub:postcalc_channel" && interaction.isChannelSelectMenu()) {
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
      await interaction.reply({ content: "Administrator only.", ...EPHEMERAL });
      return;
    }
    const channel = interaction.channels.first();
    if (!channel) {
      await interaction.reply({ content: "No channel selected.", ...EPHEMERAL });
      return;
    }
    await interaction.deferReply(EPHEMERAL);
    const proxied = withOptionValues(interaction, {
      channels: { channel: channel as never, result_channel: null },
    });
    const { handlePostCalculator } = await import("./mttcalc-hub.js");
    await handlePostCalculator(proxied);
  }
}

export async function handleVaultValueHubModal(interaction: ModalSubmitInteraction): Promise<void> {
  if (interaction.customId !== "vvhub:modal:info") return;
  const item = interaction.fields.getTextInputValue("item").trim();
  if (!item) {
    await interaction.reply({ content: "Enter an item name.", ...EPHEMERAL });
    return;
  }
  const proxied = withOptionValues(interaction, {
    strings: { item },
  });
  const { handleInfoMTTV } = await import("./mttvalues.js");
  await handleInfoMTTV(proxied);
}
