// ─────────────────────────────────────────────────────────────────────────────
// Visual Battle Arenas — pickable animated backdrops for the fight scene.
//
// These are COSMETIC backgrounds, separate from the difficulty-band arenas in
// arenas.ts (which scale the AI). Each maps to a bundled, downsampled pixel-art
// atmospheric loop (assets/arenas/<key>.png, built by scripts/build-arenas.mjs
// from the Alenia Studios pack — see assets/arenas/CREDITS.md). A light
// procedural atmosphere preset is layered on top for depth.
// ─────────────────────────────────────────────────────────────────────────────

import type { AtmospherePreset } from "../animations/atmosphere.js";

export interface SceneArena {
  key: string;
  name: string;
  emoji: string;
  /** Procedural atmosphere layered over the pixel-art loop for extra depth. */
  atmosphere: AtmospherePreset;
}

export const SCENE_ARENAS: Record<string, SceneArena> = {
  aurora:  { key: "aurora",  name: "Aurora Veil",  emoji: "🌌", atmosphere: "snow" },
  embers:  { key: "embers",  name: "Ember Field",  emoji: "🔥", atmosphere: "ember" },
  frost:   { key: "frost",   name: "Frostline",    emoji: "❄️", atmosphere: "snow" },
  storm:   { key: "storm",   name: "Thunderstorm", emoji: "⛈️", atmosphere: "storm" },
  ashfall: { key: "ashfall", name: "Ashfall",      emoji: "🌋", atmosphere: "ash" },
  godrays: { key: "godrays", name: "Sunspire",     emoji: "🌅", atmosphere: "battlefield" },
  meteor:  { key: "meteor",  name: "Meteor Storm", emoji: "☄️", atmosphere: "ember" },
  fog:     { key: "fog",     name: "Fog of War",   emoji: "🌫️", atmosphere: "battlefield" },
};

export const SCENE_ARENA_KEYS = Object.keys(SCENE_ARENAS);

export const DEFAULT_SCENE_ARENA = "embers";

export function isSceneArenaKey(v: string | null | undefined): v is string {
  return !!v && v in SCENE_ARENAS;
}

export function getSceneArena(key: string | null | undefined): SceneArena {
  return (isSceneArenaKey(key) ? SCENE_ARENAS[key]! : SCENE_ARENAS[DEFAULT_SCENE_ARENA]!);
}

export function sceneArenaLabel(key: string | null | undefined): string {
  const a = getSceneArena(key);
  return `${a.emoji} ${a.name}`;
}
