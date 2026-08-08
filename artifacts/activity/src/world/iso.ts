// ─────────────────────────────────────────────────────────────────────────────
// Isometric world math. One tile = TILE_W × TILE_H on screen (2:1 diamond).
// Tile (0,0) sits at world origin; +x goes down-right, +y goes down-left.
//
// Depth sorting is the whole game of an iso renderer: everything is drawn into a
// single container and given a depth so nearer-the-camera things overlap farther
// ones. We key depth off the tile's front corner (x + y), with small per-layer
// biases so a floor never draws over the prop standing on it.
// ─────────────────────────────────────────────────────────────────────────────

export const TILE_W = 128;
export const TILE_H = 64;
export const HALF_W = TILE_W / 2;
export const HALF_H = TILE_H / 2;

export interface Point {
  x: number;
  y: number;
}

/** Tile coords → screen coords (centre of the tile diamond). */
export function tileToScreen(tx: number, ty: number): Point {
  return {
    x: (tx - ty) * HALF_W,
    y: (tx + ty) * HALF_H,
  };
}

/** Screen coords → fractional tile coords (inverse of tileToScreen). */
export function screenToTile(sx: number, sy: number): Point {
  const tx = (sx / HALF_W + sy / HALF_H) / 2;
  const ty = (sy / HALF_H - sx / HALF_W) / 2;
  return { x: tx, y: ty };
}

/** Snap fractional tile coords to the nearest whole tile. */
export function snapTile(p: Point): Point {
  return { x: Math.floor(p.x), y: Math.floor(p.y) };
}

// Depth layers. Larger = drawn on top. Ground stays under everything; objects
// interleave by their tile position so the painter's-algorithm order is correct.
export const DEPTH = {
  GROUND: 0,
  FLOOR: 1_000,
  SHADOW: 5_000,
  WALL_BACK: 8_000,
  OBJECT: 10_000,
  WALL_FRONT: 4_000_000,
  FX: 6_000_000,
  UI: 9_000_000,
} as const;

/**
 * Depth for a thing occupying the tile-rect [x..x+w-1, y..y+h-1] at a layer.
 * Uses the FRONT corner (max x+y) so tall props sort in front of what's behind.
 */
export function depthFor(x: number, y: number, w = 1, h = 1, layer: number = DEPTH.OBJECT): number {
  const front = (x + w - 1) + (y + h - 1);
  return layer + front * 10 + (layer === DEPTH.OBJECT ? 0 : 0);
}
