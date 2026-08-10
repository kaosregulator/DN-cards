// ─────────────────────────────────────────────────────────────────────────────
// HQ — room SUITES ("the mini hotel").
//
// A suite is one LANDSCAPE rectangular subfloor carved into several sub-rooms,
// drawn in isometric with real stone walls, doorways and wall-mounted fittings.
// It replaces the old "one square room at a time" mental model: a player's HQ
// interior is a floor of connected rooms they walk between, like a hotel floor.
//
// The important idea here is that WALLS ARE DERIVED, never hand-authored. A
// layout only declares its rooms as rectangles; `suiteWalls()` works out the
// perimeter, the shared partitions between neighbouring rooms, and where the
// openings punch through. That's what makes "build your own" viable — a player
// drags a room's rectangle around and the masonry re-solves itself, with no way
// to author a floor that has a hole in its outer wall or a door to nowhere.
//
// Data only: no canvas, no DB. The renderer (render-room-suite.ts) turns this
// into sprites; the hub turns it into buttons.
// ─────────────────────────────────────────────────────────────────────────────

/** The three ways a player can start a floor. */
export type SuitePresetId = "empty" | "rooms" | "custom";

export interface SuiteRect { x: number; y: number; w: number; h: number }

/** Floor material for a sub-room — maps to a `bases/<key>.png` sprite. */
export type SuiteFloor = "stone" | "stone-detail" | "wood" | "grass" | "dirt";

export interface SuiteRoom {
  /** Unique within the layout. */
  id: string;
  /** Maps to an HQ_ROOMS id ("command"/"treasury"/…) or "hallway". */
  roomTypeId: string;
  label: string;
  rect: SuiteRect;
  floor: SuiteFloor;
}

/** Which way a wall segment runs, in suite-grid space. */
export type SuiteAxis = "n" | "w";

/** What a wall segment is. `plain` is solid masonry; the rest are openings. */
export type SuiteWallKind =
  | "plain" | "aged" | "broken"
  | "door" | "door-open" | "archway" | "gate-open"
  | "window" | "window-bars" | "column" | "half";

export interface SuiteWall {
  axis: SuiteAxis;
  x: number;
  y: number;
  kind: SuiteWallKind;
  /** True for the floor's outer shell (vs an interior partition). */
  exterior: boolean;
}

/** A hand-placed opening that overrides the derived `plain` masonry. */
export interface SuiteOpening {
  axis: SuiteAxis;
  x: number;
  y: number;
  kind: SuiteWallKind;
}

/**
 * Something placed in the suite. `floor` items stand on a tile; `wall` items
 * hang on the wall segment behind that tile (banners, torches, shelves), which
 * is what stops a room reading as furniture floating in an empty box.
 */
export interface SuiteItem {
  gx: number;
  gy: number;
  /** Sprite key under assets/hq (e.g. "furniture/table-round-chairs.png"). */
  sprite: string;
  /**
   * `rug` lies flat on the tile and is painted UNDER the furniture, so a table
   * can stand on it; `floor` stands on the tile; `wall` hangs on the tile's far
   * wall (banners, fittings) so the masonry isn't bare.
   */
  mount: "floor" | "wall" | "rug";
  /** For wall mounts: which wall of the tile it hangs on. */
  face?: SuiteAxis;
  /** Pixels to raise the sprite — wall fittings hang above the floor. */
  lift?: number;
  /** Draw scale, 1 = the sprite's natural tile size. */
  scale?: number;
  label?: string;
}

export interface SuiteLayout {
  id: SuitePresetId;
  name: string;
  emoji: string;
  blurb: string;
  cols: number;
  rows: number;
  rooms: SuiteRoom[];
  openings: SuiteOpening[];
  items: SuiteItem[];
}

// ── Geometry helpers ─────────────────────────────────────────────────────────

export const suiteKey = (axis: SuiteAxis, x: number, y: number): string => `${axis}:${x}:${y}`;

export function rectContains(r: SuiteRect, x: number, y: number): boolean {
  return x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h;
}

/** The room occupying a tile, if any. */
export function roomAt(layout: SuiteLayout, x: number, y: number): SuiteRoom | null {
  for (const r of layout.rooms) if (rectContains(r.rect, x, y)) return r;
  return null;
}

/**
 * Solve the masonry for a layout.
 *
 * A wall exists on a tile edge wherever the room on one side differs from the
 * room on the other — that single rule yields both the outer shell (room vs
 * nothing) and the partitions between neighbours (room A vs room B), so the
 * walls can never disagree with the rooms. Declared openings are then stamped
 * over the top, and any opening that doesn't land on a real wall is ignored
 * rather than drawn floating in mid-air.
 */
export function suiteWalls(layout: SuiteLayout): SuiteWall[] {
  const walls = new Map<string, SuiteWall>();
  const idAt = (x: number, y: number): string | null => roomAt(layout, x, y)?.id ?? null;

  for (let y = 0; y <= layout.rows; y++) {
    for (let x = 0; x <= layout.cols; x++) {
      const here = idAt(x, y);
      // North edge: this tile vs the one above it.
      const above = idAt(x, y - 1);
      if (here !== above && (here || above)) {
        const exterior = !here || !above;
        // Interior partitions are HALF height. A full-height partition is drawn
        // nearer the camera than the room behind it, so it would bury that
        // room's floor and furniture; a low wall still reads as a division
        // while leaving both rooms visible. The outer shell stays full height
        // because nothing sits behind it.
        walls.set(suiteKey("n", x, y), { axis: "n", x, y, kind: exterior ? "plain" : "half", exterior });
      }
      // West edge: this tile vs the one to its left.
      const left = idAt(x - 1, y);
      if (here !== left && (here || left)) {
        const exterior = !here || !left;
        walls.set(suiteKey("w", x, y), { axis: "w", x, y, kind: exterior ? "plain" : "half", exterior });
      }
    }
  }

  for (const o of layout.openings) {
    const k = suiteKey(o.axis, o.x, o.y);
    const w = walls.get(k);
    if (w) w.kind = o.kind; // never invent a wall just to hold an opening
  }
  return [...walls.values()];
}

/** Tiles that belong to no room — the void a "build your own" floor can fill. */
export function emptyTiles(layout: SuiteLayout): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = [];
  for (let y = 0; y < layout.rows; y++) {
    for (let x = 0; x < layout.cols; x++) if (!roomAt(layout, x, y)) out.push({ x, y });
  }
  return out;
}

/** True when two rooms overlap — the check a room editor must run before saving. */
export function rectsOverlap(a: SuiteRect, b: SuiteRect): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

/** Every reason a layout is invalid (empty = good). Used by the editor + tests. */
export function validateSuite(layout: SuiteLayout): string[] {
  const errs: string[] = [];
  const seen = new Set<string>();
  for (const r of layout.rooms) {
    if (seen.has(r.id)) errs.push(`duplicate room id "${r.id}"`);
    seen.add(r.id);
    if (r.rect.w < 1 || r.rect.h < 1) errs.push(`room "${r.id}" has no area`);
    if (r.rect.x < 0 || r.rect.y < 0 ||
        r.rect.x + r.rect.w > layout.cols || r.rect.y + r.rect.h > layout.rows) {
      errs.push(`room "${r.id}" falls outside the floor`);
    }
  }
  for (let i = 0; i < layout.rooms.length; i++) {
    for (let j = i + 1; j < layout.rooms.length; j++) {
      const a = layout.rooms[i]!, b = layout.rooms[j]!;
      if (rectsOverlap(a.rect, b.rect)) errs.push(`rooms "${a.id}" and "${b.id}" overlap`);
    }
  }
  // An opening must sit on a real wall, or the floor would have a doorway in
  // open air.
  const wallKeys = new Set(suiteWalls({ ...layout, openings: [] }).map(w => suiteKey(w.axis, w.x, w.y)));
  for (const o of layout.openings) {
    if (!wallKeys.has(suiteKey(o.axis, o.x, o.y))) {
      errs.push(`opening at ${suiteKey(o.axis, o.x, o.y)} is not on a wall`);
    }
  }
  return errs;
}

// ── The three presets ────────────────────────────────────────────────────────
// Every preset is the SAME landscape footprint, so switching between them never
// resizes the floor under the player — only what's built on it changes.

export const SUITE_COLS = 12;
export const SUITE_ROWS = 7;

/** 1 — EMPTY: the bare subfloor, walls only around the outside. */
function emptySuite(): SuiteLayout {
  return {
    id: "empty",
    name: "Empty Floor",
    emoji: "⬛",
    blurb: "A bare landscape floor inside four walls. Build every room yourself.",
    cols: SUITE_COLS, rows: SUITE_ROWS,
    rooms: [{
      id: "floor", roomTypeId: "atrium", label: "Open Floor",
      rect: { x: 0, y: 0, w: SUITE_COLS, h: SUITE_ROWS }, floor: "stone",
    }],
    openings: [
      { axis: "n", x: 5, y: 0, kind: "window" },
      { axis: "n", x: 8, y: 0, kind: "window" },
      { axis: "w", x: 0, y: 3, kind: "gate-open" },
    ],
    items: [
      { gx: 1, gy: 1, sprite: "furniture/supply-crates.png", mount: "floor", label: "Crates" },
      { gx: 10, gy: 5, sprite: "furniture/barrels.png", mount: "floor", label: "Barrels" },
    ],
  };
}

/** 2 — ROOMS: the ready-made hotel floor. A main hall plus mini side rooms. */
function roomsSuite(): SuiteLayout {
  return {
    id: "rooms",
    name: "Furnished Rooms",
    emoji: "🏨",
    blurb: "A ready-made floor: a command hall down the middle, with a vault, barracks, workshop and quarters off it.",
    cols: SUITE_COLS, rows: SUITE_ROWS,
    rooms: [
      // The dominant hall the floor is built around.
      { id: "command", roomTypeId: "atrium", label: "Command Hall", rect: { x: 0, y: 0, w: 6, h: 5 }, floor: "stone-detail" },
      // A corridor joining everything, so no room is a dead end.
      { id: "hall", roomTypeId: "entrance", label: "Corridor", rect: { x: 0, y: 5, w: 12, h: 2 }, floor: "stone" },
      // Mini side rooms.
      { id: "vault", roomTypeId: "treasury", label: "Vault", rect: { x: 6, y: 0, w: 3, h: 3 }, floor: "stone-detail" },
      { id: "barracks", roomTypeId: "barracks", label: "Barracks", rect: { x: 9, y: 0, w: 3, h: 3 }, floor: "wood" },
      { id: "workshop", roomTypeId: "workshop", label: "Workshop", rect: { x: 6, y: 3, w: 6, h: 2 }, floor: "wood" },
    ],
    openings: [
      // Hall ↔ corridor, and every side room onto the corridor or the hall.
      { axis: "n", x: 2, y: 5, kind: "archway" },
      { axis: "n", x: 7, y: 5, kind: "door-open" },
      { axis: "n", x: 10, y: 5, kind: "door-open" },
      { axis: "w", x: 6, y: 1, kind: "gate-open" },   // hall → vault
      { axis: "w", x: 9, y: 1, kind: "door-open" },   // vault → barracks
      { axis: "n", x: 7, y: 3, kind: "archway" },     // vault → workshop
      { axis: "n", x: 10, y: 3, kind: "door-open" },  // barracks → workshop
      // Daylight in the outer shell.
      { axis: "n", x: 2, y: 0, kind: "window" },
      { axis: "n", x: 4, y: 0, kind: "window" },
      { axis: "n", x: 10, y: 0, kind: "window-bars" },
      { axis: "w", x: 0, y: 2, kind: "window" },
      { axis: "w", x: 0, y: 6, kind: "gate-open" },   // the way in
    ],
    items: [
      // Command hall — a red command rug under the war table, the way the
      // reference art anchors its centrepiece, with columns framing it.
      { gx: 2, gy: 2, sprite: "furniture/command-rug.png", mount: "rug", scale: 1.5, label: "Command Rug" },
      { gx: 2, gy: 2, sprite: "furniture/table-round-items.png", mount: "floor", label: "War Table" },
      { gx: 1, gy: 1, sprite: "furniture/table-short-chairs.png", mount: "floor", label: "Briefing Table" },
      { gx: 4, gy: 3, sprite: "furniture/chair.png", mount: "floor", label: "Officer's Chair" },
      { gx: 0, gy: 4, sprite: "furniture/stone-column.png", mount: "floor", label: "Column" },
      { gx: 5, gy: 0, sprite: "furniture/stone-column-wood.png", mount: "floor", label: "Column" },
      { gx: 1, gy: 0, sprite: "medals/laurel-wreath.png", mount: "wall", face: "n", label: "Laurel Crest" },
      { gx: 3, gy: 0, sprite: "medals/veteran-medals.png", mount: "wall", face: "n", label: "Veteran Medals" },
      // Vault — treasure on a gold runner.
      { gx: 7, gy: 1, sprite: "furniture/vault-rug.png", mount: "rug", scale: 1.3, label: "Vault Runner" },
      { gx: 7, gy: 1, sprite: "furniture/treasure-chest.png", mount: "floor", label: "Vault Chest" },
      { gx: 8, gy: 2, sprite: "furniture/treasure-chest-open.png", mount: "floor", label: "Open Chest" },
      { gx: 7, gy: 0, sprite: "medals/sovereign-crown.png", mount: "wall", face: "n", label: "Sovereign Crown" },
      // Barracks.
      { gx: 10, gy: 1, sprite: "furniture/woven-rug.png", mount: "rug", scale: 1.3, label: "Mess Rug" },
      { gx: 10, gy: 1, sprite: "furniture/table-round-chairs.png", mount: "floor", label: "Mess Table" },
      { gx: 11, gy: 2, sprite: "furniture/barrel.png", mount: "floor", label: "Barrel" },
      { gx: 10, gy: 0, sprite: "medals/collectors-crest.png", mount: "wall", face: "n", label: "Company Crest" },
      // Workshop.
      { gx: 7, gy: 4, sprite: "furniture/supply-crates.png", mount: "floor", label: "Crates" },
      { gx: 9, gy: 3, sprite: "furniture/log-pile.png", mount: "floor", label: "Timber" },
      { gx: 11, gy: 4, sprite: "furniture/barrels-stacked-tall.png", mount: "floor", label: "Stores" },
      // Corridor dressing — a runner down the middle and a crate against a wall.
      { gx: 2, gy: 5, sprite: "furniture/royal-runner.png", mount: "rug", scale: 1.35, label: "Runner" },
      { gx: 5, gy: 5, sprite: "furniture/royal-runner.png", mount: "rug", scale: 1.35, label: "Runner" },
      { gx: 3, gy: 6, sprite: "furniture/supply-crate.png", mount: "floor", label: "Crate" },
    ],
  };
}

/** 3 — CUSTOM: a starter shell with room to grow, for players who want to build. */
function customSuite(): SuiteLayout {
  return {
    id: "custom",
    name: "Build Your Own",
    emoji: "🛠️",
    blurb: "A starter hall and corridor. The rest of the floor is yours — add, move and resize rooms.",
    cols: SUITE_COLS, rows: SUITE_ROWS,
    rooms: [
      { id: "command", roomTypeId: "atrium", label: "Command Hall", rect: { x: 0, y: 0, w: 5, h: 4 }, floor: "stone-detail" },
      { id: "hall", roomTypeId: "entrance", label: "Corridor", rect: { x: 0, y: 4, w: 12, h: 2 }, floor: "stone" },
    ],
    openings: [
      { axis: "n", x: 2, y: 4, kind: "archway" },
      { axis: "n", x: 2, y: 0, kind: "window" },
      { axis: "w", x: 0, y: 5, kind: "gate-open" },
    ],
    items: [
      { gx: 2, gy: 2, sprite: "furniture/table-round-items.png", mount: "floor", label: "War Table" },
      { gx: 4, gy: 0, sprite: "furniture/stone-column.png", mount: "floor", label: "Column" },
      { gx: 6, gy: 5, sprite: "furniture/supply-crates.png", mount: "floor", label: "Building Stock" },
      { gx: 9, gy: 4, sprite: "furniture/barrels.png", mount: "floor", label: "Building Stock" },
    ],
  };
}

export const SUITE_PRESETS: Record<SuitePresetId, () => SuiteLayout> = {
  empty: emptySuite,
  rooms: roomsSuite,
  custom: customSuite,
};

export const SUITE_PRESET_IDS: SuitePresetId[] = ["rooms", "empty", "custom"];

/** Build a preset, falling back to the furnished floor for an unknown id. */
export function suitePreset(id: string | null | undefined): SuiteLayout {
  const make = SUITE_PRESETS[(id as SuitePresetId)] ?? SUITE_PRESETS.rooms;
  return make();
}

/** Floor material → the base sprite that paints it. */
export function suiteFloorSprite(floor: SuiteFloor): string {
  switch (floor) {
    case "stone-detail": return "bases/square-stone-detail.png";
    case "wood": return "bases/square-wood.png";
    case "grass": return "bases/square-grass.png";
    case "dirt": return "bases/square-dirt.png";
    default: return "bases/square-stone.png";
  }
}

/** Wall kind → sprite, per facing. `-e` art is the perpendicular run. */
export function suiteWallSprite(kind: SuiteWallKind, axis: SuiteAxis): string {
  return axis === "n" ? `roomwall/${kind}.png` : `roomwall/${kind}-e.png`;
}
