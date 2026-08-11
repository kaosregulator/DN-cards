// 🎁 Mystery Crate (mockup mg11) — a sealed military crate. Open it: the contents
// are unverified, so there's a small chance it's a dud, but usually the card is
// inside.
import { ButtonStyle } from "discord.js";
import type { MiniGameDefinition, MiniGameSession, MiniGameOutcome, MiniGameRender } from "../types.js";
import { renderScreen, winScreen, loseScreen, type ButtonSpec } from "./shared.js";

const THEME = 0x84cc16;

export const crateGame: MiniGameDefinition = {
  key: "crate",
  name: "Mystery Crate",
  blurb: "Open the crate — usually the card, sometimes a dud.",
  timeoutMs: 20000,

  start(session: MiniGameSession): Promise<MiniGameRender> {
    const buttons: ButtonSpec[] = [{ action: "open", label: "🔓 OPEN CRATE", style: ButtonStyle.Primary }];
    return renderScreen(session, {
      theme: THEME,
      icon: "📦",
      title: "MYSTERY",
      titleTail: "MILITARY CRATE",
      lines: ["Standard Issue Military", "Logistics Crate detected.", "Contents are unverified."],
      cardArtUrl: session.cardArtUrl,
      cardName: session.card.name,
      rarityLabel: session.rarityLabel,
      rarityColor: session.rarityColor,
      hideCardArt: true,
      cardBadge: "SEALED",
    }, {
      animateIntro: true,
      buttons,
      title: "📦 MYSTERY MILITARY CRATE",
      description: "Standard Issue Military Logistics Crate detected. **Contents are unverified.**",
    });
  },

  async handle(session: MiniGameSession, action: string): Promise<MiniGameOutcome> {
    if (action !== "open") return { done: false, render: await this.start(session) as MiniGameRender };
    // 82% the card is inside.
    if (Math.random() < 0.82) {
      return { done: true, win: true, render: await winScreen(session, `You found... ${session.card.name}!`) };
    }
    return { done: true, win: false, render: await loseScreen(session, "The crate was a decoy — empty. Better luck next drop.") };
  },

  onTimeout(session: MiniGameSession): Promise<MiniGameRender> {
    return loseScreen(session, "You never opened the crate — logistics reclaimed it.");
  },
};
