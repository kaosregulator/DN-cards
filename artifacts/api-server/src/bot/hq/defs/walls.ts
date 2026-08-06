// ─────────────────────────────────────────────────────────────────────────────
// HQ — wall-style registry (data-only).
//
// A wall style is the PRESENTATION of the room's two corner walls in the
// isometric renderer: the two face colours, a trim accent and whether windows
// are drawn. Like themes, the engine knows only these generic fields — nothing
// here says "military" or "castle". Add a wall = append to HQ_WALLS.
//
// Same self-healing resolve-to-default contract as themes.ts / frames.ts, and
// the same `spritePrefix` asset seam: a bundled/uploaded wall pack keyed by
// `${spritePrefix}/wall-left|wall-right` can replace the procedural faces with
// zero code change (see bot/hq/assets.ts).
// ─────────────────────────────────────────────────────────────────────────────

import type { UnlockRule } from "./unlock-rules.js";

export interface HqWall {
  id: string;
  name: string;
  emoji: string;
  // The two visible wall faces (left face is lit differently from the right so
  // the corner reads in 3D). Any CSS colour string.
  leftFace: string;
  rightFace: string;
  trim: string;          // baseboard + top-edge accent line
  window: boolean;       // draw procedural window panels on each face
  windowTint: string;    // rgba glass tint used when `window` is true
  spritePrefix: string;  // asset-pack prefix (procedural when no art is bundled)
  unlock: UnlockRule;
  price?: number;        // shard price when buyable from the shop's Surfaces aisle
}

export const HQ_WALLS: HqWall[] = [
  {
    id: "plaster", name: "Plaster", emoji: "🧱", leftFace: "#d8cbb0", rightFace: "#ece0c6",
    trim: "#b7a17a", window: false, windowTint: "rgba(0,0,0,0)", spritePrefix: "wall/plaster",
    unlock: { kind: "always" },
  },
  {
    id: "windowed", name: "Windowed", emoji: "🪟", leftFace: "#33424f", rightFace: "#3f4f5e",
    trim: "#7fa8c9", window: true, windowTint: "rgba(150,200,255,0.45)", spritePrefix: "wall/windowed",
    unlock: { kind: "always" },
  },
  {
    id: "brick", name: "Brick", emoji: "🧱", leftFace: "#7a3b32", rightFace: "#8f4a3f",
    trim: "#5a2a24", window: false, windowTint: "rgba(0,0,0,0)", spritePrefix: "wall/brick",
    unlock: { kind: "accountLevel", n: 5 }, price: 600,
  },
  {
    id: "concrete", name: "Concrete", emoji: "⬜", leftFace: "#6b6f74", rightFace: "#7d8288",
    trim: "#50545a", window: false, windowTint: "rgba(0,0,0,0)", spritePrefix: "wall/concrete",
    unlock: { kind: "battleWins", n: 10 }, price: 500,
  },
  {
    id: "neon", name: "Neon Panels", emoji: "🟪", leftFace: "#1a1030", rightFace: "#241640",
    trim: "#b06bff", window: true, windowTint: "rgba(170,90,255,0.4)", spritePrefix: "wall/neon",
    unlock: { kind: "accountLevel", n: 20 }, price: 1200,
  },
  {
    id: "stone", name: "Stone", emoji: "🪨", leftFace: "#6d7178", rightFace: "#80858c",
    trim: "#4c5056", window: false, windowTint: "rgba(0,0,0,0)", spritePrefix: "wall/stone",
    unlock: { kind: "battleWins", n: 25 }, price: 700,
  },
  {
    id: "hedge", name: "Garden Hedge", emoji: "🌿", leftFace: "#2f6b34", rightFace: "#37793c",
    trim: "#24572a", window: false, windowTint: "rgba(0,0,0,0)", spritePrefix: "wall/hedge",
    unlock: { kind: "collectionUnique", n: 50 }, price: 600,
  },
  {
    id: "marble-wall", name: "Marble", emoji: "⬜", leftFace: "#d9d6de", rightFace: "#e9e6ee",
    trim: "#b7b2c4", window: false, windowTint: "rgba(0,0,0,0)", spritePrefix: "wall/marble",
    unlock: { kind: "netWorth", n: 25_000 }, price: 1500,
  },
];

export const DEFAULT_WALL_ID = "plaster";

const WALL_BY_ID = new Map<string, HqWall>(HQ_WALLS.map(w => [w.id, w]));

// Resolve a wall id to its definition, degrading to the default (never throws).
export function resolveWall(id: string | null | undefined): HqWall {
  return (id && WALL_BY_ID.get(id)) || WALL_BY_ID.get(DEFAULT_WALL_ID)!;
}

export function getWallById(id: string): HqWall | undefined {
  return WALL_BY_ID.get(id);
}
