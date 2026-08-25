import { describe, expect, it } from "vitest";
import { emptyWorldDoc, CATEGORY_ORDER } from "../editor/types";
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
