// ─────────────────────────────────────────────────────────────────────────────
// HQ — floor-style registry (data-only).
//
// A floor style is the PRESENTATION of the isometric floor: a two-tone tile
// checker (tileA/tileB) plus a grout line colour. Generic fields only — add a
// floor = append to HQ_FLOORS. Same resolve-to-default + `spritePrefix` asset
// seam as walls.ts (a bundled/uploaded `${spritePrefix}/tile` PNG can replace
// the procedural diamonds with zero code change).
// ─────────────────────────────────────────────────────────────────────────────

import type { UnlockRule } from "./unlock-rules.js";

export interface HqFloor {
  id: string;
  name: string;
  emoji: string;
  tileA: string;         // primary tile colour
  tileB: string;         // alternate (checker) tile colour
  grout: string;         // tile-edge line (rgba)
  spritePrefix: string;  // asset-pack prefix (procedural when no art is bundled)
  unlock: UnlockRule;
  price?: number;        // shard price when buyable from the shop's Surfaces aisle
}

export const HQ_FLOORS: HqFloor[] = [
  {
    id: "wood", name: "Wood", emoji: "🪵", tileA: "#a9773f", tileB: "#9c6a36",
    grout: "rgba(60,30,10,0.35)", spritePrefix: "floor/wood", unlock: { kind: "always" },
  },
  {
    id: "tile", name: "Tile", emoji: "◻️", tileA: "#cfd6dc", tileB: "#b9c2ca",
    grout: "rgba(255,255,255,0.25)", spritePrefix: "floor/tile", unlock: { kind: "always" },
  },
  {
    id: "carpet", name: "Carpet", emoji: "🟥", tileA: "#7a3550", tileB: "#6d2e47",
    grout: "rgba(0,0,0,0.18)", spritePrefix: "floor/carpet", unlock: { kind: "accountLevel", n: 5 }, price: 500,
  },
  {
    id: "marble", name: "Marble", emoji: "⬜", tileA: "#e8e6ea", tileB: "#d5d2dc",
    grout: "rgba(180,180,200,0.3)", spritePrefix: "floor/marble", unlock: { kind: "netWorth", n: 25_000 }, price: 1500,
  },
  {
    id: "grid", name: "Grid", emoji: "🟦", tileA: "#12303a", tileB: "#0e2831",
    grout: "rgba(80,220,220,0.5)", spritePrefix: "floor/grid", unlock: { kind: "accountLevel", n: 20 }, price: 900,
  },
  // ── Outdoor / natural grounds — for open-air "outside" rooms ──────────────────
  {
    id: "grass", name: "Grass", emoji: "🌱", tileA: "#4f8f43", tileB: "#468039",
    grout: "rgba(30,70,25,0.35)", spritePrefix: "floor/grass", unlock: { kind: "always" },
  },
  {
    id: "dirt", name: "Dirt", emoji: "🟫", tileA: "#8a6239", tileB: "#7d5832",
    grout: "rgba(50,32,14,0.4)", spritePrefix: "floor/dirt", unlock: { kind: "always" },
  },
  {
    id: "sand", name: "Sand", emoji: "🏜️", tileA: "#e3cf9a", tileB: "#d8c189",
    grout: "rgba(150,120,70,0.3)", spritePrefix: "floor/sand", unlock: { kind: "totalCards", n: 25 }, price: 450,
  },
  {
    id: "cobblestone", name: "Cobblestone", emoji: "🪨", tileA: "#8b8f96", tileB: "#7c8087",
    grout: "rgba(30,32,36,0.5)", spritePrefix: "floor/cobblestone", unlock: { kind: "always" }, price: 500,
  },
  {
    id: "brick-floor", name: "Brick Floor", emoji: "🧱", tileA: "#9a5240", tileB: "#8a473a",
    grout: "rgba(50,24,18,0.5)", spritePrefix: "floor/brick", unlock: { kind: "accountLevel", n: 10 }, price: 700,
  },
  {
    id: "checker", name: "Checkerboard", emoji: "🏁", tileA: "#2a2d33", tileB: "#eceef2",
    grout: "rgba(0,0,0,0.2)", spritePrefix: "floor/checker", unlock: { kind: "dailyStreak", n: 14 }, price: 800,
  },
];

export const DEFAULT_FLOOR_ID = "cobblestone";

const FLOOR_BY_ID = new Map<string, HqFloor>(HQ_FLOORS.map(f => [f.id, f]));

// Resolve a floor id to its definition, degrading to the default (never throws).
export function resolveFloor(id: string | null | undefined): HqFloor {
  return (id && FLOOR_BY_ID.get(id)) || FLOOR_BY_ID.get(DEFAULT_FLOOR_ID)!;
}

export function getFloorById(id: string): HqFloor | undefined {
  return FLOOR_BY_ID.get(id);
}
