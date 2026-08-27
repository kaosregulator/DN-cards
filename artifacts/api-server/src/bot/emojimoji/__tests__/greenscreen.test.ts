import { describe, expect, it } from "vitest";
import GIFEncoder from "gifencoder";
import { chromaKeyFrame, compositeOver, decodeGifFrames, renderGreenScreenGif } from "../greenscreen.js";

const px = (r: number, g: number, b: number, a = 255) => [r, g, b, a];

describe("chromaKeyFrame", () => {
  it("keys out bright, green-dominant pixels and keeps others", () => {
    const data = new Uint8ClampedArray([
      ...px(0, 255, 0),     // pure green → keyed
      ...px(10, 200, 20),   // green-dominant → keyed
      ...px(200, 40, 40),   // red → kept
      ...px(120, 140, 120), // greenish but not dominant → kept
      ...px(255, 255, 255), // white → kept
    ]);
    chromaKeyFrame(data);
    expect(data[3]).toBe(0);      // px0 keyed
    expect(data[7]).toBe(0);      // px1 keyed
    expect(data[11]).toBe(255);   // px2 kept
    expect(data[15]).toBe(255);   // px3 kept
    expect(data[19]).toBe(255);   // px4 kept
  });
});

describe("compositeOver", () => {
  it("draws opaque over pixels and leaves the base where over is transparent", () => {
    const base = new Uint8ClampedArray([...px(0, 0, 0), ...px(10, 20, 30)]);
    const over = new Uint8ClampedArray([...px(255, 0, 0), ...px(99, 99, 99, 0)]);
    const out = compositeOver(base, over);
    expect([...out.slice(0, 4)]).toEqual([255, 0, 0, 255]); // over wins
    expect([...out.slice(4, 8)]).toEqual([10, 20, 30, 255]); // base kept (over alpha 0)
  });

  it("does not mutate the base buffer", () => {
    const base = new Uint8ClampedArray([...px(1, 2, 3)]);
    const over = new Uint8ClampedArray([...px(9, 9, 9)]);
    compositeOver(base, over);
    expect([...base]).toEqual([1, 2, 3, 255]);
  });
});

// Build a tiny 3-frame animated GIF (green, red, blue) for the decode path.
function makeGif(): Buffer {
  const enc = new GIFEncoder(8, 8);
  enc.start(); enc.setRepeat(0); enc.setDelay(120);
  const frame = (r: number, g: number, b: number) => {
    const d = new Uint8ClampedArray(8 * 8 * 4);
    for (let i = 0; i < d.length; i += 4) { d[i] = r; d[i + 1] = g; d[i + 2] = b; d[i + 3] = 255; }
    return d as unknown as never;
  };
  enc.addFrame(frame(0, 255, 0));
  enc.addFrame(frame(255, 0, 0));
  enc.addFrame(frame(0, 0, 255));
  enc.finish();
  return enc.out.getData();
}

describe("decodeGifFrames + renderGreenScreenGif (sharp)", () => {
  it("decodes each animated frame as raw RGBA", async () => {
    const decoded = await decodeGifFrames(makeGif());
    expect(decoded).not.toBeNull();
    expect(decoded!.width).toBe(8);
    expect(decoded!.height).toBe(8);
    expect(decoded!.frames.length).toBe(3);
    expect([...decoded!.frames[0]!.slice(0, 4)]).toEqual([0, 255, 0, 255]); // frame 0 green
  });

  it("renders a transparent GIF composite from a subject + green-screen gif", async () => {
    // A minimal 8×8 opaque red PNG subject.
    const sharp = (await import("sharp")).default;
    const subject = await sharp({
      create: { width: 8, height: 8, channels: 4, background: { r: 200, g: 30, b: 30, alpha: 255 } },
    }).png().toBuffer();
    const out = await renderGreenScreenGif(subject, makeGif());
    expect(Buffer.isBuffer(out)).toBe(true);
    expect(out!.length).toBeGreaterThan(0);
    expect(out!.subarray(0, 3).toString("ascii")).toBe("GIF"); // valid GIF header
  });

  it("returns null for a non-gif buffer", async () => {
    expect(await decodeGifFrames(Buffer.from("not a gif"))).toBeNull();
  });
});
