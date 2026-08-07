// ─────────────────────────────────────────────────────────────────────────────
// HQ — skybox registry (data-only).
//
// Skyboxes are NOT wallpapers and NOT room backdrops. They are giant surrounding
// backdrop walls that enclose the outdoor base map — the horizon wrap you see
// behind the isometric grounds. Themes: Clouds, Night, Winter, Mountains,
// Autumn, Beach, Desert, Space, etc.
//
// Stored as player_hq.stats.skyboxId. Art lands at skybox/<id>.png; when missing
// the renderer paints a procedural wrap matching the mood colours below.
// ─────────────────────────────────────────────────────────────────────────────

import type { UnlockRule } from "./unlock-rules.js";

export interface HqSkybox {
  id: string;
  name: string;
  emoji: string;
  /** Top-of-sky colour (hex). */
  skyTop: string;
  /** Horizon colour (hex). */
  skyHorizon: string;
  /** Distant land / fog band (hex). */
  land: string;
  /** Optional accent (clouds, stars, sand dunes…). */
  accent: string;
  mood: "day" | "dusk" | "night" | "storm" | "snow" | "beach" | "desert" | "space" | "autumn";
  spriteKey: string;
  unlock: UnlockRule;
}

export const HQ_SKYBOXES: HqSkybox[] = [
  // Ids are skybox-* so they never collide with backdrop / wallpaper ledger keys.
  { id: "skybox-clouds", name: "Clouds", emoji: "☁️", skyTop: "#5eb0ef", skyHorizon: "#c8e4ff",
    land: "#7aaa4a", accent: "#ffffff", mood: "day", spriteKey: "skybox/clouds",
    unlock: { kind: "always" } },
  { id: "skybox-outside", name: "Outside", emoji: "🌳", skyTop: "#87ceeb", skyHorizon: "#dfefff",
    land: "#5f9a3a", accent: "#e8f4ff", mood: "day", spriteKey: "skybox/outside",
    unlock: { kind: "always" } },
  { id: "skybox-night", name: "Night", emoji: "🌙", skyTop: "#0a1028", skyHorizon: "#1a2748",
    land: "#1e2a1a", accent: "#d4e0ff", mood: "night", spriteKey: "skybox/night",
    unlock: { kind: "accountLevel", n: 5 } },
  { id: "skybox-winter", name: "Winter", emoji: "❄️", skyTop: "#9bb5d0", skyHorizon: "#e8f0f8",
    land: "#dce6ef", accent: "#ffffff", mood: "snow", spriteKey: "skybox/winter",
    unlock: { kind: "accountLevel", n: 8 } },
  { id: "skybox-mountains", name: "Mountains", emoji: "⛰️", skyTop: "#6a9fd4", skyHorizon: "#c5d8ef",
    land: "#6b7a6a", accent: "#9aa8b8", mood: "day", spriteKey: "skybox/mountains",
    unlock: { kind: "battleWins", n: 15 } },
  { id: "skybox-autumn", name: "Autumn", emoji: "🍂", skyTop: "#f0a060", skyHorizon: "#ffd9a8",
    land: "#b86a2a", accent: "#e07030", mood: "autumn", spriteKey: "skybox/autumn",
    unlock: { kind: "accountLevel", n: 10 } },
  { id: "skybox-beach", name: "Beach", emoji: "🏖️", skyTop: "#4ec0e8", skyHorizon: "#ffe8b8",
    land: "#e8c878", accent: "#40a8d0", mood: "beach", spriteKey: "skybox/beach",
    unlock: { kind: "battleWins", n: 25 } },
  { id: "skybox-desert", name: "Desert", emoji: "🏜️", skyTop: "#f0c070", skyHorizon: "#ffe0a0",
    land: "#d4a050", accent: "#c08030", mood: "desert", spriteKey: "skybox/desert",
    unlock: { kind: "battleWins", n: 40 } },
  { id: "skybox-space", name: "Space", emoji: "🌌", skyTop: "#050510", skyHorizon: "#1a1040",
    land: "#0a0820", accent: "#a090ff", mood: "space", spriteKey: "skybox/space",
    unlock: { kind: "accountLevel", n: 20 } },
  { id: "skybox-fall", name: "Fall Forest", emoji: "🍁", skyTop: "#d87840", skyHorizon: "#f0c090",
    land: "#8a4a20", accent: "#c05020", mood: "autumn", spriteKey: "skybox/fall",
    unlock: { kind: "collectionUnique", n: 40 } },
];

export const DEFAULT_SKYBOX_ID = "skybox-clouds";

const BY_ID = new Map<string, HqSkybox>(HQ_SKYBOXES.map(s => [s.id, s]));

export function resolveSkybox(id: string | null | undefined): HqSkybox {
  return (id && BY_ID.get(id)) || BY_ID.get(DEFAULT_SKYBOX_ID)!;
}

export function getSkyboxById(id: string): HqSkybox | undefined {
  return BY_ID.get(id);
}
