// ─────────────────────────────────────────────────────────────────────────────
// Style Board — the visual heart of the /emoji dashboard.
//
// After a target is chosen, the browser is no longer a single-style preview with
// a dropdown. It is a *contact sheet*: the page's styles are each rendered on the
// user's own image and tiled into one canvas, numbered, so the whole page can be
// judged at a glance. The chosen style is ringed; favorites carry a star; the
// target itself is shown in the header so switching it is obvious.
//
// The board is a still PNG. The animated preview of the *focused* style rides
// alongside it as the embed thumbnail (see styles-picker.ts), so the dashboard
// shows both "all of them at once" and "this one, moving".
// ─────────────────────────────────────────────────────────────────────────────

import { getCanvas } from "../../animations/engine.js";
import { logger } from "../../../lib/logger.js";
import { renderStyleThumb } from "../preview/index.js";
import { isFavorite } from "./favorites.js";
import type { StyleEntry } from "./styles-picker.js";

/** Styles shown on one board page. Eight fills a tidy 4×2 grid of live previews. */
export const BOARD_PAGE_SIZE = 8;

/** Attachment name the embed's main image points at. */
export const BOARD_FILENAME = "style-board.png";

// Layout — plain pixels, drawn once per page turn. Kept generous so labels and
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
  ctx: BoardCtx, img: { width: number; height: number }, x: number, y: number, box: number,
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

/**
 * Render the contact-sheet board for one page of styles.
 *
 * Returns null when the canvas backend is unavailable — the caller then falls
 * back to the single-preview embed, so the browser degrades instead of breaking.
 */
export async function renderBoard(opts: BoardOptions): Promise<Buffer | null> {
  const mod = await getCanvas();
  if (!mod) return null;

  const { image, styles, focusValue, userId } = opts;

  // Render (or read from cache) each cell's thumbnail plus the target itself.
  const [target, thumbs] = await Promise.all([
    mod.loadImage(image).catch(() => null),
    Promise.all(styles.map(async (s) => {
      const buf = await renderStyleThumb(image, s.value).catch(() => null);
      if (!buf) return null;
      return mod.loadImage(buf).catch(() => null);
    })),
  ]);

  const rows = Math.max(1, Math.ceil(BOARD_PAGE_SIZE / COLS));
  const gridW = COLS * CELL_W + (COLS - 1) * GAP;
  const width = PAD * 2 + gridW;
  const height = HEADER_H + PAD + rows * CELL_H + (rows - 1) * GAP + PAD;

  const canvas = mod.createCanvas(width, height);
  const ctx = canvas.getContext("2d") as unknown as BoardCtx;

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
    const img = thumbs[i];

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

  try {
    return await canvas.encode("png");
  } catch (err) {
    logger.debug({ err }, "style board encode failed");
    return null;
  }
}
