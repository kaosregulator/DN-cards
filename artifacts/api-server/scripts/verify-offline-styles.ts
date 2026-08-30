// Verify offline recipes by rendering + optional preview compare.
// Invoked by scripts/src/makeemoji-offline-verify.ts
import { readFileSync, writeFileSync, mkdirSync, existsSync, copyFileSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";
import { reloadOfflineRegistry } from "../src/bot/emoji/providers/offline/registry.js";
import { reloadRecipes } from "../src/bot/emoji/providers/offline/recipes.js";
import { renderOffline } from "../src/bot/emoji/providers/offline/renderer.js";

const recipesPath = join(process.cwd(), "../emoji-offline/recipes/recipes.json");
const outDir = process.env.OFFLINE_VERIFY_OUT || "/tmp/offline-fidelity";
mkdirSync(join(outDir, "offline"), { recursive: true });
mkdirSync(join(outDir, "makeemoji"), { recursive: true });
mkdirSync(join(outDir, "sheets"), { recursive: true });

reloadOfflineRegistry();
reloadRecipes();

interface Recipe {
  id: string;
  slug: string;
  family: string;
  primitive: string | null;
  params: Record<string, unknown>;
  offlineReady: boolean;
  fidelity: string | null;
  notes: string[];
  verified?: boolean;
  verifyScore?: number;
}

const recipes = JSON.parse(readFileSync(recipesPath, "utf8")) as Recipe[];

const subjectSvg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128">
  <circle cx="64" cy="58" r="40" fill="#2f7fe4"/>
  <circle cx="50" cy="50" r="6" fill="#fff"/><circle cx="78" cy="50" r="6" fill="#fff"/>
  <rect x="48" y="78" width="32" height="8" rx="4" fill="#e04f2f"/>
</svg>`);
const image = await sharp(subjectSvg).png().toBuffer();

let cat = image;
try {
  const catPath = "/tmp/me-probe/cat.png";
  if (existsSync(catPath)) {
    cat = await sharp(catPath)
      .resize(128, 128, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png()
      .toBuffer();
  }
} catch { /* keep svg subject */ }

function previewPath(slug: string): string | null {
  for (const ext of ["gif", "webp", "png"]) {
    for (const base of ["/tmp/me-previews-pending", "/tmp/me-assets/previews"]) {
      const p = join(base, `${slug}.${ext}`);
      if (existsSync(p)) return p;
    }
  }
  return null;
}

async function scoreVsPreview(offlineGif: Buffer, previewFile: string | null) {
  if (!previewFile) return { score: 0.5, mean: 0.5, reason: "no-preview" };
  try {
    const a = await sharp(offlineGif, { animated: true, page: 0 })
      .resize(64, 64, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    let b;
    try {
      b = await sharp(previewFile, { animated: true, page: 0 })
        .resize(64, 64, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
        .ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    } catch {
      b = await sharp(previewFile)
        .resize(64, 64, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
        .ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    }
    const n = Math.min(a.data.length, b.data.length);
    let diff = 0, count = 0;
    for (let i = 0; i < n; i += 4) {
      if (a.data[i + 3]! < 10 && b.data[i + 3]! < 10) continue;
      diff += Math.abs(a.data[i]! - b.data[i]!)
        + Math.abs(a.data[i + 1]! - b.data[i + 1]!)
        + Math.abs(a.data[i + 2]! - b.data[i + 2]!);
      count++;
    }
    const mean = count ? diff / (count * 255 * 3) : 1;
    return { score: Math.max(0, 1 - mean), mean, reason: "pixel" };
  } catch (e) {
    return { score: 0.5, mean: 0.5, reason: `compare-fail:${(e as Error).message}` };
  }
}

const results: unknown[] = [];
let newlyReady = 0;

for (const r of recipes) {
  const candidate = Boolean(
    r.primitive && ["transform", "overlay", "passthrough", "atlas", "frames"].includes(r.family),
  );
  if (!candidate) continue;

  const offlinePath = join(outDir, "offline", `${r.slug}.gif`);
  const alreadyVerified = Boolean(
    r.offlineReady && r.verified && existsSync(offlinePath),
  );
  // Re-verify only when not yet claimed ready, or when a prior run left no artifact.
  if (alreadyVerified && process.env.OFFLINE_VERIFY_FORCE !== "1") continue;

  try {
    const useCat = r.family === "atlas" || r.family === "frames" || r.family === "overlay";
    const result = await renderOffline({
      image: useCat ? cat : image,
      animation: r.id,
      format: "gif",
      size: "64",
      speed: "normal",
    });
    if (!result.buffer || result.buffer.length < 50) throw new Error("empty buffer");
    if (result.buffer.subarray(0, 3).toString("ascii") !== "GIF") throw new Error("not gif");

    writeFileSync(offlinePath, result.buffer);

    const prev = previewPath(r.slug);
    if (prev) {
      try {
        copyFileSync(prev, join(outDir, "makeemoji", `${r.slug}${prev.slice(prev.lastIndexOf("."))}`));
      } catch { /* ignore */ }
    }
    const cmp = await scoreVsPreview(result.buffer, prev);

    // Gate: successful GIF render is required. Transform fingerprints with
    // very low confidence are rejected; atlas/overlay/frames pass on render.
    let pass = result.buffer.length > 400;
    if (r.family === "transform") {
      const fp = r.params?._fp as { conf?: number } | undefined;
      const conf = Number(fp?.conf ?? 0.5);
      pass = pass && conf >= 0.35;
    }

    if (pass) {
      r.offlineReady = true;
      r.verified = true;
      r.verifyScore = cmp.score;
      r.fidelity = r.fidelity
        || (r.family === "transform" ? "approximate-procedural" : "approximate-composite");
      newlyReady++;
      results.push({ id: r.id, family: r.family, ok: true, bytes: result.buffer.length, score: cmp.score });
    } else {
      r.offlineReady = false;
      r.verified = false;
      r.notes = [...(r.notes || []), `Failed verification score=${cmp.score}`];
      results.push({ id: r.id, family: r.family, ok: false, score: cmp.score });
    }
  } catch (e) {
    r.offlineReady = false;
    r.verified = false;
    r.notes = [...(r.notes || []), `Render failed: ${(e as Error).message}`];
    results.push({ id: r.id, family: r.family, ok: false, error: (e as Error).message });
  }
}

writeFileSync(recipesPath, JSON.stringify(recipes, null, 2) + "\n");
writeFileSync(join(outDir, "verify-results.json"), JSON.stringify({ newlyReady, results }, null, 2));

async function sheet(name: string, ids: string[]) {
  const tiles: Buffer[] = [];
  for (const id of ids) {
    const r = recipes.find(x => x.id === id || x.slug === id);
    if (!r) continue;
    const off = join(outDir, "offline", `${r.slug}.gif`);
    if (!existsSync(off)) continue;
    const prev = previewPath(r.slug);
    let left: Buffer;
    let right: Buffer;
    try {
      left = await sharp(off, { animated: true, page: 0 })
        .resize(72, 72, { fit: "contain", background: { r: 30, g: 30, b: 40, alpha: 1 } })
        .png().toBuffer();
    } catch { continue; }
    try {
      right = prev
        ? await sharp(prev, { animated: true, page: 0 })
          .resize(72, 72, { fit: "contain", background: { r: 30, g: 30, b: 40, alpha: 1 } })
          .png().toBuffer()
        : await sharp({ create: { width: 72, height: 72, channels: 3, background: { r: 60, g: 60, b: 70 } } })
          .png().toBuffer();
    } catch {
      right = await sharp({ create: { width: 72, height: 72, channels: 3, background: { r: 60, g: 60, b: 70 } } })
        .png().toBuffer();
    }
    const label = r.slug.slice(0, 22).replace(/[^\w\-.:]/g, "");
    // Rasterize label SVG to exact pixel size — raw SVGs can exceed declared
    // width/height under sharp's density defaults and break composite.
    const labelPng = await sharp(Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" width="152" height="14">`
      + `<rect width="152" height="14" fill="#14141c"/>`
      + `<text x="2" y="11" font-size="9" font-family="monospace" fill="#cccccc">${label}</text>`
      + `</svg>`,
    ))
      .resize(152, 14)
      .png()
      .toBuffer();
    const pair = await sharp({
      create: { width: 152, height: 90, channels: 3, background: { r: 20, g: 20, b: 28 } },
    })
      .composite([
        { input: left, left: 0, top: 14 },
        { input: right, left: 76, top: 14 },
        { input: labelPng, top: 0, left: 0 },
      ])
      .png().toBuffer();
    tiles.push(pair);
  }
  if (!tiles.length) return;
  const cols = Math.min(4, tiles.length);
  const rows = Math.ceil(tiles.length / cols);
  const tw = 152, th = 90;
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
    .toFile(join(outDir, "sheets", `${name}.png`));
}

try {
  const readyIds = recipes.filter(r => r.offlineReady).map(r => r.id);
  const byFam = (f: string) => readyIds.filter(id => recipes.find(r => r.id === id)?.family === f);
  // Prefer styles that have both offline + MakeEmoji tiles on disk for sheets.
  const withBoth = (ids: string[]) => ids.filter(id => {
    const r = recipes.find(x => x.id === id);
    if (!r) return false;
    if (!existsSync(join(outDir, "offline", `${r.slug}.gif`))) return false;
    return previewPath(r.slug) != null;
  });
  await sheet("transform", withBoth(byFam("transform")).slice(0, 16));
  await sheet("overlay", withBoth(byFam("overlay")).slice(0, 12));
  await sheet("atlas", withBoth(byFam("atlas")).slice(0, 12));
  await sheet("frames", withBoth(byFam("frames")).slice(0, 12));
  await sheet("mixed", withBoth(readyIds).slice(0, 20));
  // Low-score transforms for fidelity review
  const low = recipes
    .filter(r => r.offlineReady && r.family === "transform" && typeof r.verifyScore === "number")
    .sort((a, b) => (a.verifyScore ?? 1) - (b.verifyScore ?? 1))
    .map(r => r.id);
  await sheet("transform-low-score", withBoth(low).slice(0, 16));
} catch (e) {
  console.error("contact sheet generation failed (non-fatal):", (e as Error).message);
}

console.log(JSON.stringify({
  newlyReady,
  ready: recipes.filter(r => r.offlineReady).length,
  total: recipes.length,
}));
