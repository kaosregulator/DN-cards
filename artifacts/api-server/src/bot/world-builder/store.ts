// ─────────────────────────────────────────────────────────────────────────────
// World Builder filesystem store — maps + imported packs survive restarts.
// ─────────────────────────────────────────────────────────────────────────────

import {
  existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync,
  rmSync, statSync,
} from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  emptyWorldDoc,
  type WorldEditDocument,
  type WorldAssetPack,
  type WorldAssetEntry,
} from "./types.js";

const HERE = dirname(fileURLToPath(import.meta.url));

/** Prefer env override; default to api-server/data/world-builder. */
export function worldBuilderRoot(): string {
  const env = process.env["WORLD_BUILDER_DATA_DIR"]?.trim();
  if (env) return resolve(env);
  const candidates = [
    // Dev source: bot/world-builder → api-server/data/world-builder
    resolve(HERE, "../../../data/world-builder"),
    // Bundled dist/index.mjs → api-server/data/world-builder
    resolve(HERE, "data/world-builder"),
    resolve(process.cwd(), "artifacts/api-server/data/world-builder"),
    resolve(process.cwd(), "data/world-builder"),
  ];
  for (const c of candidates) {
    // Prefer an existing tree; otherwise use the first writable api-server candidate.
    if (existsSync(c)) return c;
  }
  // Create under api-server/data when running from repo root.
  const fallback = resolve(process.cwd(), "artifacts/api-server/data/world-builder");
  mkdirSync(fallback, { recursive: true });
  return fallback;
}

function mapsDir(): string {
  const d = join(worldBuilderRoot(), "maps");
  mkdirSync(d, { recursive: true });
  return d;
}

function packsDir(): string {
  const d = join(worldBuilderRoot(), "packs");
  mkdirSync(d, { recursive: true });
  return d;
}

function indexPath(): string {
  return join(worldBuilderRoot(), "index.json");
}

export interface WorldBuilderIndex {
  packs: WorldAssetPack[];
}

function readIndex(): WorldBuilderIndex {
  const p = indexPath();
  if (!existsSync(p)) return { packs: [] };
  try {
    return JSON.parse(readFileSync(p, "utf8")) as WorldBuilderIndex;
  } catch {
    return { packs: [] };
  }
}

function writeIndex(idx: WorldBuilderIndex): void {
  mkdirSync(worldBuilderRoot(), { recursive: true });
  writeFileSync(indexPath(), JSON.stringify(idx, null, 2));
}

export function loadWorldDoc(mapKey: string): WorldEditDocument {
  const safe = mapKey.replace(/[^a-zA-Z0-9_-]/g, "");
  const file = join(mapsDir(), `${safe}.json`);
  if (!existsSync(file)) return emptyWorldDoc(mapKey);
  try {
    const raw = JSON.parse(readFileSync(file, "utf8")) as WorldEditDocument;
    if (raw?.version !== 1 || raw.mapKey !== mapKey) return emptyWorldDoc(mapKey);
    return raw;
  } catch {
    return emptyWorldDoc(mapKey);
  }
}

export function saveWorldDoc(
  mapKey: string,
  doc: WorldEditDocument,
  updatedBy?: string,
): WorldEditDocument {
  const safe = mapKey.replace(/[^a-zA-Z0-9_-]/g, "");
  const prev = loadWorldDoc(mapKey);
  const next: WorldEditDocument = {
    ...doc,
    version: 1,
    mapKey,
    revision: (prev.revision ?? 0) + 1,
    updatedAt: new Date().toISOString(),
    updatedBy,
    tiles: doc.tiles ?? [],
    objects: doc.objects ?? [],
    zones: doc.zones ?? [],
    spawns: doc.spawns ?? [],
    doors: doc.doors ?? [],
    collision: doc.collision ?? [],
    metadata: doc.metadata ?? { defaultFloor: 0 },
  };
  writeFileSync(join(mapsDir(), `${safe}.json`), JSON.stringify(next, null, 2));
  return next;
}

export function listMapKeysWithEdits(): string[] {
  return readdirSync(mapsDir())
    .filter((f) => f.endsWith(".json"))
    .map((f) => f.replace(/\.json$/, ""));
}

export function listImportedPacks(): WorldAssetPack[] {
  return readIndex().packs.filter((p) => p.source === "imported");
}

export function upsertPackMeta(pack: WorldAssetPack): void {
  const idx = readIndex();
  const i = idx.packs.findIndex((p) => p.id === pack.id);
  if (i >= 0) idx.packs[i] = pack;
  else idx.packs.push(pack);
  writeIndex(idx);
}

export function removePack(packId: string): boolean {
  const safe = packId.replace(/[^a-zA-Z0-9_-]/g, "");
  if (!safe || safe !== packId) return false;
  const idx = readIndex();
  const before = idx.packs.length;
  idx.packs = idx.packs.filter((p) => p.id !== packId);
  writeIndex(idx);
  const dir = join(packsDir(), safe);
  if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  return idx.packs.length < before || existsSync(dir) === false;
}

export function packRoot(packId: string): string {
  const safe = packId.replace(/[^a-zA-Z0-9_-]/g, "");
  const d = join(packsDir(), safe);
  mkdirSync(d, { recursive: true });
  return d;
}

export function loadPackManifest(packId: string): WorldAssetEntry[] {
  const file = join(packRoot(packId), "manifest.json");
  if (!existsSync(file)) return [];
  try {
    const raw = JSON.parse(readFileSync(file, "utf8")) as { assets?: WorldAssetEntry[] };
    return raw.assets ?? [];
  } catch {
    return [];
  }
}

export function savePackManifest(packId: string, assets: WorldAssetEntry[]): void {
  writeFileSync(
    join(packRoot(packId), "manifest.json"),
    JSON.stringify({ assets }, null, 2),
  );
}

export function resolvePackFile(packId: string, rel: string): string | null {
  const safePack = packId.replace(/[^a-zA-Z0-9_-]/g, "");
  if (!safePack || safePack !== packId) return null;
  const cleaned = rel.replace(/^(\.\.[/\\])+/, "").replace(/\\/g, "/");
  if (cleaned.includes("..")) return null;
  const full = join(packRoot(safePack), "files", cleaned);
  const root = resolve(join(packRoot(safePack), "files"));
  if (!resolve(full).startsWith(root)) return null;
  if (!existsSync(full) || !statSync(full).isFile()) return null;
  return full;
}
