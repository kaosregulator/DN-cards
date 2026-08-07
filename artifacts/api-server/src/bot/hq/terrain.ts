// ─────────────────────────────────────────────────────────────────────────────
// HQ — built terrain (the world-editor service).
//
// Owns `hq_terrain`: the rectangles a player stamps onto a room's isometric
// lattice or onto the outdoor grounds. Pure data-access plus the rules that keep
// a build legal — bounds, size caps, a per-canvas feature budget — so both entry
// points (the visual Build section in /hq and the precise /hqbuild subcommands)
// share exactly one set of semantics.
//
// Deliberately additive: single-tile decorations still live in `hq_placements`.
// This table only owns AREAS, which is what makes "paint a 4×3 pond" one row
// instead of twelve.
// ─────────────────────────────────────────────────────────────────────────────

import { db, hqTerrainTable, type HqTerrain } from "@workspace/db";
import { and, asc, eq } from "drizzle-orm";
import { resolveSurface, getSurfaceById } from "./defs/surfaces.js";
import type { HqTerrainFeature } from "./render-terrain.js";

// The outdoor grounds are edited as a pseudo-room, matching how base
// decorations are already stored.
export const BASE_CANVAS_ID = "base";

// How many features one canvas may hold. Generous enough to landscape a whole
// room, bounded so a render never has to composite hundreds of quads.
export const MAX_FEATURES_PER_CANVAS = 40;
// The largest single rectangle, in tiles. Bigger than this and one stamp would
// carpet the entire lattice, which the "clear" action already covers.
export const MAX_RECT_SPAN = 8;
export const MAX_ELEVATION = 5;

export interface TerrainRect {
  materialId: string;
  x: number; y: number; w: number; h: number;
  elevation: number;
}

export type BuildFailure =
  | { ok: false; reason: string };
export type BuildSuccess =
  | { ok: true; feature: HqTerrainFeature };
export type BuildResult = BuildSuccess | BuildFailure;

/** Every feature on one canvas, oldest first (which is also paint order). */
export async function listTerrain(
  guildId: string, userId: string, roomId: string,
): Promise<HqTerrainFeature[]> {
  const rows = await db.select().from(hqTerrainTable)
    .where(and(
      eq(hqTerrainTable.guildId, guildId),
      eq(hqTerrainTable.userId, userId),
      eq(hqTerrainTable.roomId, roomId),
    ))
    .orderBy(asc(hqTerrainTable.z), asc(hqTerrainTable.id));
  return rows.map(toFeature);
}

function toFeature(r: HqTerrain): HqTerrainFeature {
  return {
    id: r.id, materialId: r.materialId,
    x: r.x, y: r.y, w: r.w, h: r.h,
    elevation: r.elevation, z: r.z,
  };
}

/**
 * Validate and stamp a rectangle. Returns a human reason on rejection so both
 * UIs can say exactly what went wrong instead of silently doing nothing.
 * `grid` is the lattice size of the canvas being edited (rooms and the grounds
 * have different lattices).
 */
export async function placeTerrain(
  guildId: string, userId: string, roomId: string, grid: number, rect: TerrainRect,
): Promise<BuildResult> {
  if (!getSurfaceById(rect.materialId)) {
    return { ok: false, reason: `Unknown material \`${rect.materialId}\`.` };
  }
  const w = Math.round(rect.w), h = Math.round(rect.h);
  const x = Math.round(rect.x), y = Math.round(rect.y);
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(w) || !Number.isFinite(h)) {
    return { ok: false, reason: "Coordinates must be whole numbers." };
  }
  if (w < 1 || h < 1) return { ok: false, reason: "Width and height must be at least 1 tile." };
  if (w > MAX_RECT_SPAN || h > MAX_RECT_SPAN) {
    return { ok: false, reason: `A single surface can be at most ${MAX_RECT_SPAN}×${MAX_RECT_SPAN} tiles.` };
  }
  if (x < 0 || y < 0 || x + w > grid || y + h > grid) {
    return { ok: false, reason: `That rectangle runs off the ${grid}×${grid} grid — keep x+w and y+h within ${grid}.` };
  }
  const elevation = Math.max(0, Math.min(MAX_ELEVATION, Math.round(rect.elevation)));

  const existing = await listTerrain(guildId, userId, roomId);
  if (existing.length >= MAX_FEATURES_PER_CANVAS) {
    return { ok: false, reason: `This space already has ${MAX_FEATURES_PER_CANVAS} built surfaces — remove one first.` };
  }
  // Stamping the identical rectangle twice is almost always a double-click, and
  // it would just burn a slot painting the same pixels.
  const dup = existing.find(f =>
    f.materialId === rect.materialId && f.x === x && f.y === y && f.w === w && f.h === h);
  if (dup) return { ok: false, reason: "That exact surface is already here." };

  const z = existing.reduce((m, f) => Math.max(m, f.z), 0) + 1;
  const [row] = await db.insert(hqTerrainTable)
    .values({ guildId, userId, roomId, materialId: rect.materialId, x, y, w, h, elevation, z })
    .returning();
  if (!row) return { ok: false, reason: "Could not save that surface — try again." };
  return { ok: true, feature: toFeature(row) };
}

/**
 * Remove the TOP-MOST feature covering a tile — the one the player can actually
 * see there, which is what "remove at this spot" means when surfaces overlap.
 */
export async function removeTerrainAt(
  guildId: string, userId: string, roomId: string, x: number, y: number,
): Promise<HqTerrainFeature | null> {
  const features = await listTerrain(guildId, userId, roomId);
  const hit = features
    .filter(f => x >= f.x && x < f.x + f.w && y >= f.y && y < f.y + f.h)
    .sort((a, b) => b.z - a.z || b.id - a.id)[0];
  if (!hit) return null;
  await db.delete(hqTerrainTable).where(eq(hqTerrainTable.id, hit.id));
  return hit;
}

/** Remove one feature by its row id (used by the list-and-pick UI). */
export async function removeTerrainById(
  guildId: string, userId: string, id: number,
): Promise<boolean> {
  const rows = await db.delete(hqTerrainTable)
    .where(and(
      eq(hqTerrainTable.guildId, guildId),
      eq(hqTerrainTable.userId, userId),
      eq(hqTerrainTable.id, id),
    ))
    .returning({ id: hqTerrainTable.id });
  return rows.length > 0;
}

/** Bulldoze a whole canvas. Returns how many features were removed. */
export async function clearTerrain(
  guildId: string, userId: string, roomId: string,
): Promise<number> {
  const rows = await db.delete(hqTerrainTable)
    .where(and(
      eq(hqTerrainTable.guildId, guildId),
      eq(hqTerrainTable.userId, userId),
      eq(hqTerrainTable.roomId, roomId),
    ))
    .returning({ id: hqTerrainTable.id });
  return rows.length;
}

/** Remove every built surface a player owns (admin wipe). */
export async function clearAllTerrain(guildId: string, userId: string): Promise<void> {
  await db.delete(hqTerrainTable)
    .where(and(eq(hqTerrainTable.guildId, guildId), eq(hqTerrainTable.userId, userId)));
}

/** A one-line human summary of a feature, for lists and receipts. */
export function describeFeature(f: HqTerrainFeature): string {
  const mat = resolveSurface(f.materialId);
  const size = `${f.w}×${f.h}`;
  const lift = f.elevation > 0 ? ` · h${f.elevation}` : "";
  return `${mat.emoji} **${mat.name}** ${size} @ (${f.x},${f.y})${lift}`;
}
