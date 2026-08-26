// ─────────────────────────────────────────────────────────────────────────────
// Asset pack import — ZIP / folder scan → categorized Phaser-usable assets.
// ─────────────────────────────────────────────────────────────────────────────

import { mkdirSync, writeFileSync, readFileSync, readdirSync, statSync, cpSync, rmSync, existsSync } from "node:fs";
import { join, basename, extname, relative, dirname } from "node:path";
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { tmpdir } from "node:os";
import {
  type WorldAssetCategory,
  type WorldAssetEntry,
  type WorldAssetPack,
  type WorldObjectKind,
  type PackImportSummary,
} from "./types.js";
import { packRoot, savePackManifest, upsertPackMeta } from "./store.js";

const IMAGE_EXT = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif"]);
const META_EXT = new Set([".json", ".tmx", ".tmj", ".tsx", ".tsj", ".txt", ".md"]);
const SKIP_NAMES = new Set([".ds_store", "thumbs.db", "__macosx"]);

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "pack";
}

// Read a PNG's pixel dimensions straight from the IHDR chunk (bytes 16–24) — no
// image library needed, so the scan stays cheap. Returns null for non-PNG or a
// malformed header.
function pngSize(file: string): { w: number; h: number } | null {
  try {
    const fd = readFileSync(file);
    // 8-byte signature, then IHDR: length(4)+"IHDR"(4)+width(4)+height(4).
    if (fd.length < 24 || fd.readUInt32BE(0) !== 0x89504e47) return null;
    if (fd.toString("ascii", 12, 16) !== "IHDR") return null;
    return { w: fd.readUInt32BE(16), h: fd.readUInt32BE(20) };
  } catch { return null; }
}

// RPG Maker MV ships 48×48 tiles; Modern Exteriors' MV export names its sheets
// `Tileset_NN_MV.png`, `A2_Floors_MV_TILESET.png`, the A1–A5 autotile sheets and
// the B–E object sheets. Recognise a sheet as a paintable TILE GRID when its
// name looks like a tileset AND both dimensions divide evenly by a tile size we
// support (48 first — MV — then 32/16 for other packs). Returns the grid, or
// null for an ordinary standalone sprite/object PNG (which stays a single asset).
const TILESET_NAME = /(^|[/_\- ])(tileset|tile[_\- ]?sheet|room.?builder|a[1-5]|[b-e])([/_\- .]|$)|_mv|_tileset|tileset_\d+|floors?|terrain|exterior|inner|outer/i;
const TILE_SIZES = [48, 32, 16] as const;

// The authoritative tile size when the pack states it. Packs advertise their
// grid in the path — RPG Maker MV is 48px (`_MV`), and LimeZu / Modern Exteriors
// ship `..._16x16/...` and `..._32x32/...` trees. Reading it here keeps a 16px
// sheet from being wrongly sliced at 32 (which would merge 2×2 tiles into one).
function tileSizeHint(rel: string): number | null {
  const p = rel.toLowerCase();
  if (/_mv\b|rpg[_\- ]?maker|\bmv\b/.test(p)) return 48;
  const m = p.match(/(?:^|[/_\- ])(\d{2,3})\s*[x×]\s*\1(?:[/_\- .]|$)/); // 16x16, 32x32, 48x48
  if (m) { const n = Number(m[1]); if (n === 16 || n === 32 || n === 48) return n; }
  return null;
}

function detectTileGrid(rel: string, size: { w: number; h: number } | null):
  { tileWidth: number; tileHeight: number; columns: number; rows: number; count: number } | null {
  if (!size) return null;
  if (!TILESET_NAME.test(rel)) return null;
  // Trust an explicit size hint from the path first (`_MV` → 48, `16x16` → 16,
  // `32x32` → 32); otherwise fall back to the largest supported tile size the
  // sheet divides by cleanly.
  const hint = tileSizeHint(rel);
  const sizes = hint ? [hint] : TILE_SIZES;
  for (const ts of sizes) {
    if (size.w % ts === 0 && size.h % ts === 0 && size.w >= ts && size.h >= ts) {
      const columns = size.w / ts, rows = size.h / ts;
      // A "grid" needs more than one cell; a lone 48×48 is just a sprite.
      if (columns * rows <= 1) return null;
      return { tileWidth: ts, tileHeight: ts, columns, rows, count: columns * rows };
    }
  }
  return null;
}

export function categorizeFromPath(relPath: string): WorldAssetCategory {
  const p = relPath.toLowerCase().replace(/\\/g, "/");
  if (/floor|ground|tile|pavement|concrete|dirt|grass|sand/.test(p)) return "floors";
  if (/terrain|water|cliff|hill|rock/.test(p)) return "terrain";
  if (/road|street|path|sidewalk|asphalt/.test(p)) return "roads";
  if (/build|house|shop|tower|castle|office|room/.test(p)) return "buildings";
  if (/wall|fence|barrier/.test(p)) return "walls";
  if (/door/.test(p)) return "doors";
  if (/window/.test(p)) return "windows";
  if (/furn|chair|table|bed|desk|sofa|cabinet/.test(p)) return "furniture";
  if (/car|truck|bike|vehicle|bus|boat/.test(p)) return "vehicles";
  if (/tree|bush|plant|flower|veg|foliage|garden|nature|park/.test(p)) return "vegetation";
  if (/npc|char|people|person|guard|villager|hero/.test(p)) return "characters";
  if (/enemy|monster|boss|foe/.test(p)) return "enemies";
  if (/sign|poster|billboard/.test(p)) return "signs";
  if (/chest|interact|switch|lever|portal/.test(p)) return "interactive";
  if (/prop|crate|barrel|deco|decor/.test(p)) return "props";
  return "other";
}

function kindForCategory(cat: WorldAssetCategory): WorldObjectKind {
  switch (cat) {
    case "buildings": return "building";
    case "vegetation": return "vegetation";
    case "vehicles": return "vehicle";
    case "furniture": return "furniture";
    case "signs": return "sign";
    case "doors": return "door";
    case "interactive": return "interactive";
    case "characters": return "npc";
    case "enemies": return "enemy";
    case "spawns": return "spawn";
    case "zones": return "zone";
    case "collision": return "collision";
    default: return "prop";
  }
}

function prettyName(file: string): string {
  return basename(file, extname(file))
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function walkFiles(root: string, base = root): string[] {
  const out: string[] = [];
  for (const name of readdirSync(root)) {
    if (SKIP_NAMES.has(name.toLowerCase())) continue;
    const full = join(root, name);
    const st = statSync(full);
    if (st.isDirectory()) out.push(...walkFiles(full, base));
    else out.push(relative(base, full).replace(/\\/g, "/"));
  }
  return out;
}

function readOptionalMeta(dir: string): { name?: string; description?: string; categories?: Record<string, string> } {
  for (const candidate of ["pack.json", "manifest.json", "tileset.json", "meta.json"]) {
    const p = join(dir, candidate);
    if (!existsSync(p)) continue;
    try {
      return JSON.parse(readFileSync(p, "utf8")) as {
        name?: string; description?: string; categories?: Record<string, string>;
      };
    } catch { /* ignore */ }
  }
  return {};
}

function extractZip(zipPath: string, dest: string): void {
  mkdirSync(dest, { recursive: true });
  execFileSync("unzip", ["-q", "-o", zipPath, "-d", dest], { stdio: "pipe" });
}

function scanDirectory(
  packId: string,
  scanRoot: string,
  displayName: string,
): { assets: WorldAssetEntry[]; summary: PackImportSummary; roots: string[] } {
  const meta = readOptionalMeta(scanRoot);
  const files = walkFiles(scanRoot);
  const assets: WorldAssetEntry[] = [];
  const unsupported: string[] = [];
  const warnings: string[] = [];
  const catSet = new Set<WorldAssetCategory>();
  const roots = new Set<string>();
  let skipped = 0;

  for (const rel of files) {
    const ext = extname(rel).toLowerCase();
    const top = rel.split("/")[0] ?? "";
    if (top) roots.add(top);

    if (META_EXT.has(ext)) {
      skipped++;
      continue;
    }
    if (!IMAGE_EXT.has(ext)) {
      unsupported.push(rel);
      skipped++;
      continue;
    }

    // Skip tiny UI chrome / 1×1 placeholders by name heuristics only (no sharp required).
    if (/icon_?set|cursor|ui[_-]?atlas/i.test(rel) && /limezu.*user.?interface/i.test(rel)) {
      // still import — LimeZu UI can be useful; keep
    }

    const category = categorizeFromPath(rel);
    catSet.add(category);
    const id = `${packId}/${rel}`.replace(/[^a-zA-Z0-9/_.-]/g, "_");
    const entry: WorldAssetEntry = {
      id,
      name: prettyName(rel),
      category,
      url: `/activity/assets/world-packs/${packId}/files/${rel}`,
      packId,
      kind: kindForCategory(category),
      rotatable: category === "vehicles" || category === "furniture" || category === "props",
      tags: rel.toLowerCase().split(/[/_ -]+/).filter(Boolean).slice(0, 12),
      thumb: `/activity/assets/world-packs/${packId}/files/${rel}`,
    };

    // Tile GRID detection: a sheet whose name looks like a tileset and whose real
    // pixel size divides into a whole grid becomes a paintable multi-tile sheet
    // (48×48 for RPG Maker MV) — the palette slices it so every cell is a
    // placeable tile. A standalone sprite/object PNG has no grid and stays a
    // single object asset, exactly as before.
    const grid = detectTileGrid(rel, pngSize(join(scanRoot, rel)));
    if (grid) {
      entry.tile = {
        tileset: basename(rel, ext),
        localId: 0,
        tileWidth: grid.tileWidth,
        tileHeight: grid.tileHeight,
        columns: grid.columns,
        rows: grid.rows,
        count: grid.count,
        sheet: grid.count > 1,
      };
      entry.kind = "prop";
      entry.rotatable = false;
      if (category === "other") entry.category = "floors";
      entry.tags = [...(entry.tags ?? []), "tileset", `${grid.tileWidth}px`, `${grid.count}-tiles`].slice(0, 14);
    }

    assets.push(entry);
  }

  if (assets.length === 0) warnings.push("No supported image assets found in the package.");
  if (meta.name) displayName = meta.name;

  const summary: PackImportSummary = {
    packId,
    name: displayName,
    imported: assets.length,
    skipped,
    unsupported: unsupported.slice(0, 40),
    categories: [...catSet].sort(),
    warnings,
  };
  return { assets, summary, roots: [...roots] };
}

export function importZipBuffer(
  buf: Buffer,
  opts: { name?: string } = {},
): PackImportSummary {
  const tmp = join(tmpdir(), `wb-import-${randomBytes(6).toString("hex")}`);
  const zipFile = join(tmp, "pack.zip");
  const extracted = join(tmp, "out");
  mkdirSync(tmp, { recursive: true });
  try {
    writeFileSync(zipFile, buf);
    extractZip(zipFile, extracted);

    // If the zip has a single top-level folder, scan inside it.
    const top = readdirSync(extracted).filter((n) => !SKIP_NAMES.has(n.toLowerCase()));
    let scanRoot = extracted;
    if (top.length === 1) {
      const only = join(extracted, top[0]!);
      if (statSync(only).isDirectory()) scanRoot = only;
    }

    const baseName = opts.name?.trim() || basename(scanRoot) || "Imported Pack";
    const packId = `${slugify(baseName)}-${randomBytes(3).toString("hex")}`;
    const dest = packRoot(packId);
    const filesDest = join(dest, "files");
    if (existsSync(filesDest)) rmSync(filesDest, { recursive: true, force: true });
    mkdirSync(filesDest, { recursive: true });
    cpSync(scanRoot, filesDest, { recursive: true });

    const { assets, summary, roots } = scanDirectory(packId, filesDest, baseName);
    savePackManifest(packId, assets);

    const pack: WorldAssetPack = {
      id: packId,
      name: summary.name,
      source: "imported",
      importedAt: new Date().toISOString(),
      assetCount: assets.length,
      categories: summary.categories,
      roots,
      description: `Imported package (${assets.length} assets)`,
    };
    upsertPackMeta(pack);
    return summary;
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

/** Import a pre-extracted folder (dev / folder-picker upload of many files). */
export function importFolderFiles(
  files: { relativePath: string; data: Buffer }[],
  opts: { name?: string } = {},
): PackImportSummary {
  const baseName = opts.name?.trim() || "Folder Import";
  const packId = `${slugify(baseName)}-${randomBytes(3).toString("hex")}`;
  const dest = packRoot(packId);
  const filesDest = join(dest, "files");
  mkdirSync(filesDest, { recursive: true });

  for (const f of files) {
    const rel = f.relativePath.replace(/^(\.\.[/\\])+/, "").replace(/\\/g, "/");
    if (!rel || rel.includes("..")) continue;
    const full = join(filesDest, rel);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, f.data);
  }

  const { assets, summary, roots } = scanDirectory(packId, filesDest, baseName);
  savePackManifest(packId, assets);
  upsertPackMeta({
    id: packId,
    name: summary.name,
    source: "imported",
    importedAt: new Date().toISOString(),
    assetCount: assets.length,
    categories: summary.categories,
    roots,
    description: `Folder import (${assets.length} assets)`,
  });
  return summary;
}
