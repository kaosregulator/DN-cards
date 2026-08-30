import { describe, expect, it } from "vitest";
import {
  DEFAULT_DIRECTION, DEFAULT_FORMAT, DEFAULT_SIZE, DEFAULT_SPEED,
  delayFor, parseDirection, parseFormat, parseSize, parseSpeed,
} from "../index.js";

describe("option parsing", () => {
  it("accepts every valid value", () => {
    expect(parseSpeed("turbo")).toBe("turbo");
    expect(parseDirection("down")).toBe("down");
    expect(parseFormat("png")).toBe("png");
    expect(parseSize("64")).toBe(64);
    expect(parseSize(112)).toBe(112);
  });

  it("falls back to the default rather than throwing", () => {
    // Stale buttons on old messages must never break a render.
    for (const bad of [undefined, null, "", "nonsense", 999, {}]) {
      expect(parseSpeed(bad)).toBe(DEFAULT_SPEED);
      expect(parseDirection(bad)).toBe(DEFAULT_DIRECTION);
      expect(parseFormat(bad)).toBe(DEFAULT_FORMAT);
      expect(parseSize(bad)).toBe(DEFAULT_SIZE);
    }
  });
});

describe("delayFor", () => {
  it("orders the speeds correctly", () => {
    const base = 50;
    expect(delayFor(base, "slow")).toBeGreaterThan(delayFor(base, "normal"));
    expect(delayFor(base, "normal")).toBeGreaterThan(delayFor(base, "fast"));
    expect(delayFor(base, "fast")).toBeGreaterThan(delayFor(base, "turbo"));
  });

  it("never drops below the 20ms floor browsers clamp to", () => {
    expect(delayFor(1, "turbo")).toBeGreaterThanOrEqual(20);
  });
});
