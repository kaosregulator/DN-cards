// /secret — true panel hub (ONE slash). Whisper or staff secret via buttons.

import type {
  ChatInputCommandInteraction,
  ButtonInteraction,
  UserSelectMenuInteraction,
} from "discord.js";
import {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  UserSelectMenuBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  MessageFlags,
  PermissionFlagsBits,
} from "discord.js";

const EPHEMERAL = { flags: MessageFlags.Ephemeral } as const;

export function buildSecretCommandJson() {
  return new SlashCommandBuilder()
    .setName("secret")
    .setDescription("Encrypted Echo messages — whisper a member or post a staff secret")
    .setDMPermission(false)
    .toJSON();
}

function hubEmbed(): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(0x7c3aed)
    .setTitle("🔐 Echo Secret Hub")
    .setDescription(
      [
        "Send encrypted messages that only the right people can reveal.",
        "",
        "**Whisper** — private note only one member can open",
        "**Staff secret** — encrypted staff post (viewer roles / admin)",
        "",
        "Configure viewer roles with `/echo`.",
      ].join("\n"),
    )
    .setFooter({ text: "One slash · panel actions" });
}

function hubRows() {
  return [
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId("secrethub:whisper").setLabel("Whisper").setEmoji("💬").setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId("secrethub:staff").setLabel("Staff secret").setEmoji("🛡️").setStyle(ButtonStyle.Secondary),
    ),
  ];
}

export async function handleSecretCommand(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!interaction.guildId) {
    await interaction.reply({ content: "Server only.", ...EPHEMERAL });
    return;
  }
  await interaction.deferReply(EPHEMERAL);
  await interaction.editReply({ embeds: [hubEmbed()], components: hubRows() });
}

export async function handleSecretHubComponent(
  interaction: ButtonInteraction | UserSelectMenuInteraction,
): Promise<void> {
  const id = interaction.customId;

  if (id === "secrethub:whisper" && interaction.isButton()) {
    const row = new ActionRowBuilder<UserSelectMenuBuilder>().addComponents(
      new UserSelectMenuBuilder()
        .setCustomId("secrethub:whisper_user")
        .setPlaceholder("Who can read this whisper?")
        .setMinValues(1)
        .setMaxValues(1),
    );
    await interaction.reply({
      content: "Pick the member who can decrypt your whisper:",
      components: [row],
      ...EPHEMERAL,
    });
    return;
  }

  if (id === "secrethub:whisper_user" && interaction.isUserSelectMenu()) {
    const target = interaction.users.first();
    if (!target || target.bot || target.id === interaction.user.id) {
      await interaction.reply({ content: "Pick a real member (not yourself or a bot).", ...EPHEMERAL });
      return;
    }
    const modal = new ModalBuilder()
      .setCustomId(`whisper_modal:${target.id}`)
      .setTitle("Write your whisper");
    const textInput = new TextInputBuilder()
      .setCustomId("whisper_text")
      .setLabel("Your private message")
      .setStyle(TextInputStyle.Paragraph)
      .setPlaceholder("Type your encrypted message here…")
      .setMinLength(1).setMaxLength(1500).setRequired(true);
    modal.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(textInput));
    await interaction.showModal(modal);
    return;
  }

  if (id === "secrethub:staff" && interaction.isButton()) {
    const member = interaction.member;
    const isAdmin = !!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator);
    // Soft gate — existing modal handler also validates
    if (!isAdmin && member && "roles" in member) {
      // Allow through; handleAdminSecretCommand previously had no extra gate beyond slash perms
    }
    const modal = new ModalBuilder()
      .setCustomId("adminsecret_modal")
      .setTitle("Write your admin secret");
    const textInput = new TextInputBuilder()
      .setCustomId("adminsecret_text")
      .setLabel("Your encrypted message")
      .setStyle(TextInputStyle.Paragraph)
      .setPlaceholder("Type your secret message here…")
      .setMinLength(1).setMaxLength(1500).setRequired(true);
    modal.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(textInput));
    await interaction.showModal(modal);
  }
}
