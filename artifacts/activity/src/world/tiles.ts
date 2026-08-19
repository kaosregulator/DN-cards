// ─────────────────────────────────────────────────────────────────────────────
// Procedural tileset — every world tile is drawn into a texture at runtime, so
// the world needs ZERO external image files (Discord's iframe CSP blocks other
// hosts, and bundling a tileset PNG would bloat the activity). Each tile is
// generated once per game and cached in Phaser's texture manager.
//
// Tile art is deliberately Game-Boy-ish: flat colours, a dark outline, and a
// little dithered texture so large areas don't read as plain rectangles.
// ─────────────────────────────────────────────────────────────────────────────

import Phaser from "phaser";

export const TILE = 32;

export type TileKind =
  | "grass" | "grass2" | "path" | "water" | "tree" | "wall" | "brick"
  | "roof" | "door" | "floor" | "rug" | "counter" | "shelf" | "sand"
  | "flower" | "fence" | "stone" | "carpet" | "void";

/** Tiles a walker cannot step on. */
export const SOLID: ReadonlySet<TileKind> = new Set<TileKind>([
  "water", "tree", "wall", "brick", "roof", "counter", "shelf", "fence", "void",
]);

export const TILE_KEY = (k: TileKind): string => `tile:${k}`;

interface Palette { base: number; alt: number; dark: number; light: number; }

const PALETTES: Record<TileKind, Palette> = {
  grass:   { base: 0x2f6b3d, alt: 0x357a45, dark: 0x24552f, light: 0x47955a },
  grass2:  { base: 0x357a45, alt: 0x3f8a50, dark: 0x2a6338, light: 0x4fa063 },
  path:    { base: 0x8d7a55, alt: 0x9a8760, dark: 0x6f5f41, light: 0xa89468 },
  sand:    { base: 0xc2ab74, alt: 0xcdb681, dark: 0x9d8a5c, light: 0xdcc793 },
  water:   { base: 0x2a5aa8, alt: 0x336bc4, dark: 0x1e4380, light: 0x4a85d8 },
  tree:    { base: 0x1e5e34, alt: 0x27713f, dark: 0x143f23, light: 0x368a4f },
  wall:    { base: 0x4a4f6b, alt: 0x555b7a, dark: 0x33374d, light: 0x6a7192 },
  brick:   { base: 0x7a4a4a, alt: 0x8a5555, dark: 0x5a3535, light: 0x9c6767 },
  roof:    { base: 0x6b3f8f, alt: 0x7a4aa0, dark: 0x4d2d68, light: 0x9160b8 },
  door:    { base: 0x8a6a3a, alt: 0x9c7a45, dark: 0x5f4826, light: 0xb08e55 },
  floor:   { base: 0x5b4a6b, alt: 0x66547a, dark: 0x42354e, light: 0x7a6690 },
  carpet:  { base: 0x8f3f5a, alt: 0xa04a68, dark: 0x682d42, light: 0xb56080 },
  rug:     { base: 0x3f6b8f, alt: 0x4a7aa0, dark: 0x2d4d68, light: 0x60a0c8 },
  counter: { base: 0x9c7a45, alt: 0xb08e55, dark: 0x6f5730, light: 0xc9a86e },
  shelf:   { base: 0x6b4a2f, alt: 0x7a5738, dark: 0x4d3520, light: 0x8f6b47 },
  fence:   { base: 0x7a6547, alt: 0x8a7355, dark: 0x574833, light: 0x9c8767 },
  stone:   { base: 0x6a6f7d, alt: 0x767c8c, dark: 0x4d515c, light: 0x8b91a3 },
  flower:  { base: 0x2f6b3d, alt: 0x357a45, dark: 0x24552f, light: 0xe0679a },
  void:    { base: 0x0a0d16, alt: 0x0d1120, dark: 0x05070f, light: 0x141a2e },
};

function hex(n: number): number { return n; }

/** Draw every tile texture once. Safe to call repeatedly (skips existing). */
export function ensureTileTextures(scene: Phaser.Scene): void {
  (Object.keys(PALETTES) as TileKind[]).forEach((kind) => {
    const key = TILE_KEY(kind);
    if (scene.textures.exists(key)) return;
    const g = scene.make.graphics({ x: 0, y: 0 }, false);
    drawTile(g, kind, PALETTES[kind]);
    g.generateTexture(key, TILE, TILE);
    g.destroy();
  });
}

function drawTile(g: Phaser.GameObjects.Graphics, kind: TileKind, p: Palette): void {
  // Base fill.
  g.fillStyle(hex(p.base), 1);
  g.fillRect(0, 0, TILE, TILE);

  switch (kind) {
    case "grass":
    case "grass2": {
      // Scattered blades.
      g.fillStyle(hex(p.dark), 1);
      for (const [x, y] of [[5, 7], [18, 4], [26, 14], [9, 21], [21, 26], [3, 17]]) {
        g.fillRect(x, y, 2, 3);
      }
      g.fillStyle(hex(p.light), 0.5);
      for (const [x, y] of [[13, 11], [24, 22], [7, 27]]) g.fillRect(x, y, 2, 2);
      break;
    }
    case "flower": {
      g.fillStyle(hex(p.dark), 1);
      for (const [x, y] of [[5, 7], [26, 14], [9, 21]]) g.fillRect(x, y, 2, 3);
      // Blossoms.
      for (const [x, y] of [[14, 12], [22, 20], [7, 24]]) {
        g.fillStyle(hex(p.light), 1);
        g.fillRect(x, y, 4, 4);
        g.fillStyle(0xffe08a, 1);
        g.fillRect(x + 1, y + 1, 2, 2);
      }
      break;
    }
    case "path":
    case "sand":
    case "stone": {
      g.fillStyle(hex(p.alt), 1);
      g.fillRect(0, 0, TILE, 2); g.fillRect(0, 0, 2, TILE);
      g.fillStyle(hex(p.dark), 0.5);
      for (const [x, y] of [[6, 9], [20, 6], [12, 20], [25, 24]]) g.fillRect(x, y, 3, 2);
      break;
    }
    case "water": {
      g.fillStyle(hex(p.light), 0.55);
      g.fillRect(3, 7, 12, 2); g.fillRect(18, 16, 10, 2); g.fillRect(6, 24, 9, 2);
      g.fillStyle(hex(p.dark), 0.5);
      g.fillRect(15, 11, 9, 2); g.fillRect(4, 19, 7, 2);
      break;
    }
    case "tree": {
      // Grass under the canopy.
      const gp = PALETTES.grass;
      g.fillStyle(hex(gp.base), 1); g.fillRect(0, 0, TILE, TILE);
      // Trunk.
      g.fillStyle(0x4d3520, 1); g.fillRect(14, 20, 5, 10);
      // Canopy.
      g.fillStyle(hex(p.base), 1); g.fillCircle(16, 15, 12);
      g.fillStyle(hex(p.light), 1); g.fillCircle(12, 11, 6);
      g.fillStyle(hex(p.dark), 1); g.fillCircle(22, 19, 5);
      break;
    }
    case "wall":
    case "brick": {
      g.fillStyle(hex(p.dark), 1);
      // Brick courses.
      for (let y = 0; y < TILE; y += 8) g.fillRect(0, y, TILE, 1);
      for (let y = 0; y < TILE; y += 16) { g.fillRect(10, y, 1, 8); g.fillRect(26, y, 1, 8); }
      for (let y = 8; y < TILE; y += 16) { g.fillRect(2, y, 1, 8); g.fillRect(18, y, 1, 8); }
      g.fillStyle(hex(p.light), 0.25); g.fillRect(0, 0, TILE, 2);
      break;
    }
    case "roof": {
      g.fillStyle(hex(p.dark), 1);
      for (let y = 0; y < TILE; y += 8) g.fillRect(0, y, TILE, 2);
      g.fillStyle(hex(p.light), 0.4);
      for (let y = 2; y < TILE; y += 8) g.fillRect(0, y, TILE, 1);
      break;
    }
    case "door": {
      // Frame + panel + knob.
      g.fillStyle(hex(p.dark), 1); g.fillRect(0, 0, TILE, TILE);
      g.fillStyle(hex(p.base), 1); g.fillRect(4, 3, TILE - 8, TILE - 3);
      g.fillStyle(hex(p.light), 1); g.fillRect(6, 6, TILE - 12, 10);
      g.fillStyle(0xffe08a, 1); g.fillCircle(23, 20, 2);
      break;
    }
    case "floor":
    case "carpet":
    case "rug": {
      g.fillStyle(hex(p.dark), 1);
      g.fillRect(0, 0, TILE, 1); g.fillRect(0, 0, 1, TILE);
      g.fillStyle(hex(p.alt), 1);
      g.fillRect(4, 4, TILE - 8, TILE - 8);
      g.fillStyle(hex(p.light), 0.35);
      g.fillRect(8, 8, TILE - 16, TILE - 16);
      break;
    }
    case "counter": {
      g.fillStyle(hex(p.dark), 1); g.fillRect(0, 0, TILE, TILE);
      g.fillStyle(hex(p.base), 1); g.fillRect(0, 4, TILE, TILE - 8);
      g.fillStyle(hex(p.light), 1); g.fillRect(0, 4, TILE, 3);
      break;
    }
    case "shelf": {
      g.fillStyle(hex(p.dark), 1); g.fillRect(0, 0, TILE, TILE);
      g.fillStyle(hex(p.base), 1); g.fillRect(2, 2, TILE - 4, TILE - 4);
      // Card spines on the shelf.
      const spines = [0xc94f4f, 0x4f7fc9, 0x59b06a, 0xc9a24f, 0x9b5cc9];
      for (let i = 0; i < 5; i++) {
        g.fillStyle(spines[i]!, 1);
        g.fillRect(4 + i * 5, 5, 4, 9);
        g.fillStyle(spines[(i + 2) % 5]!, 1);
        g.fillRect(4 + i * 5, 18, 4, 9);
      }
      break;
    }
    case "fence": {
      const gp = PALETTES.grass;
      g.fillStyle(hex(gp.base), 1); g.fillRect(0, 0, TILE, TILE);
      g.fillStyle(hex(p.base), 1);
      g.fillRect(0, 12, TILE, 4); g.fillRect(0, 20, TILE, 3);
      g.fillRect(6, 8, 4, 20); g.fillRect(22, 8, 4, 20);
      g.fillStyle(hex(p.dark), 1); g.fillRect(0, 15, TILE, 1);
      break;
    }
    case "void": break;
  }
  // Subtle tile seam so the grid reads.
  g.fillStyle(0x000000, 0.10);
  g.fillRect(0, TILE - 1, TILE, 1);
  g.fillRect(TILE - 1, 0, 1, TILE);
}

// ── Character sprites ────────────────────────────────────────────────────────
// Simple 4-direction walkers, also generated procedurally. Each character gets
// a 4×2 sheet: 4 facings × 2 walk frames.

export interface CharColors { body: number; trim: number; skin: number; hair: number; }

export const CHAR_KEY = (name: string): string => `char:${name}`;

export function ensureCharTexture(scene: Phaser.Scene, name: string, c: CharColors): void {
  const key = CHAR_KEY(name);
  if (scene.textures.exists(key)) return;
  const W = 24, H = 32;
  const g = scene.make.graphics({ x: 0, y: 0 }, false);
  // 4 facings (down, left, right, up) × 2 frames.
  for (let dir = 0; dir < 4; dir++) {
    for (let f = 0; f < 2; f++) {
      const ox = (dir * 2 + f) * W;
      drawChar(g, ox, 0, W, H, dir, f, c);
    }
  }
  g.generateTexture(key, W * 8, H);
  g.destroy();
  // Register as a spritesheet so frames are addressable.
  const tex = scene.textures.get(key);
  for (let i = 0; i < 8; i++) tex.add(i, 0, i * W, 0, W, H);
}

function drawChar(
  g: Phaser.GameObjects.Graphics, ox: number, oy: number, _w: number, _h: number,
  dir: number, frame: number, c: CharColors,
): void {
  const bob = frame === 1 ? 1 : 0;
  // Shadow.
  g.fillStyle(0x000000, 0.28);
  g.fillEllipse(ox + 12, oy + 29, 16, 5);
  // Legs (alternate on frame).
  g.fillStyle(0x2a2f45, 1);
  if (frame === 0) { g.fillRect(ox + 7, oy + 23, 4, 6); g.fillRect(ox + 13, oy + 23, 4, 6); }
  else { g.fillRect(ox + 6, oy + 23, 4, 6); g.fillRect(ox + 14, oy + 23, 4, 6); }
  // Body.
  g.fillStyle(c.body, 1);
  g.fillRect(ox + 6, oy + 13 + bob, 12, 11);
  g.fillStyle(c.trim, 1);
  g.fillRect(ox + 6, oy + 20 + bob, 12, 2);
  // Arms.
  g.fillStyle(c.body, 1);
  g.fillRect(ox + 3, oy + 14 + bob, 3, 8);
  g.fillRect(ox + 18, oy + 14 + bob, 3, 8);
  // Head.
  g.fillStyle(c.skin, 1);
  g.fillRect(ox + 7, oy + 4 + bob, 10, 10);
  // Hair by facing.
  g.fillStyle(c.hair, 1);
  g.fillRect(ox + 6, oy + 2 + bob, 12, 4);
  if (dir === 3) g.fillRect(ox + 6, oy + 2 + bob, 12, 11); // back of head (facing up)
  // Eyes (not when facing up).
  if (dir !== 3) {
    g.fillStyle(0x141a2e, 1);
    if (dir === 0) { g.fillRect(ox + 9, oy + 9 + bob, 2, 2); g.fillRect(ox + 14, oy + 9 + bob, 2, 2); }
    if (dir === 1) g.fillRect(ox + 8, oy + 9 + bob, 2, 2);
    if (dir === 2) g.fillRect(ox + 15, oy + 9 + bob, 2, 2);
  }
}

/** Frame index for a facing + walk frame. */
export function charFrame(dir: "down" | "left" | "right" | "up", frame: 0 | 1): number {
  const d = dir === "down" ? 0 : dir === "left" ? 1 : dir === "right" ? 2 : 3;
  return d * 2 + frame;
}
