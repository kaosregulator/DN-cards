// Shared test fixture: a deterministic, asymmetric source image.
//
// Asymmetry matters — a centred circle looks identical under rotation and
// flipping, so it would hide exactly the bugs these tests exist to catch.

import sharp from "sharp";

export async function testImage(size = 256): Promise<Buffer> {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">
    <circle cx="${size * 0.46}" cy="${size * 0.44}" r="${size * 0.34}" fill="#2f7fe4"/>
    <rect x="${size * 0.23}" y="${size * 0.69}" width="${size * 0.55}" height="${size * 0.13}" rx="${size * 0.05}" fill="#e04f2f"/>
    <circle cx="${size * 0.36}" cy="${size * 0.36}" r="${size * 0.08}" fill="#ffffff"/>
  </svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

/** Count the graphic-control extension blocks in a GIF — one per frame. */
export function countGifFrames(gif: Buffer): number {
  let count = 0;
  for (let i = 0; i + 3 < gif.length; i++) {
    if (gif[i] === 0x00 && gif[i + 1] === 0x21 && gif[i + 2] === 0xf9 && gif[i + 3] === 0x04) count++;
  }
  return count;
}

// ── typed image inspection ───────────────────────────────────────────────────
// sharp's shipped declarations lose several members under this project's module
// resolution — `metadata()` comes back narrowed, and `jpeg()` disappears
// entirely (utils/source.ts documents the same gap for `autoOrient`). Rather
// than cast at a dozen assertion sites, the two shapes the tests need are
// declared once here.

/** The image facts these tests assert on. */
export interface ImageFacts {
  format?: string;
  width?: number;
  height?: number;
  hasAlpha?: boolean;
}

export async function imageFacts(buf: Buffer): Promise<ImageFacts> {
  return (sharp(buf) as unknown as { metadata(): Promise<ImageFacts> }).metadata();
}

/** Re-encode as JPEG — a format with no alpha channel at all. */
export async function toJpeg(buf: Buffer): Promise<Buffer> {
  return (sharp(buf) as unknown as { jpeg(): { toBuffer(): Promise<Buffer> } })
    .jpeg().toBuffer();
}
