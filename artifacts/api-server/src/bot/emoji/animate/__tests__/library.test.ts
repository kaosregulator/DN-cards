// Verifies the committed harvested Noto library loads, merges over the builtin
// set, and that its real borrowed tracks drive a render. Runs in its own file so
// it gets a fresh module state (no env override from engine.test.ts).

import { describe, it, expect, beforeAll } from "vitest";
import sharp from "sharp";
import {
  loadMotionLibrary, planCandidates, renderCandidate, buildRecipe, GESTURES,
} from "../index.js";
import type { MotionLibrary } from "../index.js";

async function facePng(): Promise<Buffer> {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="160" height="160">
    <circle cx="80" cy="80" r="70" fill="#ffcf3f"/>
    <circle cx="58" cy="66" r="11" fill="#222"/><circle cx="102" cy="66" r="11" fill="#222"/>
    <ellipse cx="80" cy="112" rx="34" ry="16" fill="#222"/></svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

let lib: MotionLibrary;
beforeAll(async () => { lib = await loadMotionLibrary(); });

describe("harvested Noto library", () => {
  it("merges real Noto motion over the builtin fallback", () => {
    expect(lib.origin).toBe("merged");
    const noto = lib.tracks.filter(t => t.source.origin === "noto");
    expect(noto.length).toBeGreaterThan(100);
  });

  it("every harvested track carries Apache-2.0 provenance with a codepoint + url", () => {
    for (const t of lib.tracks.filter(t => t.source.origin === "noto")) {
      expect(t.source.license).toBe("Apache-2.0");
      expect(t.source.codepoint).toBeTruthy();
      expect(t.source.url).toContain("notoemoji");
    }
  });

  it("prefers a real Noto track when the pool has one for the region", () => {
    // The planner ranks noto ahead of builtin; a yawn should pull noto mouth/eyes.
    const recipe = buildRecipe(GESTURES.find(g => g.id === "yawn")!, lib, { intensity: "normal", speedFactor: 1 });
    const used = [recipe.tracks.global, recipe.tracks.eyes, recipe.tracks.mouth].filter(Boolean);
    expect(used.some(t => t!.source.origin === "noto")).toBe(true);
  });

  it("renders a candidate from the merged library", async () => {
    const recipes = planCandidates({ prompt: "surprised", library: lib, intensity: "dramatic", speedFactor: 1 });
    const cand = await renderCandidate({ image: await facePng(), recipe: recipes[0]!, size: 96 });
    expect(cand.buffer.toString("ascii", 0, 3)).toBe("GIF");
  });
});
