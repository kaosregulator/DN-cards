// /trade — true panel hub (ONE slash command, buttons + modals).
// No subcommands → Discord autocomplete shows a single `/trade` row.

import type {
  ChatInputCommandInteraction,
  ButtonInteraction,
  UserSelectMenuInteraction,
  ModalSubmitInteraction,
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
} from "discord.js";
import {
  handleTrade, handleAccept, handleDecline, handleListTrades, handleGift, handleTradeHistory,
} from "./trading.js";
import { withOptionValues } from "./option-proxy.js";

const EPHEMERAL = { flags: MessageFlags.Ephemeral } as const;

export function buildTradeHubCommandJson() {
  return new SlashCommandBuilder()
    .setName("trade")
    .setDescription("Trade cards & shards — propose, pending, gift, accept")
    .setDMPermission(false)
    .toJSON();
}

function hubEmbed(): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(0x0984e3)
    .setTitle("🔄 Trade Hub")
    .setDescription(
      [
        "One place for card & shard trades — pick an action below.",
        "",
        "**Propose** — offer cards and/or 💠 to a member",
        "**Pending** — your open offers",
        "**History** — recent completed trades",
        "**Accept / Decline** — by trade ID (or use buttons on the offer)",
        "**Gift** — send 💠 shards",
      ].join("\n"),
    )
    .setFooter({ text: "Buttons open the flow · no slash subcommands" });
}

function hubRows() {
  return [
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId("tradehub:propose").setLabel("Propose").setEmoji("🤝").setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId("tradehub:pending").setLabel("Pending").setEmoji("📥").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId("tradehub:history").setLabel("History").setEmoji("📜").setStyle(ButtonStyle.Secondary),
    ),
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId("tradehub:accept").setLabel("Accept").setEmoji("✅").setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId("tradehub:decline").setLabel("Decline").setEmoji("❌").setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId("tradehub:gift").setLabel("Gift shards").setEmoji("💠").setStyle(ButtonStyle.Primary),
    ),
  ];
}

export async function handleTradeHubCommand(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!interaction.guildId) {
    await interaction.reply({ content: "Server only.", ...EPHEMERAL });
    return;
  }
  await interaction.deferReply(EPHEMERAL);
  await interaction.editReply({ embeds: [hubEmbed()], components: hubRows() });
}

export async function handleTradeHubComponent(
  interaction: ButtonInteraction | UserSelectMenuInteraction,
): Promise<void> {
  const id = interaction.customId;

  if (id === "tradehub:propose" && interaction.isButton()) {
    const row = new ActionRowBuilder<UserSelectMenuBuilder>().addComponents(
      new UserSelectMenuBuilder()
        .setCustomId("tradehub:propose_user")
        .setPlaceholder("Who are you trading with?")
        .setMinValues(1)
        .setMaxValues(1),
    );
    await interaction.reply({
      content: "Pick the member to trade with:",
      components: [row],
      ...EPHEMERAL,
    });
    return;
  }

  if (id === "tradehub:propose_user" && interaction.isUserSelectMenu()) {
    const target = interaction.users.first();
    if (!target || target.bot || target.id === interaction.user.id) {
      await interaction.reply({ content: "Pick a real member (not yourself or a bot).", ...EPHEMERAL });
      return;
    }
    const modal = new ModalBuilder()
      .setCustomId(`tradehub:modal:propose:${target.id}`)
      .setTitle(`Trade with ${target.username}`.slice(0, 45))
      .addComponents(
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder().setCustomId("offer").setLabel("Card you offer (optional)")
            .setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(80),
        ),
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder().setCustomId("want").setLabel("Card you want (optional)")
            .setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(80),
        ),
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder().setCustomId("offer_shards").setLabel("Shards you offer (optional)")
            .setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(12)
            .setPlaceholder("e.g. 500"),
        ),
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder().setCustomId("want_shards").setLabel("Shards you want (optional)")
            .setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(12)
            .setPlaceholder("e.g. 200"),
        ),
      );
    await interaction.showModal(modal);
    return;
  }

  if (id === "tradehub:gift" && interaction.isButton()) {
    const row = new ActionRowBuilder<UserSelectMenuBuilder>().addComponents(
      new UserSelectMenuBuilder()
        .setCustomId("tradehub:gift_user")
        .setPlaceholder("Who gets the shards?")
        .setMinValues(1)
        .setMaxValues(1),
    );
    await interaction.reply({
      content: "Pick who to gift 💠 shards to:",
      components: [row],
      ...EPHEMERAL,
    });
    return;
  }

  if (id === "tradehub:gift_user" && interaction.isUserSelectMenu()) {
    const target = interaction.users.first();
    if (!target || target.bot || target.id === interaction.user.id) {
      await interaction.reply({ content: "Pick a real member (not yourself or a bot).", ...EPHEMERAL });
      return;
    }
    const modal = new ModalBuilder()
      .setCustomId(`tradehub:modal:gift:${target.id}`)
      .setTitle(`Gift shards to ${target.username}`.slice(0, 45))
      .addComponents(
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder().setCustomId("amount").setLabel("Shard amount")
            .setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(12)
            .setPlaceholder("e.g. 1000"),
        ),
      );
    await interaction.showModal(modal);
    return;
  }

  if (id === "tradehub:accept" && interaction.isButton()) {
    const modal = new ModalBuilder()
      .setCustomId("tradehub:modal:accept")
      .setTitle("Accept a trade")
      .addComponents(
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder().setCustomId("id").setLabel("Trade ID from Pending")
            .setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(10),
        ),
      );
    await interaction.showModal(modal);
    return;
  }

  if (id === "tradehub:decline" && interaction.isButton()) {
    const modal = new ModalBuilder()
      .setCustomId("tradehub:modal:decline")
      .setTitle("Decline / cancel a trade")
      .addComponents(
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder().setCustomId("id").setLabel("Trade ID")
            .setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(10),
        ),
      );
    await interaction.showModal(modal);
    return;
  }

  if (id === "tradehub:pending" && interaction.isButton()) {
    await interaction.deferReply(EPHEMERAL);
    await handleListTrades(interaction as unknown as ChatInputCommandInteraction);
    return;
  }

  if (id === "tradehub:history" && interaction.isButton()) {
    await interaction.deferReply(EPHEMERAL);
    const proxied = withOptionValues(interaction, {
      users: { user: interaction.user },
    });
    await handleTradeHistory(proxied);
    return;
  }
}

export async function handleTradeHubModal(interaction: ModalSubmitInteraction): Promise<void> {
  const id = interaction.customId;

  if (id.startsWith("tradehub:modal:propose:")) {
    const targetId = id.slice("tradehub:modal:propose:".length);
    const target = await interaction.client.users.fetch(targetId).catch(() => null);
    if (!target) {
      await interaction.reply({ content: "Could not resolve that member.", ...EPHEMERAL });
      return;
    }
    const offer = interaction.fields.getTextInputValue("offer")?.trim() || null;
    const want = interaction.fields.getTextInputValue("want")?.trim() || null;
    const offerShardsRaw = interaction.fields.getTextInputValue("offer_shards")?.trim() || "";
    const wantShardsRaw = interaction.fields.getTextInputValue("want_shards")?.trim() || "";
    const offerShards = offerShardsRaw ? Number.parseInt(offerShardsRaw.replace(/,/g, ""), 10) : null;
    const wantShards = wantShardsRaw ? Number.parseInt(wantShardsRaw.replace(/,/g, ""), 10) : null;
    if (offerShardsRaw && (!Number.isFinite(offerShards) || (offerShards ?? 0) < 0)) {
      await interaction.reply({ content: "Offer shards must be a positive number.", ...EPHEMERAL });
      return;
    }
    if (wantShardsRaw && (!Number.isFinite(wantShards) || (wantShards ?? 0) < 0)) {
      await interaction.reply({ content: "Want shards must be a positive number.", ...EPHEMERAL });
      return;
    }
    // Public trade proposal
    await interaction.deferReply();
    const proxied = withOptionValues(interaction, {
      users: { user: target },
      strings: { offer, want },
      integers: {
        offer_shards: offerShards && offerShards > 0 ? offerShards : null,
        want_shards: wantShards && wantShards > 0 ? wantShards : null,
      },
    });
    await handleTrade(proxied);
    return;
  }

  if (id.startsWith("tradehub:modal:gift:")) {
    const targetId = id.slice("tradehub:modal:gift:".length);
    const target = await interaction.client.users.fetch(targetId).catch(() => null);
    if (!target) {
      await interaction.reply({ content: "Could not resolve that member.", ...EPHEMERAL });
      return;
    }
    const amount = Number.parseInt(interaction.fields.getTextInputValue("amount").replace(/,/g, ""), 10);
    if (!Number.isFinite(amount) || amount < 1) {
      await interaction.reply({ content: "Enter a positive shard amount.", ...EPHEMERAL });
      return;
    }
    await interaction.deferReply();
    const proxied = withOptionValues(interaction, {
      users: { user: target },
      integers: { amount },
    });
    await handleGift(proxied);
    return;
  }

  if (id === "tradehub:modal:accept") {
    const tradeId = Number.parseInt(interaction.fields.getTextInputValue("id").replace(/[#\s]/g, ""), 10);
    if (!Number.isFinite(tradeId) || tradeId < 1) {
      await interaction.reply({ content: "Enter a valid trade ID.", ...EPHEMERAL });
      return;
    }
    await interaction.deferReply();
    const proxied = withOptionValues(interaction, {
      integers: { id: tradeId },
    });
    await handleAccept(proxied);
    return;
  }

  if (id === "tradehub:modal:decline") {
    const tradeId = Number.parseInt(interaction.fields.getTextInputValue("id").replace(/[#\s]/g, ""), 10);
    if (!Number.isFinite(tradeId) || tradeId < 1) {
      await interaction.reply({ content: "Enter a valid trade ID.", ...EPHEMERAL });
      return;
    }
    await interaction.deferReply();
    const proxied = withOptionValues(interaction, {
      integers: { id: tradeId },
    });
    await handleDecline(proxied);
  }
}
