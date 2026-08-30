// Generate offline-vs-MakeEmoji fidelity contact sheets.
// Re-renders the offline side with the default-cat subject so pairs are comparable.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";
import { reloadOfflineRegistry } from "../src/bot/emoji/providers/offline/registry.js";
import { reloadRecipes } from "../src/bot/emoji/providers/offline/recipes.js";
import { renderOffline } from "../src/bot/emoji/providers/offline/renderer.js";

const recipesPath = join(process.cwd(), "../emoji-offline/recipes/recipes.json");
const outDir = process.env.OFFLINE_VERIFY_OUT || "/opt/cursor/artifacts/offline-fidelity";
mkdirSync(join(outDir, "sheets"), { recursive: true });
mkdirSync(join(outDir, "offline-cat"), { recursive: true });

reloadOfflineRegistry();
reloadRecipes();

interface Recipe {
  id: string;
  slug: string;
  family: string;
  offlineReady: boolean;
  verifyScore?: number;
}

const recipes = JSON.parse(readFileSync(recipesPath, "utf8")) as Recipe[];

function previewPath(slug: string): string | null {
  for (const ext of ["gif", "webp", "png"]) {
    for (const base of ["/tmp/me-previews-pending", "/tmp/me-assets/previews"]) {
      const p = join(base, `${slug}.${ext}`);
      if (existsSync(p)) return p;
    }
  }
  return null;
}

async function loadCat(): Promise<Buffer> {
  const catPath = "/tmp/me-probe/cat.png";
  if (existsSync(catPath)) {
    return sharp(catPath)
      .resize(128, 128, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png()
      .toBuffer();
  }
  return sharp({
    create: { width: 128, height: 128, channels: 4, background: { r: 47, g: 127, b: 228, alpha: 1 } },
  }).png().toBuffer();
}

async function firstFrameTile(src: string | Buffer): Promise<Buffer> {
  // pages:1 extracts a single frame; page:0 alone still returns the full strip.
  const buf = await sharp(src, { pages: 1 })
    .resize(72, 72, { fit: "contain", background: { r: 30, g: 30, b: 40, alpha: 1 } })
    .flatten({ background: { r: 30, g: 30, b: 40 } })
    .removeAlpha()
    .png()
    .toBuffer();
  return sharp(buf).resize(72, 72, { fit: "fill" }).png().toBuffer();
}

async function ensureOfflineCat(slug: string, id: string, cat: Buffer): Promise<string | null> {
  const dest = join(outDir, "offline-cat", `${slug}.gif`);
  if (existsSync(dest)) return dest;
  try {
    const result = await renderOffline({
      image: cat,
      animation: id,
      format: "gif",
      size: "64",
      speed: "normal",
    });
    writeFileSync(dest, result.buffer);
    return dest;
  } catch (e) {
    console.error(`render ${slug}:`, (e as Error).message);
    return null;
  }
}

async function sheet(name: string, ids: string[], cat: Buffer) {
  const tiles: Buffer[] = [];
  const legend: string[] = [];
  for (const id of ids) {
    const r = recipes.find(x => x.id === id || x.slug === id);
    if (!r) continue;
    const prev = previewPath(r.slug);
    if (!prev) continue;
    const off = await ensureOfflineCat(r.slug, r.id, cat);
    if (!off) continue;

    let left: Buffer;
    let right: Buffer;
    try {
      left = await firstFrameTile(off);
      right = await firstFrameTile(prev);
    } catch (e) {
      console.error(`tile ${r.slug}:`, (e as Error).message);
      continue;
    }

    const header = await sharp({
      create: { width: 152, height: 14, channels: 3, background: { r: 20, g: 20, b: 28 } },
    }).png().toBuffer();

    try {
      const pair = await sharp({
        create: { width: 152, height: 90, channels: 3, background: { r: 20, g: 20, b: 28 } },
      })
        .composite([
          { input: left, left: 0, top: 14 },
          { input: right, left: 76, top: 14 },
          { input: header, top: 0, left: 0 },
        ])
        .png().toBuffer();
      tiles.push(await sharp(pair).resize(152, 90, { fit: "fill" }).png().toBuffer());
      legend.push(`${r.slug} (${r.family}) left=offline right=makeemoji score=${r.verifyScore?.toFixed?.(3) ?? "?"}`);
    } catch (e) {
      console.error(`pair ${r.slug}:`, (e as Error).message);
    }
  }
  if (!tiles.length) {
    console.log(`skip ${name}: no tiles`);
    return;
  }
  const cols = Math.min(4, tiles.length);
  const rows = Math.ceil(tiles.length / cols);
  const tw = 152, th = 90;
  const out = join(outDir, "sheets", `${name}.png`);
  await sharp({
    create: {
      width: cols * tw, height: rows * th, channels: 3,
      background: { r: 12, g: 12, b: 18 },
    },
  })
    .composite(tiles.map((t, i) => ({
      input: t, left: (i % cols) * tw, top: Math.floor(i / cols) * th,
    })))
    .png()
    .toFile(out);
  writeFileSync(join(outDir, "sheets", `${name}.json`), JSON.stringify(legend, null, 2));
  console.log(`wrote ${out} (${tiles.length} tiles)`);
}

const cat = await loadCat();
const readyIds = recipes.filter(r => r.offlineReady).map(r => r.id);
const byFam = (f: string) => readyIds.filter(id => recipes.find(r => r.id === id)?.family === f);
const withPreview = (ids: string[]) => ids.filter(id => {
  const r = recipes.find(x => x.id === id);
  return r ? previewPath(r.slug) != null : false;
});

await sheet("transform", withPreview(byFam("transform")).slice(0, 16), cat);
await sheet("overlay", withPreview(byFam("overlay")).slice(0, 12), cat);
await sheet("atlas", withPreview(byFam("atlas")).slice(0, 12), cat);
await sheet("frames", withPreview(byFam("frames")).slice(0, 12), cat);
await sheet("mixed", withPreview(readyIds).slice(0, 20), cat);
const low = recipes
  .filter(r => r.offlineReady && r.family === "transform" && typeof r.verifyScore === "number")
  .sort((a, b) => (a.verifyScore ?? 1) - (b.verifyScore ?? 1))
  .map(r => r.id);
await sheet("transform-low-score", withPreview(low).slice(0, 16), cat);
