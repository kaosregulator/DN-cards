// ─────────────────────────────────────────────────────────────────────────────
// Real tileset rendering. The Open RPG Fantasy tilesets (CC0, finalbossblues)
// give every terrain/floor tile hand-drawn pixel art. We bundle the sheets
// same-origin (public/world/, so Discord's CSP serves them as `img-src 'self'`
// files) and slice one 16×16 tile per world TileKind up to the 32px grid.
//
// This runs BEFORE the procedural ensureTileTextures(): each kind we map here
// claims TILE_KEY(kind) first, and the procedural pass then fills only the
// kinds we DON'T map (doors, roofs, fences, flowers, void) — so collision and
// every existing map keep working untouched, they just look real.
// ─────────────────────────────────────────────────────────────────────────────

import Phaser from "phaser";
import { TILE, TILE_KEY, type TileKind } from "./tiles";

const SHEET_URL: Record<string, string> = {
  "tiles-world": "tiles-world.png",
  "tiles-interior": "tiles-interior.png",
  "tiles-exterior": "tiles-exterior.png",
};
const SHEET_KEY = (name: string): string => `sheet:${name}`;
const assetUrl = (file: string): string => `${import.meta.env.BASE_URL}world/${file}`;
const SRC = 16;

interface Src { sheet: string; col: number; row: number; }

// Verified tile picks (col,row) within each 30×16 sheet.
const TILE_SRC: Partial<Record<TileKind, Src>> = {
  grass: { sheet: "tiles-world", col: 0, row: 8 },
  grass2: { sheet: "tiles-world", col: 1, row: 9 },
  water: { sheet: "tiles-world", col: 1, row: 3 },
  sand: { sheet: "tiles-world", col: 10, row: 1 },
  path: { sheet: "tiles-world", col: 7, row: 2 },
  brick: { sheet: "tiles-world", col: 12, row: 1 },
  roof: { sheet: "tiles-exterior", col: 15, row: 12 },
  wall: { sheet: "tiles-world", col: 14, row: 5 },
  stone: { sheet: "tiles-world", col: 14, row: 10 },
  tree: { sheet: "tiles-world", col: 1, row: 13 },
  floor: { sheet: "tiles-interior", col: 6, row: 5 },
  carpet: { sheet: "tiles-interior", col: 13, row: 13 },
  rug: { sheet: "tiles-interior", col: 9, row: 9 },
  counter: { sheet: "tiles-interior", col: 18, row: 6 },
  shelf: { sheet: "tiles-interior", col: 18, row: 1 },
};

/** Queue the bundled tileset sheets (call from a scene's preload()). */
export function preloadTilesets(scene: Phaser.Scene): void {
  for (const name of Object.keys(SHEET_URL)) {
    const key = SHEET_KEY(name);
    if (!scene.textures.exists(key)) scene.load.image(key, assetUrl(SHEET_URL[name]!));
  }
}

/**
 * Build a 32×32 texture for every mapped TileKind by slicing its tileset tile.
 * Skips kinds whose sheet didn't load (leaving them for the procedural pass)
 * and kinds whose key already exists. Safe to call repeatedly.
 */
export function buildTilesetTextures(scene: Phaser.Scene): void {
  for (const [kind, src] of Object.entries(TILE_SRC) as Array<[TileKind, Src]>) {
    const key = TILE_KEY(kind);
    if (scene.textures.exists(key)) continue;
    if (!scene.textures.exists(SHEET_KEY(src.sheet))) continue;
    const img = scene.textures.get(SHEET_KEY(src.sheet)).getSourceImage() as CanvasImageSource;
    const canvas = document.createElement("canvas");
    canvas.width = TILE;
    canvas.height = TILE;
    const ctx = canvas.getContext("2d");
    if (!ctx) continue;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(img, src.col * SRC, src.row * SRC, SRC, SRC, 0, 0, TILE, TILE);
    scene.textures.addCanvas(key, canvas);
  }
}
