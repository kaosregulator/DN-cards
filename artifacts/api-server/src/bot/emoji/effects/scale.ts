// ─────────────────────────────────────────────────────────────────────────────
// Scale effects — the subject stays put and changes size or proportion.
//
// These are deliberately non-directional: a pulse has no meaningful "left". The
// registry surfaces that via `directional: false` so the command UI hides the
// direction control instead of offering a setting that does nothing.
// ─────────────────────────────────────────────────────────────────────────────

import type { EffectDef } from "../types.js";
import { heartbeat, pulse, triangle, wave } from "../renderer/easing.js";

export const SCALE_EFFECTS: EffectDef[] = [
  {
    id: "pulse",
    name: "Pulse",
    emoji: "💗",
    description: "Smoothly breathes in and out",
    frames: 12,
    delayMs: 55,
    directional: false,
    inset: 0.78,
    transform: ({ t }) => {
      const s = 0.82 + 0.24 * pulse(t);
      return { scaleX: s, scaleY: s };
    },
  },
  {
    id: "zoom",
    name: "Zoom",
    emoji: "🔍",
    description: "Punches in hard, then eases back",
    frames: 14,
    delayMs: 45,
    directional: false,
    inset: 0.7,
    transform: ({ t }) => {
      // Triangle rather than a sine: the linear ramp in reads as a deliberate
      // push rather than a soft breath.
      const s = 0.68 + 0.62 * triangle(t);
      return { scaleX: s, scaleY: s };
    },
  },
  {
    id: "jello",
    name: "Jello",
    emoji: "🍮",
    description: "Wobbles like set jelly, conserving volume",
    frames: 14,
    delayMs: 45,
    directional: false,
    inset: 0.78,
    transform: ({ t }) => {
      // Squash on one axis, stretch on the other by the inverse, so the subject
      // keeps its apparent mass instead of visibly growing.
      const k = 1 + 0.2 * wave(t, 2);
      return { scaleX: k, scaleY: 1 / k };
    },
  },
  {
    id: "heartbeat",
    name: "Heartbeat",
    emoji: "❤️",
    description: "Double-thump, then rests",
    frames: 16,
    delayMs: 42,
    directional: false,
    inset: 0.76,
    transform: ({ t }) => {
      const s = 1 + 0.26 * heartbeat(t);
      return { scaleX: s, scaleY: s };
    },
  },
  {
    id: "squish",
    name: "Squish",
    emoji: "🫳",
    description: "Flattened from above and springs back",
    frames: 12,
    delayMs: 48,
    directional: false,
    inset: 0.8,
    transform: ({ t }) => {
      const p = pulse(t);
      // Squashing downward also drops the subject so it stays seated on the same
      // baseline instead of shrinking toward its own centre.
      const scaleY = 1 - 0.34 * p;
      return { scaleY, scaleX: 1 + 0.2 * p, offsetY: 0.17 * p };
    },
  },
];
