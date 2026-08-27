// ─────────────────────────────────────────────────────────────────────────────
// Green-screen chroma-key render.
//
// Takes a Giphy "green screen" GIF, keys out the green on every frame, and
// composites it over the subject image, emitting a transparent looping GIF that
// matches the emoji-pack output size. sharp decodes the animated GIF into raw
// per-frame pixels; the chroma-key and the source-over composite are pure pixel
// math (unit-tested); the shared encoder writes the final transparent GIF.
// ─────────────────────────────────────────────────────────────────────────────

import sharp from "sharp";
import { OUT } from "./effects.js";
import { encodeTransparentGif } from "./encode.js";

/** Cap frames so a long Giphy loop can't blow up encode time. */
const MAX_FRAMES = 48;

export interface ChromaOptions {
  /** Minimum green channel value for a pixel to be considered key. */
  minGreen?: number;
  /** How much green must exceed red & blue to count as chroma (0..255). */
  dominance?: number;
}

/**
 * Zero the alpha of green-screen pixels, in place. A pixel is keyed when green
 * is bright AND clearly dominates red and blue — the signature of a chroma key,
 * while sparing greenish content that isn't a flat key.
 */
export function chromaKeyFrame(
  data: Uint8ClampedArray, opts: ChromaOptions = {},
): Uint8ClampedArray {
  const minGreen = opts.minGreen ?? 90;
  const dominance = opts.dominance ?? 60;
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i]!, g = data[i + 1]!, b = data[i + 2]!;
    if (g >= minGreen && g - r >= dominance && g - b >= dominance) {
      data[i + 3] = 0; // key it out
    }
  }
  return data;
}

/** Source-over composite of `over` RGBA onto `base` RGBA (same length), in place on a copy. */
export function compositeOver(base: Uint8ClampedArray, over: Uint8ClampedArray): Uint8ClampedArray {
  const out = base.slice();
  for (let i = 0; i < out.length; i += 4) {
    const a = over[i + 3]! / 255;
    if (a <= 0) continue;
    const ia = 1 - a;
    out[i] = Math.round(over[i]! * a + out[i]! * ia);
    out[i + 1] = Math.round(over[i + 1]! * a + out[i + 1]! * ia);
    out[i + 2] = Math.round(over[i + 2]! * a + out[i + 2]! * ia);
    out[i + 3] = Math.min(255, Math.round(over[i + 3]! + out[i + 3]! * ia));
  }
  return out;
}

interface DecodedGif { width: number; height: number; frames: Uint8ClampedArray[]; delayMs: number }

/** Decode an animated GIF into raw RGBA frames (evenly sampled to MAX_FRAMES). */
export async function decodeGifFrames(buf: Buffer): Promise<DecodedGif | null> {
  try {
    const meta = await sharp(buf, { animated: true }).metadata();
    const pages = meta.pages ?? 1;
    const width = meta.width ?? 0;
    const pageHeight = meta.pageHeight ?? meta.height ?? 0;
    if (!width || !pageHeight) return null;

    const { data } = await sharp(buf, { animated: true }).ensureAlpha().raw()
      .toBuffer({ resolveWithObject: true });
    const stride = width * pageHeight * 4;
    const delays = Array.isArray(meta.delay) ? meta.delay : [];

    // Evenly sample down to MAX_FRAMES when the loop is long.
    const step = pages > MAX_FRAMES ? pages / MAX_FRAMES : 1;
    const frames: Uint8ClampedArray[] = [];
    let sumDelay = 0, counted = 0;
    for (let k = 0; k < Math.min(pages, MAX_FRAMES); k++) {
      const f = Math.min(pages - 1, Math.floor(k * step));
      frames.push(new Uint8ClampedArray(data.subarray(f * stride, f * stride + stride)));
      const d = delays[f];
      if (typeof d === "number" && d > 0) { sumDelay += d; counted++; }
    }
    const delayMs = counted ? Math.max(40, Math.round(sumDelay / counted)) : 100;
    return { width, height: pageHeight, frames, delayMs };
  } catch {
    return null;
  }
}

/** Resize raw RGBA to OUT×OUT with the given fit, transparent letterbox. */
async function fitToOut(
  data: Uint8ClampedArray, width: number, height: number, fit: "contain" | "cover",
): Promise<Uint8ClampedArray> {
  const out = await sharp(Buffer.from(data.buffer, data.byteOffset, data.byteLength), {
    raw: { width, height, channels: 4 },
  })
    .resize(OUT, OUT, { fit, background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .raw().toBuffer();
  return new Uint8ClampedArray(out.buffer, out.byteOffset, out.byteLength);
}

/**
 * Render the subject with a keyed green-screen GIF composited on top.
 * Returns null when the GIF can't be decoded.
 */
export async function renderGreenScreenGif(
  subject: Buffer, greenScreenGif: Buffer, opts: ChromaOptions = {},
): Promise<Buffer | null> {
  const decoded = await decodeGifFrames(greenScreenGif);
  if (!decoded || !decoded.frames.length) return null;

  // Subject: fit inside OUT (contain) as a static base behind the animation.
  const subjRaw = await sharp(subject).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const base = await fitToOut(
    new Uint8ClampedArray(subjRaw.data.buffer, subjRaw.data.byteOffset, subjRaw.data.byteLength),
    subjRaw.info.width, subjRaw.info.height, "contain",
  );

  const composed: Uint8ClampedArray[] = [];
  for (const frame of decoded.frames) {
    chromaKeyFrame(frame, opts);
    const overlay = await fitToOut(frame, decoded.width, decoded.height, "cover");
    composed.push(compositeOver(base, overlay));
  }
  return encodeTransparentGif(composed, OUT, OUT, decoded.delayMs);
}
