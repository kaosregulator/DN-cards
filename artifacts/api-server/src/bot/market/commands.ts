import type { ChatInputCommandInteraction } from "discord.js";
import { EmbedBuilder, MessageFlags } from "discord.js";
import type { MarketListing } from "@workspace/db";
import { getCardByName, getAllCardsCached, getOrCreateCurrency } from "../db.js";
import { toAbsoluteImageUrl } from "../image-url.js";
import type { Rarity } from "../cards-data.js";
import {
  createListing, getListing, getActiveListings, getUserListings, getUserBids,
  buyListing, placeBid, cancelListing,
  MARKET_FEE_PCT, MIN_BID_INCREMENT, proceedsFor,
} from "./db.js";

const EPHEMERAL = { flags: MessageFlags.Ephemeral } as const;
const MAX_AUCTION_HOURS = 168; // 7 days
const RARITY_EMOJI: Record<string, string> = {
  common: "⚪", uncommon: "🟢", rare: "🔵", epic: "🟣", legendary: "🟡", mythic: "🔴",
};

async function cardMap() {
  const cards = await getAllCardsCached();
  return new Map(cards.map(c => [c.id, c]));
}

function cardLabel(card: { name: string; rarity: string } | undefined, cardId: number): string {
  if (!card) return `Card #${cardId}`;
  return `${RARITY_EMOJI[card.rarity] ?? "•"} ${card.name}`;
}

function listingLine(l: MarketListing, cards: Map<number, { name: string; rarity: string }>): string {
  const label = cardLabel(cards.get(l.cardId), l.cardId);
  if (l.kind === "auction") {
    const bid = l.currentBid != null ? `💠 ${l.currentBid.toLocaleString()} (${l.currentBidderId ? `<@${l.currentBidderId}>` : "no bids"})` : `💠 ${l.price.toLocaleString()} start`;
    const ends = l.expiresAt ? ` · ends <t:${Math.floor(l.expiresAt.getTime() / 1000)}:R>` : "";
    const buyout = l.buyout ? ` · buyout 💠 ${l.buyout.toLocaleString()}` : "";
    return `\`#${l.id}\` 🔨 **${label}** — ${bid}${buyout}${ends} · <@${l.sellerId}>`;
  }
  return `\`#${l.id}\` 🏷️ **${label}** — 💠 **${l.price.toLocaleString()}** · <@${l.sellerId}>`;
}

// ── /market sell ─────────────────────────────────────────────────────────────
async function handleSell(interaction: ChatInputCommandInteraction, guildId: string): Promise<void> {
  const userId = interaction.user.id;
  const name = interaction.options.getString("name", true);
  const price = interaction.options.getInteger("price", true);
  const hours = interaction.options.getInteger("hours");
  const buyout = interaction.options.getInteger("buyout");

  if (price < 1) { await interaction.editReply("❌ Price must be at least 💠 1."); return; }
  const card = await getCardByName(name);
  if (!card) { await interaction.editReply(`❌ "**${name}**" not found. Try \`/cards list\`.`); return; }

  const isAuction = hours != null;
  if (isAuction && (hours! < 1 || hours! > MAX_AUCTION_HOURS)) {
    await interaction.editReply(`❌ Auction duration must be between 1 and ${MAX_AUCTION_HOURS} hours.`); return;
  }
  if (buyout != null && !isAuction) { await interaction.editReply("❌ Buyout only applies to auctions (set `hours`)."); return; }
  if (buyout != null && buyout <= price) { await interaction.editReply("❌ Buyout must be higher than the starting bid."); return; }

  const expiresAt = isAuction ? new Date(Date.now() + hours! * 3_600_000) : null;
  const res = await createListing({
    guildId, sellerId: userId, cardId: card.id,
    kind: isAuction ? "auction" : "sale", price, buyout: buyout ?? null, expiresAt,
  });
  if (!res.ok) {
    await interaction.editReply(`❌ You don't own a normal copy of **${card.name}** to list. (Shiny copies can't be listed.)`);
    return;
  }

  const l = res.listing;
  const embed = new EmbedBuilder()
    .setColor(0x2ecc71)
    .setTitle(isAuction ? "🔨 Auction created" : "🏷️ Listing created")
    .setDescription(
      `**${cardLabel(card, card.id)}** is now on the market.\n` +
      (isAuction
        ? `Starting bid: 💠 **${price.toLocaleString()}**\n` +
          (buyout ? `Buyout: 💠 **${buyout.toLocaleString()}**\n` : "") +
          `Ends: <t:${Math.floor(expiresAt!.getTime() / 1000)}:R>\n`
        : `Price: 💠 **${price.toLocaleString()}**\n`) +
      `Listing ID: \`#${l.id}\`\n\n` +
      `A **${MARKET_FEE_PCT}%** market fee applies to the sale. Cancel anytime with \`/market cancel id:${l.id}\`.`,
    );
  const img = toAbsoluteImageUrl(card.imageUrl);
  if (img) embed.setThumbnail(img);
  await interaction.editReply({ embeds: [embed] });
}

// ── /market browse ───────────────────────────────────────────────────────────
async function handleBrowse(interaction: ChatInputCommandInteraction, guildId: string): Promise<void> {
  const seller = interaction.options.getUser("seller");
  const kind = interaction.options.getString("kind") as "sale" | "auction" | null;
  const listings = await getActiveListings(guildId, {
    sellerId: seller?.id, kind: kind ?? undefined, limit: 25,
  });
  if (listings.length === 0) {
    await interaction.editReply("🛒 The market is empty right now. List a card with `/market sell`.");
    return;
  }
  const cards = await cardMap();
  const sales = listings.filter(l => l.kind === "sale");
  const auctions = listings.filter(l => l.kind === "auction");
  const embed = new EmbedBuilder()
    .setTitle("🛒 Marketplace")
    .setColor(0x3498db)
    .setFooter({ text: "Buy: /market buy id:<#> · Bid: /market bid id:<#> amount:<shards>" });
  if (sales.length > 0) embed.addFields({ name: `🏷️ For sale (${sales.length})`, value: sales.map(l => listingLine(l, cards)).join("\n").slice(0, 1024), inline: false });
  if (auctions.length > 0) embed.addFields({ name: `🔨 Auctions (${auctions.length})`, value: auctions.map(l => listingLine(l, cards)).join("\n").slice(0, 1024), inline: false });
  await interaction.editReply({ embeds: [embed] });
}

// ── /market buy ──────────────────────────────────────────────────────────────
async function handleBuy(interaction: ChatInputCommandInteraction, guildId: string): Promise<void> {
  const userId = interaction.user.id;
  const id = interaction.options.getInteger("id", true);
  const listing = await getListing(id);
  if (!listing || listing.guildId !== guildId || listing.status !== "active") {
    await interaction.editReply("❌ That listing is no longer available."); return;
  }
  if (listing.sellerId === userId) { await interaction.editReply("❌ You can't buy your own listing. Use `/market cancel` instead."); return; }

  // Auctions are bought only via buyout (if set); otherwise you must bid.
  let price: number;
  if (listing.kind === "sale") {
    price = listing.price;
  } else if (listing.buyout != null) {
    price = listing.buyout;
  } else {
    await interaction.editReply(`❌ That's an auction with no buyout — place a bid with \`/market bid id:${id} amount:<shards>\`.`); return;
  }

  const res = await buyListing(guildId, userId, id, price, { isBuyout: listing.kind === "auction" });
  if (!res.ok) {
    const msg = res.reason === "gone" ? "❌ That listing was just taken or cancelled."
      : res.reason === "own_listing" ? "❌ You can't buy your own listing."
      : res.reason === "insufficient" ? `❌ You need 💠 **${price.toLocaleString()}** to buy this. Check \`/cards shards\`.`
      : "❌ That listing can't be bought directly.";
    await interaction.editReply(msg); return;
  }
  const cards = await cardMap();
  await interaction.editReply(
    `✅ Bought **${cardLabel(cards.get(res.cardId), res.cardId)}** for 💠 **${price.toLocaleString()}**! ` +
    `It's in your \`/cards collection\`. Seller <@${res.sellerId}> received 💠 ${proceedsFor(price).toLocaleString()} (after ${MARKET_FEE_PCT}% fee).`,
  );
}

// ── /market bid ──────────────────────────────────────────────────────────────
async function handleBid(interaction: ChatInputCommandInteraction, guildId: string): Promise<void> {
  const userId = interaction.user.id;
  const id = interaction.options.getInteger("id", true);
  const amount = interaction.options.getInteger("amount", true);
  const res = await placeBid(guildId, userId, id, amount);
  if (!res.ok) {
    const msg = res.reason === "gone" ? "❌ That auction is no longer active."
      : res.reason === "not_auction" ? "❌ That listing is a fixed-price sale — use `/market buy`."
      : res.reason === "own_listing" ? "❌ You can't bid on your own auction."
      : res.reason === "ended" ? "❌ That auction has already ended."
      : res.reason === "too_low" ? `❌ Bid too low — the minimum next bid is 💠 **${res.min!.toLocaleString()}** (increments of ${MIN_BID_INCREMENT}).`
      : `❌ You need 💠 **${amount.toLocaleString()}** available to bid (it's held until you're outbid or the auction ends).`;
    await interaction.editReply(msg); return;
  }
  const cards = await cardMap();
  const l = res.listing;
  await interaction.editReply(
    `✅ Bid placed: 💠 **${amount.toLocaleString()}** on **${cardLabel(cards.get(l.cardId), l.cardId)}** \`#${l.id}\`. ` +
    `Your shards are held in escrow and refunded automatically if you're outbid. ` +
    (l.expiresAt ? `Auction ends <t:${Math.floor(l.expiresAt.getTime() / 1000)}:R>.` : ""),
  );
}

// ── /market cancel ───────────────────────────────────────────────────────────
async function handleCancel(interaction: ChatInputCommandInteraction, guildId: string): Promise<void> {
  const userId = interaction.user.id;
  const id = interaction.options.getInteger("id", true);
  const res = await cancelListing(guildId, userId, id);
  if (!res.ok) {
    const msg = res.reason === "gone" ? "❌ That listing is no longer active."
      : res.reason === "not_seller" ? "❌ You can only cancel your own listings."
      : "❌ Could not cancel that listing.";
    await interaction.editReply(msg); return;
  }
  const cards = await cardMap();
  let note = `✅ Listing \`#${id}\` cancelled — **${cardLabel(cards.get(res.cardId), res.cardId)}** is back in your collection.`;
  if (res.refundedBidder) note += ` The top bidder <@${res.refundedBidder}> was refunded.`;
  await interaction.editReply(note);
}

// ── /market mine ─────────────────────────────────────────────────────────────
async function handleMine(interaction: ChatInputCommandInteraction, guildId: string): Promise<void> {
  const userId = interaction.user.id;
  const [listings, bids, currency] = await Promise.all([
    getUserListings(guildId, userId),
    getUserBids(guildId, userId),
    getOrCreateCurrency(guildId, userId),
  ]);
  const cards = await cardMap();
  const embed = new EmbedBuilder()
    .setTitle("📃 Your Marketplace Activity")
    .setColor(0x9b59b6)
    .setDescription(`Balance: 💠 **${currency.shards.toLocaleString()}**`);
  embed.addFields({
    name: `🏷️ Your active listings (${listings.length})`,
    value: listings.length ? listings.map(l => listingLine(l, cards)).join("\n").slice(0, 1024) : "*None. Sell one with `/market sell`.*",
    inline: false,
  });
  embed.addFields({
    name: `🔨 Auctions you're winning (${bids.length})`,
    value: bids.length ? bids.map(l => listingLine(l, cards)).join("\n").slice(0, 1024) : "*No active top bids.*",
    inline: false,
  });
  await interaction.editReply({ embeds: [embed] });
}

// ── Router ───────────────────────────────────────────────────────────────────
export async function handleMarketCommand(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!interaction.guild) {
    await interaction.reply({ content: "❌ The marketplace only works in a server.", ...EPHEMERAL });
    return;
  }
  const sub = interaction.options.getSubcommand();
  // browse is public; everything else is ephemeral.
  await interaction.deferReply(sub === "browse" ? {} : EPHEMERAL);
  const guildId = interaction.guild.id;
  switch (sub) {
    case "sell": return handleSell(interaction, guildId);
    case "browse": return handleBrowse(interaction, guildId);
    case "buy": return handleBuy(interaction, guildId);
    case "bid": return handleBid(interaction, guildId);
    case "cancel": return handleCancel(interaction, guildId);
    case "mine": return handleMine(interaction, guildId);
    default: await interaction.editReply("❌ Unknown marketplace action.");
  }
}
