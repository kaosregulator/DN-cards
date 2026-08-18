// ─────────────────────────────────────────────────────────────────────────────
// Real character sprites. The town pack ships hand-drawn 16×16 chibi sheets
// (CC0, ansimuz / opengameart); we bundle them same-origin (public/world/, so
// Discord's CSP serves them as `img-src 'self'` files) and re-pack each into
// the SAME 8-frame layout the procedural walker uses (4 facings × 2 walk
// frames). WorldScene keeps calling charFrame()/CHAR_KEY() unchanged.
//
// The two sheets are laid out differently, so each gets its own frame map:
//   hero.png — one character, 3 walk columns × 4 rows. Verified rows:
//     row0 = ¾ LEFT (walk), row1 = UP (back), row2 = DOWN (front), row3 = emote.
//   npc.png  — FOUR townsfolk (one per row), one frame per direction:
//     col0 = DOWN, col1 = LEFT, col2 = UP (back). No walk frames.
//   RIGHT is always LEFT mirrored.
// ─────────────────────────────────────────────────────────────────────────────

import Phaser from "phaser";
import { CHAR_KEY } from "./tiles";

// Assets live in public/world/ so they ship as real, same-origin files (never
// inlined as data: URIs). BASE_URL keeps the path correct behind the proxy.
const assetUrl = (file: string): string => `${import.meta.env.BASE_URL}world/${file}`;
const SHEETS: Record<string, string> = {
  hero: assetUrl("hero.png"),
  npc: assetUrl("npc.png"),
};
const SHEET_KEY = (name: string): string => `sheet:${name}`;

const SRC = 16;
// Packed target frame — matches the procedural walker so anchors/depth are
// identical (feet near the bottom of a 24×32 cell).
const DST_W = 24, DST_H = 32;
const DIRS = ["down", "left", "right", "up"] as const;
type Dir = (typeof DIRS)[number];

interface FrameRef { col: number; row: number; flip?: boolean; }
/** Per-direction stand + step source frames. */
type SheetMap = Record<Dir, { stand: FrameRef; step: FrameRef }>;

/** hero.png: rows are directions, columns are walk frames. */
export function heroMap(): SheetMap {
  const d = (row: number, flip = false): { stand: FrameRef; step: FrameRef } => ({
    stand: { col: 1, row, flip }, step: { col: 0, row, flip },
  });
  return { down: d(2), left: d(0), right: d(0, true), up: d(1) };
}

/** npc.png: pick one townsperson row; columns are directions (no walk frames). */
export function npcMap(charRow: number): SheetMap {
  const s = (col: number, flip = false): { stand: FrameRef; step: FrameRef } => {
    const f = { col, row: charRow, flip };
    return { stand: f, step: f };
  };
  return { down: s(0), left: s(1), right: s(1, true), up: s(2) };
}

/** Number of distinct townsfolk in npc.png. */
export const NPC_ROWS = 4;

/** Queue the bundled sheets on a scene's loader (call from preload()). */
export function preloadCharSheets(scene: Phaser.Scene): void {
  for (const [name, url] of Object.entries(SHEETS)) {
    const key = SHEET_KEY(name);
    if (!scene.textures.exists(key)) scene.load.image(key, url);
  }
}

/**
 * Build char:<name> from a loaded sheet, in the 8-frame (dir×2) layout that
 * charFrame() indexes. Returns false if the sheet isn't loaded so callers can
 * fall back to the procedural texture. Safe to call repeatedly.
 */
export function composeChar(
  scene: Phaser.Scene, name: string, sheet: string, map: SheetMap,
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
    const dir = DIRS[d]!;
    for (let f = 0; f < 2; f++) {
      const ref = f === 0 ? map[dir].stand : map[dir].step;
      const sx = ref.col * SRC, sy = ref.row * SRC;
      const baseX = (d * 2 + f) * DST_W;
      ctx.save();
      if (ref.flip) {
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

/** Stable 0..NPC_ROWS-1 townsperson pick from an NPC id, for variety. */
export function npcRowFor(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return h % NPC_ROWS;
}
