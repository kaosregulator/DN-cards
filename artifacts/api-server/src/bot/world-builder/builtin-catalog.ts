// ─────────────────────────────────────────────────────────────────────────────
// Built-in World Builder catalog — grouped by the REAL DN world sources so the
// F9 palette shows where each asset comes from instead of one flat legacy dump.
//
// Sources:
//   📍 Main World  — tilesets/world/* (used by world.tmj) + player/NPC characters
//   🏘️ The Village — tilesets/village/* (used by village.tmj)
//   🗺️ Other Worlds — Card Shop / Duel Hall / Cave tilesets
//   🌾 Jack's World — Harvest Moon characters + item props (placeable objects)
//
// The old generic `city/*` fantasy set (knights, vampires, generic buildings,
// barrels…) is referenced by NO shipped map and NO code, so it is intentionally
// NOT scanned here anymore. The files stay on disk; they just no longer clutter
// the palette. Tile sheets are sliced into a tile grid (like imported packs) so
// they paint per-tile rather than rendering as one giant sheet.
// ─────────────────────────────────────────────────────────────────────────────

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, basename, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import type { WorldAssetCategory, WorldAssetEntry, WorldAssetPack, WorldObjectKind } from "./types.js";
import { categorizeFromPath } from "./packs.js";

const HERE = dirname(fileURLToPath(import.meta.url));

/** Built-in tile sheets are the LimeZu / WorkAdventure 32×32 standard. */
const BUILTIN_TILE = 32;

function activityPublicWorld(): string | null {
  const env = process.env["ACTIVITY_PUBLIC_WORLD"]?.trim();
  const candidates = [
    env,
    resolve(HERE, "../../../../activity/public/world"),
    resolve(HERE, "../activity/public/world"),
    resolve(process.cwd(), "artifacts/activity/public/world"),
    resolve(process.cwd(), "../activity/public/world"),
    resolve(process.cwd(), "public/world"),
  ].filter(Boolean) as string[];
  for (const cand of candidates) {
    if (existsSync(cand)) return cand;
  }
  return null;
}

function kindForCategory(cat: WorldAssetCategory): WorldObjectKind {
  if (cat === "characters") return "npc";
  if (cat === "enemies") return "enemy";
  if (cat === "buildings") return "building";
  if (cat === "vegetation") return "vegetation";
  if (cat === "vehicles") return "vehicle";
  if (cat === "furniture") return "furniture";
  if (cat === "signs") return "sign";
  if (cat === "doors") return "door";
  if (cat === "interactive") return "interactive";
  if (cat === "spawns") return "spawn";
  if (cat === "zones") return "zone";
  if (cat === "collision") return "collision";
  return "prop";
}

/** Categorize a built-in tile sheet by its (LimeZu / WA) name. */
function tilesetCategory(name: string): WorldAssetCategory {
  const n = name.toLowerCase();
  if (/room.?builder|floor|generic|ground/.test(n)) return "floors";
  if (/tree|flower|terrain|water|lpc|nature|park/.test(n)) return "terrain";
  if (/exterior|building|office|wa_/.test(n)) return "buildings";
  if (/user.?interface|logo|zone|animation/.test(n)) return "other";
  if (/kitchen|bedroom|living|bathroom|classroom|conference|basement|jail|hospital|museum|japanese|grocery|music|stage|chair|couch|table|decor|rug|bookshelf|furniture|auditorium|gym/.test(n)) {
    return "furniture";
  }
  return "props";
}

function listPngs(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => /\.(png|webp|jpg|jpeg|gif)$/i.test(f));
}

/** Read a PNG's pixel dimensions from its IHDR without decoding it. */
function pngSize(file: string): { w: number; h: number } | null {
  try {
    const b = readFileSync(file);
    if (b.length < 24 || b.readUInt32BE(0) !== 0x89504e47) return null;
    return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
  } catch {
    return null;
  }
}

// ── source definitions ───────────────────────────────────────────────────────
interface ObjectGroup { dir: string; category: WorldAssetCategory; kind: WorldObjectKind }
interface SourceDef {
  id: string;
  name: string;
  description: string;
  tileDirs: string[];    // folders of tile sheets → sliced, paintable tile grids
  charDirs: string[];    // folders of character sheets → placeable NPC objects
  objectGroups: ObjectGroup[]; // folders of object sprites
  tools?: boolean;       // append the collision/spawn/zone tool entries
}

const SOURCES: SourceDef[] = [
  {
    id: "world",
    name: "📍 Main World",
    description: "DN City spawn — world tilesets and player/NPC characters.",
    tileDirs: ["tilesets/world"],
    charDirs: ["characters", "characters/npc"],
    objectGroups: [],
    tools: true,
  },
  {
    id: "village",
    name: "🏘️ The Village",
    description: "The Village / Office World tilesets.",
    tileDirs: ["tilesets/village"],
    charDirs: [],
    objectGroups: [],
  },
  {
    id: "other-worlds",
    name: "🗺️ Other Worlds",
    description: "Card Shop · Duel Hall · Cave tilesets.",
    tileDirs: ["tilesets/card-shop", "tilesets/duel-hall", "tilesets/cave"],
    charDirs: [],
    objectGroups: [],
  },
  {
    id: "jacks-world",
    name: "🌾 Jack's World",
    description: "Harvest Moon characters and item props.",
    tileDirs: [],
    charDirs: ["hm/chars", "hm/chars/npc"],
    objectGroups: [{ dir: "hm/items", category: "vegetation", kind: "vegetation" }],
  },
];

function assetsForSource(root: string, src: SourceDef): WorldAssetEntry[] {
  const out: WorldAssetEntry[] = [];

  // Tile sheets → sliced tile grids (paint per-tile, not one giant sheet).
  for (const dir of src.tileDirs) {
    for (const file of listPngs(join(root, dir))) {
      const base = basename(file, extname(file));
      const url = `world/${dir}/${file}`;
      const size = pngSize(join(root, dir, file));
      const cat = tilesetCategory(base);
      const columns = size ? Math.max(1, Math.floor(size.w / BUILTIN_TILE)) : 16;
      const rows = size ? Math.max(1, Math.floor(size.h / BUILTIN_TILE)) : 1;
      const count = columns * rows;
      out.push({
        id: `builtin/${src.id}/${base}`,
        name: base.replace(/_/g, " "),
        category: cat,
        url,
        packId: src.id,
        kind: kindForCategory(cat),
        tile: {
          tileset: base,
          localId: 0,
          tileWidth: BUILTIN_TILE,
          tileHeight: BUILTIN_TILE,
          columns,
          rows,
          count,
          sheet: count > 1,
        },
        thumb: url,
        tags: ["tileset", src.id],
        rotatable: false,
      });
    }
  }

  // Character sheets → placeable NPC objects.
  for (const dir of src.charDirs) {
    for (const file of listPngs(join(root, dir))) {
      const base = basename(file, extname(file));
      const url = `world/${dir}/${file}`;
      out.push({
        id: `builtin/${src.id}/char/${base}`,
        name: base.replace(/[_-]/g, " "),
        category: "characters",
        url,
        packId: src.id,
        kind: "npc",
        thumb: url,
        tags: ["character", src.id],
      });
    }
  }

  // Object sprites (HM items, etc.).
  for (const g of src.objectGroups) {
    for (const file of listPngs(join(root, g.dir))) {
      const base = basename(file, extname(file));
      const url = `world/${g.dir}/${file}`;
      out.push({
        id: `builtin/${src.id}/obj/${base}`,
        name: base.replace(/[_-]/g, " "),
        category: g.category,
        url,
        packId: src.id,
        kind: g.kind,
        rotatable: g.kind === "prop",
        thumb: url,
        tags: [g.category, src.id],
      });
    }
  }

  // Editor tool stamps (collision / spawn / zone) — kept on the Main World source.
  if (src.tools) {
    out.push(
      { id: "builtin/tool/collision", name: "Collision Block", category: "collision", url: "", packId: src.id, kind: "collision", tags: ["collision"] },
      { id: "builtin/tool/spawn-player", name: "Player Spawn", category: "spawns", url: "", packId: src.id, kind: "spawn", tags: ["spawn", "player"] },
      { id: "builtin/tool/zone-interaction", name: "Interaction Zone", category: "zones", url: "", packId: src.id, kind: "zone", tags: ["zone"] },
    );
  }

  return out;
}

/** All built-in assets across every DN world source. */
export function builtinAssets(): WorldAssetEntry[] {
  const root = activityPublicWorld();
  if (!root) return fallbackBuiltin();
  return SOURCES.flatMap((src) => assetsForSource(root, src));
}

/** One pack entry per DN world source (Main World, Village, Other Worlds, Jack's). */
export function builtinPacks(): WorldAssetPack[] {
  const root = activityPublicWorld();
  if (!root) {
    return [{ id: "world", name: "📍 Main World", source: "builtin", description: "Built-in world assets.", assetCount: 1, categories: ["collision"], roots: [] }];
  }
  const packs: WorldAssetPack[] = [];
  for (const src of SOURCES) {
    const assets = assetsForSource(root, src);
    if (!assets.length) continue;
    packs.push({
      id: src.id,
      name: src.name,
      source: "builtin",
      description: src.description,
      assetCount: assets.length,
      categories: [...new Set(assets.map((a) => a.category))],
      roots: [...src.tileDirs, ...src.charDirs, ...src.objectGroups.map((g) => g.dir)],
    });
  }
  return packs;
}

/**
 * Back-compat aggregate: a single "built-in" pack summary spanning every source.
 * Prefer builtinPacks() for the grouped palette.
 */
export function builtinPackMeta(): WorldAssetPack {
  const assets = builtinAssets();
  return {
    id: "builtin",
    name: "DN World (Built-in)",
    source: "builtin",
    description: "Main World, The Village, Other Worlds, and Jack's World assets.",
    assetCount: assets.length,
    categories: [...new Set(assets.map((a) => a.category))],
    roots: SOURCES.map((s) => s.id),
  };
}

function fallbackBuiltin(): WorldAssetEntry[] {
  return [
    { id: "builtin/tool/collision", name: "Collision Block", category: "collision", url: "", packId: "world", kind: "collision" },
  ];
}

// categorizeFromPath is retained for imported-pack parity; referenced to satisfy lint.
void categorizeFromPath;
