// ─────────────────────────────────────────────────────────────────────────────
// HQ Store — the client-side editable model of the floorplan.
//
// Holds the working layout, an undo/redo history, and a dirty flag. It is a pure
// data model: it emits change events but knows nothing about Phaser. The scene
// subscribes and re-renders. Saves round-trip to the server, which returns the
// sanitised layout that becomes the new baseline (client is never authoritative).
// ─────────────────────────────────────────────────────────────────────────────

import type { HqLayout, LayoutObject, LayoutRoom } from "../net/api";

type Listener = () => void;

function clone(layout: HqLayout): HqLayout {
  return {
    version: 1,
    rooms: layout.rooms.map((r) => ({ ...r })),
    objects: layout.objects.map((o) => ({ ...o })),
  };
}

let uidSeq = 0;
function newUid(): string {
  return `o${Date.now().toString(36)}${(uidSeq++).toString(36)}`;
}

export class HqStore {
  private working: HqLayout;
  private baseline: string; // JSON of last-saved layout
  private undoStack: HqLayout[] = [];
  private redoStack: HqLayout[] = [];
  private readonly listeners = new Set<Listener>();

  constructor(initial: HqLayout) {
    this.working = clone(initial);
    this.baseline = JSON.stringify(this.working);
  }

  get layout(): HqLayout {
    return this.working;
  }

  get dirty(): boolean {
    return JSON.stringify(this.working) !== this.baseline;
  }

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  onChange(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(): void {
    for (const fn of this.listeners) fn();
  }

  // Every mutation pushes the pre-state onto the undo stack and clears redo.
  private commit(mutate: () => void): void {
    this.undoStack.push(clone(this.working));
    if (this.undoStack.length > 100) this.undoStack.shift();
    this.redoStack = [];
    mutate();
    this.emit();
  }

  addObject(assetId: string, x: number, y: number, rot: 0 | 1 | 2 | 3 = 0): LayoutObject {
    const obj: LayoutObject = { uid: newUid(), assetId, x, y, rot };
    this.commit(() => this.working.objects.push(obj));
    return obj;
  }

  moveObject(uid: string, x: number, y: number): void {
    const o = this.working.objects.find((it) => it.uid === uid);
    if (!o || (o.x === x && o.y === y)) return;
    this.commit(() => {
      o.x = x;
      o.y = y;
    });
  }

  rotateObject(uid: string): void {
    const o = this.working.objects.find((it) => it.uid === uid);
    if (!o) return;
    this.commit(() => {
      o.rot = ((o.rot + 1) % 4) as 0 | 1 | 2 | 3;
    });
  }

  duplicateObject(uid: string): LayoutObject | null {
    const o = this.working.objects.find((it) => it.uid === uid);
    if (!o) return null;
    const copy: LayoutObject = { ...o, uid: newUid(), x: o.x + 1, y: o.y + 1 };
    this.commit(() => this.working.objects.push(copy));
    return copy;
  }

  deleteObject(uid: string): void {
    const idx = this.working.objects.findIndex((it) => it.uid === uid);
    if (idx < 0) return;
    this.commit(() => this.working.objects.splice(idx, 1));
  }

  addRoom(room: Omit<LayoutRoom, "id">): LayoutRoom {
    const created: LayoutRoom = { ...room, id: `r${newUid()}` };
    this.commit(() => this.working.rooms.push(created));
    return created;
  }

  setRoomFloor(roomInstanceId: string, floorId: string): void {
    const r = this.working.rooms.find((it) => it.id === roomInstanceId);
    if (!r || r.floorId === floorId) return;
    this.commit(() => {
      r.floorId = floorId;
    });
  }

  undo(): void {
    const prev = this.undoStack.pop();
    if (!prev) return;
    this.redoStack.push(clone(this.working));
    this.working = prev;
    this.emit();
  }

  redo(): void {
    const next = this.redoStack.pop();
    if (!next) return;
    this.undoStack.push(clone(this.working));
    this.working = next;
    this.emit();
  }

  /** Called after a successful server save: the returned layout is the new truth. */
  acceptSaved(saved: HqLayout): void {
    this.working = clone(saved);
    this.baseline = JSON.stringify(this.working);
    this.undoStack = [];
    this.redoStack = [];
    this.emit();
  }
}
