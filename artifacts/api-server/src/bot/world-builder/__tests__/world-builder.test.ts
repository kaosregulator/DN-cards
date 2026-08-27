import { describe, expect, it } from "vitest";
import { categorizeFromPath } from "../packs.js";
import { emptyWorldDoc } from "../types.js";
import { builtinAssets, builtinPacks } from "../builtin-catalog.js";

describe("world-builder pack categorize", () => {
  it("maps common LimeZu / folder names to categories", () => {
    expect(categorizeFromPath("Modern_Exteriors/floors/concrete.png")).toBe("floors");
    expect(categorizeFromPath("buildings/shop_01.png")).toBe("buildings");
    expect(categorizeFromPath("chars/npc/guard.png")).toBe("characters");
    expect(categorizeFromPath("props/door_closed.png")).toBe("doors");
    expect(categorizeFromPath("trees/oak.png")).toBe("vegetation");
  });
});

describe("world-builder builtin catalog (source-grouped)", () => {
  it("exposes the real DN world sources as separate packs", () => {
    const packs = builtinPacks();
    const ids = packs.map((p) => p.id);
    expect(ids).toContain("world");
    expect(ids).toContain("village");
    // Every source pack is tagged builtin and has assets.
    for (const p of packs) {
      expect(p.source).toBe("builtin");
      expect(p.assetCount).toBeGreaterThan(0);
    }
  });

  it("tags every asset with its source packId and slices tile sheets", () => {
    const assets = builtinAssets();
    expect(assets.length).toBeGreaterThan(5);
    // Main World tilesets are sliced into paintable grids, not one giant sheet.
    const worldTiles = assets.filter((a) => a.packId === "world" && a.tile?.sheet);
    expect(worldTiles.length).toBeGreaterThan(0);
    expect(worldTiles[0]!.tile!.count).toBeGreaterThan(1);
    // The Village tilesets are their own source.
    expect(assets.some((a) => a.packId === "village")).toBe(true);
  });

  it("no longer injects the legacy city/* fantasy set", () => {
    const assets = builtinAssets();
    // The old generic sprites (knights, vampires, generic buildings) are gone.
    expect(assets.some((a) => /city\//.test(a.url) || /noble_vampire|forest_archer|building1\b/.test(a.id))).toBe(false);
  });
});

describe("world doc", () => {
  it("creates a blank overlay", () => {
    const d = emptyWorldDoc("village");
    expect(d.mapKey).toBe("village");
    expect(d.revision).toBe(0);
  });
});
