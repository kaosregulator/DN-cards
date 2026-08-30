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

function findHole(data: Uint8ClampedArray, w: number, h: number, threshold = 40) {
  let minX = w, minY = h, maxX = 0, maxY = 0, count = 0, sx = 0, sy = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const a = data[(y * w + x) * 4 + 3]!;
      if (a < threshold) {
        count++; sx += x; sy += y;
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (count < 16) {
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

/** Detect an N×N (or N×M) sprite grid and return tile size, or null. */
function detectTileSize(w: number, h: number, data: Uint8ClampedArray): number | null {
  type Cand = { tw: number; cols: number; rows: number; vari: number; nonempty: number };
  const cands: Cand[] = [];
  for (const tw of [56, 64, 68, 72, 80, 96, 112, 128, 136, 152, 170, 208]) {
    if (w % tw !== 0 || h % tw !== 0) continue;
    const cols = w / tw, rows = h / tw;
    const cells = cols * rows;
    if (cells < 4 || cells > 36) continue;
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
    cands.push({ tw, cols, rows, vari, nonempty });
  }
  cands.sort((a, b) => b.vari - a.vari);
  const best = cands.find(c => c.nonempty >= 4 && c.vari > 100);
  return best?.tw ?? null;
}

/**
 * Expand atlas files into per-frame overlay images.
 * Multi-chunk atlases → one frame per chunk.
 * Single-chunk sprite sheets → sliced tiles.
 */
async function expandToOverlayFrames(
  mod: CanvasMod,
  files: string[],
  maxFrames: number,
): Promise<Array<{ img: Awaited<ReturnType<CanvasMod["loadImage"]>>; w: number; h: number }>> {
  const out: Array<{ img: Awaited<ReturnType<CanvasMod["loadImage"]>>; w: number; h: number }> = [];

  // Multi-chunk: treat each file as a frame (sample if huge).
  if (files.length > 1) {
    const used = files.length > maxFrames
      ? files.filter((_, i) => i % Math.ceil(files.length / maxFrames) === 0).slice(0, maxFrames)
      : files;
    for (const file of used) {
      try {
        const img = await mod.loadImage(readFileSync(file));
        out.push({ img, w: img.width, h: img.height });
      } catch { /* skip */ }
    }
    return out;
  }

  // Single file: maybe a sprite sheet.
  const file = files[0]!;
  const buf = readFileSync(file);
  const probeImg = await mod.loadImage(buf);
  const probe: Canvas = mod.createCanvas(probeImg.width, probeImg.height);
  const probeCtx = probe.getContext("2d") as unknown as Ctx & PixelCtx;
  probeCtx.drawImage(probeImg as unknown as Canvas, 0, 0, probeImg.width, probeImg.height);
  const raw = probeCtx.getImageData(0, 0, probeImg.width, probeImg.height);
  const tw = detectTileSize(probeImg.width, probeImg.height, raw.data);

  if (tw) {
    const cols = probeImg.width / tw;
    const rows = probeImg.height / tw;
    // Use sharp for clean tile crops when available.
    try {
      const sharp = (await import("sharp")).default;
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          if (out.length >= maxFrames) break;
          const tile = await sharp(buf)
            .extract({ left: c * tw, top: r * tw, width: tw, height: tw })
            .ensureAlpha()
            .raw()
            .toBuffer({ resolveWithObject: true });
          let op = 0;
          for (let i = 3; i < tile.data.length; i += 4) if (tile.data[i]! > 40) op++;
          if (op < tw * tw * 0.02) continue;
          const png = await sharp(tile.data, {
            raw: { width: tw, height: tw, channels: 4 },
          }).png().toBuffer();
          const img = await mod.loadImage(png);
          out.push({ img, w: tw, h: tw });
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
    const ctx = frameCanvas.getContext("2d") as unknown as Ctx & PixelCtx;
    ctx.clearRect(0, 0, size, size);
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
