// ─────────────────────────────────────────────────────────────────────────────
// Emoji system — shared types.
//
// The whole system is built around one idea: an *effect* is DATA, not code that
// knows how to draw. An effect declares what happens to the subject on a given
// frame (a `Transform`) and, optionally, procedural layers painted behind or in
// front of it. The renderer is the only thing that touches a canvas, so adding
// an effect never means editing the renderer.
// ─────────────────────────────────────────────────────────────────────────────

import type { Ctx } from "../animations/engine.js";

/**
 * Output container.
 *
 * MakeEmoji offers GIF, PNG and WebP. The local fallback renderer only handles
 * GIF and PNG, and says so rather than silently substituting a format.
 */
export type EmojiFormat = "gif" | "png" | "webp";

/** Playback speed. Scales each effect's base frame delay. */
export type EmojiSpeed = "slow" | "normal" | "fast" | "turbo";

/** Travel/rotation axis. Effects that ignore direction declare `directional: false`. */
export type EmojiDirection = "right" | "left" | "up" | "down";

/** Emoji edge length in pixels. Discord renders custom emoji at 128 max. */
export type EmojiSize = 32 | 48 | 64 | 96 | 112 | 128;

/**
 * What happens to the subject on one frame.
 *
 * Every field is resolution-independent: offsets are fractions of the canvas
 * edge (0.1 = 10% of the frame) and rotation is radians. That is what makes
 * `size` a real parameter — the same effect definition renders correctly at 32px
 * and at 128px without per-size tuning.
 */
export interface Transform {
  /** Rotation in radians, clockwise, about the subject centre. */
  rotate?: number;
  /** Horizontal scale. 1 = natural size. */
  scaleX?: number;
  /** Vertical scale. 1 = natural size. */
  scaleY?: number;
  /** Horizontal offset as a fraction of the canvas edge. */
  offsetX?: number;
  /** Vertical offset as a fraction of the canvas edge. */
  offsetY?: number;
  /** Opacity, 0–1. */
  alpha?: number;
  /**
   * Colourise the subject toward this hue (degrees, 0–360), preserving its own
   * luminance so shading and detail survive. Chosen over a hue *rotation*
   * because rotation is a no-op on greyscale art — a white logo would simply
   * not animate — whereas colourising works on any source.
   */
  hue?: number;
  /** How far to colourise toward `hue`, 0–1. Defaults to 1 (full recolour). */
  hueStrength?: number;
}

/** Everything an effect function is allowed to know about the current render. */
export interface EffectContext {
  /** Loop phase, 0 (inclusive) → 1 (exclusive). */
  t: number;
  /** Frame index, 0-based. */
  frame: number;
  /** Total frames in the loop. */
  frames: number;
  /** Resolved direction. */
  direction: EmojiDirection;
  /** Canvas edge length in pixels. */
  size: number;
}

/** A procedural layer painted relative to the subject. */
export interface LayerDef {
  /** `back` paints under the subject, `front` over it. */
  z: "back" | "front";
  /**
   * Paint one frame. The context is already translated so (0,0) is the canvas
   * origin and the canvas is `size`×`size`. Painters must not leak state: save/
   * restore is handled by the compositor.
   */
  paint: (ctx: Ctx, c: EffectContext) => void;
}

/**
 * A complete effect. `transform` and `layers` are both optional so an effect can
 * be pure motion (shake), pure decoration (sparkle), or both (party).
 */
export interface EffectDef {
  /** Stable id used in customIds and the public API. Never rename in place. */
  id: string;
  /** Human label for the picker. */
  name: string;
  /** Picker glyph. */
  emoji: string;
  /** One-line description for the picker. */
  description: string;
  /** Frames in one loop. More frames = smoother but larger. */
  frames: number;
  /** Base per-frame delay in ms at `normal` speed. */
  delayMs: number;
  /** Whether the `direction` option changes the result. */
  directional: boolean;
  /**
   * Fraction of the canvas the subject occupies at rest, 0–1. Effects that move
   * the subject around (slide, orbit) shrink it so it never clips the edge.
   */
  inset: number;
  /**
   * Set when the effect is *meant* to jump between frames rather than flow
   * (glitch, strobe). Motion effects are otherwise expected to be continuous
   * across the loop seam, and that expectation is enforced by tests — this flag
   * is how an effect opts out on purpose instead of silently regressing.
   */
  discontinuous?: boolean;
  /** Per-frame subject transform. */
  transform?: (c: EffectContext) => Transform;
  /** Procedural decoration layers. */
  layers?: LayerDef[];
}

/** Public, serialisable descriptor — what the picker UI and the registry expose. */
export interface EffectSummary {
  id: string;
  name: string;
  emoji: string;
  description: string;
  directional: boolean;
}

/** Fully-resolved render request. */
export interface RenderOptions {
  effect: string;
  speed: EmojiSpeed;
  direction: EmojiDirection;
  size: EmojiSize;
  format: EmojiFormat;
}

/** What a successful render produces. */
export interface RenderResult {
  buffer: Buffer;
  format: EmojiFormat;
  size: EmojiSize;
  /** Frames actually encoded (1 for PNG). */
  frames: number;
  /** Encoded byte length — same as `buffer.length`, surfaced for logging. */
  bytes: number;
  /** Wall-clock render time in ms. */
  durationMs: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Provider-facing request/response types.
//
// These describe a generation as MakeEmoji's editor frames it: an animation plus
// a handful of modifiers. Most values are plain strings rather than closed
// unions because the vocabulary belongs to MakeEmoji, not to us — it is read
// from the discovery manifest and validated against it at the edge. Inventing a
// union here would mean inventing option values, which is exactly what we must
// not do.
// ─────────────────────────────────────────────────────────────────────────────

/** A generation request handed to a provider. */
export interface GenerateOptions {
  /** Normalised source image bytes (see utils/source.ts). */
  image: Buffer;
  /** Animation id, as named by MakeEmoji. */
  animation: string;
  /** Playback speed. Omitted means "leave MakeEmoji's default". */
  speed?: string;
  /** Travel/rotation direction, for animations that use one. */
  direction?: string;
  /** Output edge length in pixels. */
  size?: number;
  /** Colour modifier — a hex string or a MakeEmoji colour name. */
  color?: string;
  /** Output container. */
  format: EmojiFormat;
  /** Quality/compression preset. */
  quality?: string;
  /** Platform preset (Discord, Slack, …) — sets MakeEmoji's own size defaults. */
  platform?: string;
  /** Cancels an in-flight generation. */
  signal?: AbortSignal;
  /**
   * Record this request's network traffic to the debug directory. Never enable
   * by default: the recordings are large and, though redacted, still describe
   * exactly what the bot sent.
   */
  debug?: boolean;
}

/** What a provider returns on success. */
export interface GenerateResult {
  /** The generated file. */
  buffer: Buffer;
  format: EmojiFormat;
  /** Byte length of `buffer`, surfaced for logging and limit checks. */
  bytes: number;
  /** Which provider produced this. */
  providerId: string;
  /** Wall-clock time for the generation, excluding cache hits. */
  durationMs: number;
  /** The URL the result was downloaded from, when the provider had one. */
  sourceUrl?: string;
  /** True when this came from the result cache rather than a fresh generation. */
  cached: boolean;
}
