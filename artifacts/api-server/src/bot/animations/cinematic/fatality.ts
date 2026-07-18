// ─────────────────────────────────────────────────────────────────────────────
// Fatality cinematic — the flagship scene built on the Cinematic Engine.
//
// A Mortal-Kombat-style finisher: a fire-and-smoke arena comes alive, the victor
// rises glowing on the left, the loser is annihilated on the right by one of four
// finishers (explosion / shatter / energy burst / collapse), the screen strikes
// white, and a huge FATALITY title slams over the carnage. Loops cleanly for
// Discord (the atmosphere wraps; the finisher replays as a satisfying loop).
//
// It is ONLY a layer list handed to renderCinematic — no bespoke rendering — so
// the same engine + effects power future pack/boss/raid cinematics unchanged.
// ─────────────────────────────────────────────────────────────────────────────

import type { AnimationResult } from "../types.js";
import { getRarityEffectColor } from "../effects.js";
import { renderCinematic } from "./engine.js";
import {
  arenaBackdrop, dynamicLighting, flashes, bigTitle, cardSpotlight,
  defeatEffect, type DefeatKind,
} from "./effects.js";
import type { RenderCard } from "../../battle/image/render.js";

export interface FatalityInput {
  winner: RenderCard;
  loser: RenderCard;
  /** Override the enemy-destruction style; otherwise derived from the loser. */
  finisher?: DefeatKind;
  seed?: string;
}

// Pick a finisher deterministically from the loser so a given matchup always
// plays the same way, but different cards vary (higher rarity = flashier).
function pickFinisher(loser: RenderCard, seed: string): DefeatKind {
  switch (loser.rarity) {
    case "mythic": case "legendary": return "energy";
    case "epic": return "explosion";
    case "rare": return "shatter";
    default: {
      // common/uncommon → vary between shatter and collapse by seed.
      let h = 0;
      for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
      return h % 2 === 0 ? "collapse" : "shatter";
    }
  }
}

export async function renderFatalityCinematic(input: FatalityInput): Promise<AnimationResult | null> {
  const seed = input.seed ?? `${input.winner.name}-fatality-${input.loser.name}`;
  const finisher = input.finisher ?? pickFinisher(input.loser, seed);
  const accent = 0xff5a1e;                                   // fire orange
  const loserColor = input.loser.rarityColor ?? getRarityEffectColor(input.loser.rarity);

  // Geometry on the 1000×560 battle canvas: victor left, doomed foe right.
  const winnerBox = { x: 96, y: 92, w: 300, h: 392 };
  const loserBox = { x: 610, y: 108, w: 280, h: 360 };

  return renderCinematic({
    seed,
    durationMs: 3400,
    maxFrames: 34,
    quality: 15,
    renderScale: 0.72,
    layers: [
      // 1 — living fire arena (breathing gradient + full atmosphere pass).
      arenaBackdrop({
        palette: [0x3a0d0d, 0x180707, 0x050303],
        accent,
        seed,
        atmosphere: [
          { kind: "smoke", intensity: 0.7 },
          { kind: "heat", intensity: 0.8 },
          { kind: "embers", intensity: 0.9, color: accent },
          { kind: "sparks", intensity: 0.5, color: 0xffd54a },
          { kind: "ash", intensity: 0.4 },
        ],
      }),
      // 2 — moving firelight + pulsing vignette.
      dynamicLighting({ color: accent, intensity: 1 }),
      // 3 — the enemy is destroyed (behind the winner/title, right side).
      defeatEffect({
        card: input.loser, ...loserBox,
        kind: finisher, color: loserColor, defeatAt: 0.46, seed,
      }),
      // 4 — the victor, glowing and shimmering, rising from the left.
      cardSpotlight({
        card: input.winner, ...winnerBox,
        enterFrom: "left", appearAt: 0.04,
      }),
      // 5 — lightning + the white strike of the finishing blow.
      flashes({ color: 0xffffff, at: [0.46, 0.62], strength: 0.7 }),
      flashes({ color: accent, at: [0.2, 0.85], strength: 0.3 }),
      // 6 — the FATALITY title slams over the carnage.
      bigTitle({
        text: "FATALITY",
        color: 0xff2020,
        accent,
        appearAt: 0.5,
        subtitle: `${input.winner.name.toUpperCase()} WINS`,
      }),
    ],
  }).catch(() => null);
}
