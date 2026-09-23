// ─────────────────────────────────────────────────────────────────────────────
// Quiet Audio Library — catalog metadata
//
// Two layers:
//   1. Curated CC0 recordings (discovered via Openverse, harvested locally)
//   2. Procedural ffmpeg generators (fallback when a source file is missing)
//
// Priority at play time: curated source → cached mix → procedural fallback.
// Primary Quiet Room lengths: 3:00 and 5:00.
// ─────────────────────────────────────────────────────────────────────────────

import type { QuietTheme } from "../quotes.js";

export type QuietAudioCategory =
  | "rain"
  | "ocean"
  | "fireplace"
  | "forest"
  | "ambience"
  | "thunder"
  | "wind"
  | "stream"
  | "music";

export type QuietAudioMood =
  | "peaceful"
  | "reflective"
  | "hopeful"
  | "cozy"
  | "playful"
  | "calm";

export type QuietAudioKind = "curated" | "procedural";

export interface QuietAudioEntry {
  id: string;
  title: string;
  category: QuietAudioCategory;
  kind: QuietAudioKind;
  /** Preferred Quiet quote themes that pair well with this sound. */
  compatibleThemes: QuietTheme[];
  mood: QuietAudioMood;
  /** Target durations we prebuild (seconds). Primary = 180 & 300. */
  durations: number[];
  /** Whether mixes with spoken quotes are allowed. */
  allowsSpeech: boolean;
  /** Short blurb shown after the voice note. */
  blurb: string;
  /**
   * Curated source asset ids (from sources.ts). When multiple are listed,
   * prepareRecording picks one for subtle variation.
   */
  sourceIds?: string[];
  /** Procedural generator key used when no curated file is available. */
  generator: string;
  volume: number;
  source: string;
  license: string;
  attribution?: string;
  /** License capability flags (always true for CC0 / original). */
  redistributionAllowed: boolean;
  commercialUseAllowed: boolean;
  modificationAllowed: boolean;
  enabledByDefault: boolean;
  /** Selection weight boost for curated / preferred experiences. */
  weight?: number;
}

const PRIMARY = [180, 300] as const;

export const QUIET_AUDIO_CATALOG: QuietAudioEntry[] = [
  // ── Curated rain ───────────────────────────────────────────────────────────
  {
    id: "curated-rain-gentle",
    title: "Gentle Rain",
    category: "rain",
    kind: "curated",
    compatibleThemes: ["general", "think", "calm", "overwhelmed", "rest"],
    mood: "peaceful",
    durations: [...PRIMARY],
    allowsSpeech: true,
    blurb: "Gentle rain with a quiet reminder to slow down.",
    sourceIds: ["src-rain-gentle-01", "src-rain-woodland-01"],
    generator: "rain_gentle",
    volume: 0.55,
    source: "Openverse → Freesound (CC0)",
    license: "CC0 1.0",
    attribution: "shelbyshark / thinkingfish via Openverse",
    redistributionAllowed: true,
    commercialUseAllowed: true,
    modificationAllowed: true,
    enabledByDefault: true,
    weight: 4,
  },
  {
    id: "curated-rain-window",
    title: "Rain on Window",
    category: "rain",
    kind: "curated",
    compatibleThemes: ["think", "calm", "rest", "kindness", "general"],
    mood: "reflective",
    durations: [...PRIMARY],
    allowsSpeech: true,
    blurb: "Soft rain against the glass. Nothing else required.",
    sourceIds: ["src-rain-window-01", "src-rain-roof-01"],
    generator: "rain_window",
    volume: 0.52,
    source: "Openverse → Freesound (CC0)",
    license: "CC0 1.0",
    attribution: "palegolas / dwareing via Openverse",
    redistributionAllowed: true,
    commercialUseAllowed: true,
    modificationAllowed: true,
    enabledByDefault: true,
    weight: 4,
  },
  {
    id: "curated-rain-night",
    title: "Night Rain",
    category: "rain",
    kind: "curated",
    compatibleThemes: ["rest", "calm", "tomorrow", "overwhelmed"],
    mood: "calm",
    durations: [...PRIMARY],
    allowsSpeech: true,
    blurb: "Nighttime rain on leaves and earth. Stay as long as you like.",
    sourceIds: ["src-rain-woodland-01", "src-rain-roof-01"],
    generator: "rain_gentle",
    volume: 0.5,
    source: "Openverse → Freesound (CC0)",
    license: "CC0 1.0",
    attribution: "thinkingfish / dwareing via Openverse",
    redistributionAllowed: true,
    commercialUseAllowed: true,
    modificationAllowed: true,
    enabledByDefault: true,
    weight: 3,
  },
  {
    id: "curated-rain-storm",
    title: "Soft Storm",
    category: "rain",
    kind: "curated",
    compatibleThemes: ["overwhelmed", "calm", "rest", "discord"],
    mood: "reflective",
    durations: [...PRIMARY],
    allowsSpeech: true,
    blurb: "Rain with far-off thunder. The loud part can wait outside.",
    sourceIds: ["src-rain-storm-01"],
    generator: "thunder_distant",
    volume: 0.48,
    source: "Openverse → Freesound (CC0)",
    license: "CC0 1.0",
    attribution: "loopbasedmusic via Openverse",
    redistributionAllowed: true,
    commercialUseAllowed: true,
    modificationAllowed: true,
    enabledByDefault: true,
    weight: 3,
  },

  // ── Curated ocean / water ──────────────────────────────────────────────────
  {
    id: "curated-ocean-calm",
    title: "Calm Ocean",
    category: "ocean",
    kind: "curated",
    compatibleThemes: ["hope", "calm", "think", "general", "tomorrow"],
    mood: "peaceful",
    durations: [...PRIMARY],
    allowsSpeech: true,
    blurb: "A few quiet minutes of waves. Take your time.",
    sourceIds: ["src-ocean-zen-01", "src-ocean-by-sea-01"],
    generator: "ocean_calm",
    volume: 0.55,
    source: "Openverse → Freesound (CC0)",
    license: "CC0 1.0",
    attribution: "INNORECORDS / OSFX via Openverse",
    redistributionAllowed: true,
    commercialUseAllowed: true,
    modificationAllowed: true,
    enabledByDefault: true,
    weight: 4,
  },
  {
    id: "curated-ocean-waves",
    title: "Slow Waves",
    category: "ocean",
    kind: "curated",
    compatibleThemes: ["hope", "rest", "tomorrow", "encouragement"],
    mood: "hopeful",
    durations: [...PRIMARY],
    allowsSpeech: true,
    blurb: "Waves coming and going. You can come back whenever you're ready.",
    sourceIds: ["src-ocean-big-01", "src-ocean-zen-01"],
    generator: "ocean_waves",
    volume: 0.5,
    source: "Openverse → Freesound (CC0)",
    license: "CC0 1.0",
    attribution: "chris_dagorne / INNORECORDS via Openverse",
    redistributionAllowed: true,
    commercialUseAllowed: true,
    modificationAllowed: true,
    enabledByDefault: true,
    weight: 3,
  },
  {
    id: "curated-stream",
    title: "Quiet Stream",
    category: "stream",
    kind: "curated",
    compatibleThemes: ["calm", "think", "hope", "general"],
    mood: "peaceful",
    durations: [...PRIMARY],
    allowsSpeech: true,
    blurb: "Water moving past. You can stay.",
    sourceIds: ["src-stream-01", "src-river-01"],
    generator: "stream",
    volume: 0.5,
    source: "Openverse → Freesound (CC0)",
    license: "CC0 1.0",
    attribution: "jackthemurray / Pfannkuchn via Openverse",
    redistributionAllowed: true,
    commercialUseAllowed: true,
    modificationAllowed: true,
    enabledByDefault: true,
    weight: 3,
  },

  // ── Curated fireplace ──────────────────────────────────────────────────────
  {
    id: "curated-fireplace",
    title: "Fireplace",
    category: "fireplace",
    kind: "curated",
    compatibleThemes: ["encouragement", "general", "kindness", "rest", "overwhelmed"],
    mood: "cozy",
    durations: [...PRIMARY],
    allowsSpeech: true,
    blurb: "Quiet background warmth. Nothing else required.",
    sourceIds: ["src-fire-01", "src-fire-stove-01"],
    generator: "fireplace",
    volume: 0.5,
    source: "Openverse → Freesound (CC0)",
    license: "CC0 1.0",
    attribution: "visionear / mcmikai via Openverse",
    redistributionAllowed: true,
    commercialUseAllowed: true,
    modificationAllowed: true,
    enabledByDefault: true,
    weight: 4,
  },
  {
    id: "curated-cabin-fire",
    title: "Cabin Fire",
    category: "fireplace",
    kind: "curated",
    compatibleThemes: ["rest", "support", "kindness", "general"],
    mood: "cozy",
    durations: [...PRIMARY],
    allowsSpeech: true,
    blurb: "A small stove fire. Soft and close.",
    sourceIds: ["src-fire-stove-01"],
    generator: "fireplace",
    volume: 0.52,
    source: "Openverse → Freesound (CC0)",
    license: "CC0 1.0",
    attribution: "mcmikai via Openverse",
    redistributionAllowed: true,
    commercialUseAllowed: true,
    modificationAllowed: true,
    enabledByDefault: true,
    weight: 3,
  },

  // ── Curated forest / night ─────────────────────────────────────────────────
  {
    id: "curated-forest-night",
    title: "Night Forest",
    category: "forest",
    kind: "curated",
    compatibleThemes: ["think", "calm", "hope", "growth", "rest"],
    mood: "reflective",
    durations: [...PRIMARY],
    allowsSpeech: true,
    blurb: "Night forest air. Room to think.",
    sourceIds: ["src-forest-night-01"],
    generator: "forest_night",
    volume: 0.48,
    source: "Openverse → Freesound (CC0)",
    license: "CC0 1.0",
    attribution: "felix.blume via Openverse",
    redistributionAllowed: true,
    commercialUseAllowed: true,
    modificationAllowed: true,
    enabledByDefault: true,
    weight: 4,
  },
  {
    id: "curated-forest-air",
    title: "Forest Air",
    category: "forest",
    kind: "curated",
    compatibleThemes: ["hope", "growth", "encouragement", "tomorrow", "calm"],
    mood: "hopeful",
    durations: [...PRIMARY],
    allowsSpeech: true,
    blurb: "Birds and soft wind through trees.",
    sourceIds: ["src-woods-01"],
    generator: "forest_birds",
    volume: 0.48,
    source: "Openverse → Freesound (CC0)",
    license: "CC0 1.0",
    attribution: "felix.blume via Openverse",
    redistributionAllowed: true,
    commercialUseAllowed: true,
    modificationAllowed: true,
    enabledByDefault: true,
    weight: 3,
  },
  {
    id: "curated-night",
    title: "Night Ambience",
    category: "ambience",
    kind: "curated",
    compatibleThemes: ["rest", "calm", "think", "tomorrow"],
    mood: "calm",
    durations: [...PRIMARY],
    allowsSpeech: true,
    blurb: "Soft night air. No countdown.",
    sourceIds: ["src-night-insects-01", "src-night-quiet-01"],
    generator: "night_soft",
    volume: 0.45,
    source: "Openverse → Freesound (CC0)",
    license: "CC0 1.0",
    attribution: "The_Sound_Side / ragamuffin via Openverse",
    redistributionAllowed: true,
    commercialUseAllowed: true,
    modificationAllowed: true,
    enabledByDefault: true,
    weight: 3,
  },

  // ── Curated weather ────────────────────────────────────────────────────────
  {
    id: "curated-thunder",
    title: "Distant Thunder",
    category: "thunder",
    kind: "curated",
    compatibleThemes: ["overwhelmed", "calm", "rest"],
    mood: "reflective",
    durations: [...PRIMARY],
    allowsSpeech: true,
    blurb: "Far-off thunder. Close enough to hear, far enough to rest.",
    sourceIds: ["src-thunder-01", "src-rain-storm-01"],
    generator: "thunder_distant",
    volume: 0.48,
    source: "Openverse → Freesound (CC0)",
    license: "CC0 1.0",
    attribution: "sagetyrtle / loopbasedmusic via Openverse",
    redistributionAllowed: true,
    commercialUseAllowed: true,
    modificationAllowed: true,
    enabledByDefault: true,
    weight: 2,
  },
  {
    id: "curated-wind",
    title: "Soft Wind",
    category: "wind",
    kind: "curated",
    compatibleThemes: ["calm", "think", "overwhelmed"],
    mood: "peaceful",
    durations: [...PRIMARY],
    allowsSpeech: true,
    blurb: "A light breeze. Let the edges soften.",
    sourceIds: ["src-wind-beach-01"],
    generator: "wind_soft",
    volume: 0.48,
    source: "Openverse → Freesound (CC0)",
    license: "CC0 1.0",
    attribution: "BrandonNyte via Openverse",
    redistributionAllowed: true,
    commercialUseAllowed: true,
    modificationAllowed: true,
    enabledByDefault: true,
    weight: 2,
  },

  // ── Curated music ──────────────────────────────────────────────────────────
  {
    id: "curated-music-pad",
    title: "Soft Ambient Pad",
    category: "music",
    kind: "curated",
    compatibleThemes: ["hope", "encouragement", "calm", "general"],
    mood: "hopeful",
    durations: [...PRIMARY],
    allowsSpeech: true,
    blurb: "A quiet instrumental bed. No lyrics, no rush.",
    sourceIds: ["src-music-pad-01", "src-music-meditate-01"],
    generator: "music_pad",
    volume: 0.4,
    source: "Openverse → Freesound (CC0)",
    license: "CC0 1.0",
    attribution: "PhonZz / szegvari via Openverse",
    redistributionAllowed: true,
    commercialUseAllowed: true,
    modificationAllowed: true,
    enabledByDefault: true,
    weight: 3,
  },
  {
    id: "curated-music-space",
    title: "Calm Synth Texture",
    category: "music",
    kind: "curated",
    compatibleThemes: ["think", "hope", "kindness", "tomorrow"],
    mood: "reflective",
    durations: [...PRIMARY],
    allowsSpeech: false,
    blurb: "Soft atmospheric synth. Listen when you're ready.",
    sourceIds: ["src-music-space-01", "src-music-dunes-01"],
    generator: "music_pad",
    volume: 0.38,
    source: "Openverse → Freesound (CC0)",
    license: "CC0 1.0",
    attribution: "Andrewkn via Openverse",
    redistributionAllowed: true,
    commercialUseAllowed: true,
    modificationAllowed: true,
    enabledByDefault: true,
    weight: 2,
  },

  // ── Procedural fallbacks (kept; lower weight) ──────────────────────────────
  {
    id: "rain-gentle-01",
    title: "Gentle Rain (Soft)",
    category: "rain",
    kind: "procedural",
    compatibleThemes: ["general", "think", "calm", "overwhelmed", "rest"],
    mood: "peaceful",
    durations: [30, 60, ...PRIMARY],
    allowsSpeech: true,
    blurb: "Soft generated rain — a quiet backup bed.",
    generator: "rain_gentle",
    volume: 0.4,
    source: "procedural (ffmpeg anoisesrc + filters)",
    license: "Original / public domain (generated)",
    redistributionAllowed: true,
    commercialUseAllowed: true,
    modificationAllowed: true,
    enabledByDefault: true,
    weight: 1,
  },
  {
    id: "ocean-calm-01",
    title: "Calm Ocean (Soft)",
    category: "ocean",
    kind: "procedural",
    compatibleThemes: ["hope", "calm", "think", "general"],
    mood: "peaceful",
    durations: [30, 60, ...PRIMARY],
    allowsSpeech: true,
    blurb: "Soft generated waves — fallback ambience.",
    generator: "ocean_calm",
    volume: 0.42,
    source: "procedural (ffmpeg)",
    license: "Original / public domain (generated)",
    redistributionAllowed: true,
    commercialUseAllowed: true,
    modificationAllowed: true,
    enabledByDefault: true,
    weight: 1,
  },
  {
    id: "fireplace-01",
    title: "Fireplace (Soft)",
    category: "fireplace",
    kind: "procedural",
    compatibleThemes: ["encouragement", "general", "kindness", "rest"],
    mood: "cozy",
    durations: [30, 60, ...PRIMARY],
    allowsSpeech: true,
    blurb: "Soft generated crackle — fallback warmth.",
    generator: "fireplace",
    volume: 0.36,
    source: "procedural (ffmpeg)",
    license: "Original / public domain (generated)",
    redistributionAllowed: true,
    commercialUseAllowed: true,
    modificationAllowed: true,
    enabledByDefault: true,
    weight: 1,
  },
  {
    id: "sleep-01",
    title: "Sleep Ambience",
    category: "ambience",
    kind: "procedural",
    compatibleThemes: ["rest", "tomorrow", "calm"],
    mood: "calm",
    durations: [...PRIMARY, 600],
    allowsSpeech: false,
    blurb: "Low, steady hush for winding down.",
    generator: "sleep",
    volume: 0.28,
    source: "procedural (ffmpeg)",
    license: "Original / public domain (generated)",
    redistributionAllowed: true,
    commercialUseAllowed: true,
    modificationAllowed: true,
    enabledByDefault: true,
    weight: 1,
  },
];

/** Theme → preferred categories for smarter Quiet Room picks. */
export const THEME_CATEGORY_PREFS: Record<QuietTheme, QuietAudioCategory[]> = {
  calm: ["rain", "ocean", "fireplace", "wind", "ambience"],
  think: ["rain", "forest", "ocean", "music", "ambience"],
  hope: ["ocean", "forest", "music", "stream"],
  overwhelmed: ["rain", "wind", "fireplace", "ambience"],
  rest: ["rain", "fireplace", "ambience", "ocean"],
  discord: ["rain", "fireplace", "ocean", "ambience"],
  encouragement: ["fireplace", "music", "forest", "ocean"],
  support: ["fireplace", "ambience", "rain", "music"],
  kindness: ["fireplace", "music", "rain", "ambience"],
  growth: ["forest", "ocean", "music", "stream"],
  tomorrow: ["ocean", "ambience", "music", "forest"],
  general: ["rain", "ocean", "fireplace", "forest", "ambience"],
};

export function getAudioEntry(id: string): QuietAudioEntry | undefined {
  return QUIET_AUDIO_CATALOG.find(a => a.id === id);
}

/** Prefer 3–5 minute experiences; fall back to nearest available. */
export function pickDuration(entry: QuietAudioEntry, preferSeconds = 180): number {
  if (entry.durations.includes(preferSeconds)) return preferSeconds;
  const primary = entry.durations.find(d => d >= 180 && d <= 300);
  if (primary) return primary;
  return entry.durations[Math.floor(entry.durations.length / 2)] ?? entry.durations[0]!;
}

export function curatedEntries(): QuietAudioEntry[] {
  return QUIET_AUDIO_CATALOG.filter(a => a.kind === "curated");
}
