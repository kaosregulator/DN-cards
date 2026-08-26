import { describe, expect, it } from "vitest";
import {
  emptyWorldDoc,
  CATEGORY_ORDER,
  tilePickerCell,
  nextFirstGid,
  docTilesetFromAsset,
  paintGidFromDocTilesets,
  tilesetForGid,
  type WorldAssetEntry,
} from "../editor/types";
import { EditHistory } from "../editor/history";

describe("world builder document", () => {
  it("starts empty with version 1", () => {
    const doc = emptyWorldDoc("world");
    expect(doc.version).toBe(1);
    expect(doc.mapKey).toBe("world");
    expect(doc.objects).toEqual([]);
    expect(doc.tiles).toEqual([]);
    expect(doc.metadata.defaultFloor).toBe(0);
  });

  it("exposes a stable category order for the palette", () => {
    expect(CATEGORY_ORDER).toContain("floors");
    expect(CATEGORY_ORDER).toContain("buildings");
    expect(CATEGORY_ORDER).toContain("characters");
  });
});

describe("edit history", () => {
  it("undoes and redoes document snapshots", () => {
    const h = new EditHistory();
    const a = emptyWorldDoc("world");
    h.reset(a);
    const b = emptyWorldDoc("world");
    b.objects.push({
      uid: "o1", kind: "prop", assetId: "x", x: 10, y: 20,
    });
    h.push(b);
    expect(h.canUndo()).toBe(true);
    const undone = h.undo(b);
    expect(undone?.objects).toEqual([]);
    const redone = h.redo(undone!);
    expect(redone?.objects).toHaveLength(1);
  });
});

describe("tile sheet picker (RPG Maker MV 48×48)", () => {
  // A Tileset_82_MV-style sheet: 16 columns × 8 rows of 48px = 128 tiles.
  const t = { tileWidth: 48, tileHeight: 48, columns: 16, rows: 8, count: 128 };

  it("maps localId to the right grid cell", () => {
    expect(tilePickerCell(t, 0, 34)).toMatchObject({ col: 0, row: 0 });
    expect(tilePickerCell(t, 17, 34)).toMatchObject({ col: 1, row: 1 });
    expect(tilePickerCell(t, 127, 34)).toMatchObject({ col: 15, row: 7 });
  });

  it("scales the sheet to the on-screen cell size and shifts to the cell", () => {
    const cell = 34;
    const r = tilePickerCell(t, 17, cell);
    // full sheet, scaled: columns*cell wide, rows*cell tall
    expect(r.bgW).toBe(16 * cell);
    expect(r.bgH).toBe(8 * cell);
    // cell (1,1) is shifted left/up by one cell
    expect(r.bgX).toBe(-1 * cell);
    expect(r.bgY).toBe(-1 * cell);
  });

  it("works for a non-square grid (A2_Floors 16×12)", () => {
    const a2 = { tileWidth: 48, tileHeight: 48, columns: 16, rows: 12, count: 192 };
    expect(tilePickerCell(a2, 191, 34)).toMatchObject({ col: 15, row: 11 });
  });
});

describe("imported tile-sheet wiring on blank maps", () => {
  const sheet = (
    tileset: string, localId: number,
    dims = { tileWidth: 48, tileHeight: 48, columns: 16, rows: 8, count: 128 },
  ): WorldAssetEntry => ({
    id: `pack/${tileset}#${localId}`,
    name: tileset,
    category: "floors",
    url: `/activity/assets/world-packs/p1/files/${tileset}.png`,
    packId: "p1",
    kind: "prop",
    tile: { tileset, localId, sheet: true, ...dims },
  });

  it("allocates the first firstgid above the blank base stamp", () => {
    // A blank map has only wb-blank (gid 1); first imported sheet starts at 2.
    expect(nextFirstGid([], 1)).toBe(2);
  });

  it("stacks non-overlapping firstgids for multiple sheets", () => {
    const a = docTilesetFromAsset(sheet("Tileset_82_MV", 0), nextFirstGid([], 1))!;
    expect(a.firstgid).toBe(2);
    expect(a.tileCount).toBe(128);
    const b = docTilesetFromAsset(sheet("Tileset_83_MV", 0), nextFirstGid([a], 1))!;
    // 2 + 128 = 130 → next free is 130 (129 is a's last tile).
    expect(b.firstgid).toBe(130);
    // Ranges must not overlap.
    expect(b.firstgid).toBeGreaterThan(a.firstgid + a.tileCount - 1);
  });

  it("resolves a painted localId to a real gid via the persisted table", () => {
    const rec = docTilesetFromAsset(sheet("Tileset_82_MV", 0), nextFirstGid([], 1))!;
    // localId 17 (col 1,row 1) on a firstgid-2 sheet → gid 19.
    expect(paintGidFromDocTilesets([rec], sheet("Tileset_82_MV", 17))).toBe(rec.firstgid + 17);
    // Unknown sheet → null (paint falls back, never a wrong gid).
    expect(paintGidFromDocTilesets([rec], sheet("Other_MV", 3))).toBeNull();
  });

  it("carries a tilesets table on an empty doc", () => {
    expect(emptyWorldDoc("wb-cave").tilesets).toEqual([]);
  });

  // The core guarantee the user asked for: a painted imported tile resolves to
  // real artwork and NEVER falls back to the wb-blank stamp (gid ≤ 1). Proven
  // for all three shipped tile sizes (RPG Maker MV 48, LimeZu 32, LimeZu 16).
  const SIZES = [
    { label: "48×48 RPG Maker MV", tileWidth: 48, tileHeight: 48, columns: 16, rows: 8, count: 128 },
    { label: "32×32 LimeZu", tileWidth: 32, tileHeight: 32, columns: 16, rows: 16, count: 256 },
    { label: "16×16 LimeZu", tileWidth: 16, tileHeight: 16, columns: 32, rows: 32, count: 1024 },
  ];
  for (const dims of SIZES) {
    it(`resolves painted tiles to imported art (not wb-blank) — ${dims.label}`, () => {
      const name = `Sheet_${dims.tileWidth}`;
      const rec = docTilesetFromAsset(sheet(name, 0, dims), nextFirstGid([], 1))!;
      expect(rec.firstgid).toBe(2);                 // above the wb-blank stamp
      expect(rec.tileCount).toBe(dims.count);
      // Sample the first, an interior, and the last cell of the sheet.
      for (const localId of [0, Math.floor(dims.count / 2), dims.count - 1]) {
        const gid = paintGidFromDocTilesets([rec], sheet(name, localId, dims));
        expect(gid).toBe(rec.firstgid + localId);
        expect(gid!).toBeGreaterThan(1);            // not the blank stamp
        // Inverse resolve: gid maps back to THIS sheet + the same cell.
        const hit = tilesetForGid([rec], gid!);
        expect(hit).not.toBeNull();
        expect(hit!.tileset.name).toBe(name);
        expect(hit!.localId).toBe(localId);
      }
    });
  }

  it("flags the wb-blank stamp gid as a fallback (never imported art)", () => {
    const rec = docTilesetFromAsset(sheet("Sheet_48", 0), nextFirstGid([], 1))!;
    expect(tilesetForGid([rec], 1)).toBeNull();     // gid 1 = wb-blank
    expect(tilesetForGid([rec], 0)).toBeNull();     // cleared cell
    expect(tilesetForGid([rec], 100000)).toBeNull(); // outside every sheet
  });
});
