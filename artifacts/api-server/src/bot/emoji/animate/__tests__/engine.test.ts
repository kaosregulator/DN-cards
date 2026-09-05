// Engine smoke + invariants: the compositor must render a real animated GIF for
// any subject (face or not), the planner must always yield a faceless fallback,
// and the cache must collapse identical requests.

import { describe, it, expect, beforeAll } from "vitest";
import sharp from "sharp";
import {
  loadMotionLibrary, planCandidates, renderCandidate, renderCandidates,
  buildRecipe, explain, credit, sampleCurve, hashImage, animateCacheStats,
  clearAnimateCache, GESTURES, UNIVERSAL_GESTURE, BUILTIN_TRACKS,
  detectFeatures, describeMapping,
} from "../index.js";
import type { MotionLibrary } from "../index.js";

/** A plain non-face target: a magenta square, like a gem/logo emoji. */
async function squarePng(): Promise<Buffer> {
  return sharp({
    create: { width: 96, height: 96, channels: 4, background: { r: 220, g: 40, b: 200, alpha: 1 } },
  }).png().toBuffer();
}

/** A cartoon face with two dark eyes and a dark mouth, on transparent bg. */
async function facePng(): Promise<Buffer> {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="160" height="160">
    <circle cx="80" cy="80" r="70" fill="#ffcf3f"/>
    <circle cx="58" cy="66" r="11" fill="#222"/><circle cx="102" cy="66" r="11" fill="#222"/>
    <ellipse cx="80" cy="112" rx="34" ry="16" fill="#222"/>
  </svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

/** GIF magic bytes. */
function isGif(buf: Buffer): boolean {
  return buf.length > 6 && buf.toString("ascii", 0, 3) === "GIF";
}

let lib: MotionLibrary;
beforeAll(async () => {
  // Force the builtin library so the test never depends on a harvested file.
  process.env.ANIMATE_MOTION_LIBRARY = "/nonexistent/animate-lib.json";
  lib = await loadMotionLibrary();
});

describe("sampler", () => {
  it("interpolates linearly and holds the ends", () => {
    const curve = [{ t: 0, v: 0 }, { t: 0.5, v: 1 }, { t: 1, v: 0 }];
    expect(sampleCurve(curve, 0, 0)).toBeCloseTo(0);
    expect(sampleCurve(curve, 0.25, 0)).toBeCloseTo(0.5);
    expect(sampleCurve(curve, 0.5, 0)).toBeCloseTo(1);
    expect(sampleCurve(curve, 0.75, 0)).toBeCloseTo(0.5);
  });
  it("wraps phase modulo 1 for a seamless loop", () => {
    const curve = [{ t: 0, v: 0 }, { t: 1, v: 10 }];
    expect(sampleCurve(curve, 1.25, 0)).toBeCloseTo(sampleCurve(curve, 0.25, 0));
  });
});

describe("library", () => {
  it("loads the builtin set with at least one track per region", () => {
    expect(lib.origin).toBe("builtin");
    for (const region of ["global", "eyes", "mouth", "brows", "cheeks", "effect"] as const) {
      expect(lib.tracks.some(t => t.region === region), `region ${region}`).toBe(true);
    }
  });
  it("every builtin track carries traceable provenance", () => {
    for (const t of BUILTIN_TRACKS) {
      expect(t.source.name).toBeTruthy();
      expect(["noto", "builtin", "community", "custom"]).toContain(t.source.origin);
    }
  });
});

describe("planner", () => {
  it("maps 'yawn' to the yawn gesture with a mouth part", () => {
    const recipes = planCandidates({ prompt: "make him yawn", library: lib, intensity: "normal", speedFactor: 1 });
    expect(recipes.length).toBeGreaterThan(0);
    expect(recipes[0]!.tracks.mouth).toBeTruthy();
    expect(explain(recipes[0]!)).toContain("mouth");
  });
  it("always includes a faceless universal fallback candidate", () => {
    const recipes = planCandidates({ prompt: "yawn", library: lib, intensity: "normal", speedFactor: 1 });
    // The universal recipe drives only global (+effects), no warp bands.
    const universal = recipes.find(r => r.tracks.global && !r.tracks.mouth && !r.tracks.eyes);
    expect(universal, "a global-only fallback must be offered").toBeTruthy();
  });
  it("escalates cry with a shake at insane that normal lacks", () => {
    const cry = GESTURES.find(g => g.id === "cry")!;
    const normal = buildRecipe(cry, lib, { intensity: "normal", speedFactor: 1 });
    const insane = buildRecipe(cry, lib, { intensity: "insane", speedFactor: 1 });
    expect(insane.effects.length).toBeGreaterThanOrEqual(normal.effects.length);
    // insane adds a global shake the normal cry doesn't call for.
    expect(insane.tracks.global?.tags.includes("shake")).toBe(true);
  });
  it("handles a prompt that names no gesture without throwing", () => {
    const recipes = planCandidates({ prompt: "zorple the quux", library: lib, intensity: "normal", speedFactor: 1 });
    expect(recipes.length).toBeGreaterThan(0);
  });
});

describe("feature detection (target-adaptive)", () => {
  it("finds two eyes + a mouth on a cartoon face, target-relative", async () => {
    const f = await detectFeatures(await facePng());
    expect(f.eyes.length).toBe(2);
    expect(f.mouth).toBeTruthy();
    expect(f.confidence).toBeGreaterThan(0.28);
    // Eyes above the mouth, both inside the image.
    const eyeY = (f.eyes[0]!.cy + f.eyes[1]!.cy) / 2;
    expect(eyeY).toBeLessThan(f.mouth!.cy);
    for (const e of f.eyes) { expect(e.cx).toBeGreaterThan(0); expect(e.cx).toBeLessThan(1); }
  });
  it("reports no face on a flat square, so facial regions are dropped", async () => {
    const f = await detectFeatures(await squarePng());
    expect(f.eyes.length).toBe(0);
    expect(f.confidence).toBeLessThan(0.28);
  });
  it("describeMapping shows facial regions DROPPED when no face", async () => {
    const f = await detectFeatures(await squarePng());
    const recipe = buildRecipe(GESTURES.find(g => g.id === "cry")!, lib, { intensity: "normal", speedFactor: 1 });
    const lines = describeMapping(recipe, f).join("\n");
    expect(lines).toContain("whole-object");
    if (recipe.tracks.eyes) expect(lines).toMatch(/eyes:.*DROPPED/);
  });
});

describe("compositor + renderer", () => {
  it("renders an animated GIF for a NON-face square target", async () => {
    const img = await squarePng();
    const recipe = buildRecipe(UNIVERSAL_GESTURE, lib, { intensity: "normal", speedFactor: 1 });
    const cand = await renderCandidate({ image: img, recipe, size: 64 });
    expect(isGif(cand.buffer)).toBe(true);
    expect(cand.bytes).toBeGreaterThan(0);
    expect(cand.frames).toBeGreaterThan(1);
  });

  it("renders a facial recipe (yawn) on the same neutral target", async () => {
    const img = await squarePng();
    const recipe = buildRecipe(GESTURES.find(g => g.id === "yawn")!, lib, { intensity: "dramatic", speedFactor: 1 });
    const cand = await renderCandidate({ image: img, recipe, size: 64 });
    expect(isGif(cand.buffer)).toBe(true);
    expect(cand.credit).toContain("borrowed from");
  });

  it("renders multiple candidates and each is a valid GIF", async () => {
    const img = await squarePng();
    const recipes = planCandidates({ prompt: "crying", library: lib, intensity: "normal", speedFactor: 1 });
    const cands = await renderCandidates(img, recipes, 48);
    expect(cands.length).toBeGreaterThan(0);
    for (const c of cands) expect(isGif(c.buffer)).toBe(true);
  });
});

describe("cache", () => {
  it("serves an identical request from cache the second time", async () => {
    clearAnimateCache();
    const img = await squarePng();
    const recipe = buildRecipe(UNIVERSAL_GESTURE, lib, { intensity: "normal", speedFactor: 1 });
    const before = animateCacheStats().hits;
    await renderCandidate({ image: img, recipe, size: 32 });
    await renderCandidate({ image: img, recipe, size: 32 });
    expect(animateCacheStats().hits).toBe(before + 1);
  });
  it("keys on content, so a different image misses", () => {
    const a = hashImage(Buffer.from("aaaa"));
    const b = hashImage(Buffer.from("bbbb"));
    expect(a).not.toBe(b);
  });
});

describe("explainability", () => {
  it("credit lists provenance and explain lists regions", () => {
    const recipe = buildRecipe(GESTURES.find(g => g.id === "cry")!, lib, { intensity: "insane", speedFactor: 1 });
    expect(credit(recipe)).toContain("borrowed from");
    expect(explain(recipe).length).toBeGreaterThan(0);
  });
});
