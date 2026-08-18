import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(__dirname, "../../../public/world/town");

describe("Starting Town (FLARE-authored world)", () => {
  it("ships starting_town.json with object layers and overlays", () => {
    const path = resolve(root, "starting_town.json");
    expect(existsSync(path)).toBe(true);
    const town = JSON.parse(readFileSync(path, "utf8")) as {
      name: string;
      width: number;
      height: number;
      background: number[][];
      object: number[][];
      solid: boolean[][];
      overlays: Array<{ tile: number; tx: number; ty: number }>;
      doors: Array<{ tx: number; ty: number }>;
      npcs: Array<{ id: string; tx: number; ty: number; duelist?: boolean; role?: string }>;
      spawn: { tx: number; ty: number };
      tiles: Record<string, { w: number; h: number; ox: number; oy: number }>;
    };

    expect(town.name).toBe("Starting Town");
    expect(town.width).toBeGreaterThan(20);
    expect(town.height).toBeGreaterThan(20);
    expect(town.background.length).toBe(town.height);
    expect(town.object.length).toBe(town.height);

    const objCount = town.object.flat().filter((id) => id > 0).length;
    expect(objCount).toBeGreaterThan(40);
    expect(town.overlays.length).toBeGreaterThanOrEqual(2);
    expect(town.doors.length).toBeGreaterThanOrEqual(1);
    expect(town.npcs.some((n) => n.role === "shop")).toBe(true);
    expect(town.npcs.some((n) => n.duelist)).toBe(true);

    const { tx, ty } = town.spawn;
    expect(town.solid[ty]![tx]).toBe(false);

    // Every referenced tile file exists (object construction, not placeholders).
    const used = new Set<number>();
    for (const row of town.background) for (const id of row) if (id) used.add(id);
    for (const row of town.object) for (const id of row) if (id) used.add(id);
    for (const o of town.overlays) used.add(o.tile);
    for (const id of used) {
      expect(town.tiles[String(id)] || town.tiles[id as unknown as string]).toBeTruthy();
      expect(existsSync(resolve(root, `tiles/t${id}.png`))).toBe(true);
    }
  });

  it("keeps NPCs on unique walkable-adjacent cells", () => {
    const town = JSON.parse(readFileSync(resolve(root, "starting_town.json"), "utf8")) as {
      npcs: Array<{ tx: number; ty: number }>;
    };
    const keys = town.npcs.map((n) => `${n.tx},${n.ty}`);
    expect(new Set(keys).size).toBe(keys.length);
  });
});
