import { describe, expect, it } from "vitest";
import { categorizeFromPath } from "../packs.js";
import { emptyWorldDoc } from "../types.js";
import { builtinAssets, builtinPackMeta } from "../builtin-catalog.js";

describe("world-builder pack categorize", () => {
  it("maps common LimeZu / folder names to categories", () => {
    expect(categorizeFromPath("Modern_Exteriors/floors/concrete.png")).toBe("floors");
    expect(categorizeFromPath("buildings/shop_01.png")).toBe("buildings");
    expect(categorizeFromPath("chars/npc/guard.png")).toBe("characters");
    expect(categorizeFromPath("props/door_closed.png")).toBe("doors");
    expect(categorizeFromPath("trees/oak.png")).toBe("vegetation");
  });
});

describe("world-builder builtin catalog", () => {
  it("loads shipped world assets when public/world is present", () => {
    const pack = builtinPackMeta();
    expect(pack.id).toBe("builtin");
    const assets = builtinAssets();
    expect(assets.length).toBeGreaterThan(5);
    expect(assets.some((a) => a.category === "buildings")).toBe(true);
    expect(assets.some((a) => a.id.includes("tileset") || a.tile)).toBe(true);
  });
});

describe("world doc", () => {
  it("creates a blank overlay", () => {
    const d = emptyWorldDoc("village");
    expect(d.mapKey).toBe("village");
    expect(d.revision).toBe(0);
  });
});
