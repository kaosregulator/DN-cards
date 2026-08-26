import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createCustomMap,
  deleteCustomMap,
  duplicateCustomMap,
  listAllMapsForManager,
  listCustomMaps,
  renameCustomMap,
  resolveSpawnPoint,
} from "../map-registry.js";
import { loadWorldDoc, saveWorldDoc } from "../store.js";
import { tilesetForGid, type WorldDocTileset } from "../types.js";

describe("world-builder map registry", () => {
  let dir: string;
  const prev = process.env["WORLD_BUILDER_DATA_DIR"];

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "wb-maps-"));
    process.env["WORLD_BUILDER_DATA_DIR"] = dir;
  });

  afterEach(() => {
    if (prev === undefined) delete process.env["WORLD_BUILDER_DATA_DIR"];
    else process.env["WORLD_BUILDER_DATA_DIR"] = prev;
    rmSync(dir, { recursive: true, force: true });
  });

  it("creates a blank first-class map with Default spawn", () => {
    const { meta, doc } = createCustomMap({ name: "Cave", width: 24, height: 18, tile: 32, spaceKind: "cave" });
    expect(meta.key.startsWith("wb-")).toBe(true);
    expect(meta.blank).toBe(true);
    expect(meta.gridW).toBe(24);
    expect(doc.spawns.some((s) => s.name === "Default" && s.isDefault)).toBe(true);
    expect(listCustomMaps()).toHaveLength(1);
    expect(loadWorldDoc(meta.key).mapKey).toBe(meta.key);
  });

  it("renames, duplicates, and deletes custom maps", () => {
    const { meta } = createCustomMap({ name: "Graveyard" });
    renameCustomMap(meta.key, "The Graveyard");
    expect(listCustomMaps()[0]!.name).toBe("The Graveyard");
    const dup = duplicateCustomMap(meta.key, "Crypt");
    expect(dup.meta.name).toBe("Crypt");
    expect(listCustomMaps().length).toBe(2);
    expect(deleteCustomMap(meta.key)).toBe(true);
    expect(listCustomMaps().some((m) => m.key === meta.key)).toBe(false);
  });

  it("lists shipped + custom maps for the Map Manager", () => {
    createCustomMap({ name: "DN Cards HQ", spaceKind: "hq" });
    const all = listAllMapsForManager();
    expect(all.some((m) => m.key === "world" && m.source === "shipped")).toBe(true);
    expect(all.some((m) => m.name === "DN Cards HQ" && m.blank)).toBe(true);
  });

  it("resolves named spawn points for door targets", () => {
    const { meta, doc } = createCustomMap({ name: "Deep Cave" });
    doc.spawns.push({
      uid: "s2", name: "Boss Room", kind: "player",
      x: 10 * meta.tile + 16, y: 10 * meta.tile + 16, facing: "down",
    });
    saveWorldDoc(meta.key, doc);
    const hit = resolveSpawnPoint(meta.key, "Boss Room");
    expect(hit?.tx).toBe(10);
    expect(hit?.ty).toBe(10);
    const def = resolveSpawnPoint(meta.key);
    expect(def?.name).toBe("Default");
  });

  it("persists imported tilesets + painted tiles on a blank map across reload", () => {
    // Reproduces the F9 flow: create Cave → paint an imported 48×48 MV tile.
    // The imported sheet must survive save/reload as real data (firstgid + image),
    // not merely a metadata note, so the painted gid re-resolves to artwork.
    const { meta, doc } = createCustomMap({ name: "Cave", tile: 48, spaceKind: "cave" });
    doc.tilesets = [{
      name: "Tileset_82_MV",
      image: "/activity/assets/world-packs/p1/files/Tileset_82_MV.png",
      tileWidth: 48, tileHeight: 48, columns: 16, tileCount: 128, firstgid: 2,
    }];
    // Paint localId 17 → gid = firstgid(2) + 17 = 19, plus a solid collision cell.
    doc.tiles = [{ layer: "Floor", x: 5, y: 6, gid: 19 }];
    doc.collision = [{ x: 5, y: 6, solid: true }];
    saveWorldDoc(meta.key, doc);

    const reopened = loadWorldDoc(meta.key);
    expect(reopened.tilesets).toHaveLength(1);
    const ts = reopened.tilesets![0]!;
    expect(ts.name).toBe("Tileset_82_MV");
    expect(ts.firstgid).toBe(2);
    expect(ts.image).toContain("Tileset_82_MV.png"); // real sheet ref, not a note
    // The painted gid falls inside the registered sheet's range → resolves to art.
    const painted = reopened.tiles[0]!;
    expect(painted.gid).toBe(19);
    expect(painted.gid).toBeGreaterThanOrEqual(ts.firstgid);
    expect(painted.gid).toBeLessThanOrEqual(ts.firstgid + ts.tileCount - 1);
    expect(reopened.collision).toEqual([{ x: 5, y: 6, solid: true }]);
  });

  // The explicit guarantee: a blank map carrying imported sheets at each shipped
  // tile size saves, reloads, and every painted tile resolves to the imported
  // sheet — never the wb-blank stamp (gid ≤ 1).
  const SIZES: Array<{ label: string; ts: Omit<WorldDocTileset, "firstgid"> }> = [
    { label: "48", ts: { name: "MV_48", image: "packs/p/MV_48.png", tileWidth: 48, tileHeight: 48, columns: 16, tileCount: 128 } },
    { label: "32", ts: { name: "Lime_32", image: "packs/p/Lime_32.png", tileWidth: 32, tileHeight: 32, columns: 16, tileCount: 256 } },
    { label: "16", ts: { name: "Lime_16", image: "packs/p/Lime_16.png", tileWidth: 16, tileHeight: 16, columns: 32, tileCount: 1024 } },
  ];
  for (const { label, ts } of SIZES) {
    it(`saves/reloads a blank map with a ${label}×${label} sheet and resolves paint (no wb-blank fallback)`, () => {
      const { meta } = createCustomMap({ name: `Cave ${label}`, tile: Number(label), spaceKind: "cave" });
      const firstgid = 2; // above the wb-blank stamp on a blank map
      const doc = loadWorldDoc(meta.key);
      doc.tilesets = [{ ...ts, firstgid }];
      // Paint the first, a middle, and the last cell of the sheet.
      const cells = [0, Math.floor(ts.tileCount / 2), ts.tileCount - 1];
      doc.tiles = cells.map((localId, i) => ({ layer: "Floor", x: i, y: 0, gid: firstgid + localId }));
      saveWorldDoc(meta.key, doc);

      const reopened = loadWorldDoc(meta.key);
      const table = reopened.tilesets!;
      expect(table).toHaveLength(1);
      expect(table[0]!.tileWidth).toBe(Number(label));
      // Every painted tile resolves to the imported sheet + correct cell.
      reopened.tiles.forEach((patch, i) => {
        const hit = tilesetForGid(table, patch.gid);
        expect(hit, `tile ${i} must resolve to imported art, not wb-blank`).not.toBeNull();
        expect(hit!.tileset.name).toBe(ts.name);
        expect(hit!.localId).toBe(cells[i]);
        expect(patch.gid).toBeGreaterThan(1);
      });
    });
  }
});
