// ─────────────────────────────────────────────────────────────────────────────
// Shared transparent-GIF encoder.
//
// Both the emoji-pack effects and the green-screen chroma-key path compose RGBA
// frames on a canvas and then need a small looping GIF with a clean transparent
// background. gifencoder has no real alpha, so we pick a "key" colour that is FAR
// from the actual content (otherwise the key maps to a near-by content colour and
// the background leaks), paint every transparent pixel that key, and mark it
// transparent. This module owns that logic so there is exactly one code path.
// ─────────────────────────────────────────────────────────────────────────────

import GIFEncoder from "gifencoder";

// Candidate key colours; the encoder picks whichever is farthest from content.
const KEY_CANDIDATES: [number, number, number][] = [
  [255, 0, 255], [0, 255, 0], [0, 255, 255], [255, 255, 0], [0, 0, 255],
  [255, 128, 0], [128, 0, 255], [0, 255, 128], [255, 0, 128], [128, 255, 0],
];

/** Collect the set of quantized (4-bit/channel) colours of opaque pixels. */
export function collectContentColors(
  frames: Uint8ClampedArray[], into: Set<number> = new Set<number>(),
): Set<number> {
  for (const d of frames) {
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3]! >= 128) {
        into.add(((d[i]! >> 4) << 8) | ((d[i + 1]! >> 4) << 4) | (d[i + 2]! >> 4));
      }
    }
  }
  return into;
}

/** Pick the key colour whose nearest content colour is farthest away. */
export function pickKey(content: Set<number>): [number, number, number] {
  let best: [number, number, number] = KEY_CANDIDATES[0]!, bestDist = -1;
  for (const cand of KEY_CANDIDATES) {
    let near = Infinity;
    for (const c of content) {
      const r = ((c >> 8) & 0xf) * 17, g = ((c >> 4) & 0xf) * 17, b = (c & 0xf) * 17;
      const dr = r - cand[0], dg = g - cand[1], db = b - cand[2];
      const dist = dr * dr + dg * dg + db * db;
      if (dist < near) near = dist;
    }
    if (near > bestDist) { bestDist = near; best = cand; }
  }
  return best;
}

/**
 * Encode RGBA frames (each `w*h*4` bytes) into a transparent looping GIF.
 * Frames are mutated in place (transparent pixels are recoloured to the key).
 */
export function encodeTransparentGif(
  frames: Uint8ClampedArray[], w: number, h: number, delayMs: number,
): Buffer {
  const [kr, kg, kb] = pickKey(collectContentColors(frames));
  const keyInt = (kr << 16) | (kg << 8) | kb;

  const enc = new GIFEncoder(w, h);
  enc.start();
  enc.setRepeat(0);
  enc.setQuality(15);
  enc.setDelay(delayMs);
  enc.setTransparent(keyInt);

  for (const d of frames) {
    // Hard 1-bit alpha: every alpha<128 pixel becomes the transparent key; the
    // rest is forced fully opaque so gifencoder keeps a single clean key entry.
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3]! < 128) { d[i] = kr; d[i + 1] = kg; d[i + 2] = kb; d[i + 3] = 0; }
      else d[i + 3] = 255;
    }
    enc.addFrame(d as unknown as never);
  }
  enc.finish();
  return enc.out.getData();
}
