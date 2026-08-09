// ─────────────────────────────────────────────────────────────────────────────
// HQ — theme registry (data-only).
//
// A theme is the entire PRESENTATION layer for a Headquarters: wall/floor
// colours, accent, glass tint, lighting mood and ambient particles. The engine
// and renderer know only these generic fields — nothing here says "military" or
// "castle" in code; that meaning lives in the data + (later) an asset pack keyed
// by `spritePrefix`. Add a theme = append to HQ_THEMES.
//
// Mirrors bot/battle/scene-arenas.ts (registry) and bot/cards/frames.ts
// (Map index + resolve-to-default).
// ─────────────────────────────────────────────────────────────────────────────

import type { AtmospherePreset } from "../../animations/atmosphere.js";
import type { UnlockRule } from "./unlock-rules.js";

export type HqLighting = "dawn" | "dusk" | "night" | "neon";

export interface HqPalette {
  wallTop: string;    // back-wall gradient (top → bottom)
  wallBottom: string;
  floorNear: string;  // perspective floor (near → far)
  floorFar: string;
  glass: string;      // display-case tint (rgba)
  light: string;      // key-light tint (rgba)
  accent: number;     // embed accent + procedural highlights
}

export interface HqTheme {
  id: string;
  name: string;
  emoji: string;
  lighting: HqLighting;
  atmosphere: AtmospherePreset;
  palette: HqPalette;
  // Asset-pack prefix. The asset manager looks up `${spritePrefix}/${key}`; when
  // no art is bundled every lookup misses and the renderer draws procedurally.
  spritePrefix: string;
  unlock: UnlockRule;
}

export const HQ_THEMES: HqTheme[] = [
  {
    id: "command",
    name: "Command Post",
    emoji: "🎖️",
    lighting: "dusk",
    atmosphere: "ember",
    spritePrefix: "command",
    unlock: { kind: "always" },
    palette: {
      wallTop: "#2b3327", wallBottom: "#171c14",
      floorNear: "#3a3f31", floorFar: "#20241b",
      glass: "rgba(183,162,74,0.14)", light: "rgba(255,214,120,0.16)",
      accent: 0xb7a24a,
    },
  },
  {
    id: "arcane",
    name: "Arcane Sanctum",
    emoji: "🏰",
    lighting: "night",
    atmosphere: "arena",
    spritePrefix: "arcane",
    unlock: { kind: "accountLevel", n: 10 },
    palette: {
      wallTop: "#241b3a", wallBottom: "#120d20",
      floorNear: "#2e2350", floorFar: "#161029",
      glass: "rgba(155,89,182,0.16)", light: "rgba(190,140,255,0.18)",
      accent: 0x9b59b6,
    },
  },
  {
    id: "void",
    name: "Void Station",
    emoji: "🛰️",
    lighting: "neon",
    atmosphere: "none",
    spritePrefix: "void",
    unlock: { kind: "accountLevel", n: 25 },
    palette: {
      wallTop: "#0b1418", wallBottom: "#05090c",
      floorNear: "#0e1c22", floorFar: "#050b0e",
      glass: "rgba(47,212,212,0.16)", light: "rgba(47,212,212,0.18)",
      accent: 0x2fd4d4,
    },
  },
  // ── Default room themes ─────────────────────────────────────────────────────
  // The three "starter looks" a floor can wear. Each pairs a palette with a
  // torch/daylight mood the room-suite renderer reads (see render-room-suite.ts
  // roomMood) so switching theme visibly re-lights the same furnished floor.
  {
    id: "dungeon",
    name: "Dungeon",
    emoji: "🏰",
    lighting: "night",
    atmosphere: "ember",
    spritePrefix: "dungeon",
    unlock: { kind: "always" },
    palette: {
      // Cold charcoal masonry, warm torch pools — the classic stone crypt.
      wallTop: "#2a2c33", wallBottom: "#141519",
      floorNear: "#33343c", floorFar: "#191a20",
      glass: "rgba(120,140,170,0.12)", light: "rgba(255,168,86,0.20)",
      accent: 0x8a94a6,
    },
  },
  {
    id: "military",
    name: "Military Base",
    emoji: "🎖️",
    lighting: "dusk",
    atmosphere: "ash",
    spritePrefix: "military",
    unlock: { kind: "always" },
    palette: {
      // Olive-drab bunker with cool overhead worklight.
      wallTop: "#3a3d2e", wallBottom: "#20221a",
      floorNear: "#44483a", floorFar: "#262820",
      glass: "rgba(150,170,120,0.12)", light: "rgba(200,220,180,0.16)",
      accent: 0x8a9a4a,
    },
  },
  {
    id: "city",
    name: "City Houses",
    emoji: "🏘️",
    lighting: "dawn",
    atmosphere: "none",
    spritePrefix: "city",
    unlock: { kind: "always" },
    palette: {
      // Warm brick + marble, bright daylight — normal houses, not a crypt.
      wallTop: "#6a5b4c", wallBottom: "#42382e",
      floorNear: "#7a6c5a", floorFar: "#4c4236",
      glass: "rgba(255,240,210,0.14)", light: "rgba(255,236,196,0.22)",
      accent: 0xc79a5a,
    },
  },
];

export const DEFAULT_THEME_ID = "command";

const THEME_BY_ID = new Map<string, HqTheme>(HQ_THEMES.map(t => [t.id, t]));

// Resolve a theme id to its definition, degrading to the default (never throws)
// so a stale/removed id can't break a render — same self-healing contract as
// resolveActiveFrame in cards/frames.ts.
export function resolveTheme(id: string | null | undefined): HqTheme {
  return (id && THEME_BY_ID.get(id)) || THEME_BY_ID.get(DEFAULT_THEME_ID)!;
}

export function getThemeById(id: string): HqTheme | undefined {
  return THEME_BY_ID.get(id);
}
