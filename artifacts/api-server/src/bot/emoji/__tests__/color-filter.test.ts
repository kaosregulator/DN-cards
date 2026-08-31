import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { renderOffline } from "../providers/offline/index.js";
import { colorIsAnimated, normalizeColor } from "../providers/offline/color-filter.js";

async function solidPng(size = 128, rgb: [number, number, number] = [40, 120, 220]): Promise<Buffer> {
  const buf = Buffer.alloc(size * size * 4);
  for (let i = 0; i < size * size; i++) {
    buf[i * 4] = rgb[0];
    buf[i * 4 + 1] = rgb[1];
    buf[i * 4 + 2] = rgb[2];
    buf[i * 4 + 3] = 255;
  }
  return sharp(buf, { raw: { width: size, height: size, channels: 4 } }).png().toBuffer();
}

describe("MakeEmoji Colour side-control", () => {
  it("treats Colors/Rainbow/Stripes/Circles as animated", () => {
    expect(colorIsAnimated(normalizeColor("Colors"))).toBe(true);
    expect(colorIsAnimated(normalizeColor("Rainbow"))).toBe(true);
    expect(colorIsAnimated(normalizeColor("Stripes"))).toBe(true);
    expect(colorIsAnimated(normalizeColor("Circles"))).toBe(true);
    expect(colorIsAnimated(normalizeColor("Normal"))).toBe(false);
    expect(colorIsAnimated(normalizeColor("Red"))).toBe(false);
  });

  it("animates the subject with Colour alone (style none)", async () => {
    const image = await solidPng();
    const result = await renderOffline({
      image,
      animation: "none",
      format: "gif",
      size: "128",
      color: "Colors",
    });
    expect(result.bytes).toBeGreaterThan(500);
    expect(result.bytes).toBeLessThan(256 * 1024);
    const meta = await sharp(result.buffer, { animated: true }).metadata();
    expect(meta.pages ?? 1).toBeGreaterThan(1);
  }, 60_000);

  it("stacks Colour under a motion style", async () => {
    const image = await solidPng();
    const result = await renderOffline({
      image,
      animation: "shake",
      format: "gif",
      size: "128",
      color: "Rainbow",
    });
    expect(result.providerId).toBe("offline");
    expect(result.bytes).toBeLessThan(256 * 1024);
    const meta = await sharp(result.buffer, { animated: true }).metadata();
    expect(meta.width).toBe(128);
    expect(meta.pages ?? 1).toBeGreaterThan(1);
  }, 60_000);
});
