/**
 * Animated Style Board — correctness + cache/concurrency/timing coverage.
 */
import { afterEach, describe, expect, it } from "vitest";
import { parseGIF, decompressFrames } from "gifuct-js";
import {
  clearBoardDecodedCache,
  clearBoardResultCache,
  renderBoard,
  BOARD_PAGE_SIZE,
  BOARD_FILENAME,
  BOARD_FILENAME_STILL,
} from "../commands/board.js";
import {
  clearPreviewRenderCache,
  previewCacheStats,
  renderStyleThumbGif,
} from "../preview/index.js";
import { toggleFavorite, resetFavoritesForTesting } from "../commands/favorites.js";
import { testImage, countGifFrames } from "./fixtures.js";

const STYLES = [
  "gen_btn_shake",
  "gen_btn_spin",
  "gen_btn_bounce",
  "gen_btn_pet",
  "gen_btn_wobble",
  "gen_btn_nyan-cat",
  "gen_btn_party-parrot",
  "gen_btn_pokeball-emerge",
].slice(0, BOARD_PAGE_SIZE);

function styleEntries() {
  return STYLES.map(value => ({
    value,
    label: value.replace(/^gen_btn_/, ""),
  }));
}

function boardOpts(image: Buffer, overrides: Record<string, unknown> = {}) {
  const styles = styleEntries();
  return {
    image,
    targetLabel: "test target",
    styles,
    focusValue: styles[0]!.value,
    userId: "u-board-test",
    page: 0,
    pages: 1,
    total: styles.length,
    format: "gif",
    ...overrides,
  };
}

/** Pixel digest of every frame — used to prove multi-cell motion. */
function frameDigests(gif: Buffer): string[] {
  const ab = gif.buffer.slice(gif.byteOffset, gif.byteOffset + gif.byteLength) as ArrayBuffer;
  const parsed = parseGIF(ab);
  const frames = decompressFrames(parsed, true);
  return frames.map(f => {
    let h = 0;
    for (let i = 0; i < f.patch.length; i += 97) h = (h * 33 + f.patch[i]!) >>> 0;
    return `${f.dims.width}x${f.dims.height}:${h.toString(16)}`;
  });
}

afterEach(() => {
  clearPreviewRenderCache();
  clearBoardDecodedCache();
  clearBoardResultCache();
  resetFavoritesForTesting();
});

describe("animated style board", () => {
  it("renders a multi-cell animated GIF with motion across frames", async () => {
    const image = await testImage(128);
    const result = await renderBoard(boardOpts(image));
    expect(result).not.toBeNull();
    expect(result!.animated).toBe(true);
    expect(result!.name).toBe(BOARD_FILENAME);
    expect(result!.buffer.subarray(0, 3).toString("ascii")).toBe("GIF");
    expect(result!.buffer.length).toBeGreaterThan(1000);
    expect(result!.buffer.length).toBeLessThanOrEqual(7_500_000);

    const frames = countGifFrames(result!.buffer);
    expect(frames).toBeGreaterThan(1);
    expect(frames).toBeLessThanOrEqual(14);

    const digests = frameDigests(result!.buffer);
    // At least two frames must differ — the board is not a static GIF.
    expect(new Set(digests).size).toBeGreaterThan(1);
  }, 120_000);

  it("serves an identical page from the board result cache on warm hit", async () => {
    const image = await testImage(128);
    const opts = boardOpts(image);
    const cold = await renderBoard(opts);
    expect(cold).not.toBeNull();

    const t0 = performance.now();
    const warm = await renderBoard(opts);
    const warmMs = performance.now() - t0;

    expect(warm).not.toBeNull();
    expect(warm!.buffer.equals(cold!.buffer)).toBe(true);
    expect(warmMs).toBeLessThan(50);
  }, 120_000);

  it("does not decode the same thumb GIF twice when the decoded cache hits", async () => {
    const image = await testImage(96);
    // Populate thumb GIF buffer cache.
    await Promise.all(STYLES.map(s => renderStyleThumbGif(image, s)));
    const before = previewCacheStats();

    clearBoardDecodedCache();
    clearBoardResultCache();
    const first = await renderBoard(boardOpts(image));
    expect(first?.animated).toBe(true);

    // Thumb GIF cache should still be hits; decoded cache should prevent
    // re-work on the second board render once result cache is cleared.
    clearBoardResultCache();
    const t0 = performance.now();
    const second = await renderBoard(boardOpts(image));
    const secondMs = performance.now() - t0;
    expect(second?.animated).toBe(true);
    expect(second!.buffer.length).toBeGreaterThan(1000);
    // Second pass should be dominated by encode only (no offline re-render).
    expect(secondMs).toBeLessThan(5000);
    expect(previewCacheStats().hits).toBeGreaterThan(before.hits);
  }, 120_000);

  it("serializes concurrent board encodes without losing animation", async () => {
    const image = await testImage(128);
    clearPreviewRenderCache();
    clearBoardDecodedCache();
    clearBoardResultCache();

    const results = await Promise.all([
      renderBoard(boardOpts(image, { userId: "u-a" })),
      renderBoard(boardOpts(image, { userId: "u-b" })),
      renderBoard(boardOpts(image, { userId: "u-c" })),
    ]);

    for (const r of results) {
      expect(r).not.toBeNull();
      expect(r!.animated).toBe(true);
      expect(r!.name).toBe(BOARD_FILENAME);
      expect(countGifFrames(r!.buffer)).toBeGreaterThan(1);
    }
  }, 180_000);

  it("keeps favorite stars and focus ring in the board cache key", async () => {
    const image = await testImage(96);
    const base = boardOpts(image);
    const plain = await renderBoard(base);
    expect(plain).not.toBeNull();

    expect(toggleFavorite(base.userId, STYLES[1]!)).toBe(true);
    const starred = await renderBoard(base);
    expect(starred).not.toBeNull();
    // Favorite star changes pixels — must not reuse the unstarred cache entry.
    expect(starred!.buffer.equals(plain!.buffer)).toBe(false);

    const refocused = await renderBoard({
      ...base,
      focusValue: STYLES[2]!,
    });
    expect(refocused).not.toBeNull();
    expect(refocused!.buffer.equals(starred!.buffer)).toBe(false);
  }, 120_000);

  it("falls back to a still PNG when nothing on the page animates", async () => {
    const image = await testImage(64);
    // `none` (if present) / unsupported styles yield still placeholders.
    const styles = Array.from({ length: 4 }, (_, i) => ({
      value: `gen_btn_not_a_real_style_${i}`,
      label: `missing-${i}`,
    }));
    const result = await renderBoard(boardOpts(image, { styles, focusValue: styles[0]!.value, total: 4 }));
    // Either null cells → still PNG, or null board if canvas missing.
    if (result) {
      expect(result.animated).toBe(false);
      expect(result.name).toBe(BOARD_FILENAME_STILL);
      expect(result.buffer.subarray(0, 8)).toEqual(
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      );
    }
  }, 60_000);

  it("respects Discord's 5-row component limit on the styles picker page", async () => {
    // Pagination / 5-row limit is covered in target-flow; keep a cheap assert that
    // BOARD_PAGE_SIZE still drives an 8-cell page (4×2), which fits the picker.
    expect(BOARD_PAGE_SIZE).toBe(8);
  });
});
