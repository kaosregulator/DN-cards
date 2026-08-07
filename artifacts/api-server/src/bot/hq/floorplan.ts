// ─────────────────────────────────────────────────────────────────────────────
// HQ — floorplan engine (load / mutate / expand / wall tools).
//
 // Reads and writes player_hq.stats.floorplan. Wall edges auto-connect by
 // sharing grid vertices; openings punch doors/archways/windows into edges.
 // ─────────────────────────────────────────────────────────────────────────────

import { getOrCreateHq, updateHq } from "./db.js";
import { readHqStats, type HqStatsBlob } from "./base-state.js";
import {
  createDefaultFloorplan, FLOORPLAN_EXPANSIONS, FLOORPLAN_W, FLOORPLAN_H,
  hEdge, vEdge, parseEdge, perimeterEdges, sharedEdges, rectContains,
  type FloorplanState, type FloorplanWall, type FloorplanOpening,
  type FloorplanZone, type FloorplanRect, type OpeningKind, type WallKind,
  type FloorplanExpansion,
} from "./defs/floorplan.js";
import { evalUnlockRule, type HqProgress } from "./defs/unlock-rules.js";

export type { FloorplanState, FloorplanZone, FloorplanWall, FloorplanOpening };

export function readFloorplan(hqStats: HqStatsBlob): FloorplanState {
  const fp = hqStats.floorplan;
  if (fp && fp.version === 1 && Array.isArray(fp.zones) && fp.zones.length > 0) {
    return {
      ...fp,
      width: fp.width || FLOORPLAN_W,
      height: fp.height || FLOORPLAN_H,
      walls: fp.walls ?? [],
      openings: fp.openings ?? [],
      claimedExpansions: fp.claimedExpansions ?? [],
      focusZoneId: fp.focusZoneId || fp.zones[0]!.id,
    };
  }
  return createDefaultFloorplan();
}

export async function loadFloorplan(guildId: string, userId: string): Promise<FloorplanState> {
  const hq = await getOrCreateHq(guildId, userId);
  return readFloorplan(readHqStats(hq));
}

export async function saveFloorplan(
  guildId: string, userId: string, floorplan: FloorplanState,
): Promise<FloorplanState> {
  const hq = await getOrCreateHq(guildId, userId);
  const stats = { ...readHqStats(hq), floorplan };
  await updateHq(guildId, userId, { stats });
  return floorplan;
}

export function focusZone(fp: FloorplanState, zoneId: string): FloorplanState {
  if (!fp.zones.some(z => z.id === zoneId)) return fp;
  return { ...fp, focusZoneId: zoneId };
}

export function getFocusZone(fp: FloorplanState): FloorplanZone {
  return fp.zones.find(z => z.id === fp.focusZoneId) ?? fp.zones[0]!;
}

export function zoneByRoomType(fp: FloorplanState, roomTypeId: string): FloorplanZone | undefined {
  return fp.zones.find(z => z.roomTypeId === roomTypeId && z.unlocked);
}

export function wallSet(fp: FloorplanState): Set<string> {
  return new Set(fp.walls.map(w => w.key));
}

export function openingSet(fp: FloorplanState): Map<string, FloorplanOpening> {
  return new Map(fp.openings.map(o => [o.key, o]));
}

/** Place or replace a wall edge (snaps to grid). */
export function placeWall(
  fp: FloorplanState,
  key: string,
  opts: { kind?: WallKind; styleId?: string } = {},
): FloorplanState {
  if (!parseEdge(key)) return fp;
  // Can't place a solid wall over an opening — remove opening first.
  const openings = fp.openings.filter(o => o.key !== key);
  const walls = fp.walls.filter(w => w.key !== key);
  walls.push({
    key,
    kind: opts.kind ?? "interior",
    styleId: opts.styleId ?? "stone",
  });
  return { ...fp, walls, openings };
}

/** Remove a wall edge (and any opening on it). */
export function removeWall(fp: FloorplanState, key: string): FloorplanState {
  return {
    ...fp,
    walls: fp.walls.filter(w => w.key !== key),
    openings: fp.openings.filter(o => o.key !== key),
  };
}

/** Punch a door/archway/window into an existing wall (or create wall+opening). */
export function placeOpening(
  fp: FloorplanState,
  key: string,
  kind: OpeningKind,
  fromZoneId?: string,
  toZoneId?: string,
): FloorplanState {
  if (!parseEdge(key)) return fp;
  let walls = fp.walls;
  if (!walls.some(w => w.key === key)) {
    // Ensure a wall exists so the opening has a frame.
    walls = [...walls, { key, kind: "interior" as const, styleId: "stone" }];
  }
  const openings = fp.openings.filter(o => o.key !== key);
  openings.push({ key, kind, fromZoneId, toZoneId });
  return { ...fp, walls, openings };
}

export function removeOpening(fp: FloorplanState, key: string): FloorplanState {
  return { ...fp, openings: fp.openings.filter(o => o.key !== key) };
}

/** Place a run of walls along a rect perimeter (interior divider). */
export function placeInteriorBox(
  fp: FloorplanState, rect: FloorplanRect, styleId = "wood",
): FloorplanState {
  let next = fp;
  for (const key of perimeterEdges(rect)) {
    next = placeWall(next, key, { kind: "interior", styleId });
  }
  return next;
}

/** Claim an expansion parcel — unlocks the zone and builds its exterior + door. */
export function claimExpansion(fp: FloorplanState, expansionId: string): FloorplanState {
  if (fp.claimedExpansions.includes(expansionId)) return fp;
  const exp = FLOORPLAN_EXPANSIONS.find(e => e.id === expansionId);
  if (!exp) return fp;

  const zones = fp.zones.map(z =>
    z.id === exp.zoneId ? { ...z, unlocked: true, rect: exp.rect, name: exp.label, emoji: exp.emoji } : z,
  );
  // If zone wasn't in the list, add it.
  if (!zones.some(z => z.id === exp.zoneId)) {
    zones.push({
      id: exp.zoneId, roomTypeId: exp.roomTypeId, name: exp.label, emoji: exp.emoji,
      rect: exp.rect, unlocked: true,
    });
  }

  // Attach to nearest unlocked hallway / room via a door on a shared edge.
  const unlocked = zones.filter(z => z.unlocked && z.id !== exp.zoneId);
  let doorKey: string | null = null;
  let fromId: string | undefined;
  for (const other of unlocked) {
    const shared = sharedEdges(exp.rect, other.rect);
    if (shared.length > 0) {
      doorKey = shared[Math.floor(shared.length / 2)]!;
      fromId = other.id;
      break;
    }
  }

  let walls = fp.walls.slice();
  const skip = new Set<string>(doorKey ? [doorKey] : []);
  for (const key of perimeterEdges(exp.rect)) {
    if (skip.has(key)) continue;
    if (walls.some(w => w.key === key)) continue;
    walls.push({ key, kind: "exterior", styleId: "stone" });
  }
  // Remove wall on door edge if present, then add opening
  if (doorKey) walls = walls.filter(w => w.key !== doorKey);

  const openings = fp.openings.slice();
  if (doorKey) {
    walls.push({ key: doorKey, kind: "interior", styleId: "stone" });
    openings.push({
      key: doorKey, kind: "door", fromZoneId: fromId, toZoneId: exp.zoneId,
    });
  }

  return {
    ...fp,
    zones,
    walls,
    openings,
    claimedExpansions: [...fp.claimedExpansions, expansionId],
    focusZoneId: exp.zoneId,
  };
}

export function availableExpansions(
  fp: FloorplanState,
  progress: HqProgress,
): FloorplanExpansion[] {
  return FLOORPLAN_EXPANSIONS.filter(e => {
    if (fp.claimedExpansions.includes(e.id)) return false;
    return evalUnlockRule(e.unlock, progress);
  });
}

/** Sync zone unlock flags from owned room unlocks (progression). */
export function syncZoneUnlocks(
  fp: FloorplanState,
  ownedRoomTypeIds: Set<string>,
): FloorplanState {
  // Hallways always unlocked; room zones unlock when the room type is owned
  // OR the expansion was claimed.
  let changed = false;
  const zones = fp.zones.map(z => {
    if (z.roomTypeId === "hallway" || z.roomTypeId.startsWith("hallway")) {
      return z.unlocked ? z : (changed = true, { ...z, unlocked: true });
    }
    // Starter rooms always on
    if (z.id === "entrance" || z.id === "trophy-hall") {
      return z.unlocked ? z : (changed = true, { ...z, unlocked: true });
    }
    const should = ownedRoomTypeIds.has(z.roomTypeId)
      || fp.claimedExpansions.some(id => FLOORPLAN_EXPANSIONS.find(e => e.id === id)?.zoneId === z.id);
    if (should !== z.unlocked) {
      changed = true;
      return { ...z, unlocked: should };
    }
    return z;
  });
  return changed ? { ...fp, zones } : fp;
}

/** Human-readable connection list for embeds. */
export function describeConnections(fp: FloorplanState): string[] {
  const name = (id?: string) => fp.zones.find(z => z.id === id)?.name ?? id ?? "?";
  return fp.openings
    .filter(o => o.kind !== "window" && o.fromZoneId && o.toZoneId)
    .map(o => `${name(o.fromZoneId)} → ${name(o.toZoneId)} (${o.kind})`);
}

/** Find which unlocked zone contains a cell. */
export function zoneAt(fp: FloorplanState, x: number, y: number): FloorplanZone | undefined {
  return fp.zones.find(z => z.unlocked && rectContains(z.rect, x, y));
}

/** Cursor helpers — convert floorplan cell to nearest wall edge under brush. */
export function edgeNearCell(
  x: number, y: number, prefer: "h" | "v" | "auto" = "auto",
): string {
  if (prefer === "h") return hEdge(x, y);
  if (prefer === "v") return vEdge(x, y);
  // Prefer the edge toward the focus of a 2-cell brush — default west vertical
  return vEdge(x, y);
}

export function listUnlockedZones(fp: FloorplanState): FloorplanZone[] {
  return fp.zones.filter(z => z.unlocked);
}
