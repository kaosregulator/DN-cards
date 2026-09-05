// ─────────────────────────────────────────────────────────────────────────────
// Builtin motion tracks — the offline default library.
//
// These are hand-authored in the same shape the harvester emits, distilled from
// how Noto emoji actually move (a blink squashes the eye band to a slit for a
// couple of frames; a yawn stretches the mouth band down and open; a head-shake
// swings the whole subject). They exist so /animate ALWAYS works — before the
// Noto harvest has run, offline, or when the data file is thin — and so every
// region has at least one good piece for the planner to reach for.
//
// When the harvested Noto library is present it is MERGED on top of these, so
// real borrowed movement is preferred and these become the safety net. Values
// are resolution-independent (fractions / multipliers), never pixels.
// ─────────────────────────────────────────────────────────────────────────────

import type { Curve, EffectKind, MotionCategory, MotionTrack, Region } from "../types.js";

/** Sort a track into a picker category from its region + tags. */
function categorize(region: Region, tags: string[]): MotionCategory {
  if (region === "effect") return "effect";
  if (region === "eyes" || region === "brows") return "face";
  if (region === "mouth") return "mouth";
  if (region === "cheeks") return "face";
  // global: split "whole emoji" motions from "head" gestures by tag.
  const full = ["spin", "wobble", "float", "bob", "bounce", "shiver", "quake", "zoom", "pulse"];
  if (tags.some(t => full.includes(t))) return "full";
  const transform = ["melt", "explode", "inflate", "shrink"];
  if (tags.some(t => transform.includes(t))) return "transform";
  return "head";
}

/** Keyframe shorthand. */
function kf(t: number, v: number, ease?: [number, number, number, number]) {
  return ease ? { t, v, ease } : { t, v };
}

/** A gentle ease used for organic in/out motion. */
const EASE: [number, number, number, number] = [0.33, 0, 0.33, 1];

interface Spec {
  id: string;
  region: Region;
  name: string;
  emoji: string;
  glyph: string;
  tags: string[];
  intensity: number;
  channels: Partial<Record<string, Curve>>;
  /** Override the derived category. */
  category?: MotionCategory;
  /** For region `effect`: which overlay to paint. */
  effect?: EffectKind;
}

function make(spec: Spec): MotionTrack {
  return {
    id: `builtin:${spec.id}`,
    region: spec.region,
    category: spec.category ?? categorize(spec.region, spec.tags),
    ...(spec.effect ? { effect: spec.effect } : {}),
    name: spec.name,
    emoji: spec.emoji,
    tags: spec.tags,
    source: { name: spec.name, glyph: spec.glyph, origin: "builtin" },
    channels: spec.channels as MotionTrack["channels"],
    intensity: spec.intensity,
  };
}

const SPECS: Spec[] = [
  // ── global — the whole subject moves as one ────────────────────────────────
  {
    id: "bob", region: "global", name: "Idle bob", emoji: "🙂", glyph: "🙂",
    tags: ["bob", "idle", "neutral", "float"], intensity: 0.25,
    channels: { ty: [kf(0, 0), kf(0.5, -0.03, EASE), kf(1, 0, EASE)] },
  },
  {
    id: "nod", region: "global", name: "Nod", emoji: "👍", glyph: "🙂",
    tags: ["nod", "yes", "agree"], intensity: 0.5,
    channels: {
      ty: [kf(0, 0), kf(0.25, 0.05, EASE), kf(0.5, 0, EASE), kf(0.75, 0.05, EASE), kf(1, 0, EASE)],
      rotate: [kf(0, 0), kf(0.25, 0.06), kf(0.5, 0), kf(0.75, 0.06), kf(1, 0)],
    },
  },
  {
    id: "shake", region: "global", name: "Head shake", emoji: "🙅", glyph: "🙂",
    tags: ["shake", "no", "quake", "shock"], intensity: 0.6,
    channels: { tx: [kf(0, 0), kf(0.25, -0.05), kf(0.5, 0), kf(0.75, 0.05), kf(1, 0)] },
  },
  {
    id: "tilt", region: "global", name: "Curious tilt", emoji: "🤔", glyph: "🙂",
    tags: ["tilt", "confused", "think", "lean"], intensity: 0.45,
    channels: { rotate: [kf(0, 0), kf(0.5, 0.14, EASE), kf(1, 0, EASE)] },
  },
  {
    id: "wobble", region: "global", name: "Woozy wobble", emoji: "🥴", glyph: "🥴",
    tags: ["wobble", "dizzy", "silly", "woozy"], intensity: 0.55,
    channels: {
      rotate: [kf(0, -0.1), kf(0.5, 0.1), kf(1, -0.1)],
      tx: [kf(0, 0.02), kf(0.5, -0.02), kf(1, 0.02)],
    },
  },
  {
    id: "shiver", region: "global", name: "Shiver", emoji: "🥶", glyph: "🥶",
    tags: ["shiver", "cold", "shake", "fear"], intensity: 0.5,
    channels: {
      tx: [kf(0, 0), kf(0.12, 0.02), kf(0.24, -0.02), kf(0.36, 0.02), kf(0.5, -0.02),
        kf(0.62, 0.02), kf(0.74, -0.02), kf(0.86, 0.02), kf(1, 0)],
    },
  },
  {
    id: "bounce", region: "global", name: "Excited bounce", emoji: "🤩", glyph: "🙂",
    tags: ["bounce", "happy", "party", "bob"], intensity: 0.6,
    channels: {
      ty: [kf(0, 0), kf(0.5, -0.08, EASE), kf(1, 0, EASE)],
      scaleY: [kf(0, 0.94), kf(0.5, 1.04, EASE), kf(1, 0.94, EASE)],
    },
  },
  {
    id: "spin", region: "global", name: "Dizzy spin", emoji: "💫", glyph: "😵",
    tags: ["spin", "dizzy", "roll"], intensity: 0.8,
    channels: { rotate: [kf(0, 0), kf(1, Math.PI * 2)] },
  },
  {
    id: "zoom", region: "global", name: "Punch-in", emoji: "🔍", glyph: "🙂",
    tags: ["zoom", "pulse", "shock", "surprise"], intensity: 0.7,
    channels: {
      scaleX: [kf(0, 0.9), kf(0.5, 1.12, EASE), kf(1, 0.9, EASE)],
      scaleY: [kf(0, 0.9), kf(0.5, 1.12, EASE), kf(1, 0.9, EASE)],
    },
  },
  {
    id: "lean", region: "global", name: "Lean in", emoji: "👀", glyph: "🙂",
    tags: ["lean", "look", "think"], intensity: 0.4,
    channels: {
      scaleX: [kf(0, 1), kf(0.5, 1.08, EASE), kf(1, 1, EASE)],
      scaleY: [kf(0, 1), kf(0.5, 1.08, EASE), kf(1, 1, EASE)],
      ty: [kf(0, 0), kf(0.5, 0.02, EASE), kf(1, 0, EASE)],
    },
  },

  // ── eyes ────────────────────────────────────────────────────────────────────
  {
    id: "blink", region: "eyes", name: "Blink", emoji: "😌", glyph: "😌",
    tags: ["blink", "close", "shut", "neutral"], intensity: 0.6,
    channels: { squashY: [kf(0, 1), kf(0.42, 1), kf(0.5, 0.12), kf(0.58, 1), kf(1, 1)] },
  },
  {
    id: "blink2", region: "eyes", name: "Double blink", emoji: "😳", glyph: "😳",
    tags: ["blink", "close", "flushed", "surprise"], intensity: 0.7,
    channels: {
      squashY: [kf(0, 1), kf(0.3, 1), kf(0.36, 0.12), kf(0.42, 1), kf(0.56, 1),
        kf(0.62, 0.12), kf(0.68, 1), kf(1, 1)],
    },
  },
  {
    id: "squint", region: "eyes", name: "Squint", emoji: "😑", glyph: "😑",
    tags: ["squint", "smug", "unamused", "close", "smirk"], intensity: 0.5,
    channels: { squashY: [kf(0, 1), kf(0.5, 0.45, EASE), kf(1, 1, EASE)] },
  },
  {
    id: "widen", region: "eyes", name: "Eyes widen", emoji: "😲", glyph: "😲",
    tags: ["widen", "shock", "surprise", "fear", "open"], intensity: 0.65,
    channels: {
      squashY: [kf(0, 1), kf(0.4, 1.5, EASE), kf(0.8, 1.4), kf(1, 1, EASE)],
      scaleX: [kf(0, 1), kf(0.4, 1.12, EASE), kf(1, 1, EASE)],
    },
  },
  {
    id: "wink", region: "eyes", name: "Wink", emoji: "😉", glyph: "😉",
    tags: ["wink", "silly", "blink", "smirk"], intensity: 0.55,
    // Our bands are symmetric, so a wink reads as a quick asymmetric-feeling
    // dip biased to one side via a small shear as it closes.
    channels: {
      squashY: [kf(0, 1), kf(0.4, 1), kf(0.5, 0.14), kf(0.6, 1), kf(1, 1)],
      shearX: [kf(0, 0), kf(0.5, 0.06), kf(1, 0)],
    },
  },
  {
    id: "roll", region: "eyes", name: "Eye roll", emoji: "🙄", glyph: "🙄",
    tags: ["roll", "unamused", "smug", "look"], intensity: 0.5,
    channels: { ty: [kf(0, 0), kf(0.5, -0.03, EASE), kf(1, 0, EASE)] },
  },
  {
    id: "look", region: "eyes", name: "Glance around", emoji: "👀", glyph: "👀",
    tags: ["look", "shift", "think", "confused"], intensity: 0.45,
    channels: { tx: [kf(0, 0), kf(0.3, 0.03, EASE), kf(0.7, -0.03, EASE), kf(1, 0, EASE)] },
  },

  // ── brows ─────────────────────────────────────────────────────────────────
  {
    id: "raise", region: "brows", name: "Brow raise", emoji: "🤨", glyph: "🤨",
    tags: ["raise", "think", "smug", "surprise"], intensity: 0.5,
    channels: { ty: [kf(0, 0), kf(0.5, -0.04, EASE), kf(1, 0, EASE)] },
  },
  {
    id: "furrow", region: "brows", name: "Furrow", emoji: "😠", glyph: "😠",
    tags: ["furrow", "angry", "mad", "worry"], intensity: 0.55,
    channels: {
      ty: [kf(0, 0), kf(0.5, 0.03, EASE), kf(1, 0, EASE)],
      squashY: [kf(0, 1), kf(0.5, 0.7, EASE), kf(1, 1, EASE)],
    },
  },

  // ── mouth ────────────────────────────────────────────────────────────────
  {
    id: "yawn", region: "mouth", name: "Wide yawn", emoji: "🥱", glyph: "🥱",
    tags: ["yawn", "open", "wide", "tired", "sleepy"], intensity: 0.9,
    channels: {
      squashY: [kf(0, 1), kf(0.35, 2.1, EASE), kf(0.7, 2.0), kf(1, 1, EASE)],
      ty: [kf(0, 0), kf(0.35, 0.05, EASE), kf(0.7, 0.05), kf(1, 0, EASE)],
    },
  },
  {
    id: "shout", region: "mouth", name: "Shout", emoji: "😱", glyph: "😱",
    tags: ["shout", "yell", "open", "wide", "scream", "shock"], intensity: 0.95,
    channels: {
      squashY: [kf(0, 1), kf(0.25, 2.3, EASE), kf(1, 2.1)],
      scaleX: [kf(0, 1), kf(0.25, 1.12, EASE), kf(1, 1.1)],
      ty: [kf(0, 0), kf(0.25, 0.06, EASE), kf(1, 0.05)],
    },
  },
  {
    id: "talk", region: "mouth", name: "Talking", emoji: "🗣️", glyph: "🙂",
    tags: ["talk", "chew", "sing", "open"], intensity: 0.6,
    channels: {
      squashY: [kf(0, 1), kf(0.25, 1.6), kf(0.5, 1), kf(0.75, 1.6), kf(1, 1)],
    },
  },
  {
    id: "grin", region: "mouth", name: "Big grin", emoji: "😁", glyph: "😁",
    tags: ["grin", "smile", "happy", "open", "laugh"], intensity: 0.7,
    channels: {
      scaleX: [kf(0, 1), kf(0.5, 1.18, EASE), kf(1, 1, EASE)],
      squashY: [kf(0, 1), kf(0.5, 1.3, EASE), kf(1, 1, EASE)],
    },
  },
  {
    id: "laugh", region: "mouth", name: "Laugh", emoji: "😂", glyph: "😂",
    tags: ["laugh", "happy", "open", "joy"], intensity: 0.8,
    channels: {
      squashY: [kf(0, 1), kf(0.25, 1.7), kf(0.5, 1.2), kf(0.75, 1.7), kf(1, 1.2)],
      scaleX: [kf(0, 1.05), kf(0.5, 1.15), kf(1, 1.05)],
    },
  },
  {
    id: "pout", region: "mouth", name: "Pout", emoji: "😗", glyph: "😗",
    tags: ["pout", "kiss", "sad", "close"], intensity: 0.5,
    channels: {
      scaleX: [kf(0, 1), kf(0.5, 0.78, EASE), kf(1, 1, EASE)],
      ty: [kf(0, 0), kf(0.5, -0.01, EASE), kf(1, 0, EASE)],
    },
  },
  {
    id: "smirk", region: "mouth", name: "Smirk", emoji: "😏", glyph: "😏",
    tags: ["smirk", "smug", "cool"], intensity: 0.4,
    channels: {
      shearX: [kf(0, 0), kf(0.5, 0.12, EASE), kf(1, 0, EASE)],
      scaleX: [kf(0, 1), kf(0.5, 1.06, EASE), kf(1, 1, EASE)],
    },
  },
  {
    id: "gasp", region: "mouth", name: "Gasp", emoji: "😮", glyph: "😮",
    tags: ["gasp", "open", "surprise", "shock"], intensity: 0.7,
    channels: {
      squashY: [kf(0, 1), kf(0.4, 1.8, EASE), kf(0.85, 1.75), kf(1, 1, EASE)],
      scaleX: [kf(0, 1), kf(0.4, 0.9, EASE), kf(1, 1, EASE)],
    },
  },
  {
    id: "chew", region: "mouth", name: "Chew", emoji: "😋", glyph: "😋",
    tags: ["chew", "talk", "silly"], intensity: 0.45,
    channels: {
      ty: [kf(0, 0), kf(0.5, 0.02), kf(1, 0)],
      squashY: [kf(0, 1), kf(0.5, 1.3), kf(1, 1)],
    },
  },

  // ── cheeks (tears / blush) ──────────────────────────────────────────────────
  {
    id: "sob", region: "cheeks", name: "Sob shudder", emoji: "😭", glyph: "😭",
    tags: ["cry", "tears", "sad", "sob"], intensity: 0.55,
    channels: {
      ty: [kf(0, 0), kf(0.25, 0.02), kf(0.5, 0), kf(0.75, 0.02), kf(1, 0)],
      squashY: [kf(0, 1), kf(0.5, 1.12), kf(1, 1)],
    },
  },
  {
    id: "blush", region: "cheeks", name: "Blush pulse", emoji: "☺️", glyph: "☺️",
    tags: ["love", "happy", "shy", "flushed", "pulse"], intensity: 0.35,
    channels: { scaleX: [kf(0, 1), kf(0.5, 1.06, EASE), kf(1, 1, EASE)] },
  },

  // ── effect overlays — painted on top, work on ANY subject ───────────────────
  // (a 💎 or 🐹 with no face still gets tears, sparkles, steam…). The painter in
  // engine/effects.ts keys off `effect`; the alpha curve is an overall envelope.
  {
    id: "tears", region: "effect", effect: "tears", name: "Tears", emoji: "💧", glyph: "😢",
    tags: ["tears", "cry", "sad", "sob"], intensity: 0.6,
    channels: { alpha: [kf(0, 0.7), kf(0.5, 1), kf(1, 0.7)] },
  },
  {
    id: "sweat", region: "effect", effect: "sweat", name: "Sweat drop", emoji: "💦", glyph: "😅",
    tags: ["sweat", "nervous", "hot", "tired"], intensity: 0.5,
    channels: { alpha: [kf(0, 0.4), kf(0.3, 1), kf(1, 0.4)] },
  },
  {
    id: "hearts", region: "effect", effect: "hearts", name: "Floating hearts", emoji: "💕", glyph: "🥰",
    tags: ["love", "hearts", "happy", "kiss"], intensity: 0.55,
    channels: { alpha: [kf(0, 0.6), kf(0.5, 1), kf(1, 0.6)] },
  },
  {
    id: "sparkles", region: "effect", effect: "sparkles", name: "Sparkles", emoji: "✨", glyph: "✨",
    tags: ["sparkles", "party", "happy", "cool", "shiny"], intensity: 0.5,
    channels: { alpha: [kf(0, 0.5), kf(0.5, 1), kf(1, 0.5)] },
  },
  {
    id: "steam", region: "effect", effect: "steam", name: "Steam", emoji: "💨", glyph: "😤",
    tags: ["steam", "angry", "mad", "hot", "rage"], intensity: 0.6,
    channels: { alpha: [kf(0, 0.5), kf(0.5, 1), kf(1, 0.5)] },
  },
  {
    id: "anger", region: "effect", effect: "anger", name: "Anger vein", emoji: "💢", glyph: "😠",
    tags: ["anger", "angry", "mad", "rage"], intensity: 0.6,
    channels: { alpha: [kf(0, 0.3), kf(0.25, 1), kf(0.5, 0.4), kf(0.75, 1), kf(1, 0.3)] },
  },
  {
    id: "dizzy", region: "effect", effect: "dizzy", name: "Dizzy stars", emoji: "💫", glyph: "😵‍💫",
    tags: ["dizzy", "stars", "woozy", "spin"], intensity: 0.55,
    channels: { alpha: [kf(0, 0.8), kf(1, 0.8)] },
  },
];

/** The full builtin library, built once. */
export const BUILTIN_TRACKS: MotionTrack[] = SPECS.map(make);
