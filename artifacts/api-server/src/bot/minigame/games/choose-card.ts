// 🎴 Choose-a-Card (mockup mb2) — five facedown cards, one is the real drop and
// the rest are decoys. Pick one to reveal it.
import { ButtonStyle } from "discord.js";
import type { MiniGameDefinition, MiniGameSession, MiniGameOutcome, MiniGameRender } from "../types.js";
import { renderScreen, winScreen, loseScreen, type ButtonSpec } from "./shared.js";

const LETTERS = ["A", "B", "C", "D", "E"];

export const chooseCardGame: MiniGameDefinition = {
  key: "choose",
  name: "Choose-a-Card",
  blurb: "Pick the real card hidden among decoys.",
  timeoutMs: 15000,

  start(session: MiniGameSession): Promise<MiniGameRender> {
    const winning = Math.floor(Math.random() * LETTERS.length);
    session.state.winning = winning;
    const buttons: ButtonSpec[] = LETTERS.map((l, i) => ({
      action: `pick:${i}`, label: `CARD ${l}`, emoji: "🂠", style: ButtonStyle.Success,
    }));
    return renderScreen(session, {
      theme: 0x4ade80,
      icon: "🎴",
      title: "A CARD DROP",
      titleTail: "HAS APPEARED",
      lines: ["Choose one card to reveal.", "Beware of decoys!"],
      cardArtUrl: session.cardArtUrl,
      cardName: session.card.name,
      rarityLabel: session.rarityLabel,
      rarityColor: session.rarityColor,
      hideCardArt: true,
      cardBadge: "HIDDEN",
    }, {
      animateIntro: true,
      buttons,
      title: "🎴 A CARD DROP HAS APPEARED",
      description: "Choose one card to reveal. **Beware of decoys!**\n🂠 🂠 🂠 🂠 🂠",
    });
  },

  async handle(session: MiniGameSession, action: string): Promise<MiniGameOutcome> {
    const winning = session.state.winning as number;
    const picked = Number(action.split(":")[1]);
    if (picked === winning) {
      return { done: true, win: true, render: await winScreen(session, `Card ${LETTERS[winning]} was the real one!`) };
    }
    return { done: true, win: false, render: await loseScreen(session, `Card ${LETTERS[picked]} was a decoy — the real drop vanished.`) };
  },

  onTimeout(session: MiniGameSession): Promise<MiniGameRender> {
    return loseScreen(session, "You hesitated too long and the drop disappeared.");
  },
};
