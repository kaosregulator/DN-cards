// ─────────────────────────────────────────────────────────────────────────────
// Quiet Audio Library — catalog metadata
//
// Primary ambience is generated procedurally with ffmpeg (original / public
// domain). Spoken quotes use ffmpeg's flite TTS when available. Source/license
// is recorded for every entry so redistribution stays honest.
//
// External CC0 / permissive libraries researched for future sample drops:
//   - Freesound.org (filter: CC0 / CC-BY) — rain, ocean, fireplace, wind
//   - OpenGameArt.org — ambient loops with CC0 / CC-BY
//   - Pixabay Music / Sound Effects — royalty-free with attribution notes
//   - BBC Sound Effects (remArc) — check individual licences before bundling
// We intentionally ship procedural generators first so the bot never depends on
// downloading copyrighted YouTube/commercial tracks at runtime.
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

export interface QuietAudioEntry {
  id: string;
  title: string;
  category: QuietAudioCategory;
  /** Preferred Quiet quote themes that pair well with this sound. */
  compatibleThemes: QuietTheme[];
  mood: QuietAudioMood;
  /** Target durations we prebuild (seconds). Primary = 180 & 300. */
  durations: number[];
  /** Whether mixes with spoken quotes are allowed. */
  allowsSpeech: boolean;
  /** Short blurb shown after the voice note. */
  blurb: string;
  /** Procedural generator key used by generate.ts */
  generator: string;
  volume: number;
  source: string;
  license: string;
  attribution?: string;
  enabledByDefault: boolean;
}

export const QUIET_AUDIO_CATALOG: QuietAudioEntry[] = [
  {
    id: "rain-gentle-01",
    title: "Gentle Rain",
    category: "rain",
    compatibleThemes: ["general", "think", "calm", "overwhelmed", "rest"],
    mood: "peaceful",
    durations: [30, 60, 180, 300],
    allowsSpeech: true,
    blurb: "Gentle rain with room to slow down.",
    generator: "rain_gentle",
    volume: 0.4,
    source: "procedural (ffmpeg anoisesrc + filters)",
    license: "Original / public domain (generated)",
    enabledByDefault: true,
  },
  {
    id: "rain-window-01",
    title: "Rain on Window",
    category: "rain",
    compatibleThemes: ["think", "calm", "rest", "kindness"],
    mood: "reflective",
    durations: [30, 60, 180, 300],
    allowsSpeech: true,
    blurb: "Soft rain against glass. Nothing else required.",
    generator: "rain_window",
    volume: 0.38,
    source: "procedural (ffmpeg)",
    license: "Original / public domain (generated)",
    enabledByDefault: true,
  },
  {
    id: "ocean-calm-01",
    title: "Calm Ocean",
    category: "ocean",
    compatibleThemes: ["hope", "calm", "think", "general"],
    mood: "peaceful",
    durations: [30, 60, 180, 300],
    allowsSpeech: true,
    blurb: "A few quiet minutes of ocean waves.",
    generator: "ocean_calm",
    volume: 0.42,
    source: "procedural (ffmpeg)",
    license: "Original / public domain (generated)",
    enabledByDefault: true,
  },
  {
    id: "ocean-waves-01",
    title: "Soft Waves",
    category: "ocean",
    compatibleThemes: ["hope", "rest", "tomorrow"],
    mood: "hopeful",
    durations: [60, 180, 300],
    allowsSpeech: true,
    blurb: "Waves coming and going. Take your time.",
    generator: "ocean_waves",
    volume: 0.4,
    source: "procedural (ffmpeg)",
    license: "Original / public domain (generated)",
    enabledByDefault: true,
  },
  {
    id: "fireplace-01",
    title: "Fireplace",
    category: "fireplace",
    compatibleThemes: ["encouragement", "general", "kindness", "rest"],
    mood: "cozy",
    durations: [30, 60, 180, 300],
    allowsSpeech: true,
    blurb: "Quiet background warmth. Nothing else required.",
    generator: "fireplace",
    volume: 0.36,
    source: "procedural (ffmpeg)",
    license: "Original / public domain (generated)",
    enabledByDefault: true,
  },
  {
    id: "forest-night-01",
    title: "Forest Night",
    category: "forest",
    compatibleThemes: ["think", "calm", "hope", "growth"],
    mood: "reflective",
    durations: [60, 180, 300],
    allowsSpeech: true,
    blurb: "Night forest air. Room to think.",
    generator: "forest_night",
    volume: 0.35,
    source: "procedural (ffmpeg)",
    license: "Original / public domain (generated)",
    enabledByDefault: true,
  },
  {
    id: "forest-birds-01",
    title: "Calm Nature",
    category: "forest",
    compatibleThemes: ["hope", "growth", "encouragement", "tomorrow"],
    mood: "hopeful",
    durations: [60, 180, 300],
    allowsSpeech: true,
    blurb: "Soft nature tones. Stay as long as you like.",
    generator: "forest_birds",
    volume: 0.34,
    source: "procedural (ffmpeg)",
    license: "Original / public domain (generated)",
    enabledByDefault: true,
  },
  {
    id: "night-soft-01",
    title: "Night Ambience",
    category: "ambience",
    compatibleThemes: ["rest", "calm", "think", "tomorrow"],
    mood: "calm",
    durations: [30, 60, 180, 300, 600],
    allowsSpeech: true,
    blurb: "Soft night air. No countdown.",
    generator: "night_soft",
    volume: 0.32,
    source: "procedural (ffmpeg)",
    license: "Original / public domain (generated)",
    enabledByDefault: true,
  },
  {
    id: "cozy-room-01",
    title: "Cozy Room",
    category: "ambience",
    compatibleThemes: ["general", "kindness", "support", "rest"],
    mood: "cozy",
    durations: [60, 180, 300],
    allowsSpeech: true,
    blurb: "A small indoor hush. You're fine here.",
    generator: "cozy_room",
    volume: 0.3,
    source: "procedural (ffmpeg)",
    license: "Original / public domain (generated)",
    enabledByDefault: true,
  },
  {
    id: "wind-soft-01",
    title: "Soft Wind",
    category: "wind",
    compatibleThemes: ["calm", "think", "overwhelmed"],
    mood: "peaceful",
    durations: [60, 180, 300],
    allowsSpeech: true,
    blurb: "A light breeze. Let the edges soften.",
    generator: "wind_soft",
    volume: 0.33,
    source: "procedural (ffmpeg)",
    license: "Original / public domain (generated)",
    enabledByDefault: true,
  },
  {
    id: "thunder-distant-01",
    title: "Distant Thunder",
    category: "thunder",
    compatibleThemes: ["overwhelmed", "calm", "rest"],
    mood: "reflective",
    durations: [60, 180, 300],
    allowsSpeech: true,
    blurb: "Far-off thunder under soft rain.",
    generator: "thunder_distant",
    volume: 0.37,
    source: "procedural (ffmpeg)",
    license: "Original / public domain (generated)",
    enabledByDefault: true,
  },
  {
    id: "stream-01",
    title: "Quiet Stream",
    category: "stream",
    compatibleThemes: ["calm", "think", "hope", "general"],
    mood: "peaceful",
    durations: [60, 180, 300],
    allowsSpeech: true,
    blurb: "Water moving past. You can stay.",
    generator: "stream",
    volume: 0.36,
    source: "procedural (ffmpeg)",
    license: "Original / public domain (generated)",
    enabledByDefault: true,
  },
  {
    id: "music-pad-01",
    title: "Soft Ambient Pad",
    category: "music",
    compatibleThemes: ["hope", "encouragement", "calm", "general"],
    mood: "hopeful",
    durations: [60, 180, 300],
    allowsSpeech: true,
    blurb: "A quiet instrumental bed. No lyrics, no rush.",
    generator: "music_pad",
    volume: 0.28,
    source: "procedural (ffmpeg sine/pads)",
    license: "Original / public domain (generated)",
    enabledByDefault: true,
  },
  {
    id: "music-piano-01",
    title: "Soft Piano Mist",
    category: "music",
    compatibleThemes: ["kindness", "hope", "think", "tomorrow"],
    mood: "reflective",
    durations: [60, 180, 300],
    allowsSpeech: false,
    blurb: "Sparse piano tones. Listen when you're ready.",
    generator: "music_piano",
    volume: 0.26,
    source: "procedural (ffmpeg)",
    license: "Original / public domain (generated)",
    enabledByDefault: true,
  },
  {
    id: "sleep-01",
    title: "Sleep Ambience",
    category: "ambience",
    compatibleThemes: ["rest", "tomorrow", "calm"],
    mood: "calm",
    durations: [180, 300, 600],
    allowsSpeech: false,
    blurb: "Low, steady hush for winding down.",
    generator: "sleep",
    volume: 0.28,
    source: "procedural (ffmpeg)",
    license: "Original / public domain (generated)",
    enabledByDefault: true,
  },
];

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
