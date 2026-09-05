// ─────────────────────────────────────────────────────────────────────────────
// /animate — the motion-composition engine's shared types.
//
// The idea, exactly like the /emoji effects system, is that MOTION IS DATA. A
// Noto animated emoji is a Lottie file: a stack of layers, each with keyframed
// transforms over time. The harvester (scripts/animate-harvest-noto.mjs) reads
// every emoji we can reach and turns each animatable layer into a `MotionTrack`
// — a small, resolution-independent set of curves plus the tags that say what it
// IS (a blink, a yawn, a head-shake) and where on the face it belongs.
//
// Nothing here binds a track to a single emoji or a single output. The planner
// searches the whole pool and assembles a `Recipe` that borrows one region's
// motion from one emoji and another region's from a completely different one;
// the compositor then applies that recipe to ANY target image. That is the whole
// point — we are not picking a style, we are re-composing movement.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The part of the subject a track drives.
 *
 * These are bands, not landmarks: the engine has no face detector and MUST work
 * on a photo, a meme, an animal, a cartoon or a logo — the custom emoji people
 * actually target — just as well as on a smiley. So a region is a smooth,
 * MOVABLE vertical influence envelope over the image (see engine/regions.ts):
 * "eyes"/"mouth" are only default anchor positions, and a recipe can slide them
 * (or a candidate can vary them) because there is no guarantee a face is present
 * or centred. `global` moves the whole subject as one (bob, nod, shake, spin)
 * and is always safe on any subject, so the planner leans on it heavily.
 */
export type Region = "global" | "brows" | "eyes" | "mouth" | "cheeks" | "effect";

export const REGIONS: readonly Region[] = ["global", "brows", "eyes", "mouth", "cheeks", "effect"];

/**
 * Coarse grouping for the picker and the planner, independent of where a track
 * warps. A subject need not have a face for most of these to work — head, body,
 * full and effect motions apply to a 💎 or a 🐹 as happily as to a smiley, which
 * is exactly how the engine animates targets with no recognizable anatomy.
 */
export type MotionCategory =
  | "face"    // blink, wink, squint, smile, frown
  | "mouth"   // open, close, talk, gasp, exhale
  | "head"    // tilt, nod, shake, turn
  | "body"    // bounce, squash, stretch, rotate
  | "effect"  // tears, sweat, hearts, sparkles, steam
  | "full"    // shake, spin, wobble, float, jump, fall (whole emoji)
  | "transform"; // melt, explode, inflate, shrink

export const MOTION_CATEGORIES: readonly MotionCategory[] = [
  "face", "mouth", "head", "body", "effect", "full", "transform",
];

/** A painted overlay a track can carry when its region is `effect`. */
export type EffectKind =
  | "tears" | "sweat" | "hearts" | "sparkles" | "steam" | "anger" | "dizzy";

/**
 * Amplitude/timing dial. The SAME motion library drives every level — only the
 * deviation from rest is scaled, and the top levels layer supporting motion:
 *   🥺 cry — subtle: tiny tears · normal: tears rolling · dramatic: shaking +
 *   tears · insane: ugly crying. See engine/intensity.ts.
 */
export type Intensity = "subtle" | "normal" | "dramatic" | "insane";

export const INTENSITIES: readonly Intensity[] = ["subtle", "normal", "dramatic", "insane"];

/**
 * The channels a track can drive. Every value is resolution-independent so the
 * same track renders identically at 32px and 128px:
 *   • tx, ty      translation as a fraction of the canvas edge
 *   • scaleX/Y    multiplicative scale about the region centre (1 = rest)
 *   • rotate      radians, clockwise (only meaningful for `global`)
 *   • shearX      horizontal shear, radians-ish (fraction of height)
 *   • squashY     localised vertical squash used by region warps (1 = rest);
 *                 this is what makes a mouth open and an eye blink without
 *                 moving the rest of the face
 *   • alpha       opacity 0–1 (rarely used; kept for feature fades)
 */
export type Channel =
  | "tx" | "ty" | "scaleX" | "scaleY" | "rotate" | "shearX" | "squashY" | "alpha";

export const CHANNELS: readonly Channel[] = [
  "tx", "ty", "scaleX", "scaleY", "rotate", "shearX", "squashY", "alpha",
];

/** A single keyframe: value `v` at normalized time `t` (0–1 over one loop). */
export interface Keyframe {
  t: number;
  v: number;
  /**
   * Cubic-bezier ease OUT of this keyframe toward the next, as Lottie stores it:
   * [ox, oy, ix, iy]. Omitted means linear. The sampler reads it; the harvester
   * writes it straight from the Lottie curve so borrowed motion keeps its feel.
   */
  ease?: [number, number, number, number];
}

/** One channel's curve. A constant channel is a single keyframe. */
export type Curve = Keyframe[];

/**
 * A borrowed movement. Pure data — the sampler + compositor are the only code
 * that ever act on it, so adding a track never means touching the engine.
 */
export interface MotionTrack {
  /** Stable id, unique in the pool. Never renamed in place. */
  id: string;
  /** Which band it drives (or `effect` for a painted overlay). */
  region: Region;
  /** Coarse group for the picker / planner. */
  category: MotionCategory;
  /** Set when region is `effect`: which overlay to paint. */
  effect?: EffectKind;
  /** Human label for the piece-picker, e.g. "Wide yawn". */
  name: string;
  /** Picker glyph. */
  emoji: string;
  /**
   * Free tags used by the planner: the source emoji's words plus a small
   * normalized set ("blink", "open", "wide", "shout", "nod", "shake", …).
   */
  tags: string[];
  /**
   * Provenance — where this MOVEMENT came from, so every borrowed motion is
   * traceable. Note this describes the motion's origin only: the render never
   * uses the source's ARTWORK (see the module README), so a Noto-derived track
   * animates the user's own custom emoji with nothing of Noto's in the pixels.
   */
  source: {
    /** Source animation name, e.g. "Yawning face". */
    name: string;
    /** Its base glyph, for the credit line. */
    glyph: string;
    /** Where the motion was extracted from or authored. */
    origin: "noto" | "builtin" | "community" | "custom";
    /** License of the SOURCE motion data (Noto animated emoji are Apache-2.0). */
    license?: string;
    /** Unicode codepoint(s) of the source emoji, when applicable, e.g. "1f971". */
    codepoint?: string;
    /** Canonical URL the motion was harvested from, for auditing. */
    url?: string;
  };
  /** The curves. A channel absent here rests at its neutral value. */
  channels: Partial<Record<Channel, Curve>>;
  /**
   * Peak intensity of the movement, 0–1, precomputed by the harvester. Lets the
   * planner prefer a punchy yawn over a barely-there one, and lets the UI scale
   * a piece down without re-deriving it.
   */
  intensity: number;
}

/**
 * A complete, renderable plan: one optional track per region. `global` moves the
 * whole subject; the others warp their band. Timing is shared so borrowed pieces
 * stay in sync no matter which emoji each came from.
 */
export interface Recipe {
  /** Short label shown on the candidate, e.g. "Yawn · take 2". */
  label: string;
  /**
   * Chosen track per region (null = that band stays still). `effect` may carry
   * SEVERAL overlays at once (tears + shake-sweat), unlike the warp bands which
   * take one each, so it is an array.
   */
  tracks: Partial<Record<Exclude<Region, "effect">, MotionTrack | null>>;
  /** Painted overlays, layered on top. */
  effects: MotionTrack[];
  /** Amplitude/timing level applied across the whole recipe. */
  intensity: Intensity;
  /** Frames in one loop. */
  frames: number;
  /** Per-frame delay at the chosen speed, ms. */
  delayMs: number;
  /**
   * Global influence multiplier per region, 0–1, so a candidate can dial a
   * borrowed piece up or down without editing the track. Defaults to 1.
   */
  gain?: Partial<Record<Region, number>>;
  /**
   * Per-region anchor override. Because the target may be a photo/meme/animal
   * with no face where a smiley's would be, a candidate can slide a band's
   * centre (`y`, 0=top … 1=bottom) and widen/narrow it (`spread`, fraction of
   * height). Omitted regions use the defaults in engine/regions.ts. This is what
   * lets several candidates try the same movement at different places so at
   * least one lands well on an arbitrary subject.
   */
  anchors?: Partial<Record<Region, { y: number; spread: number }>>;
}

/**
 * A named, decomposed gesture — the "SIGH = eyes:slow_close + mouth:exhale +
 * head:drop + body:relax @ 1.8s" idea. It does not hard-bind tracks; it names,
 * per region, the TAGS the planner should look for, so the actual movement is
 * still borrowed from whatever emoji in the pool matches best. The planner
 * starts from a preset when the prompt names one, then lets the user swap any
 * piece. Presets live in library/gestures.ts.
 */
export interface GesturePreset {
  id: string;
  name: string;
  emoji: string;
  /** Words that select this preset from a prompt. */
  match: string[];
  /** Per-region tag preferences, most-wanted first. */
  parts: Partial<Record<Exclude<Region, "effect">, string[]>>;
  /** Overlay effect tags to add (e.g. ["tears"] for cry). */
  effects?: string[];
  /** Baseline loop duration in ms; scaled by intensity/speed. */
  timingMs: number;
  /**
   * Effects/extra motion that only switch on at the harder intensities, keyed by
   * the minimum level. This is how cry gains a shake at `dramatic` and full
   * ugly-crying at `insane` from the same library.
   */
  escalate?: Partial<Record<Intensity, { parts?: Partial<Record<Exclude<Region, "effect">, string[]>>; effects?: string[] }>>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Detected target geometry.
//
// Before any motion is applied the target image is ANALYZED so movement anchors
// to the subject's OWN features, not to where a smiley's would be. All values
// are fractions of the target image (0 = left/top … 1 = right/bottom), so they
// map onto the render canvas whatever the source's size or aspect. A gem or a
// hamster simply yields no eyes/mouth and a low `confidence`, and the compositor
// then animates the whole object instead of faking a face.
// ─────────────────────────────────────────────────────────────────────────────

/** An axis-aligned box in target-image fractions. */
export interface FracBox { x: number; y: number; w: number; h: number }

/** An ellipse in target-image fractions (rx along width, ry along height). */
export interface FracEllipse { cx: number; cy: number; rx: number; ry: number }

export interface Features {
  /** How they were found — "heuristic", "mediapipe", "manual", "none". */
  method: string;
  /** Bounding box of the actual subject (non-background pixels). */
  content: FracBox;
  /** Detected eyes, 0–2. */
  eyes: FracEllipse[];
  /** Detected mouth, or null. */
  mouth: FracEllipse | null;
  /** Detected brow band, or null (derived above the eyes when eyes are found). */
  brows: FracEllipse | null;
  /** Detected face region, or null. */
  face: FracBox | null;
  /** 0–1 confidence that a face was actually found (gates facial warps/effects). */
  confidence: number;
}

/** A rendered candidate handed back to the user to choose between. */
export interface Candidate {
  recipe: Recipe;
  buffer: Buffer;
  format: "gif";
  size: number;
  frames: number;
  bytes: number;
  /** One-line "eyes from 😮 · mouth from 🥱" credit, built from the recipe. */
  credit: string;
}

/** The whole harvested (or builtin) library, as loaded into memory. */
export interface MotionLibrary {
  /** Where it came from, for logs and the admin surface. */
  origin: "noto" | "builtin" | "merged";
  /** ISO date the data file was built, when known. */
  builtAt?: string;
  /** Every track, flattened across every source emoji. */
  tracks: MotionTrack[];
}

/** The on-disk shape written by the harvester (scripts/animate-harvest-noto.mjs). */
export interface MotionLibraryFile {
  version: 1;
  builtAt: string;
  /** How many Noto emoji contributed. */
  emojiCount: number;
  tracks: MotionTrack[];
}
