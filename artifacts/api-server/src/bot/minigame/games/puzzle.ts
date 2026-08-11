// 🧩 Puzzle → Card (mockup: "INTEL RECOVERED · B + 4 = 12"). Solve a tiny
// equation for the unknown; pick the right answer to recover the card.
import { ButtonStyle } from "discord.js";
import type { MiniGameDefinition, MiniGameSession, MiniGameOutcome, MiniGameRender } from "../types.js";
import { renderScreen, winScreen, loseScreen, type ButtonSpec } from "./shared.js";

const THEME = 0x38bdf8;

function shuffle<T>(a: T[]): T[] {
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j]!, a[i]!]; }
  return a;
}

export const puzzleGame: MiniGameDefinition = {
  key: "puzzle",
  name: "Puzzle → Card",
  blurb: "Solve a quick equation to recover the card.",
  timeoutMs: 20000,

  start(session: MiniGameSession): Promise<MiniGameRender> {
    const b = 2 + Math.floor(Math.random() * 9);      // 2..10
    const add = 1 + Math.floor(Math.random() * 9);    // 1..9
    const result = b + add;
    session.state.answer = b;
    const options = shuffle([b, b + 1, b - 1, b + 2].filter((v, i, arr) => arr.indexOf(v) === i)).slice(0, 4);
    if (!options.includes(b)) options[0] = b;
    const buttons: ButtonSpec[] = shuffle(options).map(v => ({
      action: `ans:${v}`, label: String(v), style: ButtonStyle.Secondary,
    }));
    return renderScreen(session, {
      theme: THEME,
      icon: "🧩",
      title: "INTEL",
      titleTail: "RECOVERED",
      lines: ["Solve for the unknown:", `B + ${add} = ${result}`, "What is B?"],
      statusLabel: "EQUATION",
      statusValue: `B + ${add} = ${result}`,
      cardArtUrl: session.cardArtUrl,
      cardName: session.card.name,
      rarityLabel: session.rarityLabel,
      rarityColor: session.rarityColor,
    }, {
      animateIntro: true,
      buttons,
      title: "🧩 INTEL RECOVERED",
      description: `Solve the code to recover the card:\n\`B + ${add} = ${result}\`  —  **What is B?**`,
    });
  },

  async handle(session: MiniGameSession, action: string): Promise<MiniGameOutcome> {
    const answer = session.state.answer as number;
    if (Number(action.split(":")[1]) === answer) {
      return { done: true, win: true, render: await winScreen(session, `Correct — B = ${answer}. Intel recovered!`) };
    }
    return { done: true, win: false, render: await loseScreen(session, `Wrong — B was ${answer}. The intel was lost.`) };
  },

  onTimeout(session: MiniGameSession): Promise<MiniGameRender> {
    return loseScreen(session, "The intel window closed before you solved it.");
  },
};
