// 🏃 Chase Event (mockups mg3/mg4) — "the card is escaping!". The intro is an
// ANIMATED, looping GIF of the card lunging to flee with speed lines. Then the
// bot shows a direction sequence the player must input in order before it bolts.
import { ButtonStyle } from "discord.js";
import type { MiniGameDefinition, MiniGameSession, MiniGameOutcome, MiniGameRender } from "../types.js";
import { buildRows, winScreen, loseScreen, type ButtonSpec } from "./shared.js";
import {
  renderChaseIntro, renderMiniGameStill, MG_FILE, MG_GIF_FILE, type MiniGameScreenSpec,
} from "../canvas.js";
import { withGuildFrames } from "../../animations/card-frames.js";
import { getOrCreateGuildSettings } from "../../db.js";
import type { Rarity } from "../../cards-data.js";

const THEME = 0xf1c40f; // gold, like the mockup
const DIRS: { action: string; label: string; emoji: string; arrow: string }[] = [
  { action: "left", label: "LEFT", emoji: "⬅️", arrow: "⬅️" },
  { action: "right", label: "RIGHT", emoji: "➡️", arrow: "➡️" },
  { action: "up", label: "UP", emoji: "⬆️", arrow: "⬆️" },
  { action: "down", label: "DOWN", emoji: "⬇️", arrow: "⬇️" },
];
const BY_ACTION = Object.fromEntries(DIRS.map(d => [d.action, d]));

interface ChaseState { seq: string[]; progress: number; }

function seqArrows(st: ChaseState): string {
  return st.seq.map((a, i) => (i < st.progress ? "✅" : BY_ACTION[a]!.arrow)).join(" ");
}

const dirButtons = (): ButtonSpec[] => DIRS.map(d => ({
  action: d.action, label: d.label, emoji: d.emoji, style: ButtonStyle.Primary,
}));

function specFor(session: MiniGameSession, st: ChaseState): MiniGameScreenSpec {
  return {
    theme: THEME,
    icon: "🏃",
    title: "THE CARD",
    titleTail: "IS ESCAPING!",
    lines: [
      "It's attempting to flee the server!",
      "Match the sequence before it bolts.",
    ],
    statusLabel: `CHASE PROGRESS (${st.progress}/${st.seq.length})`,
    statusValue: seqArrows(st),
    cardArtUrl: session.cardArtUrl,
    cardName: session.card.name,
    rarity: session.card.rarity as Rarity,
    rarityLabel: session.rarityLabel,
    rarityColor: session.rarityColor,
  };
}

export const chaseGame: MiniGameDefinition = {
  key: "chase",
  name: "Chase Event",
  blurb: "The card flees — input the direction sequence to catch it.",
  timeoutMs: 12000,

  async start(session: MiniGameSession): Promise<MiniGameRender> {
    const seq = Array.from({ length: 4 }, () => DIRS[Math.floor(Math.random() * DIRS.length)]!.action);
    const st: ChaseState = { seq, progress: 0 };
    session.state.chase = st;
    const spec = specFor(session, st);
    // Animated escaping-card GIF for the opening frame.
    const settings = await getOrCreateGuildSettings(session.guildId).catch(() => null);
    const image = await withGuildFrames(settings, () => session.animate ? renderChaseIntro(spec) : renderMiniGameStill(spec));
    return {
      title: "🏃 THE CARD IS ESCAPING!",
      description:
        `**It's attempting to flee!** Input the sequence in order before time runs out:\n` +
        `${seqArrows(st)}`,
      color: THEME,
      image,
      imageName: session.animate && image ? MG_GIF_FILE : MG_FILE,
      components: buildRows(session, dirButtons()),
    };
  },

  async handle(session: MiniGameSession, action: string): Promise<MiniGameOutcome> {
    const st = session.state.chase as ChaseState;
    const expected = st.seq[st.progress];
    if (action !== expected) {
      return { done: true, win: false, render: await loseScreen(session, "Wrong move — the card broke free and bolted!") };
    }
    st.progress++;
    if (st.progress >= st.seq.length) {
      return { done: true, win: true, render: await winScreen(session, "You ran it down — the card is caught!") };
    }
    // Correct so far — show a still frame with progress and keep going.
    const chaseSettings = await getOrCreateGuildSettings(session.guildId).catch(() => null);
    const image = await withGuildFrames(chaseSettings, () => renderMiniGameStill(specFor(session, st)));
    return {
      done: false,
      render: {
        title: "🏃 RUN IT DOWN!",
        description: `Keep going — match the sequence:\n${seqArrows(st)}`,
        color: THEME,
        image,
        imageName: MG_FILE,
        components: buildRows(session, dirButtons()),
      },
    };
  },

  onTimeout(session: MiniGameSession): Promise<MiniGameRender> {
    return loseScreen(session, "Too slow — the card outran you and escaped.");
  },
};
