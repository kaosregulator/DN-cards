#!/usr/bin/env tsx
/**
 * Harvest MakeEmoji CDN frame PNGs for offline styles that currently ship
 * wrong atlas sprite-sheets (which tile when drawn whole).
 *
 * Usage (from repo root):
 *   pnpm --filter @workspace/scripts exec tsx ./src/makeemoji-harvest-frames.ts
 */
import {
  existsSync, mkdirSync, writeFileSync, readdirSync, readFileSync, rmSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "../..");
const OUT = join(REPO, "artifacts/emoji-offline");
const FRAMES = join(OUT, "assets", "frames");
const ATLASES = join(OUT, "assets", "atlases");
const RECIPES = join(OUT, "recipes", "recipes.json");
const ASSET_MANIFEST = join(OUT, "assets", "asset-manifest.json");

const CDN = "https://assets.makeemoji.com";

interface Recipe {
  id: string;
  slug: string;
  tag: string;
  family: string;
  primitive: string | null;
  params: Record<string, unknown>;
  offlineReady: boolean;
  fidelity: string | null;
  notes: string[];
  assets?: Record<string, string>;
  preview?: unknown;
  directionSuffix?: string | null;
  verified?: boolean;
  verifyScore?: number;
}

async function headOk(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, { method: "HEAD" });
    return res.ok;
  } catch {
    return false;
  }
}

async function downloadFrame(style: string, n: number): Promise<Buffer | null> {
  const name = `frame_${String(n).padStart(4, "0")}.png`;
  const url = `${CDN}/frames/${style}/${name}`;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    // MakeEmoji 404 body is a non-trivial HTML/png placeholder (~27KB) — reject tiny/huge weirdness
    if (buf.length < 100) return null;
    return buf;
  } catch {
    return null;
  }
}

async function harvestStyle(style: string): Promise<string[]> {
  const dir = join(FRAMES, style);
  mkdirSync(dir, { recursive: true });
  const saved: string[] = [];
  // Probe first frame
  const first = await downloadFrame(style, 1);
  if (!first) return [];
  const name1 = "frame_0001.png";
  writeFileSync(join(dir, name1), first);
  saved.push(name1);

  for (let n = 2; n <= 48; n++) {
    const buf = await downloadFrame(style, n);
    if (!buf) break;
    const name = `frame_${String(n).padStart(4, "0")}.png`;
    writeFileSync(join(dir, name), buf);
    saved.push(name);
  }
  return saved;
}

function sha256(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex");
}

async function main() {
  mkdirSync(FRAMES, { recursive: true });
  const recipes = JSON.parse(readFileSync(RECIPES, "utf8")) as Recipe[];
  const atlasDirs = existsSync(ATLASES) ? readdirSync(ATLASES) : [];

  // Styles to harvest: every atlas slug + known frame styles + pokeball*
  const candidates = new Set<string>();
  for (const r of recipes) {
    if (r.family === "atlas" || r.family === "frames" || r.slug.includes("pokeball")) {
      candidates.add(r.slug);
    }
  }
  for (const d of atlasDirs) candidates.add(d);

  const harvested: Record<string, string[]> = {};
  let ok = 0, miss = 0;

  for (const style of [...candidates].sort()) {
    const has = await headOk(`${CDN}/frames/${style}/frame_0001.png`);
    if (!has) {
      miss++;
      continue;
    }
    process.stdout.write(`harvest ${style}… `);
    const files = await harvestStyle(style);
    console.log(`${files.length} frames`);
    if (files.length > 0) {
      harvested[style] = files.map(f => `frames/${style}/${f}`);
      ok++;

      // Prefer CDN frames over wrong atlas sprite-sheets for this style.
      const atlasPath = join(ATLASES, style);
      if (existsSync(atlasPath)) {
        // Keep atlas as backup under .deprecated-atlas but remove from active path
        // by renaming so resolveAtlasDir won't find it when frames exist.
        // Actually: renderer prefers frames when family=frames. Just update recipe.
      }
    }
  }

  // Update recipes: styles with harvested frames → family frames
  let updated = 0;
  for (const r of recipes) {
    const files = harvested[r.slug];
    if (!files?.length) continue;
    r.family = "frames";
    r.primitive = "frames";
    r.assets = { framesHint: r.slug };
    r.offlineReady = true;
    r.fidelity = "makeemoji-frames";
    r.notes = [
      `CDN frames harvested from ${CDN}/frames/${r.slug}/ (${files.length} frames)`,
      "Replaces incorrect atlas sprite-sheet that tiled when drawn whole",
    ];
    updated++;
  }

  writeFileSync(RECIPES, JSON.stringify(recipes, null, 2) + "\n");

  // Refresh asset-manifest frames section
  let manifest: Record<string, unknown> = {};
  if (existsSync(ASSET_MANIFEST)) {
    try { manifest = JSON.parse(readFileSync(ASSET_MANIFEST, "utf8")); } catch { /* */ }
  }
  const frameMap: Record<string, string[]> = {};
  for (const [style, files] of Object.entries(harvested)) {
    frameMap[style] = files;
  }
  // Keep existing overlay/atlas entries that weren't replaced
  const prev = (manifest as { frames?: Record<string, string[]>; atlases?: Record<string, string[]> });
  manifest = {
    ...manifest,
    frames: { ...(prev.frames ?? {}), ...frameMap },
    atlases: prev.atlases ?? {},
    harvestedAt: new Date().toISOString(),
  };
  writeFileSync(ASSET_MANIFEST, JSON.stringify(manifest, null, 2) + "\n");

  console.log(`\nHarvested ${ok} styles, ${miss} without CDN frames, updated ${updated} recipes.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
