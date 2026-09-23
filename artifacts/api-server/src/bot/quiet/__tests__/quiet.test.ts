import { describe, expect, it } from "vitest";
import { QUIET_QUOTES, pickQuietQuote, quotesForTheme } from "../quotes.js";
import { QUIET_AUDIO_CATALOG, pickDuration } from "../audio/catalog.js";

describe("Quiet quotes library", () => {
  it("has at least 100 short messages", () => {
    expect(QUIET_QUOTES.length).toBeGreaterThanOrEqual(100);
  });

  it("covers multiple themes", () => {
    const themes = new Set(QUIET_QUOTES.map(q => q.theme));
    expect(themes.has("general")).toBe(true);
    expect(themes.has("discord")).toBe(true);
    expect(themes.has("hope")).toBe(true);
    expect(themes.has("overwhelmed")).toBe(true);
  });

  it("picks quotes avoiding recent ids when possible", () => {
    const pool = quotesForTheme("calm");
    const recent = pool.slice(0, Math.max(0, pool.length - 1)).map(q => q.id);
    const picked = pickQuietQuote("calm", recent);
    if (pool.length > 1) expect(recent.includes(picked.id)).toBe(false);
  });
});

describe("Quiet audio catalog", () => {
  it("has multiple ambience categories", () => {
    const cats = new Set(QUIET_AUDIO_CATALOG.map(a => a.category));
    expect(cats.has("rain")).toBe(true);
    expect(cats.has("ocean")).toBe(true);
    expect(cats.has("fireplace")).toBe(true);
  });

  it("prefers 3–5 minute durations when available", () => {
    const rain = QUIET_AUDIO_CATALOG.find(a => a.id === "rain-gentle-01")!;
    expect(pickDuration(rain, 180)).toBe(180);
    expect(pickDuration(rain, 300)).toBe(300);
  });

  it("records license metadata for every entry", () => {
    for (const a of QUIET_AUDIO_CATALOG) {
      expect(a.license.length).toBeGreaterThan(3);
      expect(a.source.length).toBeGreaterThan(3);
    }
  });
});
