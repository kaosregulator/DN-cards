// ─────────────────────────────────────────────────────────────────────────────
// Decorated effects — procedural overlays painted around the subject.
//
// These prove the layer system: a `back` layer paints under the subject, a
// `front` layer over it, and both are drawn by plain canvas code that never
// needs an image asset. That is the whole reason this system is self-contained —
// there are no sprite sheets to ship, so every effect works at any size.
//
// Painters must be deterministic: identical options must produce an identical
// GIF, so particle placement is seeded from `hashRandom`, never `Math.random`.
// ─────────────────────────────────────────────────────────────────────────────

import type { Ctx } from "../../animations/engine.js";
import type { EffectDef } from "../types.js";
import { TAU, hashRandom, pulse, saw, triangle } from "../renderer/easing.js";

/** Draw a four-pointed sparkle centred at (x,y) with the given arm length. */
function star(ctx: Ctx, x: number, y: number, r: number): void {
  // Concave diamond: long arms, waist pinched to 28% so it reads as a twinkle
  // rather than a plain rhombus.
  const w = r * 0.28;
  ctx.beginPath();
  ctx.moveTo(x, y - r);
  ctx.quadraticCurveTo(x + w * 0.5, y - w * 0.5, x + r, y);
  ctx.quadraticCurveTo(x + w * 0.5, y + w * 0.5, x, y + r);
  ctx.quadraticCurveTo(x - w * 0.5, y + w * 0.5, x - r, y);
  ctx.quadraticCurveTo(x - w * 0.5, y - w * 0.5, x, y - r);
  ctx.closePath();
  ctx.fill();
}

/** Party-palette hues, evenly spaced so consecutive frames stay distinct. */
const PARTY_STOPS = 6;

export const DECORATED_EFFECTS: EffectDef[] = [
  {
    id: "sparkle",
    name: "Sparkle",
    emoji: "✨",
    description: "Twinkling stars orbit the subject",
    frames: 14,
    delayMs: 55,
    directional: false,
    inset: 0.76,
    transform: ({ t }) => {
      const s = 0.94 + 0.06 * pulse(t);
      return { scaleX: s, scaleY: s };
    },
    layers: [
      {
        z: "front",
        paint: (ctx, { t, size }) => {
          const count = 7;
          ctx.fillStyle = "#fff6a8";
          for (let i = 0; i < count; i++) {
            // Each star owns a fixed angle and radius, and twinkles on its own
            // phase offset so they never blink in unison.
            const a = (i / count) * TAU + hashRandom(i * 7919) * 0.7;
            const rad = size * (0.34 + hashRandom(i * 104729) * 0.12);
            const phase = (t + hashRandom(i * 15485863)) % 1;
            const scale = triangle(phase);
            if (scale <= 0.02) continue;
            const x = size / 2 + Math.cos(a) * rad;
            const y = size / 2 + Math.sin(a) * rad;
            ctx.globalAlpha = scale;
            star(ctx, x, y, size * 0.1 * scale);
          }
          ctx.globalAlpha = 1;
        },
      },
    ],
  },
  {
    id: "party",
    name: "Party",
    emoji: "🎉",
    description: "Classic party-mode colour cycling background",
    frames: 12,
    delayMs: 45,
    directional: false,
    inset: 0.8,
    transform: ({ t }) => {
      const s = 0.94 + 0.08 * triangle(t);
      return { scaleX: s, scaleY: s };
    },
    layers: [
      {
        z: "back",
        paint: (ctx, { frame, size }) => {
          // Step the hue per FRAME, not per phase: the hard colour jump every
          // frame is what makes party mode read as party mode.
          const hue = Math.round((frame % PARTY_STOPS) * (360 / PARTY_STOPS));
          ctx.fillStyle = `hsl(${hue}, 92%, 58%)`;
          // A disc rather than a full square keeps the emoji round-ish, which
          // sits better next to Discord's other emoji.
          ctx.beginPath();
          ctx.arc(size / 2, size / 2, size * 0.46, 0, TAU);
          ctx.closePath();
          ctx.fill();
        },
      },
    ],
  },
  {
    id: "confetti",
    name: "Confetti",
    emoji: "🎊",
    description: "Paper falls past the subject",
    frames: 16,
    delayMs: 50,
    directional: false,
    inset: 0.8,
    layers: [
      {
        z: "front",
        paint: (ctx, { t, size }) => {
          const count = 14;
          for (let i = 0; i < count; i++) {
            const x = hashRandom(i * 2654435761) * size;
            // Per-piece fall speed, wrapped by `saw`, so the stream loops
            // seamlessly however long the piece takes to cross the frame.
            const speed = 0.6 + hashRandom(i * 40503) * 0.8;
            const y = saw(t * speed + hashRandom(i * 22699)) * size;
            const hue = Math.round(hashRandom(i * 6700417) * 360);
            const w = size * 0.07;
            const h = size * 0.11;
            ctx.save();
            ctx.translate(x, y);
            // Tumble as it falls; the rotation is tied to the same phase so a
            // piece never appears to stall mid-air.
            ctx.rotate((t * speed + i) * TAU);
            ctx.fillStyle = `hsl(${hue}, 88%, 62%)`;
            ctx.fillRect(-w / 2, -h / 2, w, h);
            ctx.restore();
          }
        },
      },
    ],
  },
];
