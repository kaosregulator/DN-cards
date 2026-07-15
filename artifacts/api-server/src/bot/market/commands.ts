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

export async function cardMap(guildId: string) {
  const cards = await getAllCardsCached(guildId);
  return new Map(cards.map(c => [c.id, c]));
}

export function cardLabel(card: { name: string; rarity: string } | undefined, cardId: number): string {
  if (!card) return `Card #${cardId}`;
  return `${RARITY_EMOJI[card.rarity] ?? "•"} ${card.name}`;
}

export function listingLine(l: MarketListing, cards: Map<number, { name: string; rarity: string }>): string {
  const label = cardLabel(cards.get(l.cardId), l.cardId);
  if (l.kind === "auction") {
    const bid = l.currentBid != null ? `💠 ${l.currentBid.toLocaleString()} (${l.currentBidderId ? `<@${l.currentBidderId}>` : "no bids"})` : `💠 ${l.price.toLocaleString()} start`;
    const ends = l.expiresAt ? ` · ends <t:${Math.floor(l.expiresAt.getTime() / 1000)}:R>` : "";
    const buyout = l.buyout ? ` · buyout 💠 ${l.buyout.toLocaleString()}` : "";
    return `\`#${l.id}\` 🔨 **${label}** — ${bid}${buyout}${ends} · <@${l.sellerId}>`;
  }
  return `\`#${l.id}\` 🏷️ **${label}** — 💠 **${l.price.toLocaleString()}** · <@${l.sellerId}>`;
}

export const MAX_AUCTION_HOURS_EXPORT = MAX_AUCTION_HOURS;

// ─────────────────────────────────────────────────────────────────────────────
// Param-based core actions — the single implementation of each marketplace
// action, reused by BOTH the /market slash command and the Market Hub. They
// take plain values (never an interaction) and return an embed or a text
// result, so any surface can present them.
// ─────────────────────────────────────────────────────────────────────────────

export async function buildBrowseEmbed(
  guildId: string, opts?: { sellerId?: string; kind?: "sale" | "auction" },
): Promise<EmbedBuilder | null> {
  const listings = await getActiveListings(guildId, { sellerId: opts?.sellerId, kind: opts?.kind, limit: 25 });
  if (listings.length === 0) return null;
  const cards = await cardMap(guildId);
  const sales = listings.filter(l => l.kind === "sale");
  const auctions = listings.filter(l => l.kind === "auction");
  const embed = new EmbedBuilder()
    .setTitle("🛒 Marketplace")
    .setColor(0x3498db)
    .setFooter({ text: "Use the Buy / Bid actions in the hub to trade." });
  if (sales.length > 0) embed.addFields({ name: `🏷️ For sale (${sales.length})`, value: sales.map(l => listingLine(l, cards)).join("\n").slice(0, 1024), inline: false });
  if (auctions.length > 0) embed.addFields({ name: `🔨 Auctions (${auctions.length})`, value: auctions.map(l => listingLine(l, cards)).join("\n").slice(0, 1024), inline: false });
  return embed;
}

export async function buildMineEmbed(guildId: string, userId: string): Promise<EmbedBuilder> {
  const [listings, bids, currency] = await Promise.all([
    getUserListings(guildId, userId),
    getUserBids(guildId, userId),
    getOrCreateCurrency(guildId, userId),
  ]);
  const cards = await cardMap(guildId);
  const embed = new EmbedBuilder()
    .setTitle("📃 Your Marketplace Activity")
    .setColor(0x9b59b6)
    .setDescription(`Balance: 💠 **${currency.shards.toLocaleString()}**`);
  embed.addFields({
    name: `🏷️ Your active listings (${listings.length})`,
    value: listings.length ? listings.map(l => listingLine(l, cards)).join("\n").slice(0, 1024) : "*None yet.*",
    inline: false,
  });
  embed.addFields({
    name: `🔨 Auctions you're winning (${bids.length})`,
    value: bids.length ? bids.map(l => listingLine(l, cards)).join("\n").slice(0, 1024) : "*No active top bids.*",
    inline: false,
  });
  return embed;
}

export async function sellCard(
  guildId: string, userId: string,
  args: { name: string; price: number; hours: number | null; buyout: number | null },
): Promise<{ ok: true; embed: EmbedBuilder } | { ok: false; error: string }> {
  const { name, price, hours, buyout } = args;
  if (!Number.isInteger(price) || price < 1) return { ok: false, error: "❌ Price must be at least 💠 1." };
  const card = await getCardByName(name, guildId);
  if (!card) return { ok: false, error: `❌ "**${name}**" not found. Try \`/list\`.` };

  const isAuction = hours != null;
  if (isAuction && (hours! < 1 || hours! > MAX_AUCTION_HOURS)) return { ok: false, error: `❌ Auction duration must be between 1 and ${MAX_AUCTION_HOURS} hours.` };
  if (buyout != null && !isAuction) return { ok: false, error: "❌ Buyout only applies to auctions (set hours)." };
  if (buyout != null && buyout <= price) return { ok: false, error: "❌ Buyout must be higher than the starting bid." };

  const expiresAt = isAuction ? new Date(Date.now() + hours! * 3_600_000) : null;
  const res = await createListing({
    guildId, sellerId: userId, cardId: card.id,
    kind: isAuction ? "auction" : "sale", price, buyout: buyout ?? null, expiresAt,
  });
  if (!res.ok) return { ok: false, error: `❌ You don't own a normal copy of **${card.name}** to list. (Shiny copies can't be listed.)` };

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
      `A **${MARKET_FEE_PCT}%** market fee applies to the sale.`,
    );
  const img = toAbsoluteImageUrl(card.imageUrl);
  if (img) embed.setThumbnail(img);
  return { ok: true, embed };
}

export async function buyCard(guildId: string, userId: string, id: number): Promise<string> {
  const listing = await getListing(id);
  if (!listing || listing.guildId !== guildId || listing.status !== "active") return "❌ That listing is no longer available.";
  if (listing.sellerId === userId) return "❌ You can't buy your own listing. Use Cancel instead.";

  let price: number;
  if (listing.kind === "sale") price = listing.price;
  else if (listing.buyout != null) price = listing.buyout;
  else return "❌ That's an auction with no buyout — place a bid instead.";

  const res = await buyListing(guildId, userId, id, price, { isBuyout: listing.kind === "auction" });
  if (!res.ok) {
    return res.reason === "gone" ? "❌ That listing was just taken or cancelled."
      : res.reason === "own_listing" ? "❌ You can't buy your own listing."
      : res.reason === "insufficient" ? `❌ You need 💠 **${price.toLocaleString()}** to buy this. Check \`/shards\`.`
      : "❌ That listing can't be bought directly.";
  }
  // Unified account XP: a completed market sale rewards buyer and seller.
  try {
    const { awardPlayerXp, awardCollectionMilestoneXp, XP } = await import("../player/xp.js");
    await Promise.all([
      awardPlayerXp(guildId, userId, "economy", XP.economy),
      awardPlayerXp(guildId, res.sellerId, "economy", XP.economy),
      awardCollectionMilestoneXp(guildId, userId), // buyer's collection may have grown
    ]);
  } catch { /* non-fatal */ }
  const cards = await cardMap(guildId);
  return `✅ Bought **${cardLabel(cards.get(res.cardId), res.cardId)}** for 💠 **${price.toLocaleString()}**! ` +
    `It's in your \`/collection\`. Seller <@${res.sellerId}> received 💠 ${proceedsFor(price).toLocaleString()} (after ${MARKET_FEE_PCT}% fee).`;
}

export async function bidCard(guildId: string, userId: string, id: number, amount: number): Promise<string> {
  const res = await placeBid(guildId, userId, id, amount);
  if (!res.ok) {
    return res.reason === "gone" ? "❌ That auction is no longer active."
      : res.reason === "not_auction" ? "❌ That listing is a fixed-price sale — use Buy."
      : res.reason === "own_listing" ? "❌ You can't bid on your own auction."
      : res.reason === "ended" ? "❌ That auction has already ended."
      : res.reason === "too_low" ? `❌ Bid too low — the minimum next bid is 💠 **${res.min!.toLocaleString()}** (increments of ${MIN_BID_INCREMENT}).`
      : `❌ You need 💠 **${amount.toLocaleString()}** available to bid (it's held until you're outbid or the auction ends).`;
  }
  const cards = await cardMap(guildId);
  const l = res.listing;
  return `✅ Bid placed: 💠 **${amount.toLocaleString()}** on **${cardLabel(cards.get(l.cardId), l.cardId)}** \`#${l.id}\`. ` +
    `Your shards are held in escrow and refunded automatically if you're outbid. ` +
    (l.expiresAt ? `Auction ends <t:${Math.floor(l.expiresAt.getTime() / 1000)}:R>.` : "");
}

export async function cancelCardListing(guildId: string, userId: string, id: number): Promise<string> {
  const res = await cancelListing(guildId, userId, id);
  if (!res.ok) {
    return res.reason === "gone" ? "❌ That listing is no longer active."
      : res.reason === "not_seller" ? "❌ You can only cancel your own listings."
      : "❌ Could not cancel that listing.";
  }
  const cards = await cardMap(guildId);
  let note = `✅ Listing \`#${id}\` cancelled — **${cardLabel(cards.get(res.cardId), res.cardId)}** is back in your collection.`;
  if (res.refundedBidder) note += ` The top bidder <@${res.refundedBidder}> was refunded.`;
  return note;
}

// Buyable listings (not your own) for the hub's Buy select.
export async function buyableListings(guildId: string, userId: string): Promise<MarketListing[]> {
  const all = await getActiveListings(guildId, { limit: 25 });
  return all.filter(l => l.sellerId !== userId && (l.kind === "sale" || l.buyout != null));
}
// Active auctions (not your own) for the hub's Bid select.
export async function biddableAuctions(guildId: string, userId: string): Promise<MarketListing[]> {
  const all = await getActiveListings(guildId, { kind: "auction", limit: 25 });
  return all.filter(l => l.sellerId !== userId);
}

// ── /market sell ─────────────────────────────────────────────────────────────
async function handleSell(interaction: ChatInputCommandInteraction, guildId: string): Promise<void> {
  const res = await sellCard(guildId, interaction.user.id, {
    name: interaction.options.getString("name", true),
    price: interaction.options.getInteger("price", true),
    hours: interaction.options.getInteger("hours"),
    buyout: interaction.options.getInteger("buyout"),
  });
  if (!res.ok) { await interaction.editReply(res.error); return; }
  await interaction.editReply({ embeds: [res.embed] });
}

// ── /market browse ───────────────────────────────────────────────────────────
async function handleBrowse(interaction: ChatInputCommandInteraction, guildId: string): Promise<void> {
  const seller = interaction.options.getUser("seller");
  const kind = interaction.options.getString("kind") as "sale" | "auction" | null;
  const embed = await buildBrowseEmbed(guildId, { sellerId: seller?.id, kind: kind ?? undefined });
  if (!embed) { await interaction.editReply("🛒 The market is empty right now. List a card with `/market sell`."); return; }
  await interaction.editReply({ embeds: [embed] });
}

// ── /market buy ──────────────────────────────────────────────────────────────
async function handleBuy(interaction: ChatInputCommandInteraction, guildId: string): Promise<void> {
  await interaction.editReply(await buyCard(guildId, interaction.user.id, interaction.options.getInteger("id", true)));
}

// ── /market bid ──────────────────────────────────────────────────────────────
async function handleBid(interaction: ChatInputCommandInteraction, guildId: string): Promise<void> {
  await interaction.editReply(await bidCard(guildId, interaction.user.id, interaction.options.getInteger("id", true), interaction.options.getInteger("amount", true)));
}

// ── /market cancel ───────────────────────────────────────────────────────────
async function handleCancel(interaction: ChatInputCommandInteraction, guildId: string): Promise<void> {
  await interaction.editReply(await cancelCardListing(guildId, interaction.user.id, interaction.options.getInteger("id", true)));
}

// ── /market mine ─────────────────────────────────────────────────────────────
async function handleMine(interaction: ChatInputCommandInteraction, guildId: string): Promise<void> {
  await interaction.editReply({ embeds: [await buildMineEmbed(guildId, interaction.user.id)] });
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
