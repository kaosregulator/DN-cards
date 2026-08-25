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
  if (/tree|bush|plant|flower|veg|foliage|garden/.test(p)) return "vegetation";
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

    // Heuristic: large sheets named tileset / floor / terrain → tile paint candidate.
    if (/tileset|tile_sheet|room.?builder|floor|terrain|exterior/i.test(rel)) {
      entry.tile = {
        tileset: basename(rel, ext),
        localId: 0,
        tileWidth: 32,
        tileHeight: 32,
        columns: 16,
      };
      entry.kind = "prop";
      if (category === "other") entry.category = "floors";
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
