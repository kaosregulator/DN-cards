// ─────────────────────────────────────────────────────────────────────────────
// Rebuild artifacts/api-server/assets/hq/manifest.json from whatever art is on
// disk.
//
//   pnpm --filter @workspace/scripts run hq:manifest [-- --dir <path>] [--dry]
//
// Drop 2D-iso PNGs into the pack under a folder named after the seam you want
// them to fill, run this, and the renderer picks them up:
//
//   assets/hq/buildings/castle.png     → building/castle   (world map + sieges)
//   assets/hq/surface/pond.png         → surface/pond      (build materials)
//   assets/hq/wallpaper/rose-floral.png→ wallpaper/rose-floral
//   assets/hq/floor/marble/tile.png    → floor/marble/tile
//   assets/hq/deco/yard-tree.png       → deco/yard-tree    (decorations)
//
// The renderer can already find these by convention without a manifest, so this
// script is for the cases the convention can't express: aliases, non-PNG names,
// and one file serving several keys. It preserves any `_credits` block and any
// entry that points at a file which still exists.
// ─────────────────────────────────────────────────────────────────────────────

import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative, resolve, sep, extname, basename, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// Resolved from this file, not the cwd, so the script works whichever directory
// pnpm runs it from.
const DEFAULT_ASSET_DIR = fileURLToPath(new URL("../../artifacts/api-server/assets/hq/", import.meta.url));

interface Manifest {
  _credits?: unknown;
  sprites?: Record<string, string>;
  [k: string]: unknown;
}

const ART_EXT = new Set([".png", ".webp", ".jpg", ".jpeg"]);

// Folder names in the pack that are really seam prefixes under a different
// spelling. Everything else uses its folder path verbatim.
const FOLDER_ALIASES: Record<string, string> = {
  buildings: "building",
  bases: "base",
  backdrops: "backdrop",
  figures: "deco",
  furniture: "deco",
  medals: "deco",
  nature: "deco",
};

function parseArgs(argv: string[]): { dir: string; dry: boolean } {
  let dir = resolve(DEFAULT_ASSET_DIR);
  let dry = false;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--dir" && argv[i + 1]) { dir = resolve(argv[++i]!); continue; }
    if (argv[i] === "--dry") { dry = true; continue; }
  }
  return { dir, dry };
}

function walk(root: string, current = root, out: string[] = []): string[] {
  for (const entry of readdirSync(current)) {
    const path = join(current, entry);
    if (statSync(path).isDirectory()) { walk(root, path, out); continue; }
    if (ART_EXT.has(extname(entry).toLowerCase())) out.push(path);
  }
  return out;
}

// "buildings/castle.png" → "building/castle"; "floor/marble/tile.png" →
// "floor/marble/tile"; a file at the root keeps its bare stem.
function keyFor(root: string, file: string): string {
  const rel = relative(root, file);
  const parts = rel.split(sep);
  const stem = basename(parts.pop()!, extname(rel));
  const folders = parts.map((p, i) => (i === 0 ? FOLDER_ALIASES[p] ?? p : p));
  return [...folders, stem].join("/");
}

function main(): void {
  const { dir, dry } = parseArgs(process.argv.slice(2));
  if (!existsSync(dir)) {
    console.error(`No asset directory at ${dir}`);
    process.exitCode = 1;
    return;
  }

  const manifestPath = join(dir, "manifest.json");
  let existing: Manifest = {};
  if (existsSync(manifestPath)) {
    try {
      existing = JSON.parse(readFileSync(manifestPath, "utf8")) as Manifest;
    } catch (err) {
      console.error(`Could not parse the existing manifest (${String(err)}); writing a fresh one.`);
    }
  }

  const files = walk(dir).filter(f => dirname(f) !== dir || extname(f).toLowerCase() !== ".json");
  const sprites: Record<string, string> = {};
  const collisions: string[] = [];
  for (const file of files.sort()) {
    const key = keyFor(dir, file);
    const rel = relative(dir, file).split(sep).join("/");
    if (sprites[key] && sprites[key] !== rel) collisions.push(`${key}: ${sprites[key]} vs ${rel}`);
    sprites[key] = rel;
  }

  // Keep hand-written aliases whose target still exists — those are the entries
  // the convention scan can't reproduce.
  let kept = 0;
  for (const [key, rel] of Object.entries(existing.sprites ?? {})) {
    if (sprites[key]) continue;
    if (!existsSync(join(dir, rel))) continue;
    sprites[key] = rel;
    kept++;
  }

  const out: Manifest = { ...existing, sprites: Object.fromEntries(Object.entries(sprites).sort()) };
  const json = `${JSON.stringify(out, null, 2)}\n`;

  console.log(`Scanned ${files.length} art file(s) in ${dir}`);
  console.log(`  ${Object.keys(sprites).length} sprite keys (${kept} hand-written alias(es) preserved)`);
  for (const c of collisions) console.warn(`  ! collision — ${c}`);
  if (dry) {
    console.log("--dry: not writing. Manifest would be:");
    console.log(json);
    return;
  }
  writeFileSync(manifestPath, json);
  console.log(`Wrote ${manifestPath}`);
}

main();
