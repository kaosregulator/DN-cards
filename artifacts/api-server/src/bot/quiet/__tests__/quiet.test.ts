import { describe, expect, it } from "vitest";
import { QUIET_QUOTES, pickQuietQuote, quotesForTheme } from "../quotes.js";
import {
  QUIET_AUDIO_CATALOG, pickDuration, curatedEntries, THEME_CATEGORY_PREFS,
} from "../audio/catalog.js";
import { QUIET_SOURCE_ASSETS } from "../audio/sources.js";
import { isQuietSafeLicense } from "../audio/openverse.js";

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
  it("includes curated and procedural layers", () => {
    expect(curatedEntries().length).toBeGreaterThanOrEqual(10);
    expect(QUIET_AUDIO_CATALOG.some(a => a.kind === "procedural")).toBe(true);
  });

  it("has multiple ambience categories", () => {
    const cats = new Set(QUIET_AUDIO_CATALOG.map(a => a.category));
    expect(cats.has("rain")).toBe(true);
    expect(cats.has("ocean")).toBe(true);
    expect(cats.has("fireplace")).toBe(true);
    expect(cats.has("music")).toBe(true);
  });

  it("prefers 3–5 minute durations for curated entries", () => {
    for (const e of curatedEntries()) {
      expect(e.durations).toContain(180);
      expect(e.durations).toContain(300);
      expect(pickDuration(e, 180)).toBe(180);
      expect(pickDuration(e, 300)).toBe(300);
    }
  });

  it("records license + redistribution flags for every entry", () => {
    for (const a of QUIET_AUDIO_CATALOG) {
      expect(a.license.length).toBeGreaterThan(3);
      expect(a.source.length).toBeGreaterThan(3);
      expect(a.redistributionAllowed).toBe(true);
      expect(a.commercialUseAllowed).toBe(true);
      expect(a.modificationAllowed).toBe(true);
    }
  });

  it("defines theme category preferences", () => {
    expect(THEME_CATEGORY_PREFS.calm).toContain("rain");
    expect(THEME_CATEGORY_PREFS.hope).toContain("ocean");
    expect(THEME_CATEGORY_PREFS.overwhelmed).toContain("fireplace");
  });
});

describe("Quiet curated sources", () => {
  it("lists CC0 Openverse-backed assets with required metadata", () => {
    expect(QUIET_SOURCE_ASSETS.length).toBeGreaterThanOrEqual(15);
    for (const s of QUIET_SOURCE_ASSETS) {
      expect(s.license).toBe("cc0");
      expect(s.openverseId.length).toBeGreaterThan(8);
      expect(s.mediaUrl.startsWith("http")).toBe(true);
      expect(s.foreignLandingUrl.startsWith("http")).toBe(true);
      expect(s.redistributionAllowed).toBe(true);
      expect(s.commercialUseAllowed).toBe(true);
      expect(s.modificationAllowed).toBe(true);
      expect(s.fetchedVia).toBe("openverse");
      expect(isQuietSafeLicense(s.license)).toBe(true);
    }
  });

  it("wires curated catalog entries to known source ids", () => {
    const ids = new Set(QUIET_SOURCE_ASSETS.map(s => s.id));
    for (const e of curatedEntries()) {
      expect(e.sourceIds?.length).toBeGreaterThan(0);
      for (const sid of e.sourceIds!) {
        expect(ids.has(sid)).toBe(true);
      }
    }
  });
});
