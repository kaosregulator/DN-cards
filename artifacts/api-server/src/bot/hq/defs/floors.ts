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
    grout: "rgba(0,0,0,0.18)", spritePrefix: "floor/carpet", unlock: { kind: "accountLevel", n: 5 },
  },
  {
    id: "marble", name: "Marble", emoji: "⬜", tileA: "#e8e6ea", tileB: "#d5d2dc",
    grout: "rgba(180,180,200,0.3)", spritePrefix: "floor/marble", unlock: { kind: "netWorth", n: 25_000 },
  },
  {
    id: "grid", name: "Grid", emoji: "🟦", tileA: "#12303a", tileB: "#0e2831",
    grout: "rgba(80,220,220,0.5)", spritePrefix: "floor/grid", unlock: { kind: "accountLevel", n: 20 },
  },
];

export const DEFAULT_FLOOR_ID = "wood";

const FLOOR_BY_ID = new Map<string, HqFloor>(HQ_FLOORS.map(f => [f.id, f]));

// Resolve a floor id to its definition, degrading to the default (never throws).
export function resolveFloor(id: string | null | undefined): HqFloor {
  return (id && FLOOR_BY_ID.get(id)) || FLOOR_BY_ID.get(DEFAULT_FLOOR_ID)!;
}

export function getFloorById(id: string): HqFloor | undefined {
  return FLOOR_BY_ID.get(id);
}
