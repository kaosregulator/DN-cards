// ─────────────────────────────────────────────────────────────────────────────
// Colour effects — the subject holds still and its palette or opacity animates.
//
// `hue` and `alpha` are applied by the compositor against the subject's own
// alpha mask, so a transparent PNG stays transparent: only the visible pixels
// are recoloured or faded.
// ─────────────────────────────────────────────────────────────────────────────

import type { EffectDef } from "../types.js";
import { pulse, wave } from "../renderer/easing.js";

export const COLOR_EFFECTS: EffectDef[] = [
  {
    id: "rainbow",
    name: "Rainbow",
    emoji: "🌈",
    description: "Cycles through the full hue wheel",
    frames: 18,
    delayMs: 55,
    directional: false,
    inset: 0.86,
    transform: ({ t }) => ({ hue: t * 360 }),
  },
  {
    id: "fade",
    name: "Fade",
    emoji: "👻",
    description: "Ghosts in and out",
    frames: 14,
    delayMs: 60,
    directional: false,
    inset: 0.86,
    transform: ({ t }) => ({ alpha: 0.15 + 0.85 * pulse(t) }),
  },
  {
    id: "throb",
    name: "Throb",
    emoji: "🔥",
    description: "Hue sweep tied to a size pulse",
    frames: 16,
    delayMs: 50,
    directional: false,
    inset: 0.78,
    transform: ({ t }) => {
      const p = pulse(t);
      const s = 0.84 + 0.2 * p;
      // A narrow sweep across the warm end (red → amber) reads as heat rather
      // than a full rainbow, which would fight the pulse for attention. The
      // colourise has to be near-total: a partial blend toward orange lands on
      // muddy brown for any cool-coloured subject.
      return { scaleX: s, scaleY: s, hue: 25 + 25 * wave(t), hueStrength: 0.92 };
    },
  },
];
