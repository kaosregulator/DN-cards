// 📡 Radar Scan — narrow down the contact's position with a hot/cold search.
// Each scan tells you higher/lower; pinpoint it within your attempts to capture.
import { ButtonStyle } from "discord.js";
import { withGuildFrames } from "../../animations/card-frames.js";
import { getOrCreateGuildSettings } from "../../db.js";
import type { Rarity } from "../../cards-data.js";
import type { MiniGameDefinition, MiniGameSession, MiniGameOutcome, MiniGameRender } from "../types.js";
import { renderScreen, winScreen, loseScreen, type ButtonSpec } from "./shared.js";

const THEME = 0x22c55e;
const SLOTS = 8;

interface RadarState { target: number; attempts: number; max: number; hint: string; }

function buttons(): ButtonSpec[] {
  return Array.from({ length: SLOTS }, (_, i) => ({
    action: `scan:${i + 1}`, label: String(i + 1), style: ButtonStyle.Secondary,
  }));
}

function spec(session: MiniGameSession, st: RadarState) {
  return {
    theme: THEME,
    icon: "📡",
    title: "RADAR",
    titleTail: "CONTACT",
    lines: ["A contact is out there.", "Scan a bearing (1–8) to", "narrow the range."],
    statusLabel: `SCANS LEFT: ${st.max - st.attempts}`,
    statusValue: st.hint,
    cardArtUrl: session.cardArtUrl,
    cardName: session.card.name,
    rarityLabel: session.rarityLabel,
    rarityColor: session.rarityColor,
    cardBadge: "CONTACT",
  };
}

export const radarGame: MiniGameDefinition = {
  key: "radar",
  name: "Radar Scan",
  blurb: "Home in on the contact with hot/cold scans.",
  timeoutMs: 20000,

  start(session: MiniGameSession): Promise<MiniGameRender> {
    const st: RadarState = { target: 1 + Math.floor(Math.random() * SLOTS), attempts: 0, max: 4, hint: "Awaiting first scan…" };
    session.state.radar = st;
    return renderScreen(session, spec(session, st), {
      animateIntro: true,
      buttons: buttons(),
      title: "📡 RADAR CONTACT",
      description: `A contact is on the grid (bearings **1–8**). Scan to narrow it down — **${st.max} scans**.`,
    });
  },

  async handle(session: MiniGameSession, action: string): Promise<MiniGameOutcome> {
    const st = session.state.radar as RadarState;
    const guess = Number(action.split(":")[1]);
    st.attempts++;
    if (guess === st.target) {
      return { done: true, win: true, render: await winScreen(session, `Target located at bearing ${guess} — locked and captured!`) };
    }
    st.hint = guess < st.target ? `↗️ Higher than ${guess}` : `↙️ Lower than ${guess}`;
    if (st.attempts >= st.max) {
      return { done: true, win: false, render: await loseScreen(session, `Out of scans — the contact (bearing ${st.target}) slipped off radar.`) };
    }
    const { renderMiniGameStill, MG_FILE } = await import("../canvas.js");
    const { buildRows } = await import("./shared.js");
    const __frSet = await getOrCreateGuildSettings(session.guildId).catch(() => null);
    const image = await withGuildFrames(__frSet, () => renderMiniGameStill({ ...spec(session, st), rarity: session.card.rarity as Rarity }));
    return {
      done: false,
      render: {
        title: "📡 SCANNING…",
        description: `${st.hint} · **${st.max - st.attempts}** scans left. Pick another bearing (1–8).`,
        color: THEME, image, imageName: MG_FILE, components: buildRows(session, buttons()),
      },
    };
  },

  onTimeout(session: MiniGameSession): Promise<MiniGameRender> {
    return loseScreen(session, "The contact faded before you pinned it.");
  },
};
