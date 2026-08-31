import { beforeEach, describe, expect, it } from "vitest";
import {
  clearPreviewRenderCache, previewCacheStats, previewKey,
  prefetchStylePreviews, renderStylePreview, targetHash,
} from "../preview/index.js";
import { testImage } from "./fixtures.js";

describe("target hashing", () => {
  it("is stable for identical bytes and different for different bytes", async () => {
    const a = await testImage(64);
    const b = await testImage(96);
    expect(targetHash(a)).toBe(targetHash(a));
    expect(targetHash(a)).not.toBe(targetHash(b));
  });

  it("keys previews by target as well as style", () => {
    // Without the target in the key, one member's avatar preview could be
    // served for another's.
    expect(previewKey("hashA", "gen_btn_shake")).not.toBe(previewKey("hashB", "gen_btn_shake"));
    expect(previewKey("hashA", "gen_btn_shake")).not.toBe(previewKey("hashA", "gen_btn_spin"));
  });
});

describe("style previews", () => {
  beforeEach(() => clearPreviewRenderCache());

  it("renders the user's own image, animated", async () => {
    const preview = await renderStylePreview(await testImage(128), "gen_btn_shake");
    expect(preview).not.toBeNull();
    expect(preview!.subarray(0, 3).toString("ascii")).toBe("GIF");
    expect(preview!.length).toBeGreaterThan(0);
  }, 60_000);

  it("produces a different picture for a different style", async () => {
    // The whole point of the feature: browsing has to show what each style
    // actually does to this image.
    const image = await testImage(128);
    const shake = await renderStylePreview(image, "gen_btn_shake");
    const spin = await renderStylePreview(image, "gen_btn_spin");
    expect(shake).not.toBeNull();
    expect(spin).not.toBeNull();
    expect(shake!.equals(spin!)).toBe(false);
  }, 60_000);

  it("produces a different picture for a different target", async () => {
    const a = await renderStylePreview(await testImage(128), "gen_btn_shake");
    const b = await renderStylePreview(await testImage(96), "gen_btn_shake");
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    expect(a!.equals(b!)).toBe(false);
  }, 60_000);

  it("serves a repeat from cache instead of re-rendering", async () => {
    const image = await testImage(128);
    await renderStylePreview(image, "gen_btn_shake");
    const before = previewCacheStats();
    await renderStylePreview(image, "gen_btn_shake");
    const after = previewCacheStats();
    expect(after.hits).toBe(before.hits + 1);
    expect(after.entries).toBe(before.entries);
  }, 60_000);

  it("stays small — a preview is a thumbnail, not the artefact", async () => {
    const preview = await renderStylePreview(await testImage(256), "gen_btn_shake");
    // Comfortably under Discord's embed image handling and cheap to cache.
    expect(preview!.length).toBeLessThan(512 * 1024);
  }, 60_000);

  it("returns null rather than throwing for an unknown style", async () => {
    // Browsing must never fail because one style cannot be drawn locally; the
    // caller falls back to the CDN thumbnail.
    expect(await renderStylePreview(await testImage(64), "gen_btn_not_a_style")).toBeNull();
  }, 30_000);

  it("prefetches without throwing and populates the cache", async () => {
    const image = await testImage(96);
    prefetchStylePreviews(image, ["gen_btn_shake", "gen_btn_spin"]);
    await new Promise(resolve => setTimeout(resolve, 2500));
    expect(previewCacheStats().entries).toBeGreaterThan(0);
  }, 60_000);

  it("bounds the cache", async () => {
    const image = await testImage(64);
    for (let i = 0; i < 40; i++) await renderStylePreview(image, "gen_btn_shake");
    const stats = previewCacheStats();
    expect(stats.entries).toBeLessThanOrEqual(400);
    expect(stats.bytes).toBeLessThanOrEqual(32 * 1024 * 1024);
  }, 60_000);
});
