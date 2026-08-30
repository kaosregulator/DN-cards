import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { EmojiError, normalizeSource } from "../index.js";
import { assertPublicHttpUrl } from "../utils/source.js";
import { imageFacts, testImage, toJpeg } from "./fixtures.js";

describe("assertPublicHttpUrl", () => {
  it("accepts ordinary public https URLs", () => {
    expect(assertPublicHttpUrl("https://cdn.discordapp.com/a/b.png").hostname)
      .toBe("cdn.discordapp.com");
  });

  it("rejects non-http schemes", () => {
    // file:// and friends would read the bot's own disk.
    for (const url of ["file:///etc/passwd", "ftp://x/y", "data:image/png;base64,AAAA"]) {
      expect(() => assertPublicHttpUrl(url), url).toThrow(EmojiError);
    }
  });

  it("rejects loopback and private-network hosts", () => {
    // Without this the bot is an SSRF proxy into its own network.
    const blocked = [
      "http://localhost/x", "http://127.0.0.1/x", "http://[::1]/x",
      "http://10.0.0.5/x", "http://192.168.1.1/x", "http://172.16.0.1/x",
      "http://169.254.169.254/latest/meta-data/", "http://redis.internal/x",
    ];
    for (const url of blocked) {
      expect(() => assertPublicHttpUrl(url), url).toThrow(EmojiError);
    }
  });

  it("rejects malformed input", () => {
    expect(() => assertPublicHttpUrl("not a url")).toThrow(EmojiError);
  });
});

describe("normalizeSource", () => {
  it("produces an RGBA PNG bounded to the working size", async () => {
    const meta = await imageFacts(await normalizeSource(await testImage(1024)));
    expect(meta.format).toBe("png");
    expect(meta.hasAlpha).toBe(true);
    expect(Math.max(meta.width ?? 0, meta.height ?? 0)).toBeLessThanOrEqual(320);
  });

  it("adds an alpha channel to formats that lack one", async () => {
    // JPEG has no alpha channel at all, so this is the real-world case: a photo
    // that must still composite cleanly over a transparent emoji frame.
    const jpeg = await toJpeg(await testImage(256));
    const meta = await imageFacts(await normalizeSource(jpeg));
    expect(meta.hasAlpha).toBe(true);
  });

  it("never upscales a small source", async () => {
    const meta = await imageFacts(await normalizeSource(await testImage(64)));
    expect(meta.width).toBe(64);
  });

  it("takes the first frame of an animated GIF", async () => {
    const gif = await sharp(await testImage(128)).gif().toBuffer();
    const meta = await imageFacts(await normalizeSource(gif));
    expect(meta.format).toBe("png");
  });

  it("rejects bytes that aren't an image", async () => {
    await expect(normalizeSource(Buffer.from("hello"))).rejects.toMatchObject({
      code: "not_an_image",
    });
  });
});
