// ─────────────────────────────────────────────────────────────────────────────
 // HQ — skybox registry (data-only).
 //
 // Skyboxes are OPTIONAL ATMOSPHERE beyond the playable space — not room walls,
 // not wallpapers, and not giant enclosing backdrop planes. Changing a skybox
 // only changes what the player sees *beyond* the base/room (Sunny Day, Night,
 // Snow, Desert, …). Architecture (stone / wood / castle walls) stays separate.
 //
 // Stored as player_hq.stats.skyboxId. Art lands at skybox/<id>.png; when missing
 // the renderer paints a soft open-horizon mood on a dark void.
 // ─────────────────────────────────────────────────────────────────────────────

import type { UnlockRule } from "./unlock-rules.js";

export type HqSkyboxMood =
  | "day" | "dusk" | "night" | "storm" | "snow" | "beach" | "desert"
  | "space" | "autumn" | "volcano" | "forest" | "ocean" | "courtyard";

export interface HqSkybox {
  id: string;
  name: string;
  emoji: string;
  /** Upper atmosphere tint (hex). */
  skyTop: string;
  /** Soft horizon wash (hex). */
  skyHorizon: string;
  /** Distant land / fog band (hex). */
  land: string;
  /** Accent for clouds, stars, sparks… */
  accent: string;
  mood: HqSkyboxMood;
  spriteKey: string;
  unlock: UnlockRule;
}

export const HQ_SKYBOXES: HqSkybox[] = [
  // Ids stay skybox-* so they never collide with backdrop / wallpaper ledger keys.
  { id: "skybox-clouds", name: "Sunny Day", emoji: "☀️", skyTop: "#5eb0ef", skyHorizon: "#c8e4ff",
    land: "#7aaa4a", accent: "#ffffff", mood: "day", spriteKey: "skybox/clouds",
    unlock: { kind: "always" } },
  { id: "skybox-outside", name: "Castle Courtyard", emoji: "🏰", skyTop: "#87ceeb", skyHorizon: "#dfefff",
    land: "#6a7a5a", accent: "#e8f4ff", mood: "courtyard", spriteKey: "skybox/outside",
    unlock: { kind: "always" } },
  { id: "skybox-night", name: "Night", emoji: "🌙", skyTop: "#0a1028", skyHorizon: "#1a2748",
    land: "#1e2a1a", accent: "#d4e0ff", mood: "night", spriteKey: "skybox/night",
    unlock: { kind: "accountLevel", n: 5 } },
  { id: "skybox-winter", name: "Winter", emoji: "❄️", skyTop: "#9bb5d0", skyHorizon: "#e8f0f8",
    land: "#dce6ef", accent: "#ffffff", mood: "snow", spriteKey: "skybox/winter",
    unlock: { kind: "accountLevel", n: 8 } },
  { id: "skybox-snow", name: "Snow", emoji: "🌨️", skyTop: "#a8c0d8", skyHorizon: "#f2f6fa",
    land: "#e8eef4", accent: "#ffffff", mood: "snow", spriteKey: "skybox/snow",
    unlock: { kind: "accountLevel", n: 9 } },
  { id: "skybox-forest", name: "Forest", emoji: "🌲", skyTop: "#4a7a9a", skyHorizon: "#b8d4a8",
    land: "#2f5a28", accent: "#8fbf6a", mood: "forest", spriteKey: "skybox/forest",
    unlock: { kind: "collectionUnique", n: 20 } },
  { id: "skybox-mountains", name: "Mountains", emoji: "⛰️", skyTop: "#6a9fd4", skyHorizon: "#c5d8ef",
    land: "#6b7a6a", accent: "#9aa8b8", mood: "day", spriteKey: "skybox/mountains",
    unlock: { kind: "battleWins", n: 15 } },
  { id: "skybox-autumn", name: "Autumn", emoji: "🍂", skyTop: "#f0a060", skyHorizon: "#ffd9a8",
    land: "#b86a2a", accent: "#e07030", mood: "autumn", spriteKey: "skybox/autumn",
    unlock: { kind: "accountLevel", n: 10 } },
  { id: "skybox-ocean", name: "Ocean", emoji: "🌊", skyTop: "#3a90c8", skyHorizon: "#a8d8f0",
    land: "#2a6a90", accent: "#70c0e8", mood: "ocean", spriteKey: "skybox/ocean",
    unlock: { kind: "battleWins", n: 20 } },
  { id: "skybox-beach", name: "Beach", emoji: "🏖️", skyTop: "#4ec0e8", skyHorizon: "#ffe8b8",
    land: "#e8c878", accent: "#40a8d0", mood: "beach", spriteKey: "skybox/beach",
    unlock: { kind: "battleWins", n: 25 } },
  { id: "skybox-desert", name: "Desert", emoji: "🏜️", skyTop: "#f0c070", skyHorizon: "#ffe0a0",
    land: "#d4a050", accent: "#c08030", mood: "desert", spriteKey: "skybox/desert",
    unlock: { kind: "battleWins", n: 40 } },
  { id: "skybox-volcano", name: "Volcano", emoji: "🌋", skyTop: "#2a1018", skyHorizon: "#6a2030",
    land: "#3a1810", accent: "#ff6030", mood: "volcano", spriteKey: "skybox/volcano",
    unlock: { kind: "raidBoss" } },
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
