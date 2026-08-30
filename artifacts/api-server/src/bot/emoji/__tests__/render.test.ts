import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { EmojiError, effectIds, renderEmoji, getEffect } from "../index.js";
import { countGifFrames, imageFacts, testImage } from "./fixtures.js";

const BASE = { speed: "normal", direction: "right", size: 128, format: "gif" } as const;

describe("renderEmoji", () => {
  it("renders every registered effect to a valid, loopable GIF", async () => {
    const image = await testImage();
    for (const id of effectIds()) {
      const result = await renderEmoji(image, { ...BASE, effect: id });
      expect(result.buffer.subarray(0, 6).toString("ascii"), id).toMatch(/^GIF8[79]a$/);
      expect(result.bytes, id).toBeGreaterThan(0);
      expect(countGifFrames(result.buffer), id).toBe(getEffect(id)!.frames);
    }
  }, 120_000);

  it("renders a still PNG with its alpha channel intact", async () => {
    const result = await renderEmoji(await testImage(), { ...BASE, effect: "shake", format: "png" });
    const meta = await imageFacts(result.buffer);
    expect(meta.format).toBe("png");
    expect(meta.width).toBe(128);
    expect(meta.height).toBe(128);
    expect(meta.hasAlpha).toBe(true);
    expect(result.frames).toBe(1);
  }, 30_000);

  it("honours the requested size", async () => {
    const image = await testImage();
    for (const size of [32, 64, 128] as const) {
      const result = await renderEmoji(image, { ...BASE, effect: "pulse", size, format: "png" });
      const meta = await imageFacts(result.buffer);
      expect(meta.width, `${size}`).toBe(size);
    }
  }, 30_000);

  it("keeps the background transparent", async () => {
    const result = await renderEmoji(await testImage(), { ...BASE, effect: "pulse", format: "png" });
    const { data, info } = await sharp(result.buffer).raw().toBuffer({ resolveWithObject: true });
    // The very first pixel is the top-left corner, which no effect fills.
    const alpha = data[info.channels - 1];
    expect(alpha).toBe(0);
  }, 30_000);

  it("produces different bytes for different speeds", async () => {
    const image = await testImage();
    const slow = await renderEmoji(image, { ...BASE, effect: "shake", speed: "slow" });
    const fast = await renderEmoji(image, { ...BASE, effect: "shake", speed: "turbo" });
    // Same frames, different delay bytes in the graphic-control extensions.
    expect(slow.buffer.equals(fast.buffer)).toBe(false);
  }, 30_000);

  it("produces different output for opposing directions on a directional effect", async () => {
    const image = await testImage();
    const right = await renderEmoji(image, { ...BASE, effect: "slide", direction: "right" });
    const left = await renderEmoji(image, { ...BASE, effect: "slide", direction: "left" });
    expect(right.buffer.equals(left.buffer)).toBe(false);
  }, 30_000);

  it("is deterministic — identical options give identical bytes", async () => {
    const image = await testImage();
    const a = await renderEmoji(image, { ...BASE, effect: "glitch" });
    const b = await renderEmoji(image, { ...BASE, effect: "glitch" });
    expect(a.buffer.equals(b.buffer)).toBe(true);
  }, 30_000);

  it("stays inside Discord's 256 KB custom-emoji limit at default settings", async () => {
    const image = await testImage();
    for (const id of effectIds()) {
      const result = await renderEmoji(image, { ...BASE, effect: id });
      expect(result.bytes, id).toBeLessThan(256 * 1024);
    }
  }, 120_000);

  it("dissolves rather than blinks when an effect animates alpha", async () => {
    // GIF alpha is 1 bit. With a hard cutoff, `fade` snapped between fully
    // visible and fully gone; ordered dithering is what makes it a real fade.
    // Assert the opaque-pixel count ramps instead of flipping between 0 and all.
    const result = await renderEmoji(await testImage(), { ...BASE, effect: "fade" });
    const counts: number[] = [];
    for (let page = 0; page < getEffect("fade")!.frames; page++) {
      const { data, info } = await sharp(result.buffer, { page, animated: false })
        .ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      let opaque = 0;
      for (let i = 0; i < data.length; i += info.channels) {
        if (data[i + info.channels - 1]! > 200) opaque++;
      }
      counts.push(opaque);
    }

    // Every frame shows something, and the extremes differ substantially.
    expect(Math.min(...counts)).toBeGreaterThan(0);
    expect(Math.max(...counts)).toBeGreaterThan(Math.min(...counts) * 3);
    // A blink would give only two distinct values; a dissolve gives many.
    expect(new Set(counts).size).toBeGreaterThan(4);
  }, 30_000);

  it("rejects an unknown effect with a typed error", async () => {
    await expect(renderEmoji(await testImage(), { ...BASE, effect: "nope" }))
      .rejects.toMatchObject({ code: "unknown_effect" });
  }, 30_000);

  it("rejects bytes that aren't an image", async () => {
    const err = await renderEmoji(Buffer.from("not an image at all"), { ...BASE, effect: "shake" })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(EmojiError);
    expect((err as EmojiError).code).toBe("not_an_image");
  }, 30_000);
});
