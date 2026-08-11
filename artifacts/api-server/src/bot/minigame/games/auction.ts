// 💰 Auction / Bid Claim (mockup mg9) — outbid a rival collector for the card. In
// the wild mini-game gate this is a SOLO nerve game against an AI rival: the bid
// numbers are cosmetic (the only reward is the card — no shards are spent), so it
// stays true to the "card is the only prize" rule while keeping the auction feel.
import { ButtonStyle } from "discord.js";
import type { MiniGameDefinition, MiniGameSession, MiniGameOutcome, MiniGameRender } from "../types.js";
import { renderScreen, winScreen, loseScreen, type ButtonSpec } from "./shared.js";
import { renderMiniGameStill, MG_FILE } from "../canvas.js";
import { buildRows } from "./shared.js";

const THEME = 0xa855f7;

interface AuctionState { rivalBid: number; myBid: number; giveUpAt: number; }

function spec(session: MiniGameSession, st: AuctionState) {
  return {
    theme: THEME,
    icon: "💎",
    title: "CARD",
    titleTail: "AUCTION",
    lines: ["A rival collector is bidding!", `Current bid: ${st.rivalBid} Shards`, "Outbid them to claim it."],
    statusLabel: "HIGHEST BID",
    statusValue: `${st.rivalBid} Shards`,
    cardArtUrl: session.cardArtUrl,
    cardName: session.card.name,
    rarityLabel: session.rarityLabel,
    rarityColor: session.rarityColor,
  };
}

const bidButtons = (): ButtonSpec[] => [
  { action: "bid", label: "💰 BID (+100)", style: ButtonStyle.Success },
  { action: "pass", label: "🚪 PASS", style: ButtonStyle.Secondary },
];

function rnd(min: number, max: number): number { return min + Math.floor(Math.random() * (max - min + 1)); }

export const auctionGame: MiniGameDefinition = {
  key: "auction",
  name: "Auction Claim",
  blurb: "Outbid a rival AI collector to win the card (bids are cosmetic).",
  timeoutMs: 25000,

  start(session: MiniGameSession): Promise<MiniGameRender> {
    const st: AuctionState = { rivalBid: 750, myBid: 0, giveUpAt: rnd(950, 1500) };
    session.state.auction = st;
    return renderScreen(session, spec(session, st), {
      animateIntro: true,
      buttons: bidButtons(),
      title: "💎 CARD AUCTION STARTED",
      description: `A rival collector wants **${session.card.name}**!\nCurrent bid: **${st.rivalBid} Shards** — outbid them to claim it.`,
    });
  },

  async handle(session: MiniGameSession, action: string): Promise<MiniGameOutcome> {
    const st = session.state.auction as AuctionState;
    if (action === "pass") {
      return { done: true, win: false, render: await loseScreen(session, `You dropped out — the rival won at ${st.rivalBid} Shards.`) };
    }
    // Player bids +100 over the current highest.
    st.myBid = st.rivalBid + 100;
    if (st.myBid >= st.giveUpAt) {
      return { done: true, win: true, render: await winScreen(session, `Winning bid ${st.myBid} Shards — the rival folded. Card claimed!`) };
    }
    // Rival counter-bids.
    st.rivalBid = st.myBid + rnd(50, 150);
    const image = await renderMiniGameStill(spec(session, st));
    return {
      done: false,
      render: {
        title: "💎 AUCTION — you're outbid!",
        description: `You bid **${st.myBid}**. The rival countered to **${st.rivalBid} Shards**.\nBid again to claim, or pass.`,
        color: THEME, image, imageName: MG_FILE, components: buildRows(session, bidButtons()),
      },
    };
  },

  onTimeout(session: MiniGameSession): Promise<MiniGameRender> {
    return loseScreen(session, "The gavel fell while you hesitated — the rival won.");
  },
};
