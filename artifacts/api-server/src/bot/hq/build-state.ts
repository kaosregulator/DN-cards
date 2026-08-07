// ─────────────────────────────────────────────────────────────────────────────
// HQ — build-mode cursor state.
//
// The editor's "where am I and what am I holding" — the highlighted rectangle,
// the material on the brush and which canvas is being edited. It lives in the
// additive `player_hq.stats` jsonb so the visual editor and the /hqbuild
// subcommands share one cursor: move it with the arrow buttons, then
// `/hqbuild place` drops the brush exactly where the picture shows it.
//
// Everything here is clamped on read, so a cursor left over from a bigger
// lattice (or an unknown material) can never render off-grid or crash a build.
// ─────────────────────────────────────────────────────────────────────────────

import { getOrCreateHq, updateHq } from "./db.js";
import { resolveSurface, getSurfaceById, DEFAULT_SURFACE_ID } from "./defs/surfaces.js";
import { MAX_RECT_SPAN, MAX_ELEVATION, BASE_CANVAS_ID } from "./terrain.js";

export interface BuildCursor {
  /** Canvas being edited: a room id, or "base" for the outdoor grounds. */
  canvas: string;
  x: number;
  y: number;
  w: number;
  h: number;
  materialId: string;
  elevation: number;
}

// The shape stored inside player_hq.stats. Kept separate from BuildCursor so
// every field is optional on the way in and defaulted on the way out.
export interface StoredBuild {
  canvas?: string;
  x?: number; y?: number; w?: number; h?: number;
  materialId?: string;
  elevation?: number;
}

// A first-time cursor sits in open ground toward the front of the grounds
// rather than at (0,0) — the lattice origin is the BACK corner, which on the
// base scene is tucked behind the castle where a new player can't see it.
export const DEFAULT_CURSOR: BuildCursor = {
  canvas: BASE_CANVAS_ID,
  x: 3, y: 6, w: 2, h: 2,
  materialId: DEFAULT_SURFACE_ID,
  elevation: 0,
};

/** Read a stored cursor, clamped to `grid` and to a material that still exists. */
export function readCursor(stored: StoredBuild | undefined, canvas: string, grid: number): BuildCursor {
  const materialId = stored?.materialId && getSurfaceById(stored.materialId)
    ? stored.materialId : DEFAULT_SURFACE_ID;
  const w = clampSpan(stored?.w ?? DEFAULT_CURSOR.w, grid);
  const h = clampSpan(stored?.h ?? DEFAULT_CURSOR.h, grid);
  return {
    canvas,
    w, h,
    x: clampPos(stored?.x ?? DEFAULT_CURSOR.x, w, grid),
    y: clampPos(stored?.y ?? DEFAULT_CURSOR.y, h, grid),
    materialId,
    elevation: Math.max(0, Math.min(MAX_ELEVATION, Math.round(stored?.elevation ?? 0))),
  };
}

function clampSpan(n: number, grid: number): number {
  return Math.max(1, Math.min(Math.min(MAX_RECT_SPAN, grid), Math.round(n) || 1));
}
function clampPos(n: number, span: number, grid: number): number {
  return Math.max(0, Math.min(grid - span, Math.round(n) || 0));
}

/** Re-clamp a cursor after a move/resize so it always stays on the lattice. */
export function clampCursor(cur: BuildCursor, grid: number): BuildCursor {
  const w = clampSpan(cur.w, grid);
  const h = clampSpan(cur.h, grid);
  return { ...cur, w, h, x: clampPos(cur.x, w, grid), y: clampPos(cur.y, h, grid) };
}

/** Persist the cursor, merging into the HQ's stats blob. */
export async function saveCursor(guildId: string, userId: string, cur: BuildCursor): Promise<void> {
  const hq = await getOrCreateHq(guildId, userId);
  const stats = { ...(hq.stats as Record<string, unknown>), build: cur satisfies StoredBuild };
  await updateHq(guildId, userId, { stats });
}

/** The cursor's readout, drawn on the image and echoed in the embed. */
export function cursorLabel(cur: BuildCursor): string {
  const mat = resolveSurface(cur.materialId);
  const lift = cur.elevation > 0 ? ` h${cur.elevation}` : "";
  return `${mat.name} · ${cur.w}x${cur.h} @ (${cur.x},${cur.y})${lift}`;
}
