import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { renderOffline } from "../providers/offline/index.js";
import { testImage } from "./fixtures.js";

/** Count large connected components of near-primary-red opaque pixels. */
async function largeRedBlobs(gif: Buffer, minPixels = 40): Promise<number> {
  const { data, info } = await sharp(gif, { page: 0 })
    .ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const w = info.width, h = info.height, ch = info.channels;
  const visited = new Uint8Array(w * h);
  const isRed = (x: number, y: number) => {
    const i = (y * w + x) * ch;
    return data[i + ch - 1]! > 80 && data[i]! > 150 && data[i + 1]! < 110 && data[i + 2]! < 110;
  };
  let blobs = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = y * w + x;
      if (visited[idx] || !isRed(x, y)) continue;
      let count = 0;
      const stack: [number, number][] = [[x, y]];
      visited[idx] = 1;
      while (stack.length) {
        const [cx, cy] = stack.pop()!;
        count++;
        for (const [nx, ny] of [[cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1]] as [number, number][]) {
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const ni = ny * w + nx;
          if (visited[ni] || !isRed(nx, ny)) continue;
          visited[ni] = 1;
          stack.push([nx, ny]);
        }
      }
      if (count >= minPixels) blobs++;
    }
  }
  return blobs;
}

describe("no subject tiling", () => {
  // Styles that previously drew whole sprite-sheets and tiled the subject.
  const styles = [
    "gen_btn_pokeball-emerge",
    "gen_btn_party-parrot",
    "gen_btn_nyan-cat",
    "gen_btn_pet",
    "gen_btn_shake",
    "gen_btn_peepo",
  ];

  it("keeps a single main subject instance (no grid of copies)", async () => {
    // Solid red circle — easy to blob-count.
    const size = 256;
    const buf = Buffer.alloc(size * size * 4);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const dx = x - 128, dy = y - 128;
        const i = (y * size + x) * 4;
        if (dx * dx + dy * dy < 110 * 110) {
          buf[i] = 220; buf[i + 1] = 30; buf[i + 2] = 30; buf[i + 3] = 255;
        }
      }
    }
    const image = await sharp(buf, { raw: { width: size, height: size, channels: 4 } }).png().toBuffer();

    for (const animation of styles) {
      const result = await renderOffline({ image, animation, format: "gif", size: "128" });
      const blobs = await largeRedBlobs(result.buffer);
      // One subject (or subject fully covered by opaque overlay → 0). Never a grid.
      expect(blobs, `${animation} tiled (${blobs} blobs)`).toBeLessThanOrEqual(2);
    }
  }, 120_000);

  it("still renders a plain test image without tiling", async () => {
    const image = await testImage(256);
    const result = await renderOffline({
      image, animation: "gen_btn_party-parrot", format: "gif", size: "128",
    });
    expect(result.bytes).toBeGreaterThan(500);
    expect(result.bytes).toBeLessThan(256 * 1024);
  }, 60_000);
});
