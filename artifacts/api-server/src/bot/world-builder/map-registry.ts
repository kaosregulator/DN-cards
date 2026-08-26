// ─────────────────────────────────────────────────────────────────────────────
// Custom map registry — first-class blank maps created in the Map Manager.
// Shipped Tiled/HM maps stay in code; custom maps live in index.json + docs.
// ─────────────────────────────────────────────────────────────────────────────

import { existsSync, readFileSync, writeFileSync, unlinkSync, copyFileSync } from "node:fs";
import { join } from "node:path";
import {
  emptyWorldDoc,
  type CreateMapRequest,
  type CustomMapMeta,
  type WorldEditDocument,
  type MapSpaceKind,
} from "./types.js";
import {
  listMapKeysWithEdits,
  loadWorldDoc,
  saveWorldDoc,
  worldBuilderRoot,
} from "./store.js";

function indexPath(): string {
  return join(worldBuilderRoot(), "index.json");
}

interface IndexFile {
  packs?: unknown[];
  maps?: CustomMapMeta[];
}

function readIndexFile(): IndexFile {
  const p = indexPath();
  if (!existsSync(p)) return { packs: [], maps: [] };
  try {
    return JSON.parse(readFileSync(p, "utf8")) as IndexFile;
  } catch {
    return { packs: [], maps: [] };
  }
}

function writeMaps(maps: CustomMapMeta[]): void {
  const idx = readIndexFile();
  idx.maps = maps;
  if (!idx.packs) idx.packs = [];
  writeFileSync(indexPath(), JSON.stringify(idx, null, 2));
}

function slugifyKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "map";
}

function uniqueKey(desired: string): string {
  const safe = desired.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 48) || "map";
  // Avoid colliding with common shipped keys by prefixing custom maps with wb-
  // only when the bare key already exists as a custom entry OR looks reserved.
  const reserved = new Set([
    "world", "village", "card-shop", "duel-hall", "cave",
  ]);
  let base = reserved.has(safe) || safe.startsWith("hm-") ? `wb-${safe}` : safe;
  if (!base.startsWith("wb-") && !reserved.has(safe)) {
    // Prefer wb- prefix for all custom maps so they never clash with future shipped maps.
    base = `wb-${safe}`;
  }
  const existing = new Set(listCustomMaps().map((m) => m.key));
  if (!existing.has(base)) return base;
  for (let i = 2; i < 1000; i++) {
    const k = `${base}-${i}`;
    if (!existing.has(k)) return k;
  }
  return `${base}-${Date.now().toString(36)}`;
}

export function listCustomMaps(): CustomMapMeta[] {
  return readIndexFile().maps ?? [];
}

export function getCustomMap(key: string): CustomMapMeta | null {
  return listCustomMaps().find((m) => m.key === key) ?? null;
}

export function createCustomMap(
  req: CreateMapRequest,
  updatedBy?: string,
): { meta: CustomMapMeta; doc: WorldEditDocument } {
  const name = (req.name ?? "").trim();
  if (!name) throw new Error("Map name is required.");
  const width = Math.max(8, Math.min(256, Math.floor(req.width ?? 40)));
  const height = Math.max(8, Math.min(256, Math.floor(req.height ?? 30)));
  const tile = [16, 20, 32, 48].includes(req.tile ?? 32) ? (req.tile ?? 32) : 32;
  const key = uniqueKey(req.key?.trim() || slugifyKey(name));
  const now = new Date().toISOString();
  const spaceKind: MapSpaceKind = req.spaceKind ?? "exterior";
  const cx = Math.floor(width / 2);
  const cy = Math.floor(height / 2);

  const meta: CustomMapMeta = {
    key,
    name,
    subtitle: req.subtitle?.trim() || "World Builder map",
    source: "custom",
    blank: true,
    tile,
    gridW: width,
    gridH: height,
    spawn: "center",
    spawnTile: { tx: cx, ty: cy },
    spaceKind,
    defaultFloor: 0,
    createdAt: now,
    updatedAt: now,
    hasEdits: true,
  };

  const maps = listCustomMaps();
  maps.push(meta);
  writeMaps(maps);

  const doc = emptyWorldDoc(key);
  doc.metadata = {
    name,
    defaultFloor: 0,
    spaceKind,
    notes: req.baseAssetId ? `base:${req.baseAssetId}` : undefined,
  };
  // Default named spawn at centre so doors can target it immediately.
  doc.spawns.push({
    uid: `spawn_default_${key}`,
    name: "Default",
    kind: "player",
    x: cx * tile + tile / 2,
    y: cy * tile + tile / 2,
    facing: "down",
    isDefault: true,
  });
  const saved = saveWorldDoc(key, doc, updatedBy);
  return { meta, doc: saved };
}

export function renameCustomMap(key: string, name: string): CustomMapMeta {
  const maps = listCustomMaps();
  const i = maps.findIndex((m) => m.key === key);
  if (i < 0) throw new Error("Map not found.");
  const trimmed = name.trim();
  if (!trimmed) throw new Error("Name is required.");
  maps[i] = { ...maps[i]!, name: trimmed, updatedAt: new Date().toISOString() };
  writeMaps(maps);
  // Keep document metadata name in sync.
  const doc = loadWorldDoc(key);
  doc.metadata = { ...doc.metadata, name: trimmed };
  saveWorldDoc(key, doc);
  return maps[i]!;
}

export function duplicateCustomMap(
  key: string,
  newName?: string,
  updatedBy?: string,
): { meta: CustomMapMeta; doc: WorldEditDocument } {
  const src = getCustomMap(key);
  if (!src) throw new Error("Map not found.");
  const name = (newName?.trim() || `${src.name} Copy`);
  const created = createCustomMap({
    name,
    width: src.gridW,
    height: src.gridH,
    tile: src.tile,
    spaceKind: src.spaceKind,
    subtitle: src.subtitle,
  }, updatedBy);
  // Copy overlay content onto the new key (keep new default spawn if source empty).
  const srcDoc = loadWorldDoc(key);
  const copy: WorldEditDocument = {
    ...srcDoc,
    mapKey: created.meta.key,
    metadata: { ...srcDoc.metadata, name },
    revision: 0,
  };
  const saved = saveWorldDoc(created.meta.key, copy, updatedBy);
  return { meta: created.meta, doc: saved };
}

export function deleteCustomMap(key: string): boolean {
  const maps = listCustomMaps();
  const next = maps.filter((m) => m.key !== key);
  if (next.length === maps.length) return false;
  writeMaps(next);
  const file = join(worldBuilderRoot(), "maps", `${key.replace(/[^a-zA-Z0-9_-]/g, "")}.json`);
  if (existsSync(file)) unlinkSync(file);
  return true;
}

/** Shipped map keys known to the Activity (kept in sync with worldMaps.ts core + HM). */
export const SHIPPED_MAP_CATALOG: Array<{
  key: string; name: string; subtitle: string; tile?: number; gridW?: number; gridH?: number;
}> = [
  { key: "world", name: "DN City", subtitle: "Main World · Plaza · Districts", tile: 32 },
  { key: "village", name: "The Village", subtitle: "Lakeside Campus · Explore", tile: 32 },
  { key: "card-shop", name: "Card Shop", subtitle: "Interior · Browse & Duel", tile: 32 },
  { key: "duel-hall", name: "Duel Hall", subtitle: "Tournament Floor", tile: 32 },
  { key: "cave", name: "Mystery Cave", subtitle: "A passage between worlds", tile: 32 },
];

/**
 * Full Map Manager list: shipped maps (with hasEdits) + custom blank maps.
 * Overlay-only keys that somehow exist without meta are included as custom stubs.
 */
export function listAllMapsForManager(): CustomMapMeta[] {
  const edits = new Set(listMapKeysWithEdits());
  const custom = listCustomMaps().map((m) => ({ ...m, hasEdits: edits.has(m.key) }));
  const customKeys = new Set(custom.map((m) => m.key));

  const shipped: CustomMapMeta[] = SHIPPED_MAP_CATALOG.map((s) => ({
    key: s.key,
    name: s.name,
    subtitle: s.subtitle,
    source: "shipped" as const,
    blank: false,
    tile: s.tile ?? 32,
    gridW: s.gridW ?? 0,
    gridH: s.gridH ?? 0,
    spawn: "center" as const,
    spaceKind: "exterior" as const,
    createdAt: "",
    updatedAt: "",
    hasEdits: edits.has(s.key),
  }));

  // Orphan overlay docs (edited but not in custom/shipped catalog) — treat as custom stubs.
  const orphans: CustomMapMeta[] = [];
  for (const k of edits) {
    if (customKeys.has(k) || SHIPPED_MAP_CATALOG.some((s) => s.key === k) || k.startsWith("hm-")) continue;
    const doc = loadWorldDoc(k);
    orphans.push({
      key: k,
      name: doc.metadata.name || k,
      subtitle: "World Builder map",
      source: "custom",
      blank: true,
      tile: 32,
      gridW: 40,
      gridH: 30,
      spawn: "center",
      createdAt: doc.updatedAt,
      updatedAt: doc.updatedAt,
      hasEdits: true,
    });
  }

  // Include a compact set of HM maps for travel targets (read-only shipped).
  const hmShipped: CustomMapMeta[] = [];
  for (const k of edits) {
    if (!k.startsWith("hm-")) continue;
    hmShipped.push({
      key: k,
      name: k.replace(/^hm-/, "").replace(/-/g, " "),
      subtitle: "Harvest Moon map",
      source: "shipped",
      blank: false,
      tile: 20,
      gridW: 0,
      gridH: 0,
      spawn: "start",
      createdAt: "",
      updatedAt: "",
      hasEdits: true,
    });
  }

  return [...shipped, ...custom, ...orphans, ...hmShipped];
}

/** Resolve a named spawn on a map document to tile coords. */
export function resolveSpawnPoint(
  mapKey: string,
  spawnNameOrUid?: string | null,
): { tx: number; ty: number; name?: string } | null {
  const doc = loadWorldDoc(mapKey);
  const meta = getCustomMap(mapKey);
  const tile = meta?.tile ?? 32;
  if (spawnNameOrUid) {
    const hit = doc.spawns.find(
      (s) => s.uid === spawnNameOrUid || s.name === spawnNameOrUid,
    );
    if (hit) {
      return { tx: Math.floor(hit.x / tile), ty: Math.floor(hit.y / tile), name: hit.name };
    }
  }
  const def = doc.spawns.find((s) => s.isDefault) ?? doc.spawns.find((s) => s.kind === "player");
  if (def) {
    return { tx: Math.floor(def.x / tile), ty: Math.floor(def.y / tile), name: def.name };
  }
  if (meta?.spawnTile) return { ...meta.spawnTile, name: "Default" };
  return null;
}

// Silence unused import in case tree-shaking complains in tests.
void copyFileSync;
