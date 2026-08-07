// ─────────────────────────────────────────────────────────────────────────────
// HQ — buildable surface & terrain registry (data-only).
//
// The palette the "sim world editor" paints with. A material is a rectangle of
// ground the player stamps onto the isometric lattice: a paved patch, a pond, a
// grass hill, a raised deck. Everything is generic (`kind` + colours + a few
// texture knobs) so the renderer never hardcodes what "water" means, and an
// asset pack keyed by `spriteKey` can swap any of them for real 2D-iso art
// without a code change.
//
// `kind` decides how render-terrain.ts draws it:
//   • flat      — a coloured patch on the floor plane (paths, rugs, sand, snow)
//   • water     — a recessed patch with a shoreline, ripples and a specular band
//   • raised    — an isometric slab with side walls (decks, platforms, plinths)
//   • mound     — a soft organic swell (hills, bumps, dunes) that domes upward
// ─────────────────────────────────────────────────────────────────────────────

import type { UnlockRule } from "./unlock-rules.js";

export type HqSurfaceKind = "flat" | "water" | "raised" | "mound";

export interface HqSurface {
  id: string;
  name: string;
  emoji: string;
  kind: HqSurfaceKind;
  base: string;        // primary fill
  shade: string;       // darker companion (checker / side walls / depth)
  edge: string;        // rim / shoreline / grout colour
  // Surface texture the painter overlays: none, a tile checker, speckles
  // (gravel/sand), planks, or wave lines.
  texture: "none" | "checker" | "speckle" | "plank" | "wave";
  // Default vertical size in "steps" (each step ≈ 14px of iso lift/depth).
  // Ignored by flat materials; the editor can override per placement.
  height: number;
  spriteKey: string;   // asset-pack key: "surface/<id>" → optional real art
  unlock: UnlockRule;
  price?: number;      // shard price when sold in the shop's Surfaces aisle
  // Where this material makes sense. Both by default; the picker filters by
  // whether the player is editing a room interior or the outdoor grounds.
  indoor?: boolean;
  outdoor?: boolean;
}

export const HQ_SURFACES: HqSurface[] = [
  // ── Flat ground ─────────────────────────────────────────────────────────────
  { id: "grass-patch", name: "Grass", emoji: "🌱", kind: "flat", base: "#4f8f43", shade: "#427a38",
    edge: "rgba(30,70,25,0.4)", texture: "speckle", height: 0, spriteKey: "surface/grass-patch",
    unlock: { kind: "always" }, outdoor: true, indoor: true },
  { id: "dirt-patch", name: "Bare Dirt", emoji: "🟫", kind: "flat", base: "#8a6239", shade: "#7a5531",
    edge: "rgba(50,32,14,0.45)", texture: "speckle", height: 0, spriteKey: "surface/dirt-patch",
    unlock: { kind: "always" }, outdoor: true, indoor: true },
  { id: "stone-path", name: "Stone Path", emoji: "🪨", kind: "flat", base: "#9aa0a8", shade: "#868c94",
    edge: "rgba(30,32,36,0.5)", texture: "checker", height: 0, spriteKey: "surface/stone-path",
    unlock: { kind: "always" }, outdoor: true, indoor: true },
  { id: "sand-patch", name: "Sand", emoji: "🏜️", kind: "flat", base: "#e3cf9a", shade: "#d3bd85",
    edge: "rgba(150,120,70,0.35)", texture: "speckle", height: 0, spriteKey: "surface/sand-patch",
    unlock: { kind: "always" }, outdoor: true, indoor: true },
  { id: "snow-patch", name: "Snow", emoji: "❄️", kind: "flat", base: "#e9f1f8", shade: "#d3dfea",
    edge: "rgba(140,165,190,0.4)", texture: "speckle", height: 0, spriteKey: "surface/snow-patch",
    unlock: { kind: "accountLevel", n: 8 }, price: 400, outdoor: true, indoor: true },
  { id: "marble-inlay", name: "Marble Inlay", emoji: "⬜", kind: "flat", base: "#e8e6ea", shade: "#d2cfd9",
    edge: "rgba(150,150,175,0.45)", texture: "checker", height: 0, spriteKey: "surface/marble-inlay",
    unlock: { kind: "netWorth", n: 10_000 }, price: 900, indoor: true, outdoor: true },
  { id: "red-carpet", name: "Red Carpet", emoji: "🟥", kind: "flat", base: "#8e2b3f", shade: "#7a2334",
    edge: "rgba(230,200,120,0.65)", texture: "none", height: 0, spriteKey: "surface/red-carpet",
    unlock: { kind: "always" }, price: 250, indoor: true, outdoor: true },
  { id: "lava-flow", name: "Lava Flow", emoji: "🌋", kind: "flat", base: "#e2542a", shade: "#8c2411",
    edge: "rgba(255,190,90,0.8)", texture: "speckle", height: 0, spriteKey: "surface/lava-flow",
    unlock: { kind: "battleWins", n: 50 }, price: 1400, outdoor: true, indoor: true },

  // ── Water ───────────────────────────────────────────────────────────────────
  { id: "pond", name: "Pond", emoji: "💧", kind: "water", base: "#3f7fb5", shade: "#20496e",
    edge: "#c8b184", texture: "wave", height: 1, spriteKey: "surface/pond",
    unlock: { kind: "always" }, outdoor: true, indoor: true },
  { id: "deep-water", name: "Deep Water", emoji: "🌊", kind: "water", base: "#255d8c", shade: "#12324e",
    edge: "#8b9099", texture: "wave", height: 2, spriteKey: "surface/deep-water",
    unlock: { kind: "collectionUnique", n: 25 }, price: 600, outdoor: true, indoor: true },
  { id: "hot-spring", name: "Hot Spring", emoji: "♨️", kind: "water", base: "#57b7ad", shade: "#2c7a74",
    edge: "#b9a888", texture: "wave", height: 1, spriteKey: "surface/hot-spring",
    unlock: { kind: "dailyStreak", n: 7 }, price: 700, outdoor: true, indoor: true },

  // ── Raised platforms ────────────────────────────────────────────────────────
  { id: "wood-deck", name: "Wood Deck", emoji: "🪵", kind: "raised", base: "#a9773f", shade: "#7c5528",
    edge: "rgba(60,30,10,0.5)", texture: "plank", height: 1, spriteKey: "surface/wood-deck",
    unlock: { kind: "always" }, price: 300, indoor: true, outdoor: true },
  { id: "stone-plinth", name: "Stone Plinth", emoji: "🧱", kind: "raised", base: "#b6b2a4", shade: "#807c70",
    edge: "rgba(40,38,32,0.5)", texture: "checker", height: 2, spriteKey: "surface/stone-plinth",
    unlock: { kind: "always" }, price: 450, indoor: true, outdoor: true },
  { id: "battlement", name: "Battlement", emoji: "🏰", kind: "raised", base: "#cdc7b4", shade: "#948e7c",
    edge: "rgba(50,46,38,0.55)", texture: "checker", height: 3, spriteKey: "surface/battlement",
    unlock: { kind: "battleWins", n: 25 }, price: 1100, outdoor: true, indoor: true },

  // ── Mounds & hills ──────────────────────────────────────────────────────────
  { id: "grass-hill", name: "Grass Hill", emoji: "⛰️", kind: "mound", base: "#59a04b", shade: "#3d6f34",
    edge: "rgba(30,70,25,0.4)", texture: "speckle", height: 2, spriteKey: "surface/grass-hill",
    unlock: { kind: "always" }, outdoor: true },
  { id: "dirt-bump", name: "Dirt Bump", emoji: "🫓", kind: "mound", base: "#966c3f", shade: "#6d4c28",
    edge: "rgba(50,32,14,0.45)", texture: "speckle", height: 1, spriteKey: "surface/dirt-bump",
    unlock: { kind: "always" }, outdoor: true },
  { id: "sand-dune", name: "Sand Dune", emoji: "🏝️", kind: "mound", base: "#e6d3a1", shade: "#bfa268",
    edge: "rgba(150,120,70,0.35)", texture: "speckle", height: 2, spriteKey: "surface/sand-dune",
    unlock: { kind: "always" }, outdoor: true },
  { id: "rock-crag", name: "Rock Crag", emoji: "🪨", kind: "mound", base: "#9aa0a8", shade: "#666c74",
    edge: "rgba(25,28,32,0.5)", texture: "none", height: 3, spriteKey: "surface/rock-crag",
    unlock: { kind: "collectionUnique", n: 50 }, price: 800, outdoor: true },
  { id: "snow-drift", name: "Snow Drift", emoji: "🏔️", kind: "mound", base: "#eef4fa", shade: "#b9c9d8",
    edge: "rgba(140,165,190,0.4)", texture: "none", height: 3, spriteKey: "surface/snow-drift",
    unlock: { kind: "accountLevel", n: 15 }, price: 1000, outdoor: true },
];

export const DEFAULT_SURFACE_ID = "grass-patch";

const BY_ID = new Map<string, HqSurface>(HQ_SURFACES.map(s => [s.id, s]));

/** Resolve a surface id, degrading to the default so a stale id never throws. */
export function resolveSurface(id: string | null | undefined): HqSurface {
  return (id && BY_ID.get(id)) || BY_ID.get(DEFAULT_SURFACE_ID)!;
}

export function getSurfaceById(id: string): HqSurface | undefined {
  return BY_ID.get(id);
}

/** Materials usable in a given space, in registry order. */
export function surfacesFor(space: "indoor" | "outdoor"): HqSurface[] {
  return HQ_SURFACES.filter(s => (space === "indoor" ? s.indoor !== false : s.outdoor !== false));
}

/** Surfaces sold in the shop (a `price` makes a material buyable). */
export function buyableTerrain(): HqSurface[] {
  return HQ_SURFACES.filter(s => typeof s.price === "number" && s.price > 0);
}
