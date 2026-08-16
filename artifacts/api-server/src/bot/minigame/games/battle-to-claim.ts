// ⚔️ Battle to Claim (mockup: "HOSTILE CARD DETECTED"). A short solo AI skirmish:
// strike the hostile down before it drops your card. Reuses the mini-game canvas
// (the full battle engine is overkill for a gate; this is a fast HP duel).
import { ButtonStyle } from "discord.js";
import type { MiniGameDefinition, MiniGameSession, MiniGameOutcome, MiniGameRender } from "../types.js";
import { renderScreen, winScreen, loseScreen, type ButtonSpec } from "./shared.js";
import { renderMiniGameStill, MG_FILE } from "../canvas.js";
import { withGuildFrames } from "../../animations/card-frames.js";
import { getOrCreateGuildSettings } from "../../db.js";
import type { Rarity } from "../../cards-data.js";
import { buildRows } from "./shared.js";

const THEME = 0xe23b3b;

interface BattleState { bossHp: number; myHp: number; bossMax: number; myMax: number; }

function bar(cur: number, max: number): string {
  const n = 10, filled = Math.max(0, Math.round((cur / max) * n));
  return "█".repeat(filled) + "░".repeat(n - filled);
}

function spec(session: MiniGameSession, st: BattleState) {
  return {
    theme: THEME,
    icon: "⚠️",
    title: "HOSTILE",
    titleTail: "CARD DETECTED",
    lines: [
      `Enemy HP: ${st.bossHp}/${st.bossMax}  [${bar(st.bossHp, st.bossMax)}]`,
      `Your HP:  ${st.myHp}/${st.myMax}  [${bar(st.myHp, st.myMax)}]`,
      "Strike it down to claim the card!",
    ],
    statusLabel: "ENGAGEMENT",
    statusValue: `Enemy ${st.bossHp} · You ${st.myHp}`,
    cardArtUrl: session.cardArtUrl,
    cardName: session.card.name,
    rarityLabel: session.rarityLabel,
    rarityColor: session.rarityColor,
  };
}

const strikeButtons = (): ButtonSpec[] => [
  { action: "strike", label: "⚔️ STRIKE", style: ButtonStyle.Danger },
  { action: "heavy", label: "💥 HEAVY (risky)", style: ButtonStyle.Secondary },
];

function rnd(min: number, max: number): number { return min + Math.floor(Math.random() * (max - min + 1)); }

export const battleGame: MiniGameDefinition = {
  key: "battle",
  name: "Battle to Claim",
  blurb: "Duel the hostile card — drop its HP before it drops yours.",
  timeoutMs: 25000,

  start(session: MiniGameSession): Promise<MiniGameRender> {
    const st: BattleState = { bossHp: 60, bossMax: 60, myHp: 55, myMax: 55 };
    session.state.battle = st;
    return renderScreen(session, spec(session, st), {
      animateIntro: true,
      buttons: strikeButtons(),
      title: "⚠️ HOSTILE CARD DETECTED",
      description: `A hostile **${session.card.name}** blocks your claim! Strike it down.\nEnemy HP **${st.bossHp}** · Your HP **${st.myHp}**`,
    });
  },

  async handle(session: MiniGameSession, action: string): Promise<MiniGameOutcome> {
    const st = session.state.battle as BattleState;
    // Player strike.
    const dmg = action === "heavy"
      ? (Math.random() < 0.6 ? rnd(18, 34) : 0)   // heavy: big hit or a whiff
      : rnd(10, 20);
    st.bossHp = Math.max(0, st.bossHp - dmg);
    if (st.bossHp <= 0) {
      return { done: true, win: true, render: await winScreen(session, "Hostile neutralized — the card is yours!") };
    }
    // Enemy counter.
    st.myHp = Math.max(0, st.myHp - rnd(8, 18));
    if (st.myHp <= 0) {
      return { done: true, win: false, render: await loseScreen(session, "Your card was downed — the hostile escaped with the prize.") };
    }
    const __frSet = await getOrCreateGuildSettings(session.guildId).catch(() => null);
    const image = await withGuildFrames(__frSet, () => renderMiniGameStill({ ...spec(session, st), rarity: session.card.rarity as Rarity }));
    const note = dmg === 0 ? "💨 Your heavy swing missed!" : `You hit for ${dmg}.`;
    return {
      done: false,
      render: {
        title: "⚔️ ENGAGED",
        description: `${note}\nEnemy HP **${st.bossHp}** · Your HP **${st.myHp}** — keep striking!`,
        color: THEME, image, imageName: MG_FILE, components: buildRows(session, strikeButtons()),
      },
    };
  },

  onTimeout(session: MiniGameSession): Promise<MiniGameRender> {
    return loseScreen(session, "You hesitated mid-fight — the hostile card fled.");
  },
};
