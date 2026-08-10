// ─────────────────────────────────────────────────────────────────────────────
// HQ — connected floorplan (data + topology).
//
// The HQ is one continuous headquarters players expand over time — not a list of
 // isolated square scenes. Zones (Command Center, Hallway, Armory, …) sit on a
 // shared lattice, joined by doors/archways. Walls snap to edges and auto-merge
 // into corners, T-junctions, and crosses (Sims / RimWorld / Prison Architect).
 //
 // Persistence: player_hq.stats.floorplan (jsonb). No schema migration required.
 // ─────────────────────────────────────────────────────────────────────────────

import type { UnlockRule } from "./unlock-rules.js";

/** Max HQ lattice (cells). Multi-floor later stacks additional FloorplanState.floor. */
export const FLOORPLAN_W = 32;
export const FLOORPLAN_H = 20;

export type WallAxis = "h" | "v";
/** Opening cut into a wall edge. */
export type OpeningKind = "door" | "double-door" | "archway" | "window";
export type WallKind = "exterior" | "interior";

/** Auto-merged junction glyph used by the renderer. */
export type WallJunction =
  | "h" | "v"                 // straight
  | "corner-ne" | "corner-nw" | "corner-se" | "corner-sw"
  | "t-n" | "t-s" | "t-e" | "t-w"
  | "cross"
  | "cap-n" | "cap-s" | "cap-e" | "cap-w"
  | "none";

export interface FloorplanRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface FloorplanWall {
  /** Edge key — see edgeKey(). */
  key: string;
  kind: WallKind;
  /** Architectural wall style id (stone/wood/castle/…). */
  styleId: string;
}

export interface FloorplanOpening {
  key: string;
  kind: OpeningKind;
  /** Optional zone ids this opening joins. */
  fromZoneId?: string;
  toZoneId?: string;
}

export interface FloorplanZone {
  id: string;
  /** Maps to HQ_ROOMS id (functional room type). Hallways use id "hallway". */
  roomTypeId: string;
  name: string;
  emoji: string;
  rect: FloorplanRect;
  /** False = reserved parcel, not yet buildable. */
  unlocked: boolean;
}

export interface FloorplanExpansion {
  id: string;
  label: string;
  emoji: string;
  /** Parcel added when claimed. */
  rect: FloorplanRect;
  /** Zone created (or unlocked) when expansion is claimed. */
  zoneId: string;
  roomTypeId: string;
  unlock: UnlockRule;
}

export interface FloorplanState {
  version: 1;
  width: number;
  height: number;
  /** 0 = ground floor; future basement/upper use other floors. */
  floor: number;
  walls: FloorplanWall[];
  openings: FloorplanOpening[];
  zones: FloorplanZone[];
  /** Claimed expansion ids. */
  claimedExpansions: string[];
  /** Zone the camera / decorate focus is on. */
  focusZoneId: string;
}

// ── Edge keys ────────────────────────────────────────────────────────────────
/** Horizontal edge along the north side of cell (x,y) — between rows y-1 and y. */
export function hEdge(x: number, y: number): string { return `h:${x}:${y}`; }
/** Vertical edge along the west side of cell (x,y) — between cols x-1 and x. */
export function vEdge(x: number, y: number): string { return `v:${x}:${y}`; }

export function parseEdge(key: string): { axis: WallAxis; x: number; y: number } | null {
  const m = /^(h|v):(-?\d+):(-?\d+)$/.exec(key);
  if (!m) return null;
  return { axis: m[1] as WallAxis, x: Number(m[2]), y: Number(m[3]) };
}

export function edgeKey(axis: WallAxis, x: number, y: number): string {
  return axis === "h" ? hEdge(x, y) : vEdge(x, y);
}

// ── Topology ─────────────────────────────────────────────────────────────────
/** Which of the four cardinal wall stubs meet at a *vertex* (grid point). */
export function junctionAt(
  wallSet: Set<string>,
  vx: number, vy: number,
): WallJunction {
  // At vertex (vx,vy):
  //   N stub = vEdge(vx, vy-1) going up into previous row? 
  // Actually for rendering mid-edge segments we classify each EDGE, not vertex.
  // This helper classifies a VERTEX for corner posts.
  const n = wallSet.has(vEdge(vx, vy - 1)); // vertical edge ending at this vertex from north cell
  const s = wallSet.has(vEdge(vx, vy));     // vertical edge starting south
  const w = wallSet.has(hEdge(vx - 1, vy)); // horizontal edge from west
  const e = wallSet.has(hEdge(vx, vy));     // horizontal edge to east
  const bits = (n ? 1 : 0) | (e ? 2 : 0) | (s ? 4 : 0) | (w ? 8 : 0);
  switch (bits) {
    case 0: return "none";
    case 1: return "cap-n";
    case 2: return "cap-e";
    case 4: return "cap-s";
    case 8: return "cap-w";
    case 1 | 4: return "v";
    case 2 | 8: return "h";
    case 1 | 2: return "corner-ne";
    case 1 | 8: return "corner-nw";
    case 4 | 2: return "corner-se";
    case 4 | 8: return "corner-sw";
    case 1 | 2 | 8: return "t-n";
    case 4 | 2 | 8: return "t-s";
    case 2 | 1 | 4: return "t-e";
    case 8 | 1 | 4: return "t-w";
    case 1 | 2 | 4 | 8: return "cross";
    default: return "h";
  }
}

/** Classify a wall EDGE for drawing (straight vs opening gap). */
export function edgeJunction(
  wallSet: Set<string>,
  key: string,
): "h" | "v" | "none" {
  const p = parseEdge(key);
  if (!p || !wallSet.has(key)) return "none";
  return p.axis === "h" ? "h" : "v";
}

// ── Rect helpers ─────────────────────────────────────────────────────────────
export function rectContains(r: FloorplanRect, x: number, y: number): boolean {
  return x >= r.x && y >= r.y && x < r.x + r.w && y < r.y + r.h;
}

export function rectsOverlap(a: FloorplanRect, b: FloorplanRect): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

export function perimeterEdges(r: FloorplanRect): string[] {
  const keys: string[] = [];
  for (let x = r.x; x < r.x + r.w; x++) {
    keys.push(hEdge(x, r.y));             // north
    keys.push(hEdge(x, r.y + r.h));       // south
  }
  for (let y = r.y; y < r.y + r.h; y++) {
    keys.push(vEdge(r.x, y));             // west
    keys.push(vEdge(r.x + r.w, y));       // east
  }
  return keys;
}

/** Shared edge keys between two axis-aligned rects (for door placement). */
export function sharedEdges(a: FloorplanRect, b: FloorplanRect): string[] {
  const setB = new Set(perimeterEdges(b));
  return perimeterEdges(a).filter(k => setB.has(k));
}

// ── Default starter HQ ───────────────────────────────────────────────────────
// Continuous layout:
//   Command Center ──door── Hallway ──door── Trophy Hall
//         │
//       Hallway S
//         │
//   Armory / Barracks / Treasury / Workshop / … (expansion parcels)

const STYLE = "stone";

function zone(
  id: string, roomTypeId: string, name: string, emoji: string,
  rect: FloorplanRect, unlocked: boolean,
): FloorplanZone {
  return { id, roomTypeId, name, emoji, rect, unlocked };
}

function wall(key: string, kind: WallKind = "exterior", styleId = STYLE): FloorplanWall {
  return { key, kind, styleId };
}

function opening(key: string, kind: OpeningKind, from?: string, to?: string): FloorplanOpening {
  return { key, kind, fromZoneId: from, toZoneId: to };
}

/** Build exterior walls for a rect, skipping keys in `skip`. */
function boxWalls(r: FloorplanRect, skip: Set<string>, kind: WallKind = "exterior"): FloorplanWall[] {
  return perimeterEdges(r)
    .filter(k => !skip.has(k))
    .map(k => wall(k, kind));
}

export const FLOORPLAN_EXPANSIONS: FloorplanExpansion[] = [
  { id: "exp-armory", label: "Armory Wing", emoji: "⚔️",
    rect: { x: 1, y: 13, w: 7, h: 6 }, zoneId: "armory", roomTypeId: "armory",
    unlock: { kind: "battleWins", n: 10 } },
  { id: "exp-barracks", label: "Barracks Wing", emoji: "🏕️",
    rect: { x: 9, y: 13, w: 7, h: 6 }, zoneId: "barracks", roomTypeId: "barracks",
    unlock: { kind: "battleWins", n: 25 } },
  { id: "exp-treasury", label: "Treasury Wing", emoji: "💎",
    rect: { x: 17, y: 13, w: 7, h: 6 }, zoneId: "treasury", roomTypeId: "treasury",
    unlock: { kind: "netWorth", n: 5_000 } },
  { id: "exp-workshop", label: "Workshop Wing", emoji: "🔧",
    rect: { x: 25, y: 13, w: 6, h: 6 }, zoneId: "workshop", roomTypeId: "workshop",
    unlock: { kind: "accountLevel", n: 12 } },
  { id: "exp-research", label: "Research Lab", emoji: "🔬",
    rect: { x: 25, y: 5, w: 6, h: 7 }, zoneId: "atrium", roomTypeId: "atrium",
    unlock: { kind: "collectionUnique", n: 25 } },
  { id: "exp-war-room", label: "War Room", emoji: "🗺️",
    rect: { x: 17, y: 1, w: 7, h: 4 }, zoneId: "hall-of-fame", roomTypeId: "hall-of-fame",
    unlock: { kind: "accountLevel", n: 15 } },
  { id: "exp-storage", label: "Storage Room", emoji: "📦",
    rect: { x: 1, y: 1, w: 7, h: 4 }, zoneId: "storage", roomTypeId: "storage",
    unlock: { kind: "accountLevel", n: 8 } },
  { id: "exp-arcane", label: "Arcane Vault", emoji: "🔮",
    rect: { x: 9, y: 1, w: 7, h: 4 }, zoneId: "arcane-vault", roomTypeId: "arcane-vault",
    unlock: { kind: "accountLevel", n: 18 } },
];

/**
 * Starter continuous HQ:
 * Command Center ↔ Hallway ↔ Trophy Hall, with a south stub hallway for wings.
 */
export function createDefaultFloorplan(): FloorplanState {
  const cc = zone("entrance", "entrance", "Command Center", "🎛️", { x: 2, y: 5, w: 8, h: 8 }, true);
  const hall = zone("hallway-main", "hallway", "Main Hallway", "🚪", { x: 10, y: 7, w: 5, h: 4 }, true);
  const trophy = zone("trophy-hall", "trophy-hall", "Trophy Hall", "🏆", { x: 15, y: 5, w: 8, h: 8 }, true);
  const hallS = zone("hallway-south", "hallway", "South Hallway", "🚪", { x: 10, y: 11, w: 5, h: 2 }, true);

  // Door openings between CC↔Hall, Hall↔Trophy, Hall↔South
  const doorCC = vEdge(10, 8);       // shared CC east / hall west
  const doorTrophy = vEdge(15, 8);   // hall east / trophy west
  const doorSouth = hEdge(12, 11);   // hall south into south hallway

  const skip = new Set<string>([doorCC, doorTrophy, doorSouth]);
  // Also skip shared internal edges between hall and south hall so they merge
  for (let x = 10; x < 15; x++) skip.add(hEdge(x, 11));

  const walls: FloorplanWall[] = [
    ...boxWalls(cc.rect, skip, "exterior"),
    ...boxWalls(hall.rect, skip, "interior"),
    ...boxWalls(trophy.rect, skip, "exterior"),
    ...boxWalls(hallS.rect, skip, "interior"),
  ];
  // Deduplicate wall keys
  const seen = new Set<string>();
  const dedup: FloorplanWall[] = [];
  for (const w of walls) {
    if (seen.has(w.key)) continue;
    seen.add(w.key);
    dedup.push(w);
  }

  const openings: FloorplanOpening[] = [
    opening(doorCC, "door", "entrance", "hallway-main"),
    opening(doorTrophy, "door", "hallway-main", "trophy-hall"),
    opening(doorSouth, "archway", "hallway-main", "hallway-south"),
  ];

  // Reserved (locked) expansion parcels — walls drawn dashed/dim until claimed
  const lockedZones: FloorplanZone[] = FLOORPLAN_EXPANSIONS.map(e =>
    zone(e.zoneId, e.roomTypeId, e.label, e.emoji, e.rect, false),
  );

  return {
    version: 1,
    width: FLOORPLAN_W,
    height: FLOORPLAN_H,
    floor: 0,
    walls: dedup,
    openings,
    zones: [cc, hall, trophy, hallS, ...lockedZones],
    claimedExpansions: [],
    focusZoneId: "entrance",
  };
}

/** Special room-type for corridors (not in HQ_ROOMS bonuses list). */
export const HALLWAY_ROOM_TYPE = "hallway";

export function isHallwayType(roomTypeId: string): boolean {
  return roomTypeId === HALLWAY_ROOM_TYPE || roomTypeId.startsWith("hallway");
}
