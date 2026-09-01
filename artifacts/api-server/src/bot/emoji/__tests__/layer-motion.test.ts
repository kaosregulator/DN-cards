import { describe, expect, it, beforeAll, afterAll } from "vitest";
import sharp from "sharp";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { renderOffline } from "../providers/offline/index.js";
import { loadLayerMeta } from "../providers/offline/layer-pack.js";
import { reloadOfflineRegistry, offlinePackageRoot } from "../providers/offline/registry.js";

const prev = process.env.EMOJI_ALLOW_OFFLINE_FALLBACK;

/** Solid red circle — easy to locate after compositing. */
async function redSubject(size = 256): Promise<Buffer> {
  const buf = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = x - size / 2, dy = y - size / 2;
      const i = (y * size + x) * 4;
      if (dx * dx + dy * dy < (size * 0.42) ** 2) {
        buf[i] = 220; buf[i + 1] = 30; buf[i + 2] = 30; buf[i + 3] = 255;
      }
    }
  }
  return sharp(buf, { raw: { width: size, height: size, channels: 4 } }).png().toBuffer();
}

/**
 * Centroid of near-primary-red opaque pixels in one GIF frame.
 * Note: `{ page, animated: true }` returns a multi-page strip in sharp — use
 * `{ page }` alone so each frame is a single `size×size` bitmap.
 */
async function redCentroid(gif: Buffer, page: number): Promise<{ x: number; y: number; count: number } | null> {
  const { data, info } = await sharp(gif, { page })
    .ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const w = info.width, h = info.height, ch = info.channels;
  // Guard against accidental strip reads (would inflate travel falsely).
  if (h > w * 2) {
    throw new Error(`expected single GIF page, got ${w}x${h}`);
  }
  let sx = 0, sy = 0, n = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * ch;
      if (data[i + ch - 1]! < 80) continue;
      if (data[i]! > 150 && data[i + 1]! < 110 && data[i + 2]! < 110) {
        sx += x; sy += y; n++;
      }
    }
  }
  return n > 20 ? { x: sx / n, y: sy / n, count: n } : null;
}

describe("per-frame subject animation (green-screen packs)", () => {
  beforeAll(() => {
    process.env.EMOJI_ALLOW_OFFLINE_FALLBACK = "1";
    reloadOfflineRegistry();
  });
  afterAll(() => {
    if (prev === undefined) delete process.env.EMOJI_ALLOW_OFFLINE_FALLBACK;
    else process.env.EMOJI_ALLOW_OFFLINE_FALLBACK = prev;
  });

  it("stores per-frame slot motion data for animated styles", () => {
    for (const id of ["shake", "bounce", "pet", "spin"]) {
      const meta = loadLayerMeta(id);
      expect(meta, id).toBeTruthy();
      expect(meta!.perFrame?.length, id).toBeGreaterThan(1);
      expect(meta!.animationMode).toBe("per-frame-slot-mask");
      const root = offlinePackageRoot();
      expect(root).toBeTruthy();
      expect(existsSync(join(root!, "layers", id, "slot.png")), id).toBe(true);
    }
    const shake = loadLayerMeta("shake")!;
    expect(shake.motionPx ?? 0).toBeGreaterThan(4);
    const bounce = loadLayerMeta("bounce")!;
    expect(bounce.motionPx ?? 0).toBeGreaterThan(4);
  });

  it("moves the user image with shake (not a static stamp)", async () => {
    const image = await redSubject();
    const result = await renderOffline({
      image, animation: "shake", format: "gif", size: "128",
    });
    expect(result.buffer.subarray(0, 3).toString("ascii")).toBe("GIF");

    const meta = await sharp(result.buffer, { animated: true }).metadata();
    const pages = meta.pages || 1;
    expect(pages).toBeGreaterThan(3);

    const centroids: { x: number; y: number }[] = [];
    for (let p = 0; p < pages; p++) {
      const c = await redCentroid(result.buffer, p);
      if (c) centroids.push(c);
    }
    expect(centroids.length).toBeGreaterThan(3);
    const xs = centroids.map(c => c.x);
    const ys = centroids.map(c => c.y);
    const travel = Math.hypot(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
    // Static union-bbox stamp would keep the subject nearly parked; shake must move.
    expect(travel, `shake travel=${travel}`).toBeGreaterThan(3);
  }, 60_000);

  it("moves/scales the user image with bounce", async () => {
    const image = await redSubject();
    const result = await renderOffline({
      image, animation: "bounce", format: "gif", size: "128",
    });
    const meta = await sharp(result.buffer, { animated: true }).metadata();
    const pages = meta.pages || 1;
    const centroids: { x: number; y: number; count: number }[] = [];
    for (let p = 0; p < pages; p++) {
      const c = await redCentroid(result.buffer, p);
      if (c) centroids.push(c);
    }
    expect(centroids.length).toBeGreaterThan(3);
    const ys = centroids.map(c => c.y);
    const yTravel = Math.max(...ys) - Math.min(...ys);
    expect(yTravel, `bounce yTravel=${yTravel}`).toBeGreaterThan(2);
  }, 60_000);

  it("pets the moving/squashed subject under the hand overlay", async () => {
    const image = await redSubject();
    const result = await renderOffline({
      image, animation: "pet", format: "gif", size: "128",
    });
    const pack = loadLayerMeta("pet")!;
    expect(pack.motionPx ?? 0).toBeGreaterThan(4);

    const meta = await sharp(result.buffer, { animated: true }).metadata();
    const pages = meta.pages || 1;
    const centroids: { x: number; y: number }[] = [];
    for (let p = 0; p < Math.min(pages, pack.frames); p++) {
      const c = await redCentroid(result.buffer, p);
      if (c) centroids.push(c);
    }
    expect(centroids.length).toBeGreaterThan(2);
    const ys = centroids.map(c => c.y);
    expect(Math.max(...ys) - Math.min(...ys)).toBeGreaterThan(1.5);
  }, 60_000);

  it("follows large subject area changes for pokeball-go", async () => {
    const pack = loadLayerMeta("pokeball-go")!;
    expect(pack.perFrame?.length).toBeGreaterThan(5);
    expect(pack.areaRatio ?? 1).toBeGreaterThan(2);
    const areas = (pack.perFrame || []).filter(f => f.visible).map(f => f.w * f.h);
    expect(Math.max(...areas) / Math.max(1, Math.min(...areas))).toBeGreaterThan(2);

    const image = await redSubject();
    const result = await renderOffline({
      image, animation: "pokeball-go", format: "gif", size: "128",
    });
    expect(result.bytes).toBeGreaterThan(1000);
    // At least some frames show the red subject (when ball is open / face visible).
    let seen = 0;
    const pages = (await sharp(result.buffer, { animated: true }).metadata()).pages || 1;
    for (let p = 0; p < pages; p++) {
      if (await redCentroid(result.buffer, p)) seen++;
    }
    expect(seen).toBeGreaterThan(0);
  }, 90_000);
});
