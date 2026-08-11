// 🎯 Reaction Catch (mockup mg1) — a quick-time event. Five symbols appear; the
// player must hit the ONE correct symbol before the timer runs out.
import { ButtonStyle } from "discord.js";
import type { MiniGameDefinition, MiniGameSession, MiniGameOutcome, MiniGameRender } from "../types.js";
import { renderScreen, winScreen, loseScreen, type ButtonSpec } from "./shared.js";

const SYMBOLS: { action: string; emoji: string; label: string }[] = [
  { action: "green", emoji: "🟢", label: "12" },
  { action: "red", emoji: "🔴", label: "15" },
  { action: "bolt", emoji: "⚡", label: "9" },
  { action: "target", emoji: "🎯", label: "14" },
  { action: "gem", emoji: "💎", label: "11" },
];

export const reactionGame: MiniGameDefinition = {
  key: "reaction",
  name: "Reaction Catch",
  blurb: "Hit the correct symbol before the timer expires.",
  timeoutMs: 9000,

  start(session: MiniGameSession): Promise<MiniGameRender> {
    const correct = SYMBOLS[Math.floor(Math.random() * SYMBOLS.length)]!;
    session.state.correct = correct.action;
    const buttons: ButtonSpec[] = SYMBOLS.map(s => ({
      action: s.action, label: s.label, emoji: s.emoji, style: ButtonStyle.Secondary,
    }));
    return renderScreen(session, {
      theme: 0xe23b3b,
      icon: "🃏",
      title: "WILD CARD",
      titleTail: "DETECTED",
      lines: [
        "Something has appeared in the area!",
        `Quickly react to the **${correct.emoji}** symbol`,
        "to capture it before it's too late.",
      ],
      statusLabel: "⏱️ TIMER:",
      statusValue: "React now…",
      cardArtUrl: session.cardArtUrl,
      cardName: session.card.name,
      rarityLabel: session.rarityLabel,
      rarityColor: session.rarityColor,
      cardBadge: "UNKNOWN",
    }, {
      animateIntro: true,
      buttons,
      title: "🃏 WILD CARD DETECTED",
      description:
        `**Something has appeared in the area!**\n` +
        `Quickly react to the ${correct.emoji} symbol to capture it before time runs out!`,
    });
  },

  async handle(session: MiniGameSession, action: string): Promise<MiniGameOutcome> {
    const correct = session.state.correct as string;
    if (action === correct) {
      return { done: true, win: true, render: await winScreen(session, "Perfect reflexes — you reacted in time!") };
    }
    return { done: true, win: false, render: await loseScreen(session, "Wrong symbol! The card bolted.") };
  },

  onTimeout(session: MiniGameSession): Promise<MiniGameRender> {
    return loseScreen(session, "Too slow — you missed the window.");
  },
};
