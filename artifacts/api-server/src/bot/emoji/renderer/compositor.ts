// ─────────────────────────────────────────────────────────────────────────────
// The compositor — the only module in this system that touches a canvas.
//
// It turns an EffectDef plus a decoded subject image into raw RGBA frames. It
// knows nothing about any specific effect: it reads the transform an effect
// returns for a frame and applies it. That separation is what keeps effects
// pure data — a new effect can never require a change here.
//
// Per frame the order is fixed: clear → back layers → subject → front layers.
//
// The subject is drawn onto a scratch canvas rather than straight onto the frame
// so that per-subject colour and opacity apply to the subject ALONE. Painting a
// tint directly on the frame would bleed onto the decoration layers underneath.
// ─────────────────────────────────────────────────────────────────────────────

import type { Canvas } from "@napi-rs/canvas";
import { getCanvas, type CanvasMod, type Ctx } from "../../animations/engine.js";
import { EmojiError } from "../utils/errors.js";
import type { EffectContext, EffectDef, EmojiDirection, Transform } from "../types.js";
import { colorize, planHue } from "./colorize.js";

/** Below this absolute scale the transform matrix is degenerate — skip the draw. */
const MIN_SCALE = 0.001;

/**
 * Pixel-buffer access, declared locally.
 *
 * This project compiles without the DOM lib, so the shipped @napi-rs/canvas
 * declarations lose the members whose signatures mention DOM types — the same
 * gap `animations/engine.ts` documents and works around for the transform
 * methods. These two exist on the Skia context at runtime; we re-declare the
 * shape we rely on and cast at the single point of use.
 */
interface PixelBuffer {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

interface PixelCtx {
  getImageData(sx: number, sy: number, sw: number, sh: number): PixelBuffer;
  putImageData(image: PixelBuffer, dx: number, dy: number): void;
  /** Compositing one canvas onto another — the Canvas-source overloads are lost too. */
  drawImage(source: Canvas, dx: number, dy: number, dw: number, dh: number): void;
}

export interface ComposeInput {
  /** Decoded source image bytes (any format @napi-rs/canvas can read). */
  image: Buffer;
  effect: EffectDef;
  direction: EmojiDirection;
  /** Canvas edge length in pixels. */
  size: number;
  /** Frames to render. 1 renders only the effect's resting pose. */
  frames: number;
}

/** Raw RGBA frames, each exactly `size * size * 4` bytes. */
export type Frames = Uint8ClampedArray[];

/**
 * Fit `(sw, sh)` inside a square box of `box` px, preserving aspect ratio and
 * never upscaling beyond the box. Returns the drawn size.
 */
function fitContain(sw: number, sh: number, box: number): { w: number; h: number } {
  if (sw <= 0 || sh <= 0) return { w: box, h: box };
  const scale = Math.min(box / sw, box / sh);
  return { w: sw * scale, h: sh * scale };
}

/** Render every frame of `effect` over `image`. */
export async function compose(input: ComposeInput): Promise<Frames> {
  const { image, effect, direction, size, frames } = input;

  const mod: CanvasMod | null = await getCanvas();
  if (!mod) {
    throw new EmojiError(
      "canvas_missing",
      "The image renderer isn't available right now. Please try again later.",
    );
  }

  let subject;
  try {
    subject = await mod.loadImage(image);
  } catch {
    throw new EmojiError(
      "not_an_image",
      "That file couldn't be read as an image. Try a PNG, JPG, WebP or GIF.",
    );
  }

  // The frame we hand to the encoder, and a scratch layer that holds only the
  // transformed subject. Both are allocated once and reused across frames.
  const frameCanvas: Canvas = mod.createCanvas(size, size);
  const frameCtx = frameCanvas.getContext("2d") as unknown as Ctx;
  const scratchCanvas: Canvas = mod.createCanvas(size, size);
  const scratchCtx = scratchCanvas.getContext("2d") as unknown as Ctx;

  // The subject's resting footprint. `inset` reserves the margin an effect needs
  // for its own motion, so a slide or a spin never clips against the edge.
  const box = size * effect.inset;
  const { w: dw, h: dh } = fitContain(subject.width, subject.height, box);

  const back = effect.layers?.filter(l => l.z === "back") ?? [];
  const front = effect.layers?.filter(l => l.z === "front") ?? [];

  const out: Frames = [];

  for (let frame = 0; frame < frames; frame++) {
    const c: EffectContext = {
      // A single-frame (PNG) render samples the loop at 0 — the resting pose,
      // which every effect is authored to look correct at.
      t: frames > 1 ? frame / frames : 0,
      frame,
      frames,
      direction,
      size,
    };

    const tf: Transform = effect.transform?.(c) ?? {};
    const scaleX = tf.scaleX ?? 1;
    const scaleY = tf.scaleY ?? 1;
    const alpha = tf.alpha ?? 1;

    resetContext(frameCtx, size);

    for (const layer of back) {
      frameCtx.save();
      layer.paint(frameCtx, c);
      frameCtx.restore();
    }

    // A zero scale or a fully transparent subject means "hidden this frame";
    // skipping the draw avoids a degenerate matrix and a wasted pixel pass.
    const visible =
      Math.abs(scaleX) > MIN_SCALE && Math.abs(scaleY) > MIN_SCALE && alpha > 0.002;

    if (visible) {
      resetContext(scratchCtx, size);
      scratchCtx.translate(
        size / 2 + (tf.offsetX ?? 0) * size,
        size / 2 + (tf.offsetY ?? 0) * size,
      );
      if (tf.rotate) scratchCtx.rotate(tf.rotate);
      scratchCtx.scale(scaleX, scaleY);
      scratchCtx.drawImage(subject, -dw / 2, -dh / 2, dw, dh);

      if (tf.hue !== undefined) {
        const px = scratchCtx as unknown as PixelCtx;
        const pixels = px.getImageData(0, 0, size, size);
        colorize(pixels.data, planHue(tf.hue, tf.hueStrength ?? 1));
        // putImageData ignores the current transform, which is what we want here:
        // the pixels are already in final frame coordinates.
        scratchCtx.setTransform(1, 0, 0, 1, 0, 0);
        px.putImageData(pixels, 0, 0);
      }

      // globalAlpha applies to the whole scratch layer, so subject opacity is a
      // single blend rather than something each painter has to honour.
      frameCtx.globalAlpha = alpha;
      (frameCtx as unknown as PixelCtx).drawImage(scratchCanvas, 0, 0, size, size);
      frameCtx.globalAlpha = 1;
    }

    for (const layer of front) {
      frameCtx.save();
      layer.paint(frameCtx, c);
      frameCtx.restore();
    }

    // Skia reuses the buffer backing getImageData, so snapshot before the next
    // frame overwrites it.
    out.push(frameCtx.getImageData(0, 0, size, size).data.slice());
  }

  return out;
}

/** Return a context to a known-clean state: no transform, no blending, empty. */
function resetContext(ctx: Ctx, size: number): void {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = "source-over";
  ctx.clearRect(0, 0, size, size);
}
