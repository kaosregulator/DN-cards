// ─────────────────────────────────────────────────────────────────────────────
// World Builder — shared data contracts (server).
//
// World edits are overlays on top of the shipped Tiled / HM maps. The base maps
// stay in public/world; admin edits live in WORLD_BUILDER_DATA_DIR as JSON +
// imported asset packs. Compatible with multi-floor / interior spaces later via
// spaceKind / floor / buildingId without requiring a separate game system.
// ─────────────────────────────────────────────────────────────────────────────

export type WorldAssetCategory =
  | "floors"
  | "terrain"
  | "roads"
  | "buildings"
  | "walls"
  | "doors"
  | "windows"
  | "furniture"
  | "vehicles"
  | "vegetation"
  | "props"
  | "characters"
  | "enemies"
  | "signs"
  | "interactive"
  | "spawns"
  | "zones"
  | "collision"
  | "other";

export type WorldObjectKind =
  | "prop"
  | "building"
  | "vegetation"
  | "vehicle"
  | "furniture"
  | "sign"
  | "door"
  | "interactive"
  | "npc"
  | "enemy"
  | "spawn"
  | "zone"
  | "collision"
  | "other";

export type NpcBehavior = "stand" | "idle" | "walk" | "patrol";
export type Facing = "down" | "left" | "right" | "up";

/** Tile stamp relative to a named tilemap layer (WA maps). */
export interface TilePatch {
  layer: string;
  x: number;
  y: number;
  /** Tiled global id; 0 / -1 clears the cell. */
  gid: number;
}

export interface WorldNpcProps {
  characterType?: string;
  name?: string;
  animation?: string;
  facing?: Facing;
  behavior?: NpcBehavior;
  patrol?: { x: number; y: number }[];
  dialogue?: string[];
  interaction?: string;
  collision?: boolean;
  /** Reserved for future multi-floor / interior linking. */
  buildingId?: string;
  floor?: number;
  spaceKind?: "exterior" | "interior" | "roof" | "transition";
}

export interface WorldObject {
  uid: string;
  kind: WorldObjectKind;
  /** Catalog / pack asset id, or builtin path key. */
  assetId: string;
  x: number;
  y: number;
  /** Degrees, typically 0/90/180/270. */
  rotation?: number;
  scale?: number;
  depth?: number;
  layer?: string;
  collide?: boolean;
  properties?: WorldNpcProps & Record<string, unknown>;
  /** Multi-floor / building space hooks (optional). */
  buildingId?: string;
  floor?: number;
  spaceKind?: "exterior" | "interior" | "roof" | "transition";
}

export interface WorldZone {
  uid: string;
  name: string;
  kind: "interaction" | "collision" | "trigger" | "teleport" | "floor" | "generic";
  x: number;
  y: number;
  w: number;
  h: number;
  properties?: Record<string, unknown>;
  buildingId?: string;
  floor?: number;
}

export interface WorldSpawn {
  uid: string;
  kind: "player" | "npc" | "enemy" | "generic";
  x: number;
  y: number;
  facing?: Facing;
  properties?: Record<string, unknown>;
}

export interface WorldDoor {
  uid: string;
  x: number;
  y: number;
  label?: string;
  targetMap?: string;
  targetX?: number;
  targetY?: number;
  targetFloor?: number;
  buildingId?: string;
  properties?: Record<string, unknown>;
}

export interface WorldEditDocument {
  version: 1;
  mapKey: string;
  revision: number;
  updatedAt: string;
  updatedBy?: string;
  metadata: {
    name?: string;
    notes?: string;
    /** Future multi-floor support — default floor for this document slice. */
    defaultFloor?: number;
  };
  tiles: TilePatch[];
  objects: WorldObject[];
  zones: WorldZone[];
  spawns: WorldSpawn[];
  doors: WorldDoor[];
  collision: { x: number; y: number; solid: boolean }[];
}

export function emptyWorldDoc(mapKey: string): WorldEditDocument {
  return {
    version: 1,
    mapKey,
    revision: 0,
    updatedAt: new Date().toISOString(),
    metadata: { defaultFloor: 0 },
    tiles: [],
    objects: [],
    zones: [],
    spawns: [],
    doors: [],
    collision: [],
  };
}

export interface WorldAssetEntry {
  id: string;
  name: string;
  category: WorldAssetCategory;
  /** URL path relative to API base or activity public root. */
  url: string;
  packId: string;
  kind: WorldObjectKind;
  /**
   * When present, this asset is (or belongs to) a paintable tile grid rather
   * than a single placed object. `columns`×`rows` = `count` individual tiles of
   * `tileWidth`×`tileHeight`; `localId` selects one cell (0-based, row-major).
   * `sheet: true` marks a multi-tile sheet the palette slices into a tile
   * picker so each cell can be painted individually (RPG Maker MV 48×48 sheets,
   * LimeZu tilesets, etc.). A plain single-tile entry omits `sheet`/`rows`/`count`.
   */
  tile?: {
    tileset: string;
    localId: number;
    tileWidth: number;
    tileHeight: number;
    columns: number;
    rows?: number;
    count?: number;
    sheet?: boolean;
  };
  footprint?: { w: number; h: number };
  rotatable?: boolean;
  tags?: string[];
  /** Thumbnail URL (may equal url for simple sprites). */
  thumb?: string;
}

export interface WorldAssetPack {
  id: string;
  name: string;
  source: "builtin" | "imported";
  description?: string;
  importedAt?: string;
  assetCount: number;
  categories: WorldAssetCategory[];
  /** Original pack relative roots preserved for browsing. */
  roots?: string[];
}

export interface PackImportSummary {
  packId: string;
  name: string;
  imported: number;
  skipped: number;
  unsupported: string[];
  categories: WorldAssetCategory[];
  warnings: string[];
}
