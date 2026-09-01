// ─────────────────────────────────────────────────────────────────────────────
// Animated transparent GIF encoder.
//
// GIF has no alpha channel — only a single palette index flagged "transparent".
// So the background has to become a real colour, and if that colour is close to
// anything in the artwork the quantiser will merge the two and the background
// will visibly leak through the subject.
//
// The fix is to choose the key per image: collect the colours actually present,
// then pick the candidate key that sits furthest from all of them. A picture
// with no magenta gets a magenta key; a magenta picture gets something else.
// ─────────────────────────────────────────────────────────────────────────────

import GIFEncoder from "gifencoder";
import type { Frames } from "../renderer/compositor.js";

/**
 * Candidate keys, spread around the colour cube so that at least one is far from
 * any given image's palette.
 */
const KEY_CANDIDATES: readonly (readonly [number, number, number])[] = [
  [255, 0, 255], [0, 255, 0], [0, 255, 255], [255, 255, 0], [0, 0, 255],
  [255, 128, 0], [128, 0, 255], [0, 255, 128], [255, 0, 128], [128, 255, 0],
];

/** Alpha at or above this counts as opaque when sampling content colours. */
const ALPHA_CUTOFF = 128;

/**
 * 4×4 Bayer matrix, used to dither alpha down to GIF's single bit.
 *
 * A hard cutoff makes any partially-transparent subject blink: at alpha 0.4 the
 * whole thing vanishes, at 0.5 it snaps back. Thresholding each pixel against
 * its position in this matrix instead turns partial opacity into a stable
 * stipple, so an effect like `fade` actually dissolves.
 *
 * Because the matrix spans the full range, near-opaque and near-transparent
 * pixels still resolve the same way for every position — only genuinely
 * mid-alpha pixels are stippled, which keeps anti-aliased edges clean.
 */
const BAYER_4X4 = [
   0,  8,  2, 10,
  12,  4, 14,  6,
   3, 11,  1,  9,
  15,  7, 13,  5,
];

/** Per-pixel alpha thresholds derived from the Bayer matrix, scaled to 0–255. */
const DITHER_THRESHOLDS = BAYER_4X4.map(v => ((v + 0.5) / 16) * 255);

/**
 * NeuQuant sample factor: 1 is best quality/slowest, 30 coarsest. 10 keeps
 * gradients clean on a 128px emoji without a noticeable encode cost.
 */
const QUALITY = 10;

/** Quantise the opaque colours present in `frames` to 4 bits per channel. */
export function collectContentColors(frames: Frames): Set<number> {
  const seen = new Set<number>();
  for (const data of frames) {
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3]! >= ALPHA_CUTOFF) {
        seen.add(((data[i]! >> 4) << 8) | ((data[i + 1]! >> 4) << 4) | (data[i + 2]! >> 4));
      }
    }
  }
  return seen;
}

/** Pick the candidate key whose nearest content colour is furthest away. */
export function pickTransparentKey(content: Set<number>): [number, number, number] {
  let best = KEY_CANDIDATES[0]!;
  let bestDistance = -1;

  for (const candidate of KEY_CANDIDATES) {
    let nearest = Infinity;
    for (const packed of content) {
      // Undo the 4-bit quantisation by scaling 0–15 back over 0–255.
      const r = ((packed >> 8) & 0xf) * 17;
      const g = ((packed >> 4) & 0xf) * 17;
      const b = (packed & 0xf) * 17;
      const dr = r - candidate[0], dg = g - candidate[1], db = b - candidate[2];
      const d = dr * dr + dg * dg + db * db;
      if (d < nearest) nearest = d;
    }
    if (nearest > bestDistance) {
      bestDistance = nearest;
      best = candidate;
    }
  }

  return [best[0], best[1], best[2]];
}

/**
 * Encode RGBA frames into a looping transparent GIF.
 *
 * NOTE: `frames` is mutated in place — transparent pixels are repainted with the
 * chosen key. The caller owns the buffers and must not reuse them afterwards.
 */
export function encodeGif(frames: Frames, size: number, delayMs: number): Buffer {
  const [kr, kg, kb] = pickTransparentKey(collectContentColors(frames));

  const encoder = new GIFEncoder(size, size);
  encoder.start();
  encoder.setRepeat(0);        // 0 = loop forever
  encoder.setQuality(QUALITY);
  encoder.setDelay(delayMs);
  encoder.setTransparent((kr << 16) | (kg << 8) | kb);

  for (const data of frames) {
    // Reduce alpha to GIF's single bit.
    //
    //  • Near-opaque AA rims (overlay/pokéball curves) snap fully opaque so the
    //    dither cannot chew them into "missing pixels".
    //  • Everything below that is Bayer-dithered against the FULL 0–255 scale,
    //    so a uniformly faint region — the dim end of a `fade` — still keeps a
    //    sparse stipple (~12% coverage at alpha 38) instead of vanishing to a
    //    blank frame. The Bayer floor (~8/255) naturally drops genuinely
    //    near-zero fringe, so isolated transparent specks still disappear.
    for (let i = 0; i < data.length; i += 4) {
      const a = data[i + 3]!;
      let keep: boolean;
      if (a >= 200) {
        keep = true;
      } else {
        const pixel = i >> 2;
        const x = pixel % size;
        const y = (pixel / size) | 0;
        const threshold = DITHER_THRESHOLDS[(y & 3) * 4 + (x & 3)]!;
        keep = a >= threshold;
      }

      if (!keep) {
        data[i] = kr; data[i + 1] = kg; data[i + 2] = kb; data[i + 3] = 0;
      } else {
        data[i + 3] = 255;
      }
    }
    encoder.addFrame(data as unknown as never);
  }

  encoder.finish();
  return encoder.out.getData();
}
