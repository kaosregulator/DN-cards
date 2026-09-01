// ─────────────────────────────────────────────────────────────────────────────
// Green-screen / layer compositor — MakeEmoji harvest path.
//
// Each style pack stores:
//   front.png — MakeEmoji chrome with green keyed out
//   slot.png  — per-frame green-subject mask (exact silhouette)
//   meta.json — per-frame bbox/centroid/visibility + timing
//
// Compositing reconstructs MakeEmoji's layering:
//   1) Place the user image for THIS frame's subject transform/mask
//   2) Clip to that frame's green silhouette (motion, squash, explode, …)
//   3) Draw the foreground chrome on top
//
 // A static union-bbox stamp is NOT used when per-frame data exists — the user
// image must inherit the same animation MakeEmoji applied to the green subject.
// ─────────────────────────────────────────────────────────────────────────────

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";
import type { Canvas } from "@napi-rs/canvas";
import { getCanvas, type CanvasMod, type Ctx } from "../../../animations/engine.js";
import { EmojiError } from "../../utils/errors.js";
import { offlinePackageRoot } from "./registry.js";

export interface FrameSlot {
  x: number;
  y: number;
  w: number;
  h: number;
  cx: number;
  cy: number;
  greenPixels: number;
  visible: boolean;
  delayMs?: number;
}

export interface LayerMeta {
  id: string;
  kind: "layer" | "transform-slot" | "no-slot";
  frames: number;
  delayMs: number;
  size: number;
  /** Union bbox fallback only. */
  slot: { x: number; y: number; w: number; h: number; greenPixels: number } | null;
  /** Per-frame subject geometry — preferred. */
  perFrame?: FrameSlot[];
  motionPx?: number;
  areaRatio?: number;
  layerPixels: number;
  source: string;
  animationMode?: string;
}

interface PixelCtx {
  getImageData(sx: number, sy: number, sw: number, sh: number): { data: Uint8ClampedArray };
  putImageData(image: { data: Uint8ClampedArray }, dx: number, dy: number): void;
  createImageData(sw: number, sh: number): { data: Uint8ClampedArray };
  clearRect(x: number, y: number, w: number, h: number): void;
  drawImage(...args: unknown[]): void;
  save(): void;
  restore(): void;
  beginPath(): void;
  rect(x: number, y: number, w: number, h: number): void;
  clip(): void;
  globalCompositeOperation: string;
  imageSmoothingEnabled: boolean;
}

function layersRoot(): string | null {
  const root = offlinePackageRoot();
  return root ? join(root, "layers") : null;
}

export function resolveLayerDir(slug: string): string | null {
  const root = layersRoot();
  if (!root) return null;
  const dir = join(root, slug);
  if (existsSync(join(dir, "meta.json")) && existsSync(join(dir, "front.png"))) return dir;
  return null;
}

export function loadLayerMeta(slug: string): LayerMeta | null {
  const dir = resolveLayerDir(slug);
  if (!dir) return null;
  try {
    return JSON.parse(readFileSync(join(dir, "meta.json"), "utf8")) as LayerMeta;
  } catch {
    return null;
  }
}

export function hasLayerPack(slug: string): boolean {
  const meta = loadLayerMeta(slug);
  return Boolean(meta && meta.kind !== "no-slot" && meta.frames > 0);
}

function frameSlotFor(meta: LayerMeta, i: number, tile: number): FrameSlot {
  const pf = meta.perFrame?.[i];
  if (pf) return pf;
  // Legacy fallback: static union bbox every frame (insufficient for motion).
  const s = meta.slot ?? { x: 0, y: 0, w: tile, h: tile, greenPixels: 1 };
  return {
    x: s.x, y: s.y, w: s.w, h: s.h,
    cx: s.x + s.w / 2, cy: s.y + s.h / 2,
    greenPixels: s.greenPixels, visible: s.greenPixels > 0,
  };
}

/**
 * Composite user image so it inherits MakeEmoji's per-frame subject animation.
 * Returns one RGBA buffer per frame at `size`×`size`.
 */
export async function composeLayerPack(input: {
  image: Buffer;
  slug: string;
  size: number;
}): Promise<{ frames: Uint8ClampedArray[]; delayMs: number }> {
  const dir = resolveLayerDir(input.slug);
  const meta = loadLayerMeta(input.slug);
  if (!dir || !meta || meta.kind === "no-slot") {
    throw new EmojiError("unknown_effect", `No MakeEmoji layer pack for \`${input.slug}\`.`);
  }

  const mod: CanvasMod | null = await getCanvas();
  if (!mod) {
    throw new EmojiError(
      "canvas_missing",
      "The image renderer isn't available right now. Please try again later.",
    );
  }

  const tile = meta.size || 128;
  const frontPath = join(dir, "front.png");
  const slotPath = join(dir, "slot.png");
  const hasSlotSheet = existsSync(slotPath);

  const frontMeta = await sharp(frontPath).metadata();
  const sheetH = frontMeta.height ?? tile * meta.frames;
  const actualFrames = Math.min(meta.frames, Math.floor(sheetH / tile));

  let subject;
  try {
    subject = await mod.loadImage(input.image);
  } catch {
    throw new EmojiError("not_an_image", "Source image could not be read.");
  }

  const out: Uint8ClampedArray[] = [];
  const size = input.size;
  const scale = size / tile;
  const sw = subject.width || 1;
  const sh = subject.height || 1;

  for (let i = 0; i < actualFrames; i++) {
    const slot = frameSlotFor(meta, i, tile);
    const canvas: Canvas = mod.createCanvas(size, size);
    const ctx = canvas.getContext("2d") as unknown as Ctx & PixelCtx;
    ctx.clearRect(0, 0, size, size);
    ctx.imageSmoothingEnabled = true;

    if (slot.visible && slot.w > 0 && slot.h > 0 && slot.greenPixels > 0) {
      // Per-frame subject box (moves / scales / squashes with the green).
      const dx = slot.x * scale;
      const dy = slot.y * scale;
      const dw = Math.max(1, slot.w * scale);
      const dh = Math.max(1, slot.h * scale);

      // Cover-fit user into this frame's subject bounds.
      const fit = Math.max(dw / sw, dh / sh);
      const dw2 = sw * fit;
      const dh2 = sh * fit;
      const ox = dx + (dw - dw2) / 2;
      const oy = dy + (dh - dh2) / 2;

      ctx.drawImage(subject as unknown as Canvas, ox, oy, dw2, dh2);

      // Clip to the EXACT green silhouette for this frame (deformation / explode).
      if (hasSlotSheet) {
        const maskPng = await sharp(slotPath)
          .extract({ left: 0, top: i * tile, width: tile, height: tile })
          .resize(size, size, { kernel: "nearest" })
          .png()
          .toBuffer();
        const mask = await mod.loadImage(maskPng);
        ctx.globalCompositeOperation = "destination-in";
        ctx.drawImage(mask as unknown as Canvas, 0, 0, size, size);
        ctx.globalCompositeOperation = "source-over";
      } else {
        // No mask sheet — at least clip to the per-frame rect.
        const clipped = mod.createCanvas(size, size);
        const cctx = clipped.getContext("2d") as unknown as Ctx & PixelCtx;
        cctx.clearRect(0, 0, size, size);
        cctx.drawImage(canvas as unknown as Canvas, 0, 0);
        ctx.clearRect(0, 0, size, size);
        ctx.save();
        ctx.beginPath();
        ctx.rect(dx, dy, dw, dh);
        ctx.clip();
        ctx.drawImage(clipped as unknown as Canvas, 0, 0);
        ctx.restore();
      }
    }
    // else: subject invisible this frame — leave blank under the chrome

    const frontPng = await sharp(frontPath)
      .extract({ left: 0, top: i * tile, width: tile, height: tile })
      .resize(size, size, { fit: "fill" })
      .png()
      .toBuffer();
    const overlay = await mod.loadImage(frontPng);
    ctx.globalCompositeOperation = "source-over";
    ctx.drawImage(overlay as unknown as Canvas, 0, 0, size, size);

    const img = ctx.getImageData(0, 0, size, size);
    out.push(new Uint8ClampedArray(img.data));
  }

  const delayMs = meta.perFrame?.[0]?.delayMs || meta.delayMs || 50;
  return { frames: out, delayMs };
}
