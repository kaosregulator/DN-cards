// ─────────────────────────────────────────────────────────────────────────────
// Style Board — the visual heart of the /emoji dashboard.
//
// After a target is chosen, the browser is a *contact sheet*: the page's styles
// are each rendered on the user's own image and tiled into one canvas, numbered,
// so the whole page can be judged at a glance. The chosen style is ringed;
// favorites carry a star; the target itself is shown in the header.
//
// The board is fully ANIMATED. Each cell's style is rendered as a small GIF, the
// frames are decoded with gifuct-js, and they are tiled per frame into one
// looping board GIF (gifencoder). So every cell moves at once, on the user's own
// image. Canvas + frames are used only for this menu chrome — the emoji output
// itself still goes through the render engine.
//
// If the canvas backend is missing, or nothing on the page actually animates, it
// degrades to a still PNG contact sheet, so browsing never breaks.
// ─────────────────────────────────────────────────────────────────────────────

import GIFEncoder from "gifencoder";
import { parseGIF, decompressFrames } from "gifuct-js";
import { getCanvas, type CanvasMod } from "../../animations/engine.js";
import { logger } from "../../../lib/logger.js";
import { renderStyleThumb, renderStyleThumbGif } from "../preview/index.js";
import { isFavorite } from "./favorites.js";
import type { StyleEntry } from "./styles-picker.js";

/** Styles shown on one board page. Eight fills a tidy 4×2 grid of live previews. */
export const BOARD_PAGE_SIZE = 8;

/** Attachment names — the extension follows whether the board animated. */
export const BOARD_FILENAME = "style-board.gif";
export const BOARD_FILENAME_STILL = "style-board.png";

/** Frame ceiling for the tiled board GIF — enough for smooth motion, small file. */
const BOARD_MAX_FRAMES = 14;

/** NeuQuant sample factor for the board GIF (higher = coarser palette, smaller). */
const BOARD_QUALITY = 12;

/** Give up on the animated board above this size and fall back to the still PNG. */
const BOARD_MAX_BYTES = 7_500_000;

// Layout — plain pixels, drawn once per frame. Kept generous so labels and
// numbers stay legible when Discord scales the embed image.
const COLS = 4;
const CELL_W = 150;
const CELL_H = 168;
const THUMB = 104;
const GAP = 14;
const PAD = 20;
const HEADER_H = 100;

// Palette — Discord blurple family on a dark card, so the board sits naturally
// in both light and dark client themes.
const BG_TOP = "#2b2d42";
const BG_BOT = "#1e1f2e";
const CELL_BG = "#33364a";
const CELL_BG_SEL = "#3b4670";
const RING = "#5865f2";
const STAR = "#f1c40f";
const TEXT = "#eceef5";
const SUBTLE = "#aab0c4";
const BADGE_BG = "#12131c";

/** Anything with a width/height that a 2D context can draw — an Image or Canvas. */
type Drawable = { width: number; height: number };

/** Minimal 2D context surface the board uses — avoids pulling in the DOM lib. */
interface BoardCtx {
  fillStyle: string | object;
  strokeStyle: string;
  lineWidth: number;
  font: string;
  textAlign: string;
  textBaseline: string;
  globalAlpha: number;
  fillRect(x: number, y: number, w: number, h: number): void;
  fillText(text: string, x: number, y: number): void;
  measureText(text: string): { width: number };
  beginPath(): void;
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  arc(x: number, y: number, r: number, s: number, e: number): void;
  arcTo(x1: number, y1: number, x2: number, y2: number, r: number): void;
  closePath(): void;
  fill(): void;
  stroke(): void;
  save(): void;
  restore(): void;
  clip(): void;
  drawImage(img: unknown, dx: number, dy: number, dw: number, dh: number): void;
  createLinearGradient(x0: number, y0: number, x1: number, y1: number): {
    addColorStop(offset: number, color: string): void;
  };
}

/** Context surface used while decoding GIF frames onto working canvases. */
interface FrameCtx {
  createImageData(w: number, h: number): { data: Uint8ClampedArray };
  putImageData(image: { data: Uint8ClampedArray }, dx: number, dy: number): void;
  drawImage(img: unknown, dx: number, dy: number): void;
  clearRect(x: number, y: number, w: number, h: number): void;
}

function roundRect(
  ctx: BoardCtx, x: number, y: number, w: number, h: number, r: number,
): void {
  const rad = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rad, y);
  ctx.arcTo(x + w, y, x + w, y + h, rad);
  ctx.arcTo(x + w, y + h, x, y + h, rad);
  ctx.arcTo(x, y + h, x, y, rad);
  ctx.arcTo(x, y, x + w, y, rad);
  ctx.closePath();
}

/** Truncate a label to fit `maxWidth`, adding an ellipsis when it overflows. */
function fitText(ctx: BoardCtx, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(`${t}…`).width > maxWidth) {
    t = t.slice(0, -1);
  }
  return `${t}…`;
}

/** Draw an image centered and contained inside a square box. */
function drawContain(
  ctx: BoardCtx, img: Drawable, x: number, y: number, box: number,
): void {
  const scale = Math.min(box / img.width, box / img.height);
  const w = img.width * scale;
  const h = img.height * scale;
  ctx.drawImage(img as unknown, x + (box - w) / 2, y + (box - h) / 2, w, h);
}

export interface BoardOptions {
  image: Buffer;
  targetLabel: string;
  styles: StyleEntry[];
  focusValue: string;
  userId: string;
  page: number;
  pages: number;
  total: number;
  format: string;
}

/** What renderBoard hands back: the encoded image and the attachment name to use. */
export interface BoardResult {
  buffer: Buffer;
  name: string;
  animated: boolean;
}

/** Board canvas dimensions for a page of `count` cells. */
function boardDims(count: number): { width: number; height: number; gridW: number; rows: number } {
  const rows = Math.max(1, Math.ceil(count / COLS));
  const gridW = COLS * CELL_W + (COLS - 1) * GAP;
  const width = PAD * 2 + gridW;
  const height = HEADER_H + PAD + rows * CELL_H + (rows - 1) * GAP + PAD;
  return { width, height, gridW, rows };
}

/**
 * Draw the complete board onto `ctx` using `cellImages[i]` for cell i. Shared by
 * the animated path (called once per frame) and the still path (called once).
 */
function drawBoard(
  ctx: BoardCtx,
  opts: BoardOptions,
  target: Drawable | null,
  cellImages: (Drawable | null)[],
): void {
  const { styles, focusValue, userId } = opts;
  const { width, height, gridW } = boardDims(styles.length);

  // Card background.
  const bg = ctx.createLinearGradient(0, 0, 0, height);
  bg.addColorStop(0, BG_TOP);
  bg.addColorStop(1, BG_BOT);
  ctx.fillStyle = bg as unknown as string;
  ctx.fillRect(0, 0, width, height);

  // Header: title on the left, the target thumbnail + label on the right.
  ctx.textBaseline = "alphabetic";
  ctx.textAlign = "left";
  ctx.fillStyle = TEXT;
  ctx.font = `700 26px "Orbitron", sans-serif`;
  ctx.fillText("Style Board", PAD, 46);

  ctx.fillStyle = SUBTLE;
  ctx.font = `500 15px sans-serif`;
  ctx.fillText(
    `Page ${opts.page + 1}/${opts.pages} · ${opts.total} styles · ${opts.format.toUpperCase()}`,
    PAD, 74,
  );

  // Target chip (right-aligned): the picture everything below is rendered on.
  const chip = 56;
  const chipX = width - PAD - chip;
  const chipY = 26;
  ctx.fillStyle = BADGE_BG;
  roundRect(ctx, chipX - 6, chipY - 6, chip + 12, chip + 12, 12);
  ctx.fill();
  if (target) {
    ctx.save();
    roundRect(ctx, chipX, chipY, chip, chip, 8);
    ctx.clip();
    drawContain(ctx, target, chipX, chipY, chip);
    ctx.restore();
  }
  ctx.fillStyle = SUBTLE;
  ctx.font = `500 12px sans-serif`;
  ctx.textAlign = "right";
  const label = fitText(ctx, opts.targetLabel, 150);
  ctx.fillText("Your target", chipX - 12, 44);
  ctx.fillStyle = TEXT;
  ctx.font = `600 13px sans-serif`;
  ctx.fillText(label, chipX - 12, 66);
  ctx.textAlign = "left";

  // Cells.
  styles.forEach((style, i) => {
    const col = i % COLS;
    const row = Math.floor(i / COLS);
    // Center a short final row.
    const rowCount = Math.min(COLS, styles.length - row * COLS);
    const rowW = rowCount * CELL_W + (rowCount - 1) * GAP;
    const rowStart = PAD + (gridW - rowW) / 2;
    const x = rowStart + col * (CELL_W + GAP);
    const y = HEADER_H + PAD + row * (CELL_H + GAP);

    const selected = style.value === focusValue;
    const fav = isFavorite(userId, style.value);
    const img = cellImages[i];

    // Cell background + selection ring.
    ctx.fillStyle = selected ? CELL_BG_SEL : CELL_BG;
    roundRect(ctx, x, y, CELL_W, CELL_H, 14);
    ctx.fill();
    if (selected) {
      ctx.strokeStyle = RING;
      ctx.lineWidth = 3;
      roundRect(ctx, x + 1.5, y + 1.5, CELL_W - 3, CELL_H - 3, 13);
      ctx.stroke();
    }

    // Thumbnail (or placeholder).
    const tx = x + (CELL_W - THUMB) / 2;
    const ty = y + 16;
    if (img) {
      ctx.save();
      roundRect(ctx, tx, ty, THUMB, THUMB, 10);
      ctx.clip();
      drawContain(ctx, img, tx, ty, THUMB);
      ctx.restore();
    } else {
      ctx.fillStyle = BADGE_BG;
      roundRect(ctx, tx, ty, THUMB, THUMB, 10);
      ctx.fill();
      ctx.fillStyle = SUBTLE;
      ctx.font = `500 12px sans-serif`;
      ctx.textAlign = "center";
      ctx.fillText("no preview", x + CELL_W / 2, ty + THUMB / 2 + 4);
      ctx.textAlign = "left";
    }

    // Number badge (top-left of the cell).
    const bx = x + 16;
    const by = y + 16;
    ctx.fillStyle = selected ? RING : BADGE_BG;
    ctx.beginPath();
    ctx.arc(bx, by, 15, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = TEXT;
    ctx.font = `700 15px "Orbitron", sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(String(i + 1), bx, by + 1);
    ctx.textBaseline = "alphabetic";
    ctx.textAlign = "left";

    // Favorite star (top-right of the cell).
    if (fav) {
      ctx.fillStyle = STAR;
      ctx.font = `700 18px sans-serif`;
      ctx.textAlign = "right";
      ctx.fillText("★", x + CELL_W - 12, by + 6);
      ctx.textAlign = "left";
    }

    // Label under the thumbnail.
    ctx.fillStyle = selected ? TEXT : SUBTLE;
    ctx.font = `600 14px sans-serif`;
    ctx.textAlign = "center";
    ctx.fillText(fitText(ctx, style.label, CELL_W - 24), x + CELL_W / 2, y + CELL_H - 16);
    ctx.textAlign = "left";
  });
}

interface DecodedGif { frames: Drawable[]; delays: number[] }

/**
 * Decode a GIF into fully-composited per-frame canvases.
 *
 * Our thumbnails come from the emoji encoder, which writes full frames with a
 * transparent key and "restore to background" disposal. Compositing with
 * `drawImage` (source-over) keeps the previous frame where a patch is
 * transparent; a disposal of 2 clears the region first — between them this draws
 * every frame correctly regardless of how the encoder optimised it.
 */
function decodeGif(mod: CanvasMod, buffer: Buffer): DecodedGif | null {
  try {
    const ab = buffer.buffer.slice(
      buffer.byteOffset, buffer.byteOffset + buffer.byteLength,
    ) as ArrayBuffer;
    const gif = parseGIF(ab);
    const frames = decompressFrames(gif, true);
    if (frames.length === 0) return null;

    const W = gif.lsd.width;
    const H = gif.lsd.height;
    const work = mod.createCanvas(W, H);
    const wctx = work.getContext("2d") as unknown as FrameCtx;

    const out: Drawable[] = [];
    const delays: number[] = [];
    for (const f of frames) {
      const patch = mod.createCanvas(f.dims.width, f.dims.height);
      const pctx = patch.getContext("2d") as unknown as FrameCtx;
      const id = pctx.createImageData(f.dims.width, f.dims.height);
      id.data.set(f.patch);
      pctx.putImageData(id, 0, 0);

      wctx.drawImage(patch as unknown, f.dims.left, f.dims.top);

      const snap = mod.createCanvas(W, H);
      (snap.getContext("2d") as unknown as FrameCtx).drawImage(work as unknown, 0, 0);
      out.push(snap as unknown as Drawable);
      delays.push(f.delay && f.delay > 0 ? f.delay : 90);

      // "Restore to background" — clear this region before the next frame.
      if (f.disposalType === 2) {
        wctx.clearRect(f.dims.left, f.dims.top, f.dims.width, f.dims.height);
      }
    }
    return { frames: out, delays };
  } catch (err) {
    logger.debug({ err }, "board cell GIF decode failed");
    return null;
  }
}

/** One cell's frames (≥1) plus the delays that produced them. */
interface Cell { frames: (Drawable | null)[]; delays: number[] }

/** Fetch a cell as decoded animated frames, falling back to a single still. */
async function loadCell(mod: CanvasMod, image: Buffer, style: string): Promise<Cell> {
  const gif = await renderStyleThumbGif(image, style).catch(() => null);
  if (gif) {
    const decoded = decodeGif(mod, gif);
    if (decoded && decoded.frames.length > 1) {
      return { frames: decoded.frames, delays: decoded.delays };
    }
  }
  const still = await renderStyleThumb(image, style).catch(() => null);
  const img = still ? await mod.loadImage(still).catch(() => null) : null;
  return { frames: [img as unknown as Drawable | null], delays: [90] };
}

/**
 * Render the contact-sheet board for one page of styles — animated when the page
 * has motion, a still PNG otherwise.
 *
 * Returns null when the canvas backend is unavailable, so the caller can drop the
 * board image and keep the rest of the dashboard.
 */
export async function renderBoard(opts: BoardOptions): Promise<BoardResult | null> {
  const mod = await getCanvas();
  if (!mod) return null;

  const { image, styles } = opts;

  const [target, cells] = await Promise.all([
    mod.loadImage(image).catch(() => null) as Promise<Drawable | null>,
    Promise.all(styles.map(s => loadCell(mod, image, s.value))),
  ]);

  const frameCount = Math.min(
    BOARD_MAX_FRAMES,
    Math.max(1, ...cells.map(c => c.frames.length)),
  );

  const { width, height } = boardDims(styles.length);

  // Nothing animates → a single still PNG is smaller and just as clear.
  if (frameCount <= 1) {
    return renderStill(mod, opts, target, cells, width, height);
  }

  const animated = renderAnimated(mod, opts, target, cells, frameCount, width, height);
  if (animated && animated.buffer.length <= BOARD_MAX_BYTES) return animated;
  if (animated) {
    logger.debug(
      { bytes: animated.buffer.length },
      "animated board over size budget; using still fallback",
    );
  }
  return await renderStill(mod, opts, target, cells, width, height);
}

/** Tile the cells' frames into one looping board GIF. */
function renderAnimated(
  mod: CanvasMod,
  opts: BoardOptions,
  target: Drawable | null,
  cells: Cell[],
  frameCount: number,
  width: number,
  height: number,
): BoardResult | null {
  try {
    const canvas = mod.createCanvas(width, height);
    const ctx = canvas.getContext("2d") as unknown as BoardCtx;

    // A single delay reads smoothly and keeps the encoder simple; take the
    // average of the animated cells, clamped to a sane playback range.
    const animatedDelays = cells.flatMap(c => (c.frames.length > 1 ? c.delays : []));
    const avg = animatedDelays.length
      ? animatedDelays.reduce((a, b) => a + b, 0) / animatedDelays.length
      : 90;
    const delay = Math.min(140, Math.max(50, Math.round(avg)));

    const encoder = new GIFEncoder(width, height);
    encoder.start();
    encoder.setRepeat(0);
    encoder.setQuality(BOARD_QUALITY);
    encoder.setDelay(delay);

    for (let f = 0; f < frameCount; f++) {
      const cellImages = cells.map(c => c.frames[f % c.frames.length] ?? null);
      drawBoard(ctx, opts, target, cellImages);
      encoder.addFrame(ctx as unknown as never);
    }
    encoder.finish();

    return { buffer: encoder.out.getData(), name: BOARD_FILENAME, animated: true };
  } catch (err) {
    logger.debug({ err }, "animated board encode failed");
    return null;
  }
}

/** Draw a one-frame board and encode it as a PNG. */
async function renderStill(
  mod: CanvasMod,
  opts: BoardOptions,
  target: Drawable | null,
  cells: Cell[],
  width: number,
  height: number,
): Promise<BoardResult | null> {
  try {
    const canvas = mod.createCanvas(width, height);
    const ctx = canvas.getContext("2d") as unknown as BoardCtx;
    drawBoard(ctx, opts, target, cells.map(c => c.frames[0] ?? null));
    const buffer = await canvas.encode("png");
    return { buffer, name: BOARD_FILENAME_STILL, animated: false };
  } catch (err) {
    logger.debug({ err }, "still board encode failed");
    return null;
  }
}
