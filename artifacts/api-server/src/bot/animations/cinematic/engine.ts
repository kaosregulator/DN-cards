// ─────────────────────────────────────────────────────────────────────────────
// Cinematic Engine — a reusable, timeline-driven GIF compositor.
//
// This is the shared foundation for "mini-movie" moments: Fatality finishers
// today, and later pack openings, boss intros, raid victories, and anything else
// that wants a few seconds of layered, looping motion. It never encodes anything
// itself beyond wrapping the existing animation engine (encodeAnimation), so all
// the size/duplicate-frame/8MB-guard machinery is reused untouched.
//
// A cinematic is just an ORDERED LIST OF LAYERS. Each layer is a small function
// that draws one thing per frame given the current phase; the engine iterates
// them back-to-front every frame. Layers compose — a scene is assembled from the
// reusable effect layers in ./effects.ts (dynamic lighting, animated title, card
// spotlight, defeat bursts, …), so new cinematics are declarative layer lists,
// not new renderers.
//
// Two math helpers back the whole thing:
//   • keyframes() — d3-interpolate-powered value tweening across timed stops,
//     with per-segment easing, so motion is authored as "at t=0.2 be here, at
//     t=0.5 be there" instead of hand-rolled lerps.
//   • camera() — a gl-matrix mat2d transform (zoom / pan / rotate / shake) the
//     engine applies around a layer group, for push-ins and impact shakes.
// ─────────────────────────────────────────────────────────────────────────────

import { interpolate as d3interpolate, interpolateRgb } from "d3-interpolate";
import { mat2d, vec2 } from "gl-matrix";
import {
  encodeAnimation, BATTLE_CANVAS, clamp01, type Ctx, type CanvasMod, type FrameCtx,
} from "../engine.js";
import type { AnimationSpeed, AnimationResult } from "../types.js";
import { seededRng } from "../particles.js";

// The per-frame context every layer receives. `t` is the global 0→1 phase; the
// engine also passes the shared canvas module + a seeded RNG so layers stay
// deterministic (same cinematic renders identically each time).
export interface CinematicFrame {
  ctx: Ctx;
  mod: CanvasMod;
  t: number;            // 0 → 1 across the whole cinematic
  frameIndex: number;
  frameCount: number;
  width: number;
  height: number;
  rng: ReturnType<typeof seededRng>;
  seed: string;
}

// A layer draws one element of the scene each frame. May be async (image loads).
export interface CinematicLayer {
  (frame: CinematicFrame): void | Promise<void>;
}

export interface CinematicOptions {
  width?: number;
  height?: number;
  durationMs?: number;
  speed?: AnimationSpeed;
  maxFrames?: number;
  quality?: number;
  renderScale?: number;
  seed?: string;
  layers: CinematicLayer[];
}

// ── Keyframe tweening (d3-interpolate) ────────────────────────────────────────
export interface Keyframe<T> {
  at: number;                              // phase 0..1
  value: T;
  ease?: (x: number) => number;            // easing INTO this stop (default linear)
}

/**
 * Interpolate a value across timed stops using d3-interpolate (numbers, arrays,
 * colours — anything d3 understands). Segments can each carry their own easing.
 * Returns the first/last stop's value outside the range (a hold), so authors
 * don't have to clamp by hand.
 */
export function keyframes<T>(t: number, stops: Keyframe<T>[]): T {
  if (stops.length === 0) throw new Error("keyframes: need at least one stop");
  if (stops.length === 1 || t <= stops[0]!.at) return stops[0]!.value;
  const last = stops[stops.length - 1]!;
  if (t >= last.at) return last.value;
  for (let i = 0; i < stops.length - 1; i++) {
    const a = stops[i]!, b = stops[i + 1]!;
    if (t >= a.at && t <= b.at) {
      const span = b.at - a.at || 1;
      const localRaw = (t - a.at) / span;
      const local = (b.ease ?? ((x: number) => x))(clamp01(localRaw));
      // d3-interpolate is structurally typed for numbers/arrays/colours; our T is
      // constrained only by the caller, so bridge through the untyped overload.
      return d3interpolate(a.value as never, b.value as never)(local) as T;
    }
  }
  return last.value;
}

/** Colour tween between two hex ints at local phase u∈[0,1] → "rgb(...)" string. */
export function mixHex(a: number, b: number, u: number): string {
  const toCss = (n: number) => `rgb(${(n >> 16) & 0xff},${(n >> 8) & 0xff},${n & 0xff})`;
  return interpolateRgb(toCss(a), toCss(b))(clamp01(u));
}

// ── Easing library (a few beyond the base engine's, for punchy cinematics) ────
export const ease = {
  linear: (x: number) => x,
  inCubic: (x: number) => x * x * x,
  outCubic: (x: number) => 1 - Math.pow(1 - x, 3),
  inOutCubic: (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2),
  outExpo: (x: number) => (x >= 1 ? 1 : 1 - Math.pow(2, -10 * x)),
  outBack: (x: number) => {
    const c1 = 1.70158, c3 = c1 + 1;
    return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2);
  },
  // A sharp slam: fast in, hard stop, tiny settle. Great for title impacts.
  slam: (x: number) => (x < 0.85 ? ease.outExpo(x / 0.85) : 1 + Math.sin((x - 0.85) / 0.15 * Math.PI) * 0.04),
};

// ── Camera (gl-matrix mat2d) ──────────────────────────────────────────────────
export interface CameraState {
  zoom?: number;    // 1 = none
  panX?: number;    // pixels
  panY?: number;
  rotate?: number;  // radians
  originX?: number; // pivot (defaults to frame centre)
  originY?: number;
}

/**
 * Build a mat2d camera transform (zoom/pan/rotate about a pivot) with gl-matrix
 * and apply it to the context. Returns a restore() that pops it. Use around a
 * group of layers for a shared push-in / shake.
 */
export function applyCamera(ctx: Ctx, width: number, height: number, cam: CameraState): () => void {
  const ox = cam.originX ?? width / 2;
  const oy = cam.originY ?? height / 2;
  const m = mat2d.create();
  // Compose T(origin) · R · S · T(-origin) · T(pan), right-to-left via gl-matrix.
  mat2d.translate(m, m, vec2.fromValues(ox, oy));
  if (cam.rotate) mat2d.rotate(m, m, cam.rotate);
  const z = cam.zoom ?? 1;
  if (z !== 1) mat2d.scale(m, m, vec2.fromValues(z, z));
  mat2d.translate(m, m, vec2.fromValues(-ox, -oy));
  if (cam.panX || cam.panY) mat2d.translate(m, m, vec2.fromValues(cam.panX ?? 0, cam.panY ?? 0));
  ctx.save();
  // mat2d layout is [a, b, c, d, tx, ty] — exactly canvas setTransform order.
  ctx.transform(m[0], m[1], m[2], m[3], m[4], m[5]);
  return () => ctx.restore();
}

// ── Public: render a cinematic to an animated GIF ─────────────────────────────
/**
 * Compose the layer list into a looping GIF via the shared animation engine.
 * Best-effort: returns null if the canvas/GIF stack is unavailable or the encode
 * overflows Discord's size cap — callers fall back to their normal still image.
 */
export async function renderCinematic(opts: CinematicOptions): Promise<AnimationResult | null> {
  const {
    width = BATTLE_CANVAS.width,
    height = BATTLE_CANVAS.height,
    durationMs = 3200,
    speed = "normal",
    maxFrames = 34,
    quality = 16,
    renderScale = 0.7,
    seed = "cinematic",
    layers,
  } = opts;

  return encodeAnimation({
    width, height, speed, durationMs, maxFrames, quality, renderScale,
    render: async (f: FrameCtx) => {
      const frame: CinematicFrame = {
        ctx: f.ctx, mod: f.mod, t: f.t,
        frameIndex: f.frameIndex, frameCount: f.frameCount,
        width, height, seed, rng: seededRng(seed),
      };
      for (const layer of layers) {
        // Each layer isolates its own state; a thrown layer never kills the frame.
        f.ctx.save();
        try { await layer(frame); } catch { /* skip a bad layer, keep the scene */ }
        f.ctx.restore();
      }
    },
  });
}
