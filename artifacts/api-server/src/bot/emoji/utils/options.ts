// ─────────────────────────────────────────────────────────────────────────────
// Option vocabulary + parsing.
//
// The allowed values live here once and are reused by the slash-command choices,
// the component UI and the renderer, so the three can never drift apart. Every
// parser is total: unknown input falls back to the default rather than throwing,
// because a stale button on an old message must never break a render.
// ─────────────────────────────────────────────────────────────────────────────

import type { EmojiDirection, EmojiFormat, EmojiSize, EmojiSpeed } from "../types.js";

export const SPEEDS = ["slow", "normal", "fast", "turbo"] as const;
export const DIRECTIONS = ["right", "left", "up", "down"] as const;
export const FORMATS = ["gif", "png"] as const;
export const SIZES = [32, 48, 64, 96, 112, 128] as const;

export const DEFAULT_SPEED: EmojiSpeed = "normal";
export const DEFAULT_DIRECTION: EmojiDirection = "right";
export const DEFAULT_FORMAT: EmojiFormat = "gif";
/** 128 matches Discord's own custom-emoji render size. */
export const DEFAULT_SIZE: EmojiSize = 128;

/**
 * Frame-delay multipliers. Lower = faster. These multiply each effect's own
 * `delayMs`, so an effect that is deliberately languid stays relatively slower
 * than a snappy one at the same setting.
 */
const SPEED_SCALE: Record<EmojiSpeed, number> = {
  slow: 1.8,
  normal: 1,
  fast: 0.6,
  turbo: 0.38,
};

/** GIF stores delay in 10ms units, and browsers clamp anything under 20ms. */
const MIN_DELAY_MS = 20;

/** Resolve an effect's base delay against a speed setting. */
export function delayFor(baseDelayMs: number, speed: EmojiSpeed): number {
  return Math.max(MIN_DELAY_MS, Math.round(baseDelayMs * SPEED_SCALE[speed]));
}

export function parseSpeed(v: unknown): EmojiSpeed {
  return SPEEDS.includes(v as EmojiSpeed) ? (v as EmojiSpeed) : DEFAULT_SPEED;
}

export function parseDirection(v: unknown): EmojiDirection {
  return DIRECTIONS.includes(v as EmojiDirection) ? (v as EmojiDirection) : DEFAULT_DIRECTION;
}

export function parseFormat(v: unknown): EmojiFormat {
  return FORMATS.includes(v as EmojiFormat) ? (v as EmojiFormat) : DEFAULT_FORMAT;
}

export function parseSize(v: unknown): EmojiSize {
  const n = typeof v === "string" ? Number(v) : v;
  return SIZES.includes(n as EmojiSize) ? (n as EmojiSize) : DEFAULT_SIZE;
}

/** Unit vector for a direction, in canvas space (y grows downward). */
export function directionVector(dir: EmojiDirection): { x: number; y: number } {
  switch (dir) {
    case "left": return { x: -1, y: 0 };
    case "up": return { x: 0, y: -1 };
    case "down": return { x: 0, y: 1 };
    default: return { x: 1, y: 0 };
  }
}

/** +1 for clockwise directions (right/down), -1 for anticlockwise (left/up). */
export function directionSign(dir: EmojiDirection): number {
  return dir === "left" || dir === "up" ? -1 : 1;
}

/** True when a direction moves along the vertical axis. */
export function isVertical(dir: EmojiDirection): boolean {
  return dir === "up" || dir === "down";
}
