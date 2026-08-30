import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import {
  implementedOfflineStyles, loadOfflineManifest, loadOfflineStyles,
  reloadOfflineRegistry, findOfflineStyle,
} from "../providers/offline/registry.js";
import { findRecipe, loadRecipes, readyRecipes, reloadRecipes } from "../providers/offline/recipes.js";
import { renderOffline } from "../providers/offline/renderer.js";
import { effectFromPrimitive } from "../providers/offline/primitives.js";
import { resolveOverlayPath } from "../providers/offline/overlay.js";
import { testImage } from "./fixtures.js";

const prev = process.env.EMOJI_ALLOW_OFFLINE_FALLBACK;

describe("offline recipe engine", () => {
  beforeAll(() => {
    process.env.EMOJI_ALLOW_OFFLINE_FALLBACK = "1";
    reloadOfflineRegistry();
    reloadRecipes();
  });

  afterAll(() => {
    if (prev === undefined) delete process.env.EMOJI_ALLOW_OFFLINE_FALLBACK;
    else process.env.EMOJI_ALLOW_OFFLINE_FALLBACK = prev;
  });

  it("loads classification recipes for the full catalog", () => {
    const recipes = loadRecipes();
    expect(recipes.length).toBeGreaterThanOrEqual(400);
    const ready = readyRecipes();
    expect(ready.length).toBeGreaterThanOrEqual(100);
    expect(ready.every(r => r.primitive)).toBe(true);
  });

  it("keeps the package offlineReady=false until full coverage", () => {
    const m = loadOfflineManifest();
    expect(m?.offlineReady).toBe(false);
    expect(m?.implementedStyleCount ?? 0).toBeGreaterThanOrEqual(100);
  });

  it("syncs implemented styles from recipes", () => {
    const impl = implementedOfflineStyles();
    expect(impl.length).toBeGreaterThanOrEqual(100);
    expect(findOfflineStyle("shake")?.offlineImplemented).toBe(true);
    expect(findOfflineStyle("peepo")?.offlineImplemented).toBe(true);
    expect(findOfflineStyle("party-parrot")?.offlineImplemented).toBe(false);
  });

  it("builds transform primitives used by recipes", () => {
    for (const id of ["shake", "bounce", "spin", "orbit", "wave", "tilt", "nod", "rainbow", "passthrough"]) {
      expect(effectFromPrimitive(id), id).toBeTruthy();
    }
  });

  it("has archived overlay assets for ready overlay recipes", () => {
    const overlays = readyRecipes().filter(r => r.family === "overlay");
    expect(overlays.length).toBeGreaterThanOrEqual(20);
    for (const r of overlays.slice(0, 10)) {
      expect(resolveOverlayPath(r.slug), r.slug).toBeTruthy();
    }
  });

  it("renders transform, overlay, and passthrough styles to GIF", async () => {
    const image = await testImage(128);
    const samples = ["none", "shake", "bounce", "spin", "peepo", "angel", "cowboy"];
    for (const animation of samples) {
      const recipe = findRecipe(animation);
      expect(recipe?.offlineReady, animation).toBe(true);
      const result = await renderOffline({
        image, animation, format: "gif", size: "64", speed: "normal",
      });
      expect(result.providerId).toBe("offline");
      expect(result.buffer.length).toBeGreaterThan(100);
      expect(result.buffer.subarray(0, 3).toString("ascii")).toBe("GIF");
    }
  }, 60_000);

  it("refuses atlas styles that are not offline-ready yet", async () => {
    const image = await testImage(64);
    await expect(renderOffline({
      image, animation: "party-parrot", format: "gif", size: "64",
    })).rejects.toThrow(/not implemented offline/i);
  });

  it("writes a small contact-sheet sample for visual review", async () => {
    const image = await testImage(128);
    const outDir = "/opt/cursor/artifacts/offline-contact";
    mkdirSync(outDir, { recursive: true });
    const styles = ["none", "shake", "bounce", "wobble", "glitch", "peepo", "angel", "heartbeat"];
    const summary: { style: string; bytes: number }[] = [];
    for (const animation of styles) {
      const result = await renderOffline({
        image, animation, format: "gif", size: "64", speed: "normal",
      });
      writeFileSync(join(outDir, `${animation}.gif`), result.buffer);
      summary.push({ style: animation, bytes: result.bytes });
    }
    writeFileSync(join(outDir, "summary.json"), JSON.stringify({
      implemented: readyRecipes().length,
      total: loadOfflineStyles().length,
      sample: summary,
    }, null, 2));
    expect(existsSync(join(outDir, "shake.gif"))).toBe(true);
  }, 60_000);
});
