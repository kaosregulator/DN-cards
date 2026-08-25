import { describe, expect, it } from "vitest";
import { emptyWorldDoc, CATEGORY_ORDER, tilePickerCell } from "../editor/types";
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
