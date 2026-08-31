// ─────────────────────────────────────────────────────────────────────────────
// Atlas / frame-sequence compositors for the offline MakeEmoji engine.
//
// MakeEmoji ships animated "character" styles as WebP atlas chunks (and some as
 // numbered PNG frames). Each chunk is a full-frame overlay with a transparent
// hole for the subject — same placement model as static overlays, but N frames.
// ─────────────────────────────────────────────────────────────────────────────

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Canvas } from "@napi-rs/canvas";
import { getCanvas, type CanvasMod, type Ctx } from "../../../animations/engine.js";
import { EmojiError } from "../../utils/errors.js";
import { offlinePackageRoot } from "./registry.js";

interface PixelBuffer {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

interface PixelCtx {
  getImageData(sx: number, sy: number, sw: number, sh: number): PixelBuffer;
  drawImage(source: Canvas, dx: number, dy: number, dw: number, dh: number): void;
}

function assetsRoot(): string | null {
  const root = offlinePackageRoot();
  return root ? join(root, "assets") : null;
}

/** kebab-case ↔ camelCase / raw CDN folder name. */
export function resolveAssetDir(kind: "atlases" | "frames", slug: string): string | null {
  const root = assetsRoot();
  if (!root) return null;
  const base = join(root, kind);
  const candidates = [
    slug,
    slug.replace(/-/g, ""),
    // banana-dance → bananaDance
    slug.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase()),
    // pepe-flag stays pepe-flag; party-parrot stays
  ];
  // Also scan directory for case-insensitive / kebab match.
  if (!existsSync(base)) return null;
  const entries = readdirSync(base);
  for (const c of candidates) {
    const hit = entries.find(e => e === c || e.toLowerCase() === c.toLowerCase());
    if (hit) {
      const path = join(base, hit);
      if (existsSync(path)) return path;
    }
  }
  // fuzzy: strip non-alnum
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  const want = norm(slug);
  const fuzzy = entries.find(e => norm(e) === want);
  return fuzzy ? join(base, fuzzy) : null;
}

function listFrameFiles(dir: string): string[] {
  const files = readdirSync(dir).filter(f => /\.(webp|png|avif|gif)$/i.test(f));
  // Prefer chunk-NNN-* order, then frame_NNNN, then numeric.
  return files.sort((a, b) => {
    const ca = /chunk-(\d+)/i.exec(a);
    const cb = /chunk-(\d+)/i.exec(b);
    if (ca && cb) return Number(ca[1]) - Number(cb[1]);
    const fa = /frame_(\d+)/i.exec(a);
    const fb = /frame_(\d+)/i.exec(b);
    if (fa && fb) return Number(fa[1]) - Number(fb[1]);
    const na = /^(\d+)\./.exec(a);
    const nb = /^(\d+)\./.exec(b);
    if (na && nb) return Number(na[1]) - Number(nb[1]);
    return a.localeCompare(b);
  }).map(f => join(dir, f));
}

/**
 * Find the subject hole: the largest transparent region that does NOT touch
 * the image border (so exterior canvas transparency isn't treated as the hole).
 * Falls back to transparent pixels inside the opaque artwork's bounding box.
 */
function findHole(data: Uint8ClampedArray, w: number, h: number, threshold = 40) {
  const isClear = (x: number, y: number) => data[(y * w + x) * 4 + 3]! < threshold;

  // Opaque artwork bbox — anchors the search so full-frame clear canvases still work.
  let oMinX = w, oMinY = h, oMaxX = 0, oMaxY = 0, opaque = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (isClear(x, y)) continue;
      opaque++;
      if (x < oMinX) oMinX = x;
      if (y < oMinY) oMinY = y;
      if (x > oMaxX) oMaxX = x;
      if (y > oMaxY) oMaxY = y;
    }
  }
  if (opaque < 16) {
    return { x: 0, y: 0, w, h, frac: 1 };
  }

  // Flood-fill clear components; prefer interior ones (not touching the border).
  const seen = new Uint8Array(w * h);
  type Region = { minX: number; minY: number; maxX: number; maxY: number; count: number; border: boolean };
  const regions: Region[] = [];

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = y * w + x;
      if (seen[idx] || !isClear(x, y)) continue;
      const stack: number[] = [idx];
      seen[idx] = 1;
      let minX = x, minY = y, maxX = x, maxY = y, count = 0, border = false;
      while (stack.length) {
        const i = stack.pop()!;
        const cx = i % w, cy = (i / w) | 0;
        count++;
        if (cx === 0 || cy === 0 || cx === w - 1 || cy === h - 1) border = true;
        if (cx < minX) minX = cx;
        if (cy < minY) minY = cy;
        if (cx > maxX) maxX = cx;
        if (cy > maxY) maxY = cy;
        for (const [nx, ny] of [[cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1]] as [number, number][]) {
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const ni = ny * w + nx;
          if (seen[ni] || !isClear(nx, ny)) continue;
          seen[ni] = 1;
          stack.push(ni);
        }
      }
      if (count >= 16) regions.push({ minX, minY, maxX, maxY, count, border });
    }
  }

  // Prefer the largest interior clear region (the face hole). If none, use clear
  // pixels strictly inside the opaque artwork bbox.
  const interior = regions.filter(r => !r.border).sort((a, b) => b.count - a.count);
  if (interior[0]) {
    const r = interior[0];
    return {
      x: r.minX, y: r.minY,
      w: r.maxX - r.minX + 1, h: r.maxY - r.minY + 1,
      frac: r.count / (w * h),
    };
  }

  // Fallback: transparent pixels inside the opaque bbox (inset 1px).
  let minX = w, minY = h, maxX = 0, maxY = 0, count = 0;
  for (let y = oMinY + 1; y < oMaxY; y++) {
    for (let x = oMinX + 1; x < oMaxX; x++) {
      if (!isClear(x, y)) continue;
      count++;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }
  if (count < 16) {
    // No real hole — place subject centred under the whole overlay.
    return { x: 0, y: 0, w, h, frac: 1 };
  }
  return {
    x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1,
    frac: count / (w * h),
  };
}

function fitContain(sw: number, sh: number, boxW: number, boxH: number) {
  const scale = Math.min(boxW / Math.max(1, sw), boxH / Math.max(1, sh));
  return { w: sw * scale, h: sh * scale };
}

export interface SequenceComposeInput {
  image: Buffer;
  /** Absolute directory containing ordered frame/chunk files. */
  sequenceDir: string;
  size: number;
  /** Cap frames (large atlases). */
  maxFrames?: number;
}

/**
 * Detect a regular sprite-sheet grid and return tile width/height.
 *
 * MakeEmoji packs many animated styles as one WebP with N×M cells. Drawing
 * that sheet whole is what produced the "subject tiled across the canvas"
 * bug — every cell's hole showed the same stretched subject. We must slice
 * first. Returns null when the image is a single full-frame overlay.
 */
function detectTileSize(
  w: number,
  h: number,
  data: Uint8ClampedArray,
): { tw: number; th: number } | null {
  type Cand = {
    tw: number; th: number; cols: number; rows: number;
    vari: number; nonempty: number; cells: number; bleed: number;
  };
  const cands: Cand[] = [];

  // Prefer common MakeEmoji cell sizes, then any divisor that yields 4–64 cells.
  const preferred = [56, 64, 68, 72, 80, 96, 102, 104, 112, 128, 130, 136, 152, 170, 208];
  const twSet = new Set<number>(preferred);
  for (let d = 48; d <= Math.min(w, h); d++) {
    if (w % d === 0 && h % d === 0) twSet.add(d);
  }

  // Individual CDN frames are already 128×128 (or similar). Never treat a
  // near-emoji-sized image as a sheet — that reintroduces the grid bug by
  // carving one overlay into a 2×2 of garbage tiles.
  if (w <= 160 && h <= 160) return null;

  for (const tw of twSet) {
    if (w % tw !== 0 || h % tw !== 0) continue;
    const cols = w / tw, rows = h / tw;
    const cells = cols * rows;
    // Need a real grid (at least 3×2 / 2×3), not a 2×2 crop of a single frame.
    if (cells < 6 || cells > 64) continue;
    if (cols < 2 || rows < 2) continue;

    const opaque: number[] = [];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        let op = 0;
        for (let y = 0; y < tw; y += 2) {
          for (let x = 0; x < tw; x += 2) {
            const gx = c * tw + x, gy = r * tw + y;
            if (data[(gy * w + gx) * 4 + 3]! > 40) op++;
          }
        }
        opaque.push(op);
      }
    }
    const mean = opaque.reduce((a, b) => a + b, 0) / opaque.length;
    const vari = opaque.reduce((a, b) => a + (b - mean) ** 2, 0) / opaque.length;
    const nonempty = opaque.filter(t => t > tw * tw * 0.01).length;
    // Real sheets have several populated cells with uneven fill (idle vs active).
    // Reject near-uniform grids (a full-bleed overlay wrongly divisible into tiles).
    if (nonempty < 4) continue;
    if (vari < 100) continue;

    // Edge bleed: wrong tile sizes cut through sprites so opaque pixels hug
    // the cell border. Prefer grids where content sits inside the cell.
    let edgeBleed = 0, edgeSamples = 0;
    const band = Math.max(1, Math.floor(tw * 0.08));
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        // Skip empty cells
        const cellOp = opaque[r * cols + c]!;
        if (cellOp <= tw * tw * 0.01) continue;
        for (let y = 0; y < tw; y += 2) {
          for (let x = 0; x < tw; x += 2) {
            const onEdge = x < band || y < band || x >= tw - band || y >= tw - band;
            if (!onEdge) continue;
            edgeSamples++;
            const gx = c * tw + x, gy = r * tw + y;
            if (data[(gy * w + gx) * 4 + 3]! > 40) edgeBleed++;
          }
        }
      }
    }
    const bleed = edgeSamples ? edgeBleed / edgeSamples : 1;
    cands.push({ tw, th: tw, cols, rows, vari, nonempty, cells, bleed });
  }

  // Prefer:
  //  1. Low edge bleed (tiles don't cut through neighbouring sprites)
  //  2. Nonempty count in a typical animation range (6–24)
  //  3. Higher variance as a weak tie-break
  cands.sort((a, b) => {
    const bleedDelta = a.bleed - b.bleed;
    if (Math.abs(bleedDelta) > 0.04) return bleedDelta;
    const ideal = (n: number) => (n >= 6 && n <= 24 ? 1000 + n : n);
    const idealDelta = ideal(b.nonempty) - ideal(a.nonempty);
    if (idealDelta !== 0) return idealDelta;
    return b.vari - a.vari;
  });
  const best = cands[0];
  return best ? { tw: best.tw, th: best.th } : null;
}

type OverlayFrame = {
  img: Awaited<ReturnType<CanvasMod["loadImage"]>>;
  w: number;
  h: number;
};

/** Slice one image file into overlay frames (sprite sheet → tiles, else whole). */
async function expandOneFile(
  mod: CanvasMod,
  file: string,
  maxFrames: number,
): Promise<OverlayFrame[]> {
  const out: OverlayFrame[] = [];
  const buf = readFileSync(file);
  const probeImg = await mod.loadImage(buf);
  const probe: Canvas = mod.createCanvas(probeImg.width, probeImg.height);
  const probeCtx = probe.getContext("2d") as unknown as Ctx & PixelCtx;
  probeCtx.clearRect(0, 0, probeImg.width, probeImg.height);
  probeCtx.drawImage(probeImg as unknown as Canvas, 0, 0, probeImg.width, probeImg.height);
  const raw = probeCtx.getImageData(0, 0, probeImg.width, probeImg.height);
  const tile = detectTileSize(probeImg.width, probeImg.height, raw.data);

  if (tile) {
    const { tw, th } = tile;
    const cols = probeImg.width / tw;
    const rows = probeImg.height / th;
    try {
      const sharp = (await import("sharp")).default;
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          if (out.length >= maxFrames) break;
          const cropped = await sharp(buf)
            .extract({ left: c * tw, top: r * th, width: tw, height: th })
            .ensureAlpha()
            .raw()
            .toBuffer({ resolveWithObject: true });
          let op = 0;
          for (let i = 3; i < cropped.data.length; i += 4) if (cropped.data[i]! > 40) op++;
          // Skip empty / nearly-empty cells in a sparse atlas.
          if (op < tw * th * 0.02) continue;
          const png = await sharp(cropped.data, {
            raw: { width: tw, height: th, channels: 4 },
          }).png().toBuffer();
          const img = await mod.loadImage(png);
          out.push({ img, w: tw, h: th });
        }
      }
    } catch {
      // fall through to whole image
    }
  }

  if (out.length === 0) {
    out.push({ img: probeImg, w: probeImg.width, h: probeImg.height });
  }
  return out;
}

/**
 * Expand atlas/frame files into per-frame overlay images.
 *
 * - Numbered PNG frame dirs → one overlay per file (already individual frames).
 * - Sprite-sheet WebPs (one or many chunks) → sliced into cells; NEVER drawn whole.
 * - Multi-chunk atlases whose chunks are already full frames → one overlay per chunk.
 */
async function expandToOverlayFrames(
  mod: CanvasMod,
  files: string[],
  maxFrames: number,
): Promise<OverlayFrame[]> {
  const out: OverlayFrame[] = [];

  // Sample files when there are far more than we will encode.
  const used = files.length > maxFrames
    ? files.filter((_, i) => i % Math.ceil(files.length / maxFrames) === 0).slice(0, maxFrames)
    : files;

  for (const file of used) {
    if (out.length >= maxFrames) break;
    try {
      const frames = await expandOneFile(mod, file, maxFrames - out.length);
      // If a "chunk" expands into many tiles, those ARE the animation frames —
      // take them all (up to the cap). If it stays one frame, append and continue
      // to the next chunk.
      out.push(...frames);
    } catch { /* skip unreadable */ }
  }

  return out;
}

/**
 * Composite the subject into each atlas/frame overlay's transparent hole.
 * Returns one RGBA buffer per sequence frame.
 */
export async function composeSequence(input: SequenceComposeInput): Promise<Uint8ClampedArray[]> {
  const mod: CanvasMod | null = await getCanvas();
  if (!mod) {
    throw new EmojiError(
      "canvas_missing",
      "The image renderer isn't available right now. Please try again later.",
    );
  }

  const files = listFrameFiles(input.sequenceDir);
  if (files.length === 0) {
    throw new EmojiError("unknown_effect", `No frames in ${input.sequenceDir}`);
  }
  const max = input.maxFrames ?? 24;

  let subject;
  try {
    subject = await mod.loadImage(input.image);
  } catch {
    throw new EmojiError("not_an_image", "Source image could not be read.");
  }

  const overlays = await expandToOverlayFrames(mod, files, max);
  const size = input.size;
  const out: Uint8ClampedArray[] = [];

  for (const overlay of overlays) {
    const probe: Canvas = mod.createCanvas(overlay.w, overlay.h);
    const probeCtx = probe.getContext("2d") as unknown as Ctx & PixelCtx;
    probeCtx.clearRect(0, 0, overlay.w, overlay.h);
    probeCtx.drawImage(overlay.img as unknown as Canvas, 0, 0, overlay.w, overlay.h);
    const probeData = probeCtx.getImageData(0, 0, overlay.w, overlay.h);
    const hole = findHole(probeData.data, overlay.w, overlay.h);

    const sx = size / overlay.w;
    const sy = size / overlay.h;
    const holeBox = {
      x: hole.x * sx,
      y: hole.y * sy,
      w: hole.w * sx,
      h: hole.h * sy,
    };

    const inset = hole.frac > 0.85 ? 0.78 : hole.frac > 0.5 ? 0.88 : 0.92;
    const fitted = fitContain(subject.width, subject.height, holeBox.w * inset, holeBox.h * inset);
    const dx = holeBox.x + (holeBox.w - fitted.w) / 2;
    const dy = holeBox.y + (holeBox.h - fitted.h) / 2;

    const frameCanvas: Canvas = mod.createCanvas(size, size);
    const ctx = frameCanvas.getContext("2d") as unknown as Ctx & PixelCtx & {
      imageSmoothingEnabled: boolean;
    };
    ctx.clearRect(0, 0, size, size);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(subject as unknown as Canvas, dx, dy, fitted.w, fitted.h);
    ctx.drawImage(overlay.img as unknown as Canvas, 0, 0, size, size);

    out.push(new Uint8ClampedArray(ctx.getImageData(0, 0, size, size).data));
  }

  if (out.length === 0) {
    throw new EmojiError("encode_failed", "Atlas/frame sequence produced no frames.");
  }
  return out;
}

export function resolveAtlasDir(slug: string): string | null {
  return resolveAssetDir("atlases", slug);
}

export function resolveFramesDir(slug: string): string | null {
  return resolveAssetDir("frames", slug);
}
