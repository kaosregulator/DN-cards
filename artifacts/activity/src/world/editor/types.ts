// Shared World Builder types (client mirror of server contracts).

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

export interface TilePatch {
  layer: string;
  x: number;
  y: number;
  gid: number;
}

/**
 * An imported tile-sheet registered onto a map so painted tiles resolve to real
 * artwork. Blank maps ship only the `wb-blank` stamp, so without this record a
 * painted imported tile has no tileset to render against. Persisted in the doc
 * with a stable `firstgid` so the same gids re-resolve after reload / playtest.
 */
export interface WorldDocTileset {
  /** Source tileset name — matches WorldAssetEntry.tile.tileset. */
  name: string;
  /** Sheet image URL (catalog asset url); resolved against the API base at load. */
  image: string;
  tileWidth: number;
  tileHeight: number;
  columns: number;
  /** Total tiles in the sheet (columns × rows). */
  tileCount: number;
  /** Stable global id of this tileset's first tile on the map. */
  firstgid: number;
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
  buildingId?: string;
  floor?: number;
  spaceKind?: "exterior" | "interior" | "roof" | "transition";
}

export interface WorldObject {
  uid: string;
  kind: WorldObjectKind;
  assetId: string;
  x: number;
  y: number;
  rotation?: number;
  scale?: number;
  depth?: number;
  layer?: string;
  collide?: boolean;
  properties?: WorldNpcProps & Record<string, unknown>;
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
  /** Human-readable spawn id used by doors ("Cave Entrance", "Main Entrance"). */
  name?: string;
  kind: "player" | "npc" | "enemy" | "generic";
  x: number;
  y: number;
  facing?: Facing;
  /** When true, used as the default arrival for this map when no spawn is specified. */
  isDefault?: boolean;
  properties?: Record<string, unknown>;
}

export interface WorldDoor {
  uid: string;
  x: number;
  y: number;
  label?: string;
  /** Destination map key (shipped or custom). */
  targetMap?: string;
  /** Named spawn on the destination map (preferred over raw coords). */
  targetSpawn?: string;
  targetX?: number;
  targetY?: number;
  targetFloor?: number;
  transition?: "fade" | "instant";
  locked?: boolean;
  buildingId?: string;
  properties?: Record<string, unknown>;
}

/** Space / map-type hint for multi-floor and interior readiness. */
export type MapSpaceKind =
  | "exterior"
  | "interior"
  | "roof"
  | "cave"
  | "arena"
  | "hq"
  | "other";

/**
 * Registry entry for a playable map in the World Builder Map Manager.
 * Custom blank maps are first-class; shipped Tiled/HM maps appear as overlay targets.
 */
export interface CustomMapMeta {
  key: string;
  name: string;
  subtitle?: string;
  /** custom = created in Map Manager; shipped = existing Tiled/HM map with optional overlay. */
  source: "custom" | "shipped";
  /** When true, Phaser builds a procedural blank tilemap (no .tmj required). */
  blank: boolean;
  tile: number;
  gridW: number;
  gridH: number;
  spawn: "start" | "center";
  spawnTile?: { tx: number; ty: number };
  spaceKind?: MapSpaceKind;
  defaultFloor?: number;
  createdAt: string;
  updatedAt: string;
  /** True when a WorldEditDocument file exists for this key. */
  hasEdits?: boolean;
}

export interface CreateMapRequest {
  name: string;
  key?: string;
  width?: number;
  height?: number;
  tile?: number;
  spaceKind?: MapSpaceKind;
  /** Optional starting floor fill from a catalog tile asset id. */
  baseAssetId?: string;
  subtitle?: string;
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
    defaultFloor?: number;
    spaceKind?: MapSpaceKind;
  };
  tiles: TilePatch[];
  /** Imported tile-sheets registered on this map (see WorldDocTileset). */
  tilesets?: WorldDocTileset[];
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
    tilesets: [],
    objects: [],
    zones: [],
    spawns: [],
    doors: [],
    collision: [],
  };
}

/**
 * Next free firstgid above the blank base (`mapMaxGid`, the highest gid already
 * on the live map) and any sheets already registered in the doc. Keeping this
 * deterministic + persisted is what makes painted imported tiles survive a
 * reload: the same sheet always re-registers at the same firstgid.
 */
export function nextFirstGid(
  existing: { firstgid: number; tileCount: number }[],
  mapMaxGid = 1,
): number {
  let max = mapMaxGid;
  for (const t of existing) max = Math.max(max, t.firstgid + t.tileCount - 1);
  return max + 1;
}

/** Build a persistable tileset record for an imported sheet asset. */
export function docTilesetFromAsset(
  asset: WorldAssetEntry,
  firstgid: number,
): WorldDocTileset | null {
  const t = asset.tile;
  if (!t) return null;
  const image = asset.url || asset.thumb || "";
  if (!image) return null;
  const columns = Math.max(1, t.columns || 1);
  const rows = Math.max(1, t.rows ?? Math.ceil((t.count ?? columns) / columns));
  const tileCount = Math.max(1, t.count ?? columns * rows);
  return {
    name: t.tileset,
    image,
    tileWidth: t.tileWidth,
    tileHeight: t.tileHeight,
    columns,
    tileCount,
    firstgid,
  };
}

/** Absolute gid for an asset given the doc's registered tilesets, or null. */
export function paintGidFromDocTilesets(
  tilesets: WorldDocTileset[] | undefined,
  asset: WorldAssetEntry,
): number | null {
  const t = asset.tile;
  if (!t || !tilesets) return null;
  const ts = tilesets.find((x) => x.name === t.tileset);
  return ts ? ts.firstgid + (t.localId ?? 0) : null;
}

export interface WorldAssetEntry {
  id: string;
  name: string;
  category: WorldAssetCategory;
  url: string;
  packId: string;
  kind: WorldObjectKind;
  tile?: {
    tileset: string;
    localId: number;
    tileWidth: number;
    tileHeight: number;
    columns: number;
    /** Multi-tile sheet grid (RPG Maker MV 48×48, LimeZu tilesets). */
    rows?: number;
    count?: number;
    sheet?: boolean;
  };
  footprint?: { w: number; h: number };
  rotatable?: boolean;
  tags?: string[];
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

export type EditorTool =
  | "select"
  | "paint"
  | "place"
  | "erase"
  | "collision"
  | "zone"
  | "spawn"
  | "duplicate";

export const CATEGORY_LABELS: Record<WorldAssetCategory, string> = {
  floors: "Floors",
  terrain: "Terrain",
  roads: "Roads",
  buildings: "Buildings",
  walls: "Walls",
  doors: "Doors",
  windows: "Windows",
  furniture: "Furniture",
  vehicles: "Vehicles",
  vegetation: "Vegetation",
  props: "Props",
  characters: "Characters",
  enemies: "Enemies",
  signs: "Signs",
  interactive: "Interactive",
  spawns: "Spawns",
  zones: "Zones",
  collision: "Collision",
  other: "Other",
};

export const CATEGORY_ORDER: WorldAssetCategory[] = [
  "floors", "terrain", "roads", "buildings", "walls", "doors", "windows",
  "furniture", "vehicles", "vegetation", "props", "signs", "interactive",
  "characters", "enemies", "spawns", "zones", "collision", "other",
];

/** Geometry for one cell of a sliced tile sheet in the palette picker.
 *  Pure + shared by the DOM picker so the slicing math is unit-testable. */
export interface TileCellRect { col: number; row: number; bgX: number; bgY: number; bgW: number; bgH: number; }
export function tilePickerCell(
  t: { tileWidth: number; tileHeight: number; columns: number; rows?: number; count?: number },
  id: number,
  cell: number,
): TileCellRect {
  const columns = Math.max(1, t.columns);
  const rows = Math.max(1, t.rows ?? Math.ceil((t.count ?? columns) / columns));
  const sx = cell / t.tileWidth, sy = cell / t.tileHeight;   // sheet px → on-screen px
  const col = id % columns, row = Math.floor(id / columns);
  return {
    col, row,
    bgW: columns * t.tileWidth * sx,   // full sheet width, scaled
    bgH: rows * t.tileHeight * sy,
    bgX: -(col * t.tileWidth * sx),    // shift so this cell shows
    bgY: -(row * t.tileHeight * sy),
  };
}
