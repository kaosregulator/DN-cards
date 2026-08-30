// ─────────────────────────────────────────────────────────────────────────────
// Option vocabulary + parsing.
//
// The allowed values live here once and are reused by the slash-command choices,
// the component UI and the renderer, so the three can never drift apart. Every
// parser is total: unknown input falls back to the default rather than throwing,
// because a stale button on an old message must never break a render.
// ─────────────────────────────────────────────────────────────────────────────

import type { EmojiDirection, EmojiFormat, EmojiSize, EmojiSpeed } from "../types.js";

/**
 * Output containers MakeEmoji offers.
 *
 * Taken from the discovered manifest, whose format control lists GIF, WebP,
 * APNG and HDR APNG. Plain PNG is deliberately absent: MakeEmoji has no
 * still-image output, so offering it produced an `unknown_option` failure on
 * every use. APNG is the animated PNG container and uses the `.png` extension.
 *
 * HDR APNG is left out: it is a niche variant, and Discord does not render it
 * any differently from ordinary APNG.
 */
export const FORMATS = ["gif", "webp", "apng"] as const;

/** Containers the LOCAL fallback renderer can emit. It cannot produce WebP. */
export const LOCAL_FORMATS = ["gif", "png"] as const;

// ── local fallback renderer vocabulary ───────────────────────────────────────
// These describe the procedural renderer's own controls, not MakeEmoji's.
// MakeEmoji's real option values are never hardcoded: they come from the
// discovery manifest (see providers/makeemoji/manifest.ts).
export const SPEEDS = ["slow", "normal", "fast", "turbo"] as const;
export const DIRECTIONS = ["right", "left", "up", "down"] as const;
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
  return (FORMATS as readonly string[]).includes(v as string)
    ? (v as EmojiFormat)
    : DEFAULT_FORMAT;
}

/** True when the local fallback renderer can emit this container. */
export function isLocalFormat(format: EmojiFormat): boolean {
  return (LOCAL_FORMATS as readonly string[]).includes(format);
}

export function parseSize(v: unknown): EmojiSize {
  // Sizes arriving from MakeEmoji are decorated (`"⬜ 64px"`), so pull the first
  // number out of a string rather than coercing the whole thing to NaN. Only
  // strings and numbers are considered: `Number(null)` is 0, which would
  // otherwise sail through as a plausible size.
  const raw =
    typeof v === "string" ? Number(/\d+/.exec(v)?.[0] ?? NaN)
    : typeof v === "number" ? v
    : NaN;

  return SIZES.includes(raw as EmojiSize) ? (raw as EmojiSize) : DEFAULT_SIZE;
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

/**
 * File extension for an output container.
 *
 * APNG is an animated PNG and must be served as `.png`; Discord does not
 * recognise an `.apng` attachment and shows it as an unrenderable file.
 */
export function extensionFor(format: EmojiFormat): string {
  return format === "apng" ? "png" : format;
}
