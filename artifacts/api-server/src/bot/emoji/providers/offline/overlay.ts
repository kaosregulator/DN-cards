// ─────────────────────────────────────────────────────────────────────────────
// Overlay compositor — subject in the transparent hole of a static overlay.
//
// MakeEmoji "peepo / hat / meme" styles are typically a PNG/AVIF overlay with a
// clear region where the user's image sits, then the opaque overlay on top.
// ─────────────────────────────────────────────────────────────────────────────

import { existsSync, readFileSync } from "node:fs";
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
  drawImage(
    source: Canvas,
    sx: number, sy: number, sw: number, sh: number,
    dx: number, dy: number, dw: number, dh: number,
  ): void;
}

export interface OverlayComposeInput {
  image: Buffer;
  /** Absolute path or package-relative overlay asset. */
  overlayPath: string;
  size: number;
  /** Frames to emit (static overlay is repeated for GIF length). */
  frames?: number;
}

/** Resolve an overlay file from the offline package assets/overlays directory. */
export function resolveOverlayPath(slug: string): string | null {
  const root = offlinePackageRoot();
  if (!root) return null;
  const dir = join(root, "assets", "overlays");
  for (const ext of ["png", "avif", "webp", "gif"]) {
    const path = join(dir, `${slug}.${ext}`);
    if (existsSync(path)) return path;
  }
  return null;
}

/** Find the transparent hole (alpha < threshold) as a bounding box + centroid. */
function findHole(data: Uint8ClampedArray, w: number, h: number, threshold = 40) {
  let minX = w, minY = h, maxX = 0, maxY = 0, count = 0, sx = 0, sy = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const a = data[(y * w + x) * 4 + 3]!;
      if (a < threshold) {
        count++;
        sx += x; sy += y;
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (count < 16) {
    // No real hole — place subject centred under the whole overlay.
    return { x: 0, y: 0, w, h, cx: w / 2, cy: h / 2, frac: 1 };
  }
  return {
    x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1,
    cx: sx / count, cy: sy / count,
    frac: count / (w * h),
  };
}

function fitContain(sw: number, sh: number, boxW: number, boxH: number) {
  const scale = Math.min(boxW / Math.max(1, sw), boxH / Math.max(1, sh));
  return { w: sw * scale, h: sh * scale };
}

/**
 * Composite the user image into the overlay's transparent region.
 * Returns identical RGBA frames (static style animated as a short GIF loop).
 */
export async function composeOverlay(input: OverlayComposeInput): Promise<Uint8ClampedArray[]> {
  const mod: CanvasMod | null = await getCanvas();
  if (!mod) {
    throw new EmojiError(
      "canvas_missing",
      "The image renderer isn't available right now. Please try again later.",
    );
  }

  const { image, overlayPath, size } = input;
  const frameCount = Math.max(1, input.frames ?? 8);

  let subject;
  let overlayImg;
  try {
    subject = await mod.loadImage(image);
    overlayImg = await mod.loadImage(readFileSync(overlayPath));
  } catch {
    throw new EmojiError("not_an_image", "Overlay or source image could not be read.");
  }

  // Analyse hole at overlay native resolution, then scale placements to `size`.
  const probe: Canvas = mod.createCanvas(overlayImg.width, overlayImg.height);
  const probeCtx = probe.getContext("2d") as unknown as Ctx & PixelCtx;
  probeCtx.clearRect(0, 0, overlayImg.width, overlayImg.height);
  probeCtx.drawImage(overlayImg as unknown as Canvas, 0, 0, overlayImg.width, overlayImg.height);
  const probeData = probeCtx.getImageData(0, 0, overlayImg.width, overlayImg.height);
  const hole = findHole(probeData.data, overlayImg.width, overlayImg.height);

  const sx = size / overlayImg.width;
  const sy = size / overlayImg.height;
  const holeBox = {
    x: hole.x * sx,
    y: hole.y * sy,
    w: hole.w * sx,
    h: hole.h * sy,
  };

  // Fit subject inside the hole with a little inset so edges don't poke out.
  const inset = 0.92;
  const fitted = fitContain(subject.width, subject.height, holeBox.w * inset, holeBox.h * inset);
  const dx = holeBox.x + (holeBox.w - fitted.w) / 2;
  const dy = holeBox.y + (holeBox.h - fitted.h) / 2;

  const frameCanvas: Canvas = mod.createCanvas(size, size);
  const ctx = frameCanvas.getContext("2d") as unknown as Ctx & PixelCtx;

  ctx.clearRect(0, 0, size, size);
  ctx.drawImage(subject as unknown as Canvas, dx, dy, fitted.w, fitted.h);
  ctx.drawImage(overlayImg as unknown as Canvas, 0, 0, size, size);

  const pixels = (ctx as PixelCtx).getImageData(0, 0, size, size).data;
  const frames: Uint8ClampedArray[] = [];
  for (let i = 0; i < frameCount; i++) {
    frames.push(new Uint8ClampedArray(pixels));
  }
  return frames;
}
