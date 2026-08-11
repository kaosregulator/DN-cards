// 🎯 Aim & Radar (mockup mg5) — a target locks onto one of four color channels.
// Hit the locked channel to secure the card.
import { ButtonStyle } from "discord.js";
import type { MiniGameDefinition, MiniGameSession, MiniGameOutcome, MiniGameRender } from "../types.js";
import { renderScreen, winScreen, loseScreen, type ButtonSpec } from "./shared.js";

const CHANNELS: { action: string; label: string; emoji: string }[] = [
  { action: "red", label: "RED", emoji: "🔴" },
  { action: "green", label: "GREEN", emoji: "🟢" },
  { action: "blue", label: "BLUE", emoji: "🔵" },
  { action: "yellow", label: "YELLOW", emoji: "🟡" },
];

export const aimGame: MiniGameDefinition = {
  key: "aim",
  name: "Aim & Radar",
  blurb: "Lock the correct channel to capture the target.",
  timeoutMs: 12000,

  start(session: MiniGameSession): Promise<MiniGameRender> {
    const locked = CHANNELS[Math.floor(Math.random() * CHANNELS.length)]!;
    session.state.locked = locked.action;
    const distance = 200 + Math.floor(Math.random() * 600);
    const buttons: ButtonSpec[] = CHANNELS.map(c => ({
      action: c.action, label: c.label, emoji: c.emoji, style: ButtonStyle.Secondary,
    }));
    return renderScreen(session, {
      theme: 0x22c55e,
      icon: "🎯",
      title: "TARGET",
      titleTail: "ACQUIRED",
      lines: [
        "A target has appeared at",
        "a random frequency. Acquire",
        `the lock: engage **${locked.emoji} ${locked.label}**.`,
      ],
      statusLabel: "LOCK STATUS",
      statusValue: `SEARCHING…  ·  ${distance}m`,
      cardArtUrl: session.cardArtUrl,
      cardName: session.card.name,
      rarityLabel: session.rarityLabel,
      rarityColor: session.rarityColor,
    }, {
      animateIntro: true,
      buttons,
      title: "🎯 TARGET ACQUIRED",
      description:
        `A target has appeared at a random frequency.\n` +
        `Acquire the lock — engage the **${locked.emoji} ${locked.label}** channel.`,
    });
  },

  async handle(session: MiniGameSession, action: string): Promise<MiniGameOutcome> {
    const locked = session.state.locked as string;
    if (action === locked) {
      return { done: true, win: true, render: await winScreen(session, "Direct hit — target neutralized and secured!") };
    }
    return { done: true, win: false, render: await loseScreen(session, "Missed the lock — the target broke contact.") };
  },

  onTimeout(session: MiniGameSession): Promise<MiniGameRender> {
    return loseScreen(session, "The signal faded before you could engage.");
  },
};
