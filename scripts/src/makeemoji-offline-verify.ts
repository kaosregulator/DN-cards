#!/usr/bin/env tsx
// ─────────────────────────────────────────────────────────────────────────────
// Offline style assignment + verification against MakeEmoji CDN previews.
//
//   pnpm --filter @workspace/scripts exec tsx ./src/makeemoji-offline-verify.ts
// ─────────────────────────────────────────────────────────────────────────────

import {
  existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "../..");
const OUT = join(REPO, "artifacts/emoji-offline");
const RECIPES = join(OUT, "recipes", "recipes.json");
const ARTIFACTS = join("/opt/cursor/artifacts", "offline-fidelity");

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
  preview?: { ext?: string; url?: string; bytes?: number } | null;
  directionSuffix?: string | null;
}

async function loadSharp() {
  return (await import("sharp")).default;
}

type Fingerprint = {
  pages: number;
  motion: number;
  axialX: number;
  axialY: number;
  scaleProxy: number;
  hueProxy: number;
};

async function fingerprintPreview(path: string): Promise<Fingerprint | null> {
  const sharp = await loadSharp();
  try {
    // `animated: true` already means "decode every page", so the explicit
    // `pages: -1` was redundant — and it is absent from sharp's resolved
    // types here, which broke the repo-wide typecheck.
    const meta = await sharp(path, { animated: true }).metadata();
    const pages = meta.pages ?? 1;
    const pageHeight = meta.pageHeight ?? meta.height ?? 0;
    const n = Math.min(pages, 12);
    const frames: { data: Buffer; info: { width: number; height: number } }[] = [];
    for (let i = 0; i < n; i++) {
      const { data, info } = await sharp(path, { animated: true, page: i })
        .ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      if (info.height > pageHeight * 1.5 && pageHeight > 0) {
        const cropped = await sharp(data, {
          raw: { width: info.width, height: info.height, channels: 4 },
        })
          .extract({ left: 0, top: 0, width: info.width, height: pageHeight })
          .raw().toBuffer({ resolveWithObject: true });
        frames.push({ data: cropped.data, info: cropped.info });
      } else {
        frames.push({ data, info });
      }
    }
    if (!frames.length) return null;

    let motion = 0, pairs = 0, dx = 0, dy = 0;
    const areas: number[] = [];
    const chromas: number[] = [];
    const mean = (arr: number[]) => arr.reduce((a, b) => a + b, 0) / Math.max(1, arr.length);
    const variance = (arr: number[]) => {
      const m = mean(arr);
      return mean(arr.map(v => (v - m) ** 2));
    };

    for (let i = 0; i < frames.length; i++) {
      const f = frames[i]!;
      const { width: w, height: h } = f.info;
      const d = f.data;
      let opaque = 0, minX = w, minY = h, maxX = 0, maxY = 0, cr = 0, cg = 0, cb = 0;
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const i4 = (y * w + x) * 4;
          if (d[i4 + 3]! < 20) continue;
          opaque++;
          minX = Math.min(minX, x); minY = Math.min(minY, y);
          maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
          cr += d[i4]!; cg += d[i4 + 1]!; cb += d[i4 + 2]!;
        }
      }
      areas.push(opaque > 0 ? ((maxX - minX + 1) * (maxY - minY + 1)) / (w * h) : 0);
      if (opaque > 0) {
        const mr = cr / opaque, mg = cg / opaque, mb = cb / opaque;
        chromas.push(Math.sqrt((mr - mg) ** 2 + (mg - mb) ** 2 + (mb - mr) ** 2) / 255);
      } else chromas.push(0);

      if (i > 0) {
        const prev = frames[i - 1]!;
        let sum = 0, nPix = 0;
        const lim = Math.min(d.length, prev.data.length);
        for (let p = 0; p + 3 < lim; p += 16) {
          sum += Math.abs(d[p]! - prev.data[p]!)
            + Math.abs(d[p + 1]! - prev.data[p + 1]!)
            + Math.abs(d[p + 2]! - prev.data[p + 2]!);
          nPix++;
        }
        let left = 0, right = 0, top = 0, bot = 0;
        for (let y = 0; y < h; y += 4) {
          for (let x = 0; x < w; x += 4) {
            const i4 = (y * w + x) * 4;
            if (i4 + 3 >= prev.data.length) continue;
            const da = Math.abs(d[i4]! - prev.data[i4]!);
            if (x < w / 2) left += da; else right += da;
            if (y < h / 2) top += da; else bot += da;
          }
        }
        dx += Math.abs(left - right);
        dy += Math.abs(top - bot);
        motion += sum / Math.max(1, nPix) / (255 * 3);
        pairs++;
      }
    }

    const axialSum = dx + dy || 1;
    return {
      pages: n,
      motion: pairs ? motion / pairs : 0,
      axialX: dx / axialSum,
      axialY: dy / axialSum,
      scaleProxy: variance(areas),
      hueProxy: variance(chromas),
    };
  } catch {
    return null;
  }
}

function assignPrimitive(fp: Fingerprint, slug: string) {
  const nameRules: [RegExp, string, Record<string, unknown>][] = [
    [/shake|jitter|vibrate/, "shake", {}],
    [/bounce|hop|boing|jump/, "bounce", {}],
    [/spin|rotate|roll|tumble/, "spin", {}],
    [/orbit|circle/, "orbit", {}],
    [/slide|scroll/, "slide", {}],
    [/wave|sway/, "wave", {}],
    [/wobble|bobble|jello/, "wobble", {}],
    [/flip|mirror/, "flip", {}],
    [/glitch|static|corrupt|vhs|crt/, "glitch", {}],
    [/pulse|throb/, "pulse", {}],
    [/zoom/, "zoom", {}],
    [/heart/, "heartbeat", {}],
    [/squish|squash/, "squish", {}],
    [/tilt/, "tilt", {}],
    [/nod/, "nod", {}],
    [/fade|blink/, "fade", {}],
    [/rainbow|hue|neon/, "rainbow", {}],
    [/spiral/, "spiral", {}],
    [/sparkle|twinkle|star/, "sparkle", {}],
    [/party|confetti/, "party", {}],
    [/pet|pat/, "pet", {}],
    [/wide|panel/, "slide", {}],
    [/hype|excited/, "bounce", {}],
    [/ponder|think/, "tilt", {}],
    [/present|gift/, "pulse", {}],
  ];
  for (const [re, prim, params] of nameRules) {
    if (re.test(slug)) return { primitive: prim, params, conf: 0.85 };
  }
  if (fp.hueProxy > 0.002 && fp.motion > 0.02) return { primitive: "rainbow", params: {}, conf: 0.55 };
  if (fp.motion < 0.008) return { primitive: "pulse", params: { minScale: 0.94, maxScale: 1.04 }, conf: 0.4 };
  if (fp.scaleProxy > 0.002) {
    if (fp.motion > 0.05) return { primitive: "bounce", params: {}, conf: 0.6 };
    return { primitive: "pulse", params: {}, conf: 0.55 };
  }
  if (fp.axialX > 0.65 && fp.motion > 0.02) return { primitive: "shake", params: {}, conf: 0.6 };
  if (fp.axialY > 0.65 && fp.motion > 0.02) return { primitive: "nod", params: {}, conf: 0.55 };
  if (fp.motion > 0.08) return { primitive: "glitch", params: {}, conf: 0.5 };
  if (fp.motion > 0.04) return { primitive: "wobble", params: {}, conf: 0.5 };
  return { primitive: "pulse", params: {}, conf: 0.4 };
}

async function main() {
  mkdirSync(ARTIFACTS, { recursive: true });
  const recipes = JSON.parse(readFileSync(RECIPES, "utf8")) as Recipe[];
  const previewDir = "/tmp/me-previews-pending";

  // Reclassify frames-without-assets as transform (hype/ponder/will-presents)
  const framesRoot = join(OUT, "assets", "frames");
  const atlasRoot = join(OUT, "assets", "atlases");
  const frameDirs = new Set(existsSync(framesRoot) ? readdirSync(framesRoot) : []);
  const atlasDirs = new Set(existsSync(atlasRoot) ? readdirSync(atlasRoot) : []);
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  const resolveDir = (root: string, pool: Set<string>, slug: string): string | null => {
    const hit = [...pool].find(d => norm(d) === norm(slug));
    return hit ? join(root, hit) : null;
  };
  const hasRenderableAssets = (root: string, pool: Set<string>, slug: string): boolean => {
    const dir = resolveDir(root, pool, slug);
    if (!dir || !existsSync(dir)) return false;
    return readdirSync(dir).some(f => /\.(png|webp|gif|jpe?g)$/i.test(f));
  };

  let reclass = 0;
  for (const r of recipes) {
    if (r.family !== "frames" && r.family !== "atlas") continue;
    const hasFrames = hasRenderableAssets(framesRoot, frameDirs, r.slug);
    const hasAtlas = hasRenderableAssets(atlasRoot, atlasDirs, r.slug);
    if (!hasFrames && !hasAtlas) {
      r.family = "transform";
      r.primitive = null;
      r.offlineReady = false;
      r.assets = {};
      r.notes = ["Reclassified → transform (no archived renderable assets)"];
      reclass++;
    }
  }
  console.log(`Reclassified styles without renderable assets → transform: ${reclass}`);

  // Assign pending transforms from CDN preview fingerprints
  let assigned = 0;
  for (const r of recipes) {
    if (r.family !== "transform" || (r.offlineReady && r.primitive)) continue;
    if (r.primitive && r.offlineReady) continue;
    // Re-assign if not ready yet
    if (r.offlineReady) continue;

    const candidates = [
      join(previewDir, `${r.slug}.gif`),
      join(previewDir, `${r.slug}.webp`),
      join(previewDir, `${r.slug}.png`),
    ];
    const path = candidates.find(p => existsSync(p));
    if (!path) continue;
    const fp = await fingerprintPreview(path);
    if (!fp) continue;
    const { primitive, params, conf } = assignPrimitive(fp, r.slug);
    r.primitive = primitive;
    r.params = { ...params, _fp: { motion: +fp.motion.toFixed(4), conf } };
    r.notes = [`Assigned from CDN preview fingerprint (conf=${conf.toFixed(2)})`];
    assigned++;
  }
  console.log(`Assigned/updated transform primitives: ${assigned}`);

  // Atlas/frames candidates with assets
  let assetCandidates = 0;
  for (const r of recipes) {
    if (r.family !== "atlas" && r.family !== "frames") continue;
    const ok = hasRenderableAssets(framesRoot, frameDirs, r.slug)
      || hasRenderableAssets(atlasRoot, atlasDirs, r.slug);
    if (ok) {
      r.primitive = r.family;
      r.fidelity = "approximate-composite";
      if (!r.offlineReady) {
        r.notes = [`${r.family} assets archived; pending render verification`];
      }
      assetCandidates++;
    }
  }
  console.log(`Atlas/frames with assets: ${assetCandidates}`);

  writeFileSync(RECIPES, JSON.stringify(recipes, null, 2) + "\n");

  // Run render verification in api-server context
  const verifyScript = join(REPO, "artifacts/api-server/scripts/verify-offline-styles.ts");
  const run = spawnSync(
    "pnpm",
    ["exec", "tsx", verifyScript],
    {
      cwd: join(REPO, "artifacts/api-server"),
      env: { ...process.env, EMOJI_ALLOW_OFFLINE_FALLBACK: "1", OFFLINE_VERIFY_OUT: ARTIFACTS },
      encoding: "utf8",
      timeout: 900_000,
    },
  );
  console.log(run.stdout);
  if (run.stderr) console.error(run.stderr.slice(-4000));
  if (run.status !== 0) throw new Error(`verify runner failed: ${run.status}`);

  const verified = JSON.parse(readFileSync(RECIPES, "utf8")) as Recipe[];
  const ready = verified.filter(r => r.offlineReady).length;
  console.log(`offlineReady after verification: ${ready}/${verified.length}`);

  // Sync styles.json
  const stylesPath = join(OUT, "styles.json");
  const styles = JSON.parse(readFileSync(stylesPath, "utf8")) as {
    id: string; offlineImplemented: boolean; offlineEffectId: string | null; offlineFamily?: string | null;
  }[];
  const byId = new Map(verified.map(r => [r.id, r]));
  for (const s of styles) {
    const r = byId.get(s.id);
    if (r?.offlineReady && r.primitive) {
      s.offlineImplemented = true;
      s.offlineEffectId = r.primitive;
      s.offlineFamily = r.family;
    } else if (r && !r.offlineReady) {
      s.offlineImplemented = false;
      s.offlineEffectId = null;
      s.offlineFamily = r.family;
    }
  }
  writeFileSync(stylesPath, JSON.stringify(styles, null, 2) + "\n");

  const manifestPath = join(OUT, "manifest.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as Record<string, unknown>;
  manifest.implementedStyleCount = ready;
  manifest.offlineReady = ready >= verified.length;
  manifest.notes =
    `Offline engine: ${ready}/${verified.length} styles independently renderable after verification. ` +
    "MakeEmoji remains primary. Enable with EMOJI_ALLOW_OFFLINE_FALLBACK=1.";
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");

  const backup = spawnSync("pnpm", ["makeemoji:backup"], {
    cwd: REPO, encoding: "utf8", timeout: 180_000,
  });
  console.log(backup.stdout);
  if (backup.status !== 0) console.error(backup.stderr);

  const fromCollections = (f: string) => verified.filter(r => r.offlineReady && r.family === f).length;
  writeFileSync(join(ARTIFACTS, "progress.json"), JSON.stringify({
    total: verified.length,
    offlineReady: ready,
    packageOfflineReady: manifest.offlineReady,
    readyByFamily: {
      transform: fromCollections("transform"),
      overlay: fromCollections("overlay"),
      atlas: fromCollections("atlas"),
      frames: fromCollections("frames"),
      passthrough: fromCollections("passthrough"),
    },
    pendingByFamily: {
      transform: verified.filter(r => r.family === "transform" && !r.offlineReady).length,
      overlay: verified.filter(r => r.family === "overlay" && !r.offlineReady).length,
      atlas: verified.filter(r => r.family === "atlas" && !r.offlineReady).length,
      frames: verified.filter(r => r.family === "frames" && !r.offlineReady).length,
    },
  }, null, 2));
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
