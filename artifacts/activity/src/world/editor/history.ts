// Undo / redo stack for World Builder documents.

import type { WorldEditDocument } from "./types";

const MAX = 80;

export class EditHistory {
  private undoStack: string[] = [];
  private redoStack: string[] = [];

  push(doc: WorldEditDocument): void {
    this.undoStack.push(JSON.stringify(doc));
    if (this.undoStack.length > MAX) this.undoStack.shift();
    this.redoStack = [];
  }

  canUndo(): boolean {
    return this.undoStack.length > 1;
  }

  canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  undo(current: WorldEditDocument): WorldEditDocument | null {
    if (this.undoStack.length <= 1) return null;
    const cur = this.undoStack.pop()!;
    this.redoStack.push(cur);
    const prev = this.undoStack[this.undoStack.length - 1]!;
    return JSON.parse(prev) as WorldEditDocument;
  }

  redo(_current: WorldEditDocument): WorldEditDocument | null {
    const next = this.redoStack.pop();
    if (!next) return null;
    this.undoStack.push(next);
    return JSON.parse(next) as WorldEditDocument;
  }

  reset(doc: WorldEditDocument): void {
    this.undoStack = [JSON.stringify(doc)];
    this.redoStack = [];
  }
}
