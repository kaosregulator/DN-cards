// ─────────────────────────────────────────────────────────────────────────────
// Built-in World Builder catalog — LimeZu tilesets already in public/world plus
// city props/buildings/NPCs. No code changes required to browse these in-editor.
// ─────────────────────────────────────────────────────────────────────────────

import { existsSync, readdirSync } from "node:fs";
import { join, basename, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import type { WorldAssetCategory, WorldAssetEntry, WorldAssetPack, WorldObjectKind } from "./types.js";
import { categorizeFromPath } from "./packs.js";

const HERE = dirname(fileURLToPath(import.meta.url));

function activityPublicWorld(): string | null {
  const env = process.env["ACTIVITY_PUBLIC_WORLD"]?.trim();
  const candidates = [
    env,
    // Dev / source layout: api-server/src/bot/world-builder → artifacts/activity/public/world
    resolve(HERE, "../../../../activity/public/world"),
    // Bundled dist/index.mjs lives in artifacts/api-server/dist
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

function limeZuCategory(name: string): WorldAssetCategory {
  const n = name.toLowerCase();
  if (/room.?builder|floor|generic/.test(n)) return "floors";
  if (/kitchen|bedroom|living|bathroom|office|classroom|conference|basement|jail|hospital|museum|japanese|grocery|music/.test(n)) {
    return "furniture";
  }
  if (/user.?interface/.test(n)) return "other";
  if (/tree|flower|terrain|water|lpc/.test(n)) return "terrain";
  if (/exterior|wa_/.test(n)) return "buildings";
  return "props";
}

function listPngs(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => /\.(png|webp|jpg|jpeg|gif)$/i.test(f));
}

export function builtinPackMeta(): WorldAssetPack {
  const assets = builtinAssets();
  const cats = [...new Set(assets.map((a) => a.category))];
  return {
    id: "builtin",
    name: "DN World (Built-in)",
    source: "builtin",
    description: "LimeZu tilesets, WorkAdventure sheets, and city props already shipped with the Activity.",
    assetCount: assets.length,
    categories: cats,
    roots: ["tilesets", "city", "characters"],
  };
}

export function builtinAssets(): WorldAssetEntry[] {
  const root = activityPublicWorld();
  if (!root) return fallbackBuiltin();

  const out: WorldAssetEntry[] = [];

  // City object sprites (placeable).
  const cityGroups: { dir: string; category: WorldAssetCategory; kind: WorldObjectKind }[] = [
    { dir: "city/buildings", category: "buildings", kind: "building" },
    { dir: "city/props", category: "props", kind: "prop" },
    { dir: "city/ground", category: "floors", kind: "prop" },
    { dir: "city/npc", category: "characters", kind: "npc" },
  ];
  for (const g of cityGroups) {
    for (const file of listPngs(join(root, g.dir))) {
      const id = `builtin/city/${basename(file, extname(file))}`;
      const url = `world/${g.dir}/${file}`;
      out.push({
        id,
        name: basename(file, extname(file)).replace(/_/g, " "),
        category: g.category === "props" && /door/.test(file) ? "doors" : g.category,
        url,
        packId: "builtin",
        kind: /door/.test(file) ? "door" : g.kind,
        rotatable: g.kind === "prop" || g.kind === "building",
        thumb: url,
        tags: [g.category, "city"],
      });
    }
  }

  // Character sheets.
  for (const file of listPngs(join(root, "characters"))) {
    const id = `builtin/characters/${basename(file, extname(file))}`;
    const url = `world/characters/${file}`;
    out.push({
      id, name: basename(file, extname(file)), category: "characters", url,
      packId: "builtin", kind: "npc", thumb: url, tags: ["characters"],
    });
  }
  const npcDir = join(root, "characters/npc");
  for (const file of listPngs(npcDir)) {
    const id = `builtin/characters/npc/${basename(file, extname(file))}`;
    const url = `world/characters/npc/${file}`;
    out.push({
      id, name: basename(file, extname(file)), category: "characters", url,
      packId: "builtin", kind: "npc", thumb: url, tags: ["npc"],
    });
  }

  // LimeZu + WA tilesets under tilesets/world (tile paint + object preview).
  const tsDir = join(root, "tilesets/world");
  for (const file of listPngs(tsDir)) {
    const base = basename(file, extname(file));
    const cat = /LimeZu/i.test(base) ? limeZuCategory(base) : categorizeFromPath(base);
    const id = `builtin/tileset/${base}`;
    const url = `world/tilesets/world/${file}`;
    out.push({
      id,
      name: base.replace(/_/g, " "),
      category: cat,
      url,
      packId: "builtin",
      kind: kindForCategory(cat),
      tile: {
        tileset: base,
        localId: 0,
        tileWidth: 32,
        tileHeight: 32,
        columns: 16,
      },
      thumb: url,
      tags: ["tileset", "limezu"].filter((t, i, a) => a.indexOf(t) === i || /LimeZu/i.test(base)),
      rotatable: false,
    });
  }

  // Tool entries (not images) — editor synthesizes these client-side too.
  out.push(
    {
      id: "builtin/tool/collision",
      name: "Collision Block",
      category: "collision",
      url: "",
      packId: "builtin",
      kind: "collision",
      tags: ["collision"],
    },
    {
      id: "builtin/tool/spawn-player",
      name: "Player Spawn",
      category: "spawns",
      url: "",
      packId: "builtin",
      kind: "spawn",
      tags: ["spawn", "player"],
    },
    {
      id: "builtin/tool/zone-interaction",
      name: "Interaction Zone",
      category: "zones",
      url: "",
      packId: "builtin",
      kind: "zone",
      tags: ["zone"],
    },
  );

  return out;
}

function fallbackBuiltin(): WorldAssetEntry[] {
  return [
    {
      id: "builtin/tool/collision",
      name: "Collision Block",
      category: "collision",
      url: "",
      packId: "builtin",
      kind: "collision",
    },
  ];
}
