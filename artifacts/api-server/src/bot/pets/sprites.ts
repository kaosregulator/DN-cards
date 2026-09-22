// Onocentaur egg spritesheet loader + blit helpers.
// Pack: https://onocentaur.itch.io/eggs (free commercial use, attribution appreciated)
// Layout (Colorful.png): 16×16 tiles, 13 cols × 34 rows.
// Each row = one egg design:
//   col 0–1  whole egg
//   col 2–4  smooth crack progression
//   col 5–6  top half / bottom half (smooth)
//   col 7–8  whole (pattern B start)
//   col 9–10 jagged crack
//   col 11–12 top / bottom halves (jagged)

import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { CanvasMod, Ctx } from "../animations/engine.js";
import { getCanvas } from "../animations/engine.js";
import type { PetSpecies } from "./engine.js";

export const EGG_TILE = 16;
export const EGG_COLS = 13;

/** Species → row index in Colorful.png (picked for thematic match). */
export const SPECIES_EGG_ROW: Record<PetSpecies, number> = {
  dragon: 4,   // fire / magma egg
  cat: 3,      // blue-spotted
  dog: 1,      // brown band
  hamster: 2,  // rainbow patch
};

type SheetImage = Awaited<ReturnType<CanvasMod["loadImage"]>>;
type TileCanvas = ReturnType<CanvasMod["createCanvas"]>;

let _sheet: SheetImage | null | undefined;
let _bg: SheetImage | null | undefined;
let _mod: CanvasMod | null = null;
const _tileCache = new Map<string, TileCanvas>();
const _frost = new Map<string, SheetImage | null>();

function assetsDir(): string | null {
  const candidates = [
    fileURLToPath(new URL("../../../assets/pets/", import.meta.url)),
    join(process.cwd(), "assets/pets"),
    join(process.cwd(), "artifacts/api-server/assets/pets"),
  ];
  for (const dir of candidates) {
    if (existsSync(join(dir, "eggs", "Colorful.png"))) return dir;
  }
  return null;
}

async function canvasMod(): Promise<CanvasMod | null> {
  if (_mod) return _mod;
  _mod = await getCanvas();
  return _mod;
}

export async function loadEggSheet(): Promise<SheetImage | null> {
  if (_sheet !== undefined) return _sheet;
  const mod = await canvasMod();
  const dir = assetsDir();
  if (!mod || !dir) {
    _sheet = null;
    return null;
  }
  try {
    _sheet = await mod.loadImage(join(dir, "eggs", "Colorful.png"));
  } catch {
    _sheet = null;
  }
  return _sheet;
}

export async function loadPetBackground(kind: "pink" | "blue" | "green" | "purple" = "pink") {
  if (_bg !== undefined) return _bg;
  const mod = await canvasMod();
  const dir = assetsDir();
  if (!mod || !dir) {
    _bg = null;
    return null;
  }
  const file = join(dir, "backgrounds", `${kind}.png`);
  if (!existsSync(file)) {
    _bg = null;
    return null;
  }
  try {
    _bg = await mod.loadImage(file);
  } catch {
    _bg = null;
  }
  return _bg;
}

export type EggFrame =
  | "idle"
  | "crack1"
  | "crack2"
  | "crack3"
  | "top"
  | "bottom"
  | "open";

/** Column index for a named frame (smooth crack pattern). */
export function eggCol(frame: EggFrame): number {
  switch (frame) {
    case "idle": return 0;
    case "crack1": return 2;
    case "crack2": return 3;
    case "crack3": return 4;
    case "top": return 5;
    case "bottom": return 6;
    case "open": return 5;
  }
}

/** Crack timeline 0→1 → frame name for hatch cinematic. */
export function eggFrameAt(t: number): EggFrame {
  if (t < 0.22) return "idle";
  if (t < 0.38) return "crack1";
  if (t < 0.52) return "crack2";
  if (t < 0.66) return "crack3";
  return "open";
}

function tileCanvas(sheet: SheetImage, row: number, col: number): TileCanvas | null {
  const key = `${row}:${col}`;
  const cached = _tileCache.get(key);
  if (cached) return cached;
  if (!_mod) return null;
  const c = _mod.createCanvas(EGG_TILE, EGG_TILE);
  const tctx = c.getContext("2d") as unknown as {
    drawImage: (...a: unknown[]) => void;
    imageSmoothingEnabled: boolean;
  };
  tctx.imageSmoothingEnabled = false;
  // Crop with 9-arg onto a tiny canvas (works reliably at 1:1), then scale that.
  tctx.drawImage(sheet, col * EGG_TILE, row * EGG_TILE, EGG_TILE, EGG_TILE, 0, 0, EGG_TILE, EGG_TILE);
  _tileCache.set(key, c);
  return c;
}

/** Draw a single egg tile scaled (nearest-neighbor). */
export function blitEggTile(
  ctx: Ctx,
  sheet: SheetImage,
  row: number,
  col: number,
  dx: number,
  dy: number,
  size: number,
): void {
  const tile = tileCanvas(sheet, row, col);
  const anyCtx = ctx as unknown as {
    drawImage: (...a: unknown[]) => void;
    imageSmoothingEnabled?: boolean;
  };
  const prev = anyCtx.imageSmoothingEnabled;
  anyCtx.imageSmoothingEnabled = false;
  if (tile) {
    anyCtx.drawImage(tile, dx, dy, size, size);
  } else {
    // Last resort 9-arg
    anyCtx.drawImage(sheet, col * EGG_TILE, row * EGG_TILE, EGG_TILE, EGG_TILE, dx, dy, size, size);
  }
  if (prev !== undefined) anyCtx.imageSmoothingEnabled = prev;
}

export function eggRowFor(species: string, variant = 0): number {
  const base = SPECIES_EGG_ROW[(species as PetSpecies)] ?? 0;
  return (base + (variant % 3) * 8) % 32;
}

/** Frostwindz fantasy pixel eggs — 64×64, nearest-neighbor, same on-screen scale as Onocentaur tiles. */
export async function loadFrostEgg(file: string): Promise<SheetImage | null> {
  if (_frost.has(file)) return _frost.get(file) ?? null;
  const mod = await canvasMod();
  const dir = assetsDir();
  if (!mod || !dir) {
    _frost.set(file, null);
    return null;
  }
  const path = join(dir, "eggs", "frostwindz", file);
  if (!existsSync(path)) {
    _frost.set(file, null);
    return null;
  }
  try {
    const img = await mod.loadImage(path);
    _frost.set(file, img);
    return img;
  } catch {
    _frost.set(file, null);
    return null;
  }
}

export function blitFrostEgg(
  ctx: Ctx,
  img: SheetImage,
  dx: number,
  dy: number,
  size: number,
): void {
  const anyCtx = ctx as unknown as {
    drawImage: (...a: unknown[]) => void;
    imageSmoothingEnabled?: boolean;
  };
  const prev = anyCtx.imageSmoothingEnabled;
  anyCtx.imageSmoothingEnabled = false;
  anyCtx.drawImage(img, Math.round(dx), Math.round(dy), size, size);
  if (prev !== undefined) anyCtx.imageSmoothingEnabled = prev;
}

/** Split a 64×64 egg into top/bottom halves for the birth frame. */
export function blitFrostHalf(
  ctx: Ctx,
  img: SheetImage,
  half: "top" | "bottom",
  dx: number,
  dy: number,
  size: number,
): void {
  const anyCtx = ctx as unknown as {
    drawImage: (...a: unknown[]) => void;
    imageSmoothingEnabled?: boolean;
  };
  const prev = anyCtx.imageSmoothingEnabled;
  anyCtx.imageSmoothingEnabled = false;
  const sy = half === "top" ? 0 : 32;
  anyCtx.drawImage(img, 0, sy, 64, 32, Math.round(dx), Math.round(dy), size, Math.round(size / 2));
  if (prev !== undefined) anyCtx.imageSmoothingEnabled = prev;
}
