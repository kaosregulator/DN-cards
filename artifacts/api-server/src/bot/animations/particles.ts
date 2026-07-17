// ─────────────────────────────────────────────────────────────────────────────
// Shared particle & effect helpers (canvas-sketch-util).
//
// Reusable, self-contained draw helpers for the canvas scenes — sparks, embers,
// smoke, explosions, confetti, floating damage numbers, plus screen-shake and
// projectile-interpolation math. Every layout uses a SEEDED RNG so the same
// scene renders identically each time (no jitter between re-renders) while still
// looking organically random. Built on canvas-sketch-util's math + random.
//
// All draws are additive layers over an existing canvas context — they never
// clear or reshape it, so they compose on top of any scene.
// ─────────────────────────────────────────────────────────────────────────────

import { lerp, mapRange } from "canvas-sketch-util/math";
import random from "canvas-sketch-util/random";
import { hexToRgba, type Ctx } from "./engine.js";

/** A seeded RNG instance — same seed → same layout, so re-renders are stable. */
export function seededRng(seed: string | number) {
  const r = random.createRandom();
  r.setSeed(String(seed));
  return r;
}

export interface SparkOpts {
  count?: number;
  color?: number;        // hex
  minLen?: number;
  maxLen?: number;
  innerRadius?: number;
  lineWidth?: number;
  seed?: string | number;
}

/** Radiating spark shards from a point — crit / impact accent. */
export function drawSparks(ctx: Ctx, x: number, y: number, opts: SparkOpts = {}): void {
  const {
    count = 14, color = 0xffcc33, minLen = 26, maxLen = 72,
    innerRadius = 18, lineWidth = 3, seed = "sparks",
  } = opts;
  const rng = seededRng(seed);
  ctx.save();
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2 + rng.range(-0.12, 0.12);
    const len = rng.range(minLen, maxLen);
    const alpha = rng.range(0.5, 1);
    ctx.strokeStyle = hexToRgba(color, alpha);
    ctx.lineWidth = lineWidth * rng.range(0.6, 1.3);
    ctx.beginPath();
    ctx.moveTo(x + Math.cos(a) * innerRadius, y + Math.sin(a) * innerRadius);
    ctx.lineTo(x + Math.cos(a) * (innerRadius + len), y + Math.sin(a) * (innerRadius + len));
    ctx.stroke();
  }
  ctx.restore();
}

export interface EmberOpts {
  count?: number;
  color?: number;
  minR?: number;
  maxR?: number;
  rise?: number;         // vertical bias — negative floats upward
  seed?: string | number;
}

/** Soft glowing embers scattered in a region (boss aura / fire scenes). */
export function drawEmbers(
  ctx: Ctx, x: number, y: number, w: number, h: number, opts: EmberOpts = {},
): void {
  const { count = 28, color = 0xff7a1a, minR = 1.5, maxR = 4.5, rise = -0.35, seed = "embers" } = opts;
  const rng = seededRng(seed);
  ctx.save();
  for (let i = 0; i < count; i++) {
    const px = x + rng.range(0, w);
    // Bias vertical position so embers cluster toward the top when rising.
    const vy = rise < 0 ? Math.pow(rng.value(), 1 + Math.abs(rise)) : rng.value();
    const py = y + vy * h;
    const r = rng.range(minR, maxR);
    const alpha = mapRange(r, minR, maxR, 0.25, 0.7);
    ctx.fillStyle = hexToRgba(color, alpha);
    ctx.beginPath();
    ctx.arc(px, py, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

export interface ExplosionOpts {
  radius?: number;
  color?: number;
  ringCount?: number;
  seed?: string | number;
}

/** Concentric shockwave rings — big-hit / boss-entrance burst. */
export function drawExplosion(ctx: Ctx, x: number, y: number, opts: ExplosionOpts = {}): void {
  const { radius = 90, color = 0xffd54a, ringCount = 3, seed = "boom" } = opts;
  const rng = seededRng(seed);
  ctx.save();
  for (let i = 0; i < ringCount; i++) {
    const r = radius * lerp(0.4, 1, i / Math.max(1, ringCount - 1)) * rng.range(0.92, 1.08);
    ctx.strokeStyle = hexToRgba(color, mapRange(i, 0, ringCount - 1, 0.75, 0.2));
    ctx.lineWidth = lerp(6, 2, i / Math.max(1, ringCount - 1));
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.stroke();
  }
  drawSparks(ctx, x, y, { count: 18, color, maxLen: radius, seed: `${seed}-sparks` });
  ctx.restore();
}

export interface ConfettiOpts {
  count?: number;
  colors?: number[];
  seed?: string | number;
}

/** Falling confetti pieces across the frame — victory celebration. */
export function drawConfetti(ctx: Ctx, width: number, height: number, opts: ConfettiOpts = {}): void {
  const { count = 60, colors = [0xff5e78, 0xffd54a, 0x4ad991, 0x4a9ff5, 0xb56bff], seed = "confetti" } = opts;
  const rng = seededRng(seed);
  ctx.save();
  for (let i = 0; i < count; i++) {
    const px = rng.range(0, width);
    const py = rng.range(0, height);
    const size = rng.range(4, 10);
    const rot = rng.range(0, Math.PI);
    ctx.fillStyle = hexToRgba(rng.pick(colors), rng.range(0.6, 1));
    ctx.save();
    ctx.translate(px, py);
    ctx.rotate(rot);
    ctx.fillRect(-size / 2, -size / 2, size, size * rng.range(0.4, 0.9));
    ctx.restore();
  }
  ctx.restore();
}

/**
 * Deterministic screen-shake offset for a given seed + intensity. Callers can
 * translate the context by {dx, dy} before drawing to fake an impact shake in a
 * single static frame.
 */
export function shakeOffset(seed: string | number, intensity: number): { dx: number; dy: number } {
  const rng = seededRng(seed);
  return { dx: rng.gaussian(0, intensity), dy: rng.gaussian(0, intensity) };
}

/** Linear projectile position between two points at t∈[0,1] (with optional arc). */
export function projectileLerp(
  from: { x: number; y: number }, to: { x: number; y: number }, t: number, arc = 0,
): { x: number; y: number } {
  const x = lerp(from.x, to.x, t);
  const y = lerp(from.y, to.y, t) - Math.sin(t * Math.PI) * arc;
  return { x, y };
}
