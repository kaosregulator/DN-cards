// 👥 First-to-React / Global Drop (mockup mg10) — a hyper-fast drop. In the wild
// mini-game gate this is the catcher's solo reflex check: stabilize the link by
// hitting CLAIM before the very short timer expires.
import { ButtonStyle } from "discord.js";
import type { MiniGameDefinition, MiniGameSession, MiniGameOutcome, MiniGameRender } from "../types.js";
import { renderScreen, winScreen, loseScreen, type ButtonSpec } from "./shared.js";

const THEME = 0xe23b3b;

export const firstReactGame: MiniGameDefinition = {
  key: "firstreact",
  name: "First-to-React",
  blurb: "Hyper-fast drop — hit CLAIM before the link destabilizes.",
  timeoutMs: 6000, // deliberately tight

  start(session: MiniGameSession): Promise<MiniGameRender> {
    const buttons: ButtonSpec[] = [{ action: "claim", label: "⚡ CLAIM", style: ButtonStyle.Success }];
    return renderScreen(session, {
      theme: THEME,
      icon: "🚨",
      title: "GLOBAL",
      titleTail: "CARD DROP!",
      lines: ["A hyper-fast drop appeared.", "Stabilize the link FAST —", "hit CLAIM before it's gone!"],
      statusLabel: "⏱️ LINK",
      statusValue: "Destabilizing…",
      cardArtUrl: session.cardArtUrl,
      cardName: session.card.name,
      rarityLabel: session.rarityLabel,
      rarityColor: session.rarityColor,
    }, {
      animateIntro: true,
      buttons,
      title: "🚨 GLOBAL CARD DROP!",
      description: "A hyper-fast drop appeared! **Hit ⚡ CLAIM immediately** to stabilize the link and claim it.",
    });
  },

  async handle(session: MiniGameSession, action: string): Promise<MiniGameOutcome> {
    if (action === "claim") {
      return { done: true, win: true, render: await winScreen(session, "Link stabilized — you claimed it in time!") };
    }
    return { done: true, win: false, render: await loseScreen(session, "The link collapsed. The card is gone.") };
  },

  onTimeout(session: MiniGameSession): Promise<MiniGameRender> {
    return loseScreen(session, "Too slow — the link destabilized and the drop vanished.");
  },
};
