// ─────────────────────────────────────────────────────────────────────────────
// Market Hub — a /help-style ephemeral hub for the whole marketplace, launched
// from /market or the 🏪 button on /user-hub. Every /market subcommand's action
// lives here as a dropdown entry; input-heavy actions (sell / bid) open a modal,
// pick actions (buy / bid / cancel) use a listing dropdown. All actions reuse
// the exact same core functions as the /market slash command — no logic drift.
// ─────────────────────────────────────────────────────────────────────────────

import type {
  ChatInputCommandInteraction, StringSelectMenuInteraction, ButtonInteraction, ModalSubmitInteraction,
} from "discord.js";
import {
  EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder, ButtonBuilder,
  ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle, MessageFlags,
} from "discord.js";
import {
  buildBrowseEmbed, buildMineEmbed, sellCard, buyCard, bidCard, cancelCardListing,
  buyableListings, biddableAuctions, cardMap, cardLabel,
} from "../market/commands.js";
import { getUserListings } from "../market/db.js";

const EPHEMERAL = { flags: MessageFlags.Ephemeral } as const;

type Action = "browse" | "mine" | "sell" | "buy" | "bid" | "cancel";

const ACTIONS: { id: Action; label: string; emoji: string; description: string }[] = [
  { id: "browse", label: "Browse Market", emoji: "🛒", description: "See every active listing & auction" },
  { id: "mine",   label: "My Activity",   emoji: "📃", description: "Your listings & winning bids" },
  { id: "sell",   label: "Sell a Card",   emoji: "🏷️", description: "List a card for sale or auction" },
  { id: "buy",    label: "Buy",           emoji: "💰", description: "Buy a listing (or auction buyout)" },
  { id: "bid",    label: "Bid",           emoji: "🔨", description: "Bid on an active auction" },
  { id: "cancel", label: "Cancel Listing", emoji: "🗑️", description: "Take one of your listings down" },
];

// ── Entry point ──────────────────────────────────────────────────────────────
export async function handleMarketHub(
  interaction: ChatInputCommandInteraction, opening: Action = "browse",
): Promise<void> {
  if (!interaction.deferred && !interaction.replied) {
    await interaction.deferReply(EPHEMERAL).catch(() => {});
  }
  const view = await buildView(interaction, opening);
  await interaction.editReply(view);
}

// Launch from a button (e.g. the /user-hub 🏪 button) — updates in place.
export async function openMarketHubFromButton(interaction: ButtonInteraction): Promise<void> {
  const view = await buildView(interaction, "browse");
  await interaction.update(view).catch(() => {});
}

// ── Component + modal router ──────────────────────────────────────────────────
export async function handleMarketHubComponent(
  interaction: StringSelectMenuInteraction | ButtonInteraction,
): Promise<void> {
  const parts = interaction.customId.split(":"); // market-hub:<action>[:arg]
  const action = parts[1] ?? "select";

  if (action === "select" && interaction.isStringSelectMenu()) {
    const chosen = interaction.values[0] as Action;
    // sell → modal; buy/bid/cancel → picker; browse/mine → render.
    if (chosen === "sell") { await showSellModal(interaction); return; }
    const view = await buildView(interaction, chosen);
    await interaction.update(view).catch(() => {});
    return;
  }

  // Buy: a listing was picked → execute.
  if (action === "buy-pick" && interaction.isStringSelectMenu()) {
    const id = Number(interaction.values[0]);
    const text = await buyCard(interaction.guildId!, interaction.user.id, id);
    const view = await buildView(interaction, "browse");
    await interaction.update(view).catch(() => {});
    await interaction.followUp({ content: text, ...EPHEMERAL }).catch(() => {});
    return;
  }

  // Bid: a listing was picked → open amount modal.
  if (action === "bid-pick" && interaction.isStringSelectMenu()) {
    const id = Number(interaction.values[0]);
    await showBidModal(interaction, id);
    return;
  }

  // Cancel: a listing was picked → execute.
  if (action === "cancel-pick" && interaction.isStringSelectMenu()) {
    const id = Number(interaction.values[0]);
    const text = await cancelCardListing(interaction.guildId!, interaction.user.id, id);
    const view = await buildView(interaction, "mine");
    await interaction.update(view).catch(() => {});
    await interaction.followUp({ content: text, ...EPHEMERAL }).catch(() => {});
    return;
  }

  // Back to the user-hub.
  if (action === "back" && interaction.isButton()) {
    const { openUserHubFromButton } = await import("./user-hub.js");
    await openUserHubFromButton(interaction);
    return;
  }
}

// Modal submissions (market-hub:modal:*).
export async function handleMarketHubModal(interaction: ModalSubmitInteraction): Promise<void> {
  const parts = interaction.customId.split(":"); // market-hub:modal:<kind>[:id]
  const kind = parts[2];
  const guildId = interaction.guildId!;
  const userId = interaction.user.id;

  if (kind === "sell") {
    const name = interaction.fields.getTextInputValue("name").trim();
    const price = Number(interaction.fields.getTextInputValue("price").replace(/,/g, "").trim());
    const hoursRaw = interaction.fields.getTextInputValue("hours").trim();
    const buyoutRaw = interaction.fields.getTextInputValue("buyout").trim();
    const hours = hoursRaw ? Number(hoursRaw.replace(/,/g, "")) : null;
    const buyout = buyoutRaw ? Number(buyoutRaw.replace(/,/g, "")) : null;
    if (hoursRaw && !Number.isInteger(hours)) { await interaction.reply({ content: "❌ Hours must be a whole number.", ...EPHEMERAL }); return; }
    if (buyoutRaw && !Number.isInteger(buyout)) { await interaction.reply({ content: "❌ Buyout must be a whole number.", ...EPHEMERAL }); return; }
    const res = await sellCard(guildId, userId, { name, price, hours, buyout });
    if (!res.ok) { await interaction.reply({ content: res.error, ...EPHEMERAL }); return; }
    await interaction.reply({ embeds: [res.embed], ...EPHEMERAL });
    return;
  }

  if (kind === "bid") {
    const id = Number(parts[3]);
    const amount = Number(interaction.fields.getTextInputValue("amount").replace(/,/g, "").trim());
    if (!Number.isInteger(amount) || amount < 1) { await interaction.reply({ content: "❌ Bid must be a whole number ≥ 1.", ...EPHEMERAL }); return; }
    const text = await bidCard(guildId, userId, id, amount);
    await interaction.reply({ content: text, ...EPHEMERAL });
    return;
  }
}

// ── View builder ──────────────────────────────────────────────────────────────
type AnyInteraction = ChatInputCommandInteraction | StringSelectMenuInteraction | ButtonInteraction;

function actionRow(current: Action) {
  const select = new StringSelectMenuBuilder()
    .setCustomId("market-hub:select")
    .setPlaceholder("🏪 Choose a marketplace action…")
    .addOptions(ACTIONS.map(a => ({ label: a.label, value: a.id, description: a.description, emoji: a.emoji, default: a.id === current })));
  return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select);
}

function backRow() {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId("market-hub:back").setLabel("Back to Hub").setEmoji("⬅️").setStyle(ButtonStyle.Secondary),
  );
}

async function buildView(interaction: AnyInteraction, action: Action) {
  const guildId = interaction.guildId!;
  const userId = interaction.user.id;
  const rows: ActionRowBuilder<any>[] = [actionRow(action)];
  let embeds: EmbedBuilder[];

  switch (action) {
    case "browse": {
      const embed = await buildBrowseEmbed(guildId);
      embeds = [embed ?? new EmbedBuilder().setTitle("🛒 Marketplace").setColor(0x3498db).setDescription("The market is empty right now. List a card with **Sell a Card**.")];
      break;
    }
    case "mine":
      embeds = [await buildMineEmbed(guildId, userId)];
      break;
    case "buy": {
      const listings = await buyableListings(guildId, userId);
      const cards = await cardMap(guildId);
      if (listings.length === 0) {
        embeds = [new EmbedBuilder().setTitle("💰 Buy").setColor(0x3498db).setDescription("Nothing available to buy right now.")];
      } else {
        embeds = [new EmbedBuilder().setTitle("💰 Buy a Listing").setColor(0x3498db).setDescription("Pick a listing below to buy it (auctions use their buyout price).")];
        rows.push(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
          new StringSelectMenuBuilder().setCustomId("market-hub:buy-pick").setPlaceholder("Pick a listing to buy…")
            .addOptions(listings.map(l => ({
              label: cardLabel(cards.get(l.cardId), l.cardId).slice(0, 100),
              value: l.id.toString(),
              description: l.kind === "auction" ? `Buyout 💠 ${l.buyout!.toLocaleString()}` : `💠 ${l.price.toLocaleString()}`,
            }))),
        ));
      }
      break;
    }
    case "bid": {
      const auctions = await biddableAuctions(guildId, userId);
      const cards = await cardMap(guildId);
      if (auctions.length === 0) {
        embeds = [new EmbedBuilder().setTitle("🔨 Bid").setColor(0x3498db).setDescription("No active auctions to bid on right now.")];
      } else {
        embeds = [new EmbedBuilder().setTitle("🔨 Bid on an Auction").setColor(0x3498db).setDescription("Pick an auction, then enter your bid amount.")];
        rows.push(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
          new StringSelectMenuBuilder().setCustomId("market-hub:bid-pick").setPlaceholder("Pick an auction to bid on…")
            .addOptions(auctions.map(l => ({
              label: cardLabel(cards.get(l.cardId), l.cardId).slice(0, 100),
              value: l.id.toString(),
              description: `Current 💠 ${(l.currentBid ?? l.price).toLocaleString()}`,
            }))),
        ));
      }
      break;
    }
    case "cancel": {
      const listings = await getUserListings(guildId, userId);
      const cards = await cardMap(guildId);
      if (listings.length === 0) {
        embeds = [new EmbedBuilder().setTitle("🗑️ Cancel").setColor(0x9b59b6).setDescription("You have no active listings to cancel.")];
      } else {
        embeds = [new EmbedBuilder().setTitle("🗑️ Cancel a Listing").setColor(0x9b59b6).setDescription("Pick one of your listings to take it down.")];
        rows.push(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
          new StringSelectMenuBuilder().setCustomId("market-hub:cancel-pick").setPlaceholder("Pick a listing to cancel…")
            .addOptions(listings.map(l => ({
              label: cardLabel(cards.get(l.cardId), l.cardId).slice(0, 100),
              value: l.id.toString(),
              description: l.kind === "auction" ? "Auction" : `💠 ${l.price.toLocaleString()}`,
            }))),
        ));
      }
      break;
    }
    default:
      embeds = [new EmbedBuilder().setTitle("🏪 Market Hub").setColor(0x3498db)];
  }

  rows.push(backRow());
  return { embeds, components: rows };
}

// ── Modals ────────────────────────────────────────────────────────────────────
async function showSellModal(interaction: StringSelectMenuInteraction) {
  const modal = new ModalBuilder().setCustomId("market-hub:modal:sell").setTitle("Sell a Card");
  modal.addComponents(
    new ActionRowBuilder<TextInputBuilder>().addComponents(
      new TextInputBuilder().setCustomId("name").setLabel("Card name").setStyle(TextInputStyle.Short).setRequired(true).setPlaceholder("e.g. Abrams"),
    ),
    new ActionRowBuilder<TextInputBuilder>().addComponents(
      new TextInputBuilder().setCustomId("price").setLabel("Price / starting bid (💠)").setStyle(TextInputStyle.Short).setRequired(true).setPlaceholder("Whole number ≥ 1"),
    ),
    new ActionRowBuilder<TextInputBuilder>().addComponents(
      new TextInputBuilder().setCustomId("hours").setLabel("Auction hours (leave blank = fixed sale)").setStyle(TextInputStyle.Short).setRequired(false).setPlaceholder("1–168"),
    ),
    new ActionRowBuilder<TextInputBuilder>().addComponents(
      new TextInputBuilder().setCustomId("buyout").setLabel("Buyout price (auctions only, optional)").setStyle(TextInputStyle.Short).setRequired(false),
    ),
  );
  await interaction.showModal(modal);
}

async function showBidModal(interaction: StringSelectMenuInteraction, listingId: number) {
  const modal = new ModalBuilder().setCustomId(`market-hub:modal:bid:${listingId}`).setTitle("Place a Bid");
  modal.addComponents(
    new ActionRowBuilder<TextInputBuilder>().addComponents(
      new TextInputBuilder().setCustomId("amount").setLabel("Bid amount (💠)").setStyle(TextInputStyle.Short).setRequired(true).setPlaceholder("Whole number of shards"),
    ),
  );
  await interaction.showModal(modal);
}
