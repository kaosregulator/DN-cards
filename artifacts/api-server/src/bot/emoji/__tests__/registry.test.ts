import { describe, expect, it } from "vitest";
import { EFFECTS, EFFECT_SUMMARIES, effectIds, getEffect, hasEffect } from "../index.js";
import { DEFAULT_EFFECT } from "../registry/index.js";

describe("effect registry", () => {
  it("exposes a non-empty, uniquely-identified set", () => {
    expect(EFFECTS.length).toBeGreaterThan(0);
    expect(new Set(effectIds()).size).toBe(EFFECTS.length);
  });

  it("has a registered default effect", () => {
    expect(hasEffect(DEFAULT_EFFECT)).toBe(true);
  });

  it("keeps summaries in step with the definitions", () => {
    expect(EFFECT_SUMMARIES.map(s => s.id)).toEqual(effectIds());
  });

  it("returns undefined for an unknown id", () => {
    expect(getEffect("definitely-not-an-effect")).toBeUndefined();
    expect(hasEffect("definitely-not-an-effect")).toBe(false);
  });

  it("declares sane, renderable metadata for every effect", () => {
    for (const e of EFFECTS) {
      expect(e.frames, e.id).toBeGreaterThan(0);
      expect(e.delayMs, e.id).toBeGreaterThan(0);
      expect(e.inset, e.id).toBeGreaterThan(0);
      expect(e.inset, e.id).toBeLessThanOrEqual(1);
      expect(e.name.length, e.id).toBeGreaterThan(0);
      // Discord truncates select-option descriptions at 100 characters.
      expect(e.description.length, e.id).toBeLessThanOrEqual(100);
      // An effect that does nothing at all would render a static GIF.
      expect(Boolean(e.transform || e.layers?.length), e.id).toBe(true);
    }
  });

  it("fits inside Discord's 25-choice slash-command limit", () => {
    expect(EFFECTS.length).toBeLessThanOrEqual(25);
  });
});

describe("effect transforms", () => {
  it("produce finite values across a whole loop, in both directions", () => {
    for (const e of EFFECTS) {
      if (!e.transform) continue;
      for (const direction of ["right", "left", "up", "down"] as const) {
        for (let frame = 0; frame < e.frames; frame++) {
          const tf = e.transform({
            t: frame / e.frames, frame, frames: e.frames, direction, size: 128,
          });
          for (const [key, value] of Object.entries(tf)) {
            expect(Number.isFinite(value), `${e.id}.${key} @${frame} ${direction}`).toBe(true);
          }
          if (tf.alpha !== undefined) {
            expect(tf.alpha, `${e.id}.alpha`).toBeGreaterThanOrEqual(0);
            expect(tf.alpha, `${e.id}.alpha`).toBeLessThanOrEqual(1);
          }
        }
      }
    }
  });

  it("loop seamlessly — the frame after the last matches the first", () => {
    for (const e of EFFECTS) {
      if (!e.transform || e.discontinuous) continue;
      const base = { frames: e.frames, direction: "right" as const, size: 128 };
      const first = e.transform({ ...base, t: 0, frame: 0 });
      // Sampling t=1 is the seam: a continuous loop returns to its start there.
      const wrapped = e.transform({ ...base, t: 1, frame: e.frames });
      for (const key of ["rotate", "scaleX", "scaleY", "offsetX", "offsetY", "alpha"] as const) {
        const a = first[key], b = wrapped[key];
        if (a === undefined || b === undefined) continue;
        // `rotate` legitimately advances by a full turn per loop.
        const delta = key === "rotate"
          ? Math.abs(((b - a) % (Math.PI * 2)))
          : Math.abs(b - a);
        const wrappedDelta = key === "rotate" ? Math.min(delta, Math.PI * 2 - delta) : delta;
        expect(wrappedDelta, `${e.id}.${key} seam`).toBeLessThan(0.02);
      }
    }
  });
});
