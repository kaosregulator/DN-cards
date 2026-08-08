// ─────────────────────────────────────────────────────────────────────────────
// HQ — unified base / room editor.
//
// One editing engine for outdoor grounds AND interior rooms. Supports placing,
// moving, rotating, deleting, duplicating, layering, undo, and redo. Category
// tabs replace long scrolling menus. Grid + live placement previews are editor-
// only concerns; the overview never shows them.
//
// Persistence: terrain mutations go through terrain.ts; the undo/redo stacks
// and selection live in-process (Discord sessions are short-lived). Cursor /
// category / mode stay in player_hq.stats via base-state.
// ─────────────────────────────────────────────────────────────────────────────

import {
  listTerrain, placeTerrain, removeTerrainAt, removeTerrainById, clearTerrain,
  BASE_CANVAS_ID, type TerrainRect,
} from "./terrain.js";
import { HQ_BASE_GRID, HQ_GRID } from "./grid.js";
import { resolveSurface, surfacesFor } from "./defs/surfaces.js";
import { HQ_DECORATIONS } from "./defs/decorations.js";
import { HQ_SKYBOXES } from "./defs/skyboxes.js";
import { HQ_WALLS } from "./defs/walls.js";
import { HQ_FLOORS } from "./defs/floors.js";
import {
  type EditorCategory, type EditorMode, type EditorLayer,
  saveHqStats, readHqStats,
} from "./base-state.js";
import { getOrCreateHq } from "./db.js";
import {
  readCursor, saveCursor, clampCursor, type BuildCursor,
} from "./build-state.js";
import type { HqTerrainFeature } from "./render-terrain.js";

export type { EditorCategory, EditorMode, EditorLayer };

export interface EditorCategoryTab {
  id: EditorCategory;
  label: string;
  emoji: string;
  space: "outdoor" | "indoor" | "both";
}

/** Category tabs matching the mockups (outdoor + indoor). */
export const OUTDOOR_CATEGORIES: EditorCategoryTab[] = [
  { id: "terrain", label: "Terrain", emoji: "🟩", space: "outdoor" },
  { id: "water", label: "Water", emoji: "💧", space: "outdoor" },
  { id: "buildings", label: "Buildings", emoji: "🏰", space: "outdoor" },
  { id: "defenses", label: "Defenses", emoji: "🛡️", space: "outdoor" },
  { id: "decorations", label: "Decorations", emoji: "🎨", space: "outdoor" },
  { id: "nature", label: "Nature", emoji: "🌲", space: "outdoor" },
  { id: "fences", label: "Fences", emoji: "🚧", space: "outdoor" },
  { id: "skyboxes", label: "Skyboxes", emoji: "☁️", space: "outdoor" },
];

export const INDOOR_CATEGORIES: EditorCategoryTab[] = [
  { id: "walls", label: "Walls", emoji: "🧱", space: "indoor" },
  { id: "doors", label: "Doors", emoji: "🚪", space: "indoor" },
  { id: "floors", label: "Floors", emoji: "🟫", space: "indoor" },
  { id: "windows", label: "Windows", emoji: "🪟", space: "indoor" },
  { id: "decorations", label: "Decor", emoji: "🎀", space: "indoor" },
  { id: "furniture", label: "Furniture", emoji: "🪑", space: "indoor" },
  { id: "lighting", label: "Lighting", emoji: "💡", space: "indoor" },
  { id: "trophies", label: "Trophies", emoji: "🏆", space: "indoor" },
  { id: "defense", label: "Defense", emoji: "🛡️", space: "indoor" },
];

export const EDITOR_MODES: { id: EditorMode; label: string; emoji: string }[] = [
  { id: "select", label: "Select", emoji: "🖱️" },
  { id: "move", label: "Move", emoji: "✥" },
  { id: "place", label: "Place", emoji: "➕" },
  { id: "rotate", label: "Rotate", emoji: "🔄" },
  { id: "delete", label: "Delete", emoji: "🗑️" },
  { id: "duplicate", label: "Duplicate", emoji: "⧉" },
];

export const QUICK_LAYERS: { id: EditorLayer; label: string }[] = [
  { id: "ground", label: "Ground" },
  { id: "water", label: "Water" },
  { id: "structures", label: "Structures" },
  { id: "decorations", label: "Decorations" },
  { id: "fences", label: "Fences" },
];

interface EditorSnapshot {
  canvas: string;
  features: HqTerrainFeature[];
}

interface EditorSession {
  undo: EditorSnapshot[];
  redo: EditorSnapshot[];
  selectedFeatureId: number | null;
  preview: BuildCursor | null;
}

const sessions = new Map<string, EditorSession>();
const MAX_UNDO = 40;

function sessionKey(guildId: string, userId: string): string {
  return `${guildId}:${userId}`;
}

function getSession(guildId: string, userId: string): EditorSession {
  const k = sessionKey(guildId, userId);
  let s = sessions.get(k);
  if (!s) {
    s = { undo: [], redo: [], selectedFeatureId: null, preview: null };
    sessions.set(k, s);
  }
  return s;
}

function gridFor(canvas: string): number {
  return canvas === BASE_CANVAS_ID ? HQ_BASE_GRID : HQ_GRID;
}

async function snapshotCanvas(guildId: string, userId: string, canvas: string): Promise<EditorSnapshot> {
  const features = await listTerrain(guildId, userId, canvas).catch(() => [] as HqTerrainFeature[]);
  return { canvas, features: features.map(f => ({ ...f })) };
}

async function restoreSnapshot(guildId: string, userId: string, snap: EditorSnapshot): Promise<void> {
  const grid = gridFor(snap.canvas);
  await clearTerrain(guildId, userId, snap.canvas);
  for (const f of snap.features) {
    await placeTerrain(guildId, userId, snap.canvas, grid, {
      materialId: f.materialId,
      x: f.x, y: f.y, w: f.w, h: f.h,
      elevation: f.elevation,
    }).catch(() => {});
  }
}

/** Push current canvas onto the undo stack before a mutating edit. */
export async function pushUndo(guildId: string, userId: string, canvas: string): Promise<void> {
  const s = getSession(guildId, userId);
  const snap = await snapshotCanvas(guildId, userId, canvas);
  s.undo.push(snap);
  if (s.undo.length > MAX_UNDO) s.undo.shift();
  s.redo = [];
}

export async function undoEdit(guildId: string, userId: string): Promise<string> {
  const s = getSession(guildId, userId);
  const prev = s.undo.pop();
  if (!prev) return "Nothing to undo.";
  const current = await snapshotCanvas(guildId, userId, prev.canvas);
  s.redo.push(current);
  await restoreSnapshot(guildId, userId, prev);
  return `Undid last edit on **${prev.canvas === BASE_CANVAS_ID ? "Base grounds" : prev.canvas}**.`;
}

export async function redoEdit(guildId: string, userId: string): Promise<string> {
  const s = getSession(guildId, userId);
  const next = s.redo.pop();
  if (!next) return "Nothing to redo.";
  const current = await snapshotCanvas(guildId, userId, next.canvas);
  s.undo.push(current);
  await restoreSnapshot(guildId, userId, next);
  return `Redid edit on **${next.canvas === BASE_CANVAS_ID ? "Base grounds" : next.canvas}**.`;
}

export function canUndo(guildId: string, userId: string): boolean {
  return getSession(guildId, userId).undo.length > 0;
}
export function canRedo(guildId: string, userId: string): boolean {
  return getSession(guildId, userId).redo.length > 0;
}

export function setSelectedFeature(guildId: string, userId: string, id: number | null): void {
  getSession(guildId, userId).selectedFeatureId = id;
}
export function getSelectedFeature(guildId: string, userId: string): number | null {
  return getSession(guildId, userId).selectedFeatureId;
}

export function setPreview(guildId: string, userId: string, cur: BuildCursor | null): void {
  getSession(guildId, userId).preview = cur;
}
export function getPreview(guildId: string, userId: string): BuildCursor | null {
  return getSession(guildId, userId).preview;
}

/** Materials / items offered under a category tab. */
export function paletteForCategory(
  cat: EditorCategory,
  space: "outdoor" | "indoor",
  owned: Set<string>,
): { id: string; label: string; emoji: string; kind: string }[] {
  switch (cat) {
    case "terrain":
      return surfacesFor(space).filter(s => s.kind === "flat" || s.kind === "mound")
        .filter(s => s.unlock.kind === "always" || owned.has(s.id))
        .map(s => ({ id: s.id, label: s.name, emoji: s.emoji, kind: s.kind }));
    case "water":
      return surfacesFor(space).filter(s => s.kind === "water")
        .filter(s => s.unlock.kind === "always" || owned.has(s.id))
        .map(s => ({ id: s.id, label: s.name, emoji: s.emoji, kind: s.kind }));
    case "defenses":
    case "defense":
      return surfacesFor(space).filter(s => (s.defense ?? 0) > 0)
        .filter(s => s.unlock.kind === "always" || owned.has(s.id))
        .map(s => ({ id: s.id, label: s.name, emoji: s.emoji, kind: "defense" }));
    case "buildings":
      return surfacesFor(space).filter(s => s.kind === "raised")
        .filter(s => s.unlock.kind === "always" || owned.has(s.id))
        .map(s => ({ id: s.id, label: s.name, emoji: s.emoji, kind: s.kind }));
    case "nature":
      return HQ_DECORATIONS.filter(d =>
        (d.category === "tree" || d.category === "rock" || d.category === "plant" || d.category === "flowers")
        && (d.unlock.kind === "always" || owned.has(d.id)))
        .map(d => ({ id: d.id, label: d.name, emoji: d.emoji, kind: d.category }));
    case "fences":
      return HQ_DECORATIONS.filter(d => d.category === "fence" && (d.unlock.kind === "always" || owned.has(d.id)))
        .map(d => ({ id: d.id, label: d.name, emoji: d.emoji, kind: "fence" }));
    case "decorations":
    case "furniture":
      return HQ_DECORATIONS.filter(d => {
        const furnitureish = ["case", "statue", "rug", "monument", "banner", "emblem", "crystal"].includes(d.category);
        const want = cat === "furniture" ? furnitureish : !["tree", "rock", "fence"].includes(d.category);
        return want && (d.unlock.kind === "always" || owned.has(d.id));
      }).map(d => ({ id: d.id, label: d.name, emoji: d.emoji, kind: d.category }));
    case "lighting":
      return HQ_DECORATIONS.filter(d => d.category === "light" && (d.unlock.kind === "always" || owned.has(d.id)))
        .map(d => ({ id: d.id, label: d.name, emoji: d.emoji, kind: "light" }));
    case "trophies":
      return HQ_DECORATIONS.filter(d =>
        (d.category === "trophy" || d.category === "monument") && (d.unlock.kind === "always" || owned.has(d.id)))
        .map(d => ({ id: d.id, label: d.name, emoji: d.emoji, kind: d.category }));
    case "skyboxes":
      return HQ_SKYBOXES.filter(s => s.unlock.kind === "always" || owned.has(s.id))
        .map(s => ({ id: s.id, label: s.name, emoji: s.emoji, kind: "skybox" }));
    case "walls":
      return HQ_WALLS.filter(w => w.unlock.kind === "always" || owned.has(w.id))
        .map(w => ({ id: w.id, label: w.name, emoji: w.emoji, kind: "wall" }));
    case "floors":
      return HQ_FLOORS.filter(f => f.unlock.kind === "always" || owned.has(f.id))
        .map(f => ({ id: f.id, label: f.name, emoji: f.emoji, kind: "floor" }));
    case "doors":
      return [
        { id: "door-wood", label: "Wooden Door", emoji: "🚪", kind: "door" },
        { id: "door-iron", label: "Iron Door", emoji: "🚪", kind: "door" },
        { id: "door-arch", label: "Archway", emoji: "🏛️", kind: "door" },
      ];
    case "windows":
      return [
        { id: "window-square", label: "Square Window", emoji: "🪟", kind: "window" },
        { id: "window-arch", label: "Arch Window", emoji: "🪟", kind: "window" },
        { id: "window-stained", label: "Stained Glass", emoji: "🪟", kind: "window" },
      ];
    default:
      return [];
  }
}

/** Place the current brush (with undo). */
export async function editorPlace(
  guildId: string, userId: string, cur: BuildCursor,
): Promise<{ ok: boolean; message: string }> {
  await pushUndo(guildId, userId, cur.canvas);
  const result = await placeTerrain(guildId, userId, cur.canvas, gridFor(cur.canvas), {
    materialId: cur.materialId,
    x: cur.x, y: cur.y, w: cur.w, h: cur.h,
    elevation: cur.elevation,
  } satisfies TerrainRect);
  if (!result.ok) {
    getSession(guildId, userId).undo.pop();
    return { ok: false, message: result.reason };
  }
  setPreview(guildId, userId, cur);
  return { ok: true, message: `Placed **${resolveSurface(cur.materialId).name}** at (${cur.x},${cur.y}).` };
}

/** Remove the top-most feature under the cursor (with undo). */
export async function editorRemove(
  guildId: string, userId: string, cur: BuildCursor,
): Promise<{ ok: boolean; message: string }> {
  await pushUndo(guildId, userId, cur.canvas);
  const hit = await removeTerrainAt(guildId, userId, cur.canvas, cur.x, cur.y);
  if (!hit) {
    getSession(guildId, userId).undo.pop();
    return { ok: false, message: "Nothing to remove there." };
  }
  return { ok: true, message: `Removed **${resolveSurface(hit.materialId).name}**.` };
}

/** Clear an entire canvas (with undo). */
export async function editorClear(
  guildId: string, userId: string, canvas: string,
): Promise<string> {
  await pushUndo(guildId, userId, canvas);
  const n = await clearTerrain(guildId, userId, canvas);
  return n > 0 ? `Cleared **${n}** surfaces.` : "Canvas was already empty.";
}

/** Move the selected feature by Δx/Δy (with undo). */
export async function editorMoveSelected(
  guildId: string, userId: string, canvas: string, dx: number, dy: number,
): Promise<string> {
  const s = getSession(guildId, userId);
  if (s.selectedFeatureId == null) return "Select a surface first (pick from the list).";
  const features = await listTerrain(guildId, userId, canvas);
  const f = features.find(x => x.id === s.selectedFeatureId);
  if (!f) return "Selected surface is gone — pick another.";
  const grid = gridFor(canvas);
  const nx = Math.max(0, Math.min(grid - f.w, f.x + dx));
  const ny = Math.max(0, Math.min(grid - f.h, f.y + dy));
  if (nx === f.x && ny === f.y) return "Already at the edge.";
  await pushUndo(guildId, userId, canvas);
  await removeTerrainById(guildId, userId, f.id);
  const placed = await placeTerrain(guildId, userId, canvas, grid, {
    materialId: f.materialId, x: nx, y: ny, w: f.w, h: f.h, elevation: f.elevation,
  });
  if (placed.ok) s.selectedFeatureId = placed.feature.id;
  return `Moved to (**${nx}**, **${ny}**).`;
}

/** Duplicate the selected feature one tile offset (with undo). */
export async function editorDuplicateSelected(
  guildId: string, userId: string, canvas: string,
): Promise<string> {
  const s = getSession(guildId, userId);
  if (s.selectedFeatureId == null) return "Select a surface first.";
  const features = await listTerrain(guildId, userId, canvas);
  const f = features.find(x => x.id === s.selectedFeatureId);
  if (!f) return "Selected surface is gone.";
  const grid = gridFor(canvas);
  const nx = Math.min(grid - f.w, f.x + 1);
  const ny = Math.min(grid - f.h, f.y + 1);
  await pushUndo(guildId, userId, canvas);
  const result = await placeTerrain(guildId, userId, canvas, grid, {
    materialId: f.materialId, x: nx, y: ny, w: f.w, h: f.h, elevation: f.elevation,
  });
  if (!result.ok) {
    getSession(guildId, userId).undo.pop();
    return result.reason;
  }
  s.selectedFeatureId = result.feature.id;
  return `Duplicated **${resolveSurface(f.materialId).name}** at (${nx},${ny}).`;
}

/** Rotate = swap w/h around the origin corner (with undo). */
export async function editorRotateSelected(
  guildId: string, userId: string, canvas: string,
): Promise<string> {
  const s = getSession(guildId, userId);
  if (s.selectedFeatureId == null) return "Select a surface first.";
  const features = await listTerrain(guildId, userId, canvas);
  const f = features.find(x => x.id === s.selectedFeatureId);
  if (!f) return "Selected surface is gone.";
  if (f.w === f.h) return "Square — rotation looks the same.";
  const grid = gridFor(canvas);
  const nw = f.h, nh = f.w;
  if (f.x + nw > grid || f.y + nh > grid) return "Can't rotate — would leave the grid.";
  await pushUndo(guildId, userId, canvas);
  await removeTerrainById(guildId, userId, f.id);
  const placed = await placeTerrain(guildId, userId, canvas, grid, {
    materialId: f.materialId, x: f.x, y: f.y, w: nw, h: nh, elevation: f.elevation,
  });
  if (placed.ok) s.selectedFeatureId = placed.feature.id;
  return `Rotated to **${nw}×${nh}**.`;
}

export async function setEditorMode(guildId: string, userId: string, mode: EditorMode): Promise<void> {
  await saveHqStats(guildId, userId, { editorMode: mode });
}

export async function setEditorCategory(guildId: string, userId: string, cat: EditorCategory): Promise<void> {
  await saveHqStats(guildId, userId, { editorCategory: cat });
}

export async function toggleLayer(
  guildId: string, userId: string, layer: EditorLayer,
): Promise<boolean> {
  const hq = await getOrCreateHq(guildId, userId);
  const stats = readHqStats(hq);
  const layers = { ...(stats.layers ?? {}) };
  const next = layers[layer] !== false ? false : true;
  layers[layer] = next;
  await saveHqStats(guildId, userId, { layers });
  return next;
}

export async function loadEditorCursor(guildId: string, userId: string): Promise<BuildCursor> {
  const hq = await getOrCreateHq(guildId, userId);
  const stats = readHqStats(hq);
  const canvas = stats.build?.canvas ?? BASE_CANVAS_ID;
  return readCursor(stats.build, canvas, gridFor(canvas));
}

export { saveCursor, clampCursor, resolveSurface, listTerrain };
