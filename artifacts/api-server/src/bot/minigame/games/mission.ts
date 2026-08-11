// 🪖 Mission Claim — a short field op: Infiltrate → Hack → Escape. Each stage has
// a success chance; clear all three to acquire the card.
import { ButtonStyle } from "discord.js";
import type { MiniGameDefinition, MiniGameSession, MiniGameOutcome, MiniGameRender } from "../types.js";
import { renderScreen, winScreen, loseScreen, type ButtonSpec } from "./shared.js";
import { renderMiniGameStill, MG_FILE } from "../canvas.js";
import { buildRows } from "./shared.js";

const THEME = 0xf97316;
const STAGES = [
  { action: "infiltrate", label: "🚪 INFILTRATE", verb: "Infiltrate the enemy base", chance: 0.85 },
  { action: "hack", label: "💻 HACK", verb: "Hack the vault", chance: 0.8 },
  { action: "escape", label: "🏃 ESCAPE", verb: "Escape with the card", chance: 0.8 },
];

interface MissionState { stage: number; }

function spec(session: MiniGameSession, stage: number) {
  const s = STAGES[stage]!;
  return {
    theme: THEME,
    icon: "🪖",
    title: "FIELD",
    titleTail: "MISSION",
    lines: [`Recover the ${session.card.name} card.`, `Objective ${stage + 1}/3:`, s.verb + "."],
    statusLabel: `OBJECTIVE ${stage + 1} / 3`,
    statusValue: s.verb,
    cardArtUrl: session.cardArtUrl,
    cardName: session.card.name,
    rarityLabel: session.rarityLabel,
    rarityColor: session.rarityColor,
  };
}

const stageButton = (stage: number): ButtonSpec[] => [{
  action: STAGES[stage]!.action, label: STAGES[stage]!.label, style: ButtonStyle.Primary,
}];

export const missionGame: MiniGameDefinition = {
  key: "mission",
  name: "Mission Claim",
  blurb: "Run a 3-stage op — Infiltrate, Hack, Escape.",
  timeoutMs: 20000,

  start(session: MiniGameSession): Promise<MiniGameRender> {
    session.state.mission = { stage: 0 } as MissionState;
    return renderScreen(session, spec(session, 0), {
      animateIntro: true,
      buttons: stageButton(0),
      title: "🪖 FIELD MISSION",
      description: `**Recover the ${session.card.name} card.**\nObjective 1/3: ${STAGES[0]!.verb}.`,
    });
  },

  async handle(session: MiniGameSession, action: string): Promise<MiniGameOutcome> {
    const st = session.state.mission as MissionState;
    const stage = STAGES[st.stage];
    if (!stage || action !== stage.action) {
      return { done: false, render: await this.start(session) as MiniGameRender };
    }
    if (Math.random() > stage.chance) {
      return { done: true, win: false, render: await loseScreen(session, `Mission failed at "${stage.verb}". The card was lost.`) };
    }
    st.stage++;
    if (st.stage >= STAGES.length) {
      return { done: true, win: true, render: await winScreen(session, "Mission complete — card acquired!") };
    }
    const image = await renderMiniGameStill(spec(session, st.stage));
    return {
      done: false,
      render: {
        title: "🪖 MISSION IN PROGRESS",
        description: `✅ ${stage.verb} — success!\nObjective ${st.stage + 1}/3: ${STAGES[st.stage]!.verb}.`,
        color: THEME, image, imageName: MG_FILE, components: buildRows(session, stageButton(st.stage)),
      },
    };
  },

  onTimeout(session: MiniGameSession): Promise<MiniGameRender> {
    return loseScreen(session, "The mission window expired — extraction failed.");
  },
};
