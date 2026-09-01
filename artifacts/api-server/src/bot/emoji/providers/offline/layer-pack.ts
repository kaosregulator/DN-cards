// ─────────────────────────────────────────────────────────────────────────────
// Green-screen / layer compositor — MakeEmoji harvest path.
//
// Harvest uploads a solid green subject to makeemoji.com, downloads the result,
// and chroma-keys green to transparency. What's left is the real MakeEmoji
// layer (hands, blob chrome, pokéball shell, …). We stamp the user's image into
// the green slot — same idea as the old /emojimoji green-screen packs.
// ─────────────────────────────────────────────────────────────────────────────

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";
import type { Canvas } from "@napi-rs/canvas";
import { getCanvas, type CanvasMod, type Ctx } from "../../../animations/engine.js";
import { EmojiError } from "../../utils/errors.js";
import { offlinePackageRoot } from "./registry.js";

export interface LayerMeta {
  id: string;
  kind: "layer" | "transform-slot" | "no-slot";
  frames: number;
  delayMs: number;
  size: number;
  slot: { x: number; y: number; w: number; h: number; greenPixels: number } | null;
  layerPixels: number;
  source: string;
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

/**
 * Composite user image into the chroma slot of a harvested MakeEmoji layer pack.
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
  const n = meta.frames;
  const sheetPath = join(dir, "front.png");

  // Load front sheet and slice frames with sharp (reliable for tall sprites).
  const sheet = sharp(sheetPath).ensureAlpha();
  const sheetMeta = await sheet.metadata();
  const sheetH = sheetMeta.height ?? tile * n;
  const actualFrames = Math.min(n, Math.floor(sheetH / tile));

  let subject;
  try {
    subject = await mod.loadImage(input.image);
  } catch {
    throw new EmojiError("not_an_image", "Source image could not be read.");
  }

  const slot = meta.slot ?? { x: 0, y: 0, w: tile, h: tile, greenPixels: 0 };
  const out: Uint8ClampedArray[] = [];
  const size = input.size;

  for (let i = 0; i < actualFrames; i++) {
    const framePng = await sharp(sheetPath)
      .extract({ left: 0, top: i * tile, width: tile, height: tile })
      .png()
      .toBuffer();
    const overlay = await mod.loadImage(framePng);

    const canvas: Canvas = mod.createCanvas(size, size);
    const ctx = canvas.getContext("2d") as unknown as Ctx;
    ctx.clearRect(0, 0, size, size);

    // Scale slot from template tile → output size.
    const sx = size / tile;
    const dx = slot.x * sx;
    const dy = slot.y * sx;
    const dw = Math.max(1, slot.w * sx);
    const dh = Math.max(1, slot.h * sx);

    // Fit subject into slot (cover), centered.
    const sw = subject.width || 1;
    const sh = subject.height || 1;
    const scale = Math.max(dw / sw, dh / sh);
    const dw2 = sw * scale;
    const dh2 = sh * scale;
    const ox = dx + (dw - dw2) / 2;
    const oy = dy + (dh - dh2) / 2;

    ctx.save();
    ctx.beginPath();
    ctx.rect(dx, dy, dw, dh);
    ctx.clip();
    ctx.drawImage(subject as unknown as Canvas, ox, oy, dw2, dh2);
    ctx.restore();

    // Front layer (already chroma-keyed) on top.
    ctx.drawImage(overlay as unknown as Canvas, 0, 0, size, size);

    const img = ctx.getImageData(0, 0, size, size);
    out.push(new Uint8ClampedArray(img.data));
  }

  return { frames: out, delayMs: meta.delayMs || 50 };
}
