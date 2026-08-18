// ─────────────────────────────────────────────────────────────────────────────
// Real animated character sprites. The town pack ships hand-drawn 16×16 chibi
// walk sheets (CC0, finalbossblues / opengameart); we bundle them same-origin
// (Vite fingerprints the import, so Discord's CSP serves them from our own
// host — no external fetch) and re-pack each into the SAME 8-frame layout the
// procedural walker uses (4 facings × 2 walk frames). WorldScene keeps calling
// charFrame()/CHAR_KEY() unchanged; only the pixels get nicer.
//
// The source sheet is 3 columns (walk frames) × 4 rows. The hero sheet's rows,
// verified by eye, are:  row0 = ¾ LEFT, row1 = UP (back), row2 = DOWN (front),
// row3 = a sparkle/emote pose we skip. RIGHT is LEFT mirrored.
// ─────────────────────────────────────────────────────────────────────────────

import Phaser from "phaser";
import { CHAR_KEY } from "./tiles";

// Assets live in public/world/ so they ship as real, same-origin files (never
// inlined as data: URIs) — Discord's iframe CSP allows `img-src 'self'`, and
// BASE_URL keeps the path correct behind the proxy.
const assetUrl = (file: string): string => `${import.meta.env.BASE_URL}world/${file}`;

/** Sheets the world preloads. Keyed so more can be added later. */
const SHEETS: Record<string, string> = { hero: assetUrl("hero.png") };

const SHEET_KEY = (name: string): string => `sheet:${name}`;

/** Source frame geometry. */
const SRC = 16;

/** dir → { row, flip } into the source sheet, plus the walk columns. */
interface DirMap { row: number; flip: boolean; }
const HERO_DIRS: Record<"down" | "left" | "right" | "up", DirMap> = {
  down: { row: 2, flip: false },
  left: { row: 0, flip: false },
  right: { row: 0, flip: true },
  up: { row: 1, flip: false },
};
// Standing pose = middle column; the walk step = an outer column.
const STAND_COL = 1;
const STEP_COL = 0;

// Packed target frame — matches the procedural walker so anchors/depth are
// identical (feet near the bottom of a 24×32 cell).
const DST_W = 24, DST_H = 32;
const DIRS: Array<"down" | "left" | "right" | "up"> = ["down", "left", "right", "up"];

/** Queue the bundled sheets on a scene's loader (call from preload()). */
export function preloadCharSheets(scene: Phaser.Scene): void {
  for (const [name, url] of Object.entries(SHEETS)) {
    const key = SHEET_KEY(name);
    if (!scene.textures.exists(key)) scene.load.image(key, url);
  }
}

/** True once a given sheet has finished loading and can be composed. */
export function charSheetReady(scene: Phaser.Scene, sheet: string): boolean {
  return scene.textures.exists(SHEET_KEY(sheet));
}

/**
 * Build char:<name> from a loaded sheet, in the 8-frame (dir×2) layout that
 * charFrame() indexes. Returns false if the sheet isn't loaded, so callers can
 * fall back to the procedural texture. Safe to call repeatedly.
 */
export function composeCharFromSheet(
  scene: Phaser.Scene, name: string, sheet: string, dirs: Record<string, DirMap> = HERO_DIRS,
): boolean {
  const outKey = CHAR_KEY(name);
  if (scene.textures.exists(outKey)) return true;
  if (!scene.textures.exists(SHEET_KEY(sheet))) return false;

  const src = scene.textures.get(SHEET_KEY(sheet)).getSourceImage() as CanvasImageSource;
  const canvas = document.createElement("canvas");
  canvas.width = DST_W * 8;
  canvas.height = DST_H;
  const ctx = canvas.getContext("2d");
  if (!ctx) return false;
  ctx.imageSmoothingEnabled = false;

  // Draw the 16×16 source scaled to a grounded 24×24 within each 24×32 cell.
  const dw = DST_W, dh = DST_W, dy = DST_H - dh - 1;
  for (let d = 0; d < 4; d++) {
    const map = dirs[DIRS[d]!]!;
    for (let f = 0; f < 2; f++) {
      const col = f === 0 ? STAND_COL : STEP_COL;
      const sx = col * SRC, sy = map.row * SRC;
      const frameIndex = d * 2 + f;
      const baseX = frameIndex * DST_W;
      ctx.save();
      if (map.flip) {
        ctx.translate(baseX + DST_W, 0);
        ctx.scale(-1, 1);
        ctx.drawImage(src, sx, sy, SRC, SRC, 0, dy, dw, dh);
      } else {
        ctx.drawImage(src, sx, sy, SRC, SRC, baseX, dy, dw, dh);
      }
      ctx.restore();
    }
  }

  const tex = scene.textures.addCanvas(outKey, canvas);
  if (!tex) return false;
  for (let i = 0; i < 8; i++) tex.add(i, 0, i * DST_W, 0, DST_W, DST_H);
  return true;
}
