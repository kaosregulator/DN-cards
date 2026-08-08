// ─────────────────────────────────────────────────────────────────────────────
// HQ — wall-style registry (data-only).
//
// Wall styles are ROOM ARCHITECTURE — stone, wood, castle masonry, bunker
// plating, sci-fi panels, magical wards. They are NOT skyboxes. Skyboxes only
// tint what sits *beyond* the playable isometric room.
//
 // Same self-healing resolve-to-default contract as themes.ts / frames.ts, and
 // the same `spritePrefix` asset seam: a bundled/uploaded wall pack keyed by
 // `${spritePrefix}/wall` can replace the procedural faces with zero code change.
 // ─────────────────────────────────────────────────────────────────────────────

import type { UnlockRule } from "./unlock-rules.js";

export type HqWallKind =
  | "stone" | "wood" | "castle" | "bunker" | "scifi" | "magical" | "decorative";

export interface HqWall {
  id: string;
  name: string;
  emoji: string;
  kind: HqWallKind;
  // The two visible wall faces (left face is lit differently from the right so
  // the corner reads in 3D). Any CSS colour string.
  leftFace: string;
  rightFace: string;
  trim: string;          // baseboard + top-edge accent line
  window: boolean;       // draw procedural window panels on each face
  windowTint: string;    // rgba glass tint used when `window` is true
  /** Optional masonry / panel motif drawn onto the face. */
  motif: "plain" | "brick" | "planks" | "blocks" | "panels" | "runes" | "rivets";
  spritePrefix: string;  // asset-pack prefix (procedural when no art is bundled)
  unlock: UnlockRule;
  price?: number;        // shard price when buyable from the shop's Surfaces aisle
}

export const HQ_WALLS: HqWall[] = [
  // ── Always-on architectural starters ──────────────────────────────────────
  {
    id: "stone", name: "Stone", emoji: "🪨", kind: "stone",
    leftFace: "#3a3e46", rightFace: "#4a5058", trim: "#1e2228",
    window: false, windowTint: "rgba(0,0,0,0)", motif: "blocks",
    spritePrefix: "wall/stone", unlock: { kind: "always" },
  },
  {
    id: "wood", name: "Wood", emoji: "🪵", kind: "wood",
    leftFace: "#6a4224", rightFace: "#845230", trim: "#3c2814",
    window: false, windowTint: "rgba(0,0,0,0)", motif: "planks",
    spritePrefix: "wall/wood", unlock: { kind: "always" }, price: 400,
  },
  {
    id: "plaster", name: "Plaster", emoji: "🧱", kind: "decorative",
    leftFace: "#c4b8a0", rightFace: "#d8ccb4", trim: "#8a7a5a",
    window: false, windowTint: "rgba(0,0,0,0)", motif: "plain",
    spritePrefix: "wall/plaster", unlock: { kind: "always" },
  },
  {
    id: "windowed", name: "Windowed", emoji: "🪟", kind: "decorative",
    leftFace: "#2a3540", rightFace: "#364450", trim: "#6a90b0",
    window: true, windowTint: "rgba(120,180,255,0.35)", motif: "panels",
    spritePrefix: "wall/windowed", unlock: { kind: "always" },
  },

  // ── Castle / military architecture ───────────────────────────────────────
  {
    id: "castle", name: "Castle Walls", emoji: "🏰", kind: "castle",
    leftFace: "#4a4844", rightFace: "#5a5852", trim: "#2a2824",
    window: true, windowTint: "rgba(30,40,55,0.55)", motif: "blocks",
    spritePrefix: "wall/castle", unlock: { kind: "accountLevel", n: 5 }, price: 700,
  },
  {
    id: "brick", name: "Brick", emoji: "🧱", kind: "castle",
    leftFace: "#6a3228", rightFace: "#7a3e32", trim: "#4a2018",
    window: false, windowTint: "rgba(0,0,0,0)", motif: "brick",
    spritePrefix: "wall/brick", unlock: { kind: "accountLevel", n: 5 }, price: 600,
  },
  {
    id: "bunker", name: "Bunker Walls", emoji: "🛡️", kind: "bunker",
    leftFace: "#2e3236", rightFace: "#3e4448", trim: "#1a1e22",
    window: false, windowTint: "rgba(0,0,0,0)", motif: "rivets",
    spritePrefix: "wall/bunker", unlock: { kind: "battleWins", n: 10 }, price: 800,
  },
  {
    id: "concrete", name: "Concrete", emoji: "⬜", kind: "bunker",
    leftFace: "#6b6f74", rightFace: "#7d8288", trim: "#50545a",
    window: false, windowTint: "rgba(0,0,0,0)", motif: "plain",
    spritePrefix: "wall/concrete", unlock: { kind: "battleWins", n: 10 }, price: 500,
  },

  // ── Sci-fi / magical ──────────────────────────────────────────────────────
  {
    id: "scifi", name: "Sci-Fi Walls", emoji: "💠", kind: "scifi",
    leftFace: "#1a2838", rightFace: "#243448", trim: "#2fd4d4",
    window: true, windowTint: "rgba(80,220,255,0.35)", motif: "panels",
    spritePrefix: "wall/scifi", unlock: { kind: "accountLevel", n: 16 }, price: 1100,
  },
  {
    id: "neon", name: "Neon Panels", emoji: "🟪", kind: "scifi",
    leftFace: "#1a1030", rightFace: "#241640", trim: "#b06bff",
    window: true, windowTint: "rgba(170,90,255,0.4)", motif: "panels",
    spritePrefix: "wall/neon", unlock: { kind: "accountLevel", n: 20 }, price: 1200,
  },
  {
    id: "magical", name: "Magical Walls", emoji: "✨", kind: "magical",
    leftFace: "#3a2a58", rightFace: "#4a3870", trim: "#c9a24a",
    window: true, windowTint: "rgba(180,120,255,0.35)", motif: "runes",
    spritePrefix: "wall/magical", unlock: { kind: "accountLevel", n: 18 }, price: 1000,
  },
  {
    id: "hedge", name: "Garden Hedge", emoji: "🌿", kind: "decorative",
    leftFace: "#2f6b34", rightFace: "#37793c", trim: "#24572a",
    window: false, windowTint: "rgba(0,0,0,0)", motif: "plain",
    spritePrefix: "wall/hedge", unlock: { kind: "collectionUnique", n: 50 }, price: 600,
  },
  {
    id: "marble-wall", name: "Marble", emoji: "⬜", kind: "decorative",
    leftFace: "#d9d6de", rightFace: "#e9e6ee", trim: "#b7b2c4",
    window: false, windowTint: "rgba(0,0,0,0)", motif: "blocks",
    spritePrefix: "wall/marble", unlock: { kind: "netWorth", n: 25_000 }, price: 1500,
  },
];

export const DEFAULT_WALL_ID = "stone";

const WALL_BY_ID = new Map<string, HqWall>(HQ_WALLS.map(w => [w.id, w]));

/** Resolve a wall id to its definition, degrading to the default (never throws). */
export function resolveWall(id: string | null | undefined): HqWall {
  return (id && WALL_BY_ID.get(id)) || WALL_BY_ID.get(DEFAULT_WALL_ID)!;
}

export function getWallById(id: string): HqWall | undefined {
  return WALL_BY_ID.get(id);
}

export function wallsByKind(kind: HqWallKind | "all"): HqWall[] {
  if (kind === "all") return HQ_WALLS;
  return HQ_WALLS.filter(w => w.kind === kind);
}
