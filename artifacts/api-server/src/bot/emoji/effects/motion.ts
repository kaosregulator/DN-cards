// ─────────────────────────────────────────────────────────────────────────────
// Motion effects — the subject moves, but keeps its shape and colour.
//
// Each entry is pure data plus one pure function of the loop phase. Nothing here
// touches a canvas; the compositor turns these transforms into pixels. All
// offsets are fractions of the canvas edge, so every effect is resolution-
// independent and renders identically at 32px and 128px.
// ─────────────────────────────────────────────────────────────────────────────

import type { EffectDef } from "../types.js";
import { directionSign, directionVector, isVertical } from "../utils/options.js";
import { TAU, bounce, cwave, hashRandom, saw, triangle, wave } from "../renderer/easing.js";

export const MOTION_EFFECTS: EffectDef[] = [
  {
    id: "shake",
    name: "Shake",
    emoji: "🫨",
    description: "Rapid jitter along the chosen axis",
    frames: 8,
    delayMs: 50,
    directional: true,
    inset: 0.84,
    transform: ({ t, direction }) => {
      // Two full cycles per loop keeps it frantic rather than a slow sway.
      const amp = 0.07 * wave(t, 2);
      return isVertical(direction) ? { offsetY: amp } : { offsetX: amp };
    },
  },
  {
    id: "spin",
    name: "Spin",
    emoji: "🌀",
    description: "One full rotation per loop",
    frames: 16,
    delayMs: 55,
    directional: true,
    // A rotating square's corners sweep a circle of radius w·√2/2, so it needs
    // ~71% of the frame to never clip at 45°.
    inset: 0.7,
    transform: ({ t, direction }) => ({ rotate: directionSign(direction) * t * TAU }),
  },
  {
    id: "bounce",
    name: "Bounce",
    emoji: "🏀",
    description: "Hops and squashes on landing",
    frames: 14,
    delayMs: 45,
    directional: true,
    inset: 0.78,
    transform: ({ t, direction }) => {
      const h = bounce(t); // 0 at the seam (landed), 1 at apex
      const travel = -0.16 * h * directionSign(direction);
      // Squash hardest at the landing frames, where h is near 0.
      const squash = 1 - (1 - h) * 0.22;
      const stretch = 1 + (1 - h) * 0.22;
      return isVertical(direction)
        ? { offsetY: travel, scaleX: stretch, scaleY: squash }
        : { offsetX: travel, scaleX: squash, scaleY: stretch };
    },
  },
  {
    id: "slide",
    name: "Slide",
    emoji: "➡️",
    description: "Travels across the frame and wraps around",
    frames: 16,
    delayMs: 55,
    directional: true,
    inset: 0.72,
    transform: ({ t, direction }) => {
      const v = directionVector(direction);
      // Centre the sweep on 0 so the subject is mid-frame at t=0.5 and exits
      // symmetrically on both sides.
      const travel = saw(t) - 0.5;
      return { offsetX: v.x * travel * 1.6, offsetY: v.y * travel * 1.6 };
    },
  },
  {
    id: "orbit",
    name: "Orbit",
    emoji: "🛸",
    description: "Circles the centre of the frame",
    frames: 16,
    delayMs: 55,
    directional: true,
    inset: 0.66,
    transform: ({ t, direction }) => {
      const a = directionSign(direction) * t * TAU;
      const r = 0.13;
      return { offsetX: Math.cos(a) * r, offsetY: Math.sin(a) * r };
    },
  },
  {
    id: "wobble",
    name: "Wobble",
    emoji: "🤪",
    description: "Rocks back and forth",
    frames: 12,
    delayMs: 55,
    directional: true,
    inset: 0.8,
    transform: ({ t, direction }) => ({
      rotate: directionSign(direction) * wave(t) * 0.34,
    }),
  },
  {
    id: "spiral",
    name: "Spiral",
    emoji: "🌪️",
    description: "Spins while pulsing in and out",
    frames: 18,
    delayMs: 50,
    directional: true,
    inset: 0.68,
    transform: ({ t, direction }) => {
      const s = 0.72 + 0.28 * triangle(t);
      return { rotate: directionSign(direction) * t * TAU, scaleX: s, scaleY: s };
    },
  },
  {
    id: "flip",
    name: "Flip",
    emoji: "🔄",
    description: "Turns over like a coin",
    frames: 14,
    delayMs: 55,
    directional: true,
    inset: 0.8,
    transform: ({ t, direction }) => {
      // A cosine on one axis reads as a 3D turn: the subject squashes to nothing
      // edge-on at the quarter points, then opens out mirrored.
      const s = cwave(t);
      return isVertical(direction) ? { scaleY: s } : { scaleX: s };
    },
  },
  {
    id: "glitch",
    name: "Glitch",
    emoji: "📺",
    description: "Datamosh jitter with hard displacement",
    frames: 10,
    delayMs: 45,
    directional: true,
    inset: 0.82,
    // Frame-indexed on purpose: the hard jump at the loop seam is the effect.
    discontinuous: true,
    transform: ({ frame, direction }) => {
      // Deterministic per-frame jitter: the same options always render the same
      // GIF, which keeps previews stable and makes the output cacheable.
      const r = hashRandom(frame * 2654435761);
      const kick = (r - 0.5) * 0.12;
      const skip = hashRandom(frame * 40503) > 0.72 ? 0.05 : 0;
      return isVertical(direction)
        ? { offsetY: kick, offsetX: skip }
        : { offsetX: kick, offsetY: skip };
    },
  },
];
