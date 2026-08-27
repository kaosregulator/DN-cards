import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { EMOJI_EFFECTS, renderEmojiGif, OUT } from "../effects.js";

describe("renderEmojiGif (margin/bleed compose)", () => {
  it("has effects loaded from the pack manifest", () => {
    expect(EMOJI_EFFECTS.length).toBeGreaterThan(0);
  });

  it("renders a valid transparent GIF for the first few effects", async () => {
    const subject = await sharp({
      create: { width: 96, height: 96, channels: 4, background: { r: 80, g: 120, b: 200, alpha: 255 } },
    }).png().toBuffer();

    for (const eff of EMOJI_EFFECTS.slice(0, 3)) {
      const gif = await renderEmojiGif(subject, eff.id);
      expect(gif, `effect ${eff.id} should render`).toBeTruthy();
      expect(gif!.length).toBeGreaterThan(0);
      // GIF header + logical screen size == OUT×OUT (nothing changed the canvas size).
      expect(gif!.subarray(0, 6).toString("ascii")).toMatch(/^GIF8[79]a$/);
      expect(gif!.readUInt16LE(6)).toBe(OUT);
      expect(gif!.readUInt16LE(8)).toBe(OUT);
    }
  });

  it("returns null for an unknown effect id", async () => {
    const subject = await sharp({
      create: { width: 8, height: 8, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 255 } },
    }).png().toBuffer();
    expect(await renderEmojiGif(subject, "does-not-exist")).toBeNull();
  });
});
