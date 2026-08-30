// ─────────────────────────────────────────────────────────────────────────────
// Shared transform primitives for the offline MakeEmoji engine.
//
// Many of the ~300 animated styles are motion/scale/color variants of a small
// set of behaviours. Recipes name a primitive + params; this module turns that
// into an EffectDef the existing compositor can render.
// ─────────────────────────────────────────────────────────────────────────────

import type { EffectDef } from "../../types.js";
import { directionSign, directionVector, isVertical } from "../../utils/options.js";
import { TAU, bounce, hashRandom, pulse, saw, wave } from "../../renderer/easing.js";
import { getEffect } from "../../registry/index.js";
import type { EmojiDirection } from "../../types.js";

export interface PrimitiveParams {
  amp?: number;
  cycles?: number;
  turns?: number;
  radius?: number;
  minScale?: number;
  maxScale?: number;
  height?: number;
  squash?: number;
  mode?: string;
  [key: string]: unknown;
}

/** Build an EffectDef for a named primitive, or reuse a registry effect as-is. */
export function effectFromPrimitive(primitive: string, params: PrimitiveParams = {}): EffectDef | null {
  // Exact local registry ids are valid primitives.
  const existing = getEffect(primitive);
  if (existing && Object.keys(params).length === 0) return existing;

  const built = buildPrimitive(primitive, params);
  if (built) return built;
  return existing ?? null;
}

function buildPrimitive(id: string, p: PrimitiveParams): EffectDef | null {
  switch (id) {
    case "passthrough":
      return {
        id: "passthrough", name: "None", emoji: "⬜", description: "No animation",
        frames: 1, delayMs: 100, directional: false, inset: 0.92,
        transform: () => ({}),
      };

    case "shake": {
      const amp = num(p.amp, 0.07);
      const cycles = num(p.cycles, 2);
      return {
        id: "shake", name: "Shake", emoji: "🫨", description: "Rapid jitter",
        frames: 8, delayMs: 50, directional: true, inset: 0.84,
        transform: ({ t, direction }) => {
          const a = amp * wave(t, cycles);
          return isVertical(direction) ? { offsetY: a } : { offsetX: a };
        },
      };
    }

    case "spin": {
      const turns = num(p.turns, 1);
      return {
        id: "spin", name: "Spin", emoji: "🌀", description: "Full rotation",
        frames: 16, delayMs: 55, directional: true, inset: 0.7,
        transform: ({ t, direction }) => ({
          rotate: directionSign(direction) * t * TAU * turns,
        }),
      };
    }

    case "bounce": {
      const height = num(p.height, 0.16);
      const squash = num(p.squash, 0.22);
      return {
        id: "bounce", name: "Bounce", emoji: "🏀", description: "Hop and squash",
        frames: 14, delayMs: 45, directional: true, inset: 0.78,
        transform: ({ t, direction }) => {
          const h = bounce(t);
          const travel = -height * h * directionSign(direction);
          const sq = 1 - (1 - h) * squash;
          const st = 1 + (1 - h) * squash;
          return isVertical(direction)
            ? { offsetY: travel, scaleX: st, scaleY: sq }
            : { offsetX: travel, scaleX: sq, scaleY: st };
        },
      };
    }

    case "wobble":
      return {
        id: "wobble", name: "Wobble", emoji: "📳", description: "Pendulum sway",
        frames: 14, delayMs: 55, directional: true, inset: 0.78,
        transform: ({ t, direction }) => {
          const a = 0.18 * wave(t, 1);
          return { rotate: isVertical(direction) ? a * 0.4 : a };
        },
      };

    case "wave":
      return {
        id: "wave", name: "Wave", emoji: "🌊", description: "Sine sway",
        frames: 14, delayMs: 50, directional: true, inset: 0.8,
        transform: ({ t, direction }) => {
          const a = 0.1 * wave(t, 1);
          const v = directionVector(direction);
          return { offsetX: v.y * a, offsetY: v.x * a, rotate: a * 0.5 };
        },
      };

    case "slide": {
      const mode = String(p.mode ?? "loop");
      return {
        id: "slide", name: "Slide", emoji: "➡️", description: "Travel across",
        frames: 16, delayMs: 55, directional: true, inset: 0.72,
        transform: ({ t, direction }) => {
          const v = directionVector(direction);
          let travel: number;
          if (mode === "in") travel = (1 - t) * -0.9;
          else if (mode === "out") travel = t * 0.9;
          else travel = saw(t) - 0.5;
          return { offsetX: v.x * travel * 1.6, offsetY: v.y * travel * 1.6 };
        },
      };
    }

    case "orbit": {
      const radius = num(p.radius, 0.18);
      return {
        id: "orbit", name: "Orbit", emoji: "🪐", description: "Circle the centre",
        frames: 16, delayMs: 55, directional: true, inset: 0.68,
        transform: ({ t, direction }) => {
          const ang = directionSign(direction) * t * TAU;
          return { offsetX: Math.cos(ang) * radius, offsetY: Math.sin(ang) * radius };
        },
      };
    }

    case "flip": {
      const cycles = num(p.cycles, 1);
      return {
        id: "flip", name: "Flip", emoji: "🔄", description: "Horizontal flip",
        frames: 12, delayMs: 55, directional: true, inset: 0.82,
        transform: ({ t, direction }) => {
          const phase = saw(t * cycles);
          const sx = Math.cos(phase * Math.PI);
          return isVertical(direction)
            ? { scaleY: Math.max(0.05, Math.abs(sx)) * Math.sign(sx || 1) }
            : { scaleX: Math.max(0.05, Math.abs(sx)) * Math.sign(sx || 1) };
        },
      };
    }

    case "glitch":
      return {
        id: "glitch", name: "Glitch", emoji: "📺", description: "Discontinuous jitter",
        frames: 10, delayMs: 45, directional: false, inset: 0.82, discontinuous: true,
        transform: ({ frame, frames }) => {
          const r = hashRandom(frame * 17 + frames);
          return {
            offsetX: (r - 0.5) * 0.14,
            offsetY: (hashRandom(frame * 31) - 0.5) * 0.1,
            hue: r * 360,
            hueStrength: 0.35,
          };
        },
      };

    case "pulse": {
      const minS = num(p.minScale, 0.86);
      const maxS = num(p.maxScale, 1.08);
      return {
        id: "pulse", name: "Pulse", emoji: "💗", description: "Scale pulse",
        frames: 12, delayMs: 55, directional: false, inset: 0.8,
        transform: ({ t }) => {
          const s = minS + (maxS - minS) * pulse(t);
          return { scaleX: s, scaleY: s };
        },
      };
    }

    case "zoom":
      return {
        id: "zoom", name: "Zoom", emoji: "🔍", description: "Zoom in and out",
        frames: 14, delayMs: 55, directional: false, inset: 0.7,
        transform: ({ t }) => {
          const s = 0.72 + 0.36 * (0.5 - 0.5 * Math.cos(t * TAU));
          return { scaleX: s, scaleY: s };
        },
      };

    case "heartbeat":
      return {
        id: "heartbeat", name: "Heartbeat", emoji: "💓", description: "Double pulse",
        frames: 16, delayMs: 50, directional: false, inset: 0.78,
        transform: ({ t }) => {
          // Two quick beats then rest — approximate MakeEmoji heartbeat.
          const local = (t * 2) % 1;
          const beat = local < 0.25 ? pulse(local / 0.25) : local < 0.5 ? pulse((local - 0.25) / 0.25) * 0.7 : 0;
          const s = 0.92 + 0.16 * beat;
          return { scaleX: s, scaleY: s };
        },
      };

    case "squish":
      return {
        id: "squish", name: "Squish", emoji: "🍮", description: "Vertical squash",
        frames: 12, delayMs: 55, directional: true, inset: 0.8,
        transform: ({ t, direction }) => {
          const w = 0.5 + 0.5 * wave(t, 1);
          return isVertical(direction)
            ? { scaleX: 0.85 + 0.3 * w, scaleY: 1.15 - 0.3 * w }
            : { scaleX: 1.15 - 0.3 * w, scaleY: 0.85 + 0.3 * w };
        },
      };

    case "tilt":
      return {
        id: "tilt", name: "Tilt", emoji: "📐", description: "Gentle tilt",
        frames: 12, delayMs: 60, directional: true, inset: 0.84,
        transform: ({ t, direction }) => ({
          rotate: directionSign(direction) * 0.22 * wave(t, 1),
        }),
      };

    case "nod":
      return {
        id: "nod", name: "Nod", emoji: "垂", description: "Vertical nod",
        frames: 10, delayMs: 55, directional: false, inset: 0.86,
        transform: ({ t }) => ({ offsetY: 0.06 * wave(t, 1) }),
      };

    case "fade":
      return {
        id: "fade", name: "Fade", emoji: "👻", description: "Opacity pulse",
        frames: 12, delayMs: 60, directional: false, inset: 0.9,
        transform: ({ t }) => ({ alpha: 0.35 + 0.65 * pulse(t) }),
      };

    case "rainbow":
      return {
        id: "rainbow", name: "Rainbow", emoji: "🌈", description: "Hue cycle",
        frames: 16, delayMs: 55, directional: false, inset: 0.9,
        transform: ({ t }) => ({ hue: t * 360, hueStrength: 0.85 }),
      };

    case "spiral":
      return {
        id: "spiral", name: "Spiral", emoji: "🌀", description: "Spin while orbiting",
        frames: 16, delayMs: 50, directional: true, inset: 0.65,
        transform: ({ t, direction }) => {
          const ang = directionSign(direction) * t * TAU;
          const r = 0.12;
          return {
            offsetX: Math.cos(ang) * r,
            offsetY: Math.sin(ang) * r,
            rotate: ang * 2,
          };
        },
      };

    case "sparkle":
    case "party":
    case "confetti":
      return getEffect(id === "confetti" ? "confetti" : id) ?? getEffect("sparkle") ?? null;

    case "pet":
      // Hand-petting approximation: subject bobbles under a front-layer pat.
      return {
        id: "pet", name: "Pet", emoji: "🤚", description: "Gentle petting bob",
        frames: 10, delayMs: 50, directional: false, inset: 0.82,
        transform: ({ t }) => ({
          offsetY: 0.04 * Math.max(0, wave(t, 1)),
          scaleY: 1 - 0.04 * Math.max(0, wave(t, 1)),
          scaleX: 1 + 0.03 * Math.max(0, wave(t, 1)),
        }),
      };

    case "boing":
      return buildPrimitive("bounce", { height: 0.22, squash: 0.3 });

    case "bobble":
      return buildPrimitive("wobble", {});

    default:
      return null;
  }
}

function num(v: unknown, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

/** Resolve forced direction from recipe params / MakeEmoji arrow suffix. */
export function directionFromRecipe(
  params: PrimitiveParams,
  fallback: EmojiDirection,
): EmojiDirection {
  const forced = params.forcedDirection;
  if (forced === "left" || forced === "right" || forced === "up" || forced === "down") return forced;
  return fallback;
}
