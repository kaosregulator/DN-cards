// ─────────────────────────────────────────────────────────────────────────────
// Curve sampler — read a borrowed movement at a moment in the loop.
//
// A track's channels are keyframed curves (value at normalized time). The
// compositor asks "what is this channel at phase p?" once per channel per frame;
// this module answers, honouring the cubic-bezier easing the harvester copies
// straight out of the Lottie so a borrowed nod keeps its snap and a borrowed
// blink keeps its flick.
//
// Time wraps: phase is taken modulo 1 so a loop is seamless, and a curve whose
// ends differ is treated as continuing past t=1 back to t=0 (the harvester and
// the builtin tracks author closed loops, so this only matters at the seam).
// ─────────────────────────────────────────────────────────────────────────────

import type { Channel, Curve, MotionTrack } from "../types.js";

/** Neutral resting value for each channel — what "no motion" means. */
export const REST: Record<Channel, number> = {
  tx: 0, ty: 0, scaleX: 1, scaleY: 1, rotate: 0, shearX: 0, squashY: 1, alpha: 1,
};

/**
 * Solve a cubic-bezier easing y for a given x, control points (x1,y1,x2,y2) with
 * implied endpoints (0,0) and (1,1). Newton–Raphson with a bisection fallback —
 * the same approach browsers use for `cubic-bezier()`.
 */
function bezierEase(x: number, x1: number, y1: number, x2: number, y2: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx;
  const cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
  const fx = (t: number) => ((ax * t + bx) * t + cx) * t;
  const dfx = (t: number) => (3 * ax * t + 2 * bx) * t + cx;
  let t = x;
  for (let i = 0; i < 8; i++) {
    const err = fx(t) - x;
    if (Math.abs(err) < 1e-5) break;
    const d = dfx(t);
    if (Math.abs(d) < 1e-6) break;
    t -= err / d;
  }
  // Bisection safety net if Newton wandered out of range.
  if (t < 0 || t > 1) {
    let lo = 0, hi = 1;
    for (let i = 0; i < 20; i++) {
      t = (lo + hi) / 2;
      if (fx(t) < x) lo = t; else hi = t;
    }
  }
  return ((ay * t + by) * t + cy) * t;
}

/** Value of one curve at phase p (0–1). Empty curve → NaN-free fallback 0. */
export function sampleCurve(curve: Curve, p: number, restValue: number): number {
  if (curve.length === 0) return restValue;
  if (curve.length === 1) return curve[0]!.v;

  const t = ((p % 1) + 1) % 1;
  // Before the first / after the last keyframe: hold the nearest end value.
  if (t <= curve[0]!.t) return curve[0]!.v;
  const last = curve[curve.length - 1]!;
  if (t >= last.t) return last.v;

  // Find the bracketing pair.
  let a = curve[0]!;
  let b = last;
  for (let i = 1; i < curve.length; i++) {
    if (curve[i]!.t >= t) { a = curve[i - 1]!; b = curve[i]!; break; }
  }
  const span = b.t - a.t;
  const localX = span > 0 ? (t - a.t) / span : 0;
  const eased = a.ease ? bezierEase(localX, a.ease[0], a.ease[1], a.ease[2], a.ease[3]) : localX;
  return a.v + (b.v - a.v) * eased;
}

/** Every channel of a track, sampled at phase p, missing channels at rest. */
export type ChannelValues = Record<Channel, number>;

export function sampleTrack(track: MotionTrack, p: number): ChannelValues {
  const out = { ...REST };
  for (const ch of Object.keys(track.channels) as Channel[]) {
    const curve = track.channels[ch];
    if (curve && curve.length) out[ch] = sampleCurve(curve, p, REST[ch]);
  }
  return out;
}

/**
 * Peak absolute deviation of a track from rest across the loop, per the largest-
 * moving channel — a cheap "how much does this move?" the harvester stores as
 * `intensity` and the planner can recompute for merged sets.
 */
export function measureIntensity(track: MotionTrack, samples = 24): number {
  let peak = 0;
  for (let i = 0; i < samples; i++) {
    const v = sampleTrack(track, i / samples);
    for (const ch of Object.keys(v) as Channel[]) {
      const dev = Math.abs(v[ch] - REST[ch]);
      // Rotation is radians; normalize so it competes fairly with fractions.
      const norm = ch === "rotate" ? dev / Math.PI : dev;
      if (norm > peak) peak = norm;
    }
  }
  return Math.min(1, peak);
}
