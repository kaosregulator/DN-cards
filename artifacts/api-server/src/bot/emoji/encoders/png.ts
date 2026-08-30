// ─────────────────────────────────────────────────────────────────────────────
// Static PNG encoder.
//
// PNG keeps the full 8-bit alpha channel, so unlike the GIF path there is no key
// colour and no 1-bit cutoff — soft edges and semi-transparent pixels survive
// exactly as composed.
//
// This goes through sharp rather than the canvas: the frames are already raw
// RGBA, so handing them straight to an encoder skips a pointless round-trip back
// onto a canvas just to read them off again.
// ─────────────────────────────────────────────────────────────────────────────

import sharp from "sharp";
import { EmojiError } from "../utils/errors.js";
import type { Frames } from "../renderer/compositor.js";

/** Encode the first frame of `frames` as a transparent PNG. */
export async function encodePng(frames: Frames, size: number): Promise<Buffer> {
  const frame = frames[0];
  if (!frame) {
    throw new EmojiError("encode_failed", "The emoji came out empty. Please try again.");
  }

  try {
    return await sharp(Buffer.from(frame.buffer, frame.byteOffset, frame.byteLength), {
      raw: { width: size, height: size, channels: 4 },
    })
      .png({ compressionLevel: 9 })
      .toBuffer();
  } catch {
    throw new EmojiError("encode_failed", "Couldn't save that emoji as a PNG. Please try again.");
  }
}
