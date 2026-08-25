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
