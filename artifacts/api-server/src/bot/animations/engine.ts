// Animation engine — low-level frame management and GIF encoding.
// Lazy-loads @napi-rs/canvas and gifencoder so missing native deps never break
// commands that don't use animation.

import GIFEncoder from "gifencoder";
import type { Canvas, SKRSContext2D } from "@napi-rs/canvas";
import type { AnimationSpeed, AnimationResult } from "./types.js";
import { logger } from "../../lib/logger.js";

export type CanvasMod = typeof import("@napi-rs/canvas");

// The 2D context type used across the animation system. Mirrors the existing
// battle-image renderer, which types the napi-rs context rather than pulling in
// the DOM lib. Kept as a single alias so effects/pack/battle stay consistent.
//
// The shipped @napi-rs/canvas declarations under-declare a few standard 2D
// methods in this project's module resolution (scale/transform/setTransform/
// quadraticCurveTo). They exist at runtime on the spec-complete Skia context,
// so we re-declare them here to keep the animation code fully typed.
export type Ctx = SKRSContext2D & {
  scale(x: number, y: number): void;
  transform(a: number, b: number, c: number, d: number, e: number, f: number): void;
  setTransform(a: number, b: number, c: number, d: number, e: number, f: number): void;
  quadraticCurveTo(cpx: number, cpy: number, x: number, y: number): void;
};

// Horizontal text alignment values accepted by the napi-rs 2D context. Declared
// locally because the project intentionally excludes the DOM lib.
export type TextAlign = "left" | "right" | "center" | "start" | "end";

export const PACK_CANVAS = { width: 800, height: 520 } as const;
export const BATTLE_CANVAS = { width: 1000, height: 560 } as const;

// Discord's default (non-boosted) attachment limit is 8 MiB. Stay safely under
// it: an animation that would exceed this is dropped (treated like an encode
// failure) so the command still succeeds with its static embed instead of the
// attach throwing after rewards were already granted.
export const MAX_ANIMATION_BYTES = 8_000_000;

let _canvas: CanvasMod | null | undefined;

export async function getCanvas(): Promise<CanvasMod | null> {
  if (_canvas !== undefined) return _canvas;
  try {
    _canvas = await import("@napi-rs/canvas");
  } catch (err) {
    logger.debug({ err }, "animation engine: @napi-rs/canvas not available");
    _canvas = null;
  }
  return _canvas;
}

export function msPerFrame(speed: AnimationSpeed): number {
  switch (speed) {
    case "slow": return 160;
    case "fast": return 60;
    default: return 100;
  }
}

export function framesForDurationMs(durationMs: number, speed: AnimationSpeed): number {
  return Math.max(2, Math.round(durationMs / msPerFrame(speed)));
}

export interface FrameCtx {
  canvas: Canvas;
  ctx: Ctx;
  t: number;          // 0 → 1 across the whole animation
  frameIndex: number;
  frameCount: number;
  mod: CanvasMod;
}

export async function encodeAnimation(
  width: number,
  height: number,
  speed: AnimationSpeed,
  durationMs: number,
  render: (frame: FrameCtx) => Promise<void> | void,
): Promise<AnimationResult | null> {
  const mod = await getCanvas();
  if (!mod) return null;
  try {
    const delay = msPerFrame(speed);
    const frameCount = framesForDurationMs(durationMs, speed);
    const encoder = new GIFEncoder(width, height);
    encoder.start();
    encoder.setRepeat(0);       // loop forever
    encoder.setDelay(delay);    // ms per frame
    encoder.setQuality(10);     // 1-30, lower = better but slower

    for (let i = 0; i < frameCount; i++) {
      const canvas = mod.createCanvas(width, height);
      const ctx = canvas.getContext("2d") as unknown as Ctx;
      const t = frameCount <= 1 ? 1 : i / (frameCount - 1);
      await render({ canvas, ctx, t, frameIndex: i, frameCount, mod });
      encoder.addFrame(ctx);
    }
    encoder.finish();
    const buffer = encoder.out.getData();
    if (buffer.length > MAX_ANIMATION_BYTES) {
      logger.debug(
        { bytes: buffer.length, max: MAX_ANIMATION_BYTES },
        "animation engine: encoded GIF exceeds attachment limit, falling back to static",
      );
      return null;
    }
    return {
      buffer,
      width,
      height,
      frameCount,
      durationMs: frameCount * delay,
    };
  } catch (err) {
    logger.error({ err }, "animation engine: encode failed");
    return null;
  }
}

export function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

export function easeOutBack(x: number): number {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2);
}

export function easeOutElastic(x: number): number {
  const c4 = (2 * Math.PI) / 3;
  return x === 0 ? 0 : x === 1 ? 1 : Math.pow(2, -10 * x) * Math.sin((x * 10 - 0.75) * c4) + 1;
}

export function easeInOutCubic(x: number): number {
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function hexToRgba(hex: number, alpha: number): string {
  const r = (hex >> 16) & 0xff;
  const g = (hex >> 8) & 0xff;
  const b = hex & 0xff;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export function roundRectPath(
  ctx: Ctx,
  x: number, y: number, w: number, h: number, r: number,
): void {
  const radius = Math.min(r, w / 2, h / 2);
  // Uses arcTo (not quadraticCurveTo) to match the battle-image renderer, whose
  // context type is the source of truth for what the napi-rs canvas exposes.
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

export function drawGradientBackground(
  ctx: Ctx,
  width: number,
  height: number,
  stops: [number, string][],
  angleRad = 0,
): void {
  const cx = width / 2, cy = height / 2;
  const dx = Math.cos(angleRad) * width * 0.5;
  const dy = Math.sin(angleRad) * height * 0.5;
  const g = ctx.createLinearGradient(cx - dx, cy - dy, cx + dx, cy + dy);
  for (const [offset, color] of stops) g.addColorStop(offset, color);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, width, height);
}
