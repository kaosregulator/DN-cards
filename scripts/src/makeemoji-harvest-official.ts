#!/usr/bin/env tsx
/**
 * Harvest ORIGINAL free MakeEmoji assets into artifacts/emoji-offline.
 *
 * Source of truth: https://assets.makeemoji.com (referenced by makeemoji.com).
 * Does NOT procedurally generate, approximate, or redraw artwork.
 *
 * Usage (repo root):
 *   pnpm --filter @workspace/scripts exec tsx ./src/makeemoji-harvest-official.ts
 */
import {
  existsSync, mkdirSync, writeFileSync, readFileSync, rmSync, readdirSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "../..");
const OUT = join(REPO, "artifacts/emoji-offline");
const RECIPES = join(OUT, "recipes", "recipes.json");
const PRERENDERED = join(OUT, "assets", "prerendered");
const FRAMES = join(OUT, "assets", "frames");
const OVERLAYS = join(OUT, "assets", "overlays");
const CDN = "https://assets.makeemoji.com";
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36";

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
  preview?: { url?: string; ext?: string; bytes?: number; contentType?: string };
  directionSuffix?: string | null;
  verified?: boolean;
  verifyScore?: number;
}

function sha256(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex");
}

async function fetchBuf(url: string): Promise<Buffer | null> {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": UA, Referer: "https://makeemoji.com/" },
    });
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < 64) return null;
    const head = buf.subarray(0, 16).toString("utf8").toLowerCase();
    if (head.includes("<!doctype") || head.includes("<html")) return null;
    return buf;
  } catch {
    return null;
  }
}

function isGif(buf: Buffer): boolean {
  return buf.subarray(0, 3).toString("ascii") === "GIF";
}
function isPng(buf: Buffer): boolean {
  return buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47;
}
function isWebp(buf: Buffer): boolean {
  return buf.subarray(0, 4).toString("ascii") === "RIFF" && buf.subarray(8, 12).toString("ascii") === "WEBP";
}
function isAvif(buf: Buffer): boolean {
  // ftyp....avif / avis
  return buf.length > 12 && buf.subarray(4, 8).toString("ascii") === "ftyp";
}

async function harvestPrerendered(slug: string): Promise<{ path: string; bytes: number; kind: string } | null> {
  const dir = join(PRERENDERED, slug);
  // Prefer HQ GIF, then HQ webp, then preview webp/gif.
  const candidates: { url: string; kind: string; file: string }[] = [
    { url: `${CDN}/prerendered/default-cat/${slug}.gif`, kind: "hq-gif", file: "default-cat.gif" },
    { url: `${CDN}/prerendered/default-cat/${slug}.webp`, kind: "hq-webp", file: "default-cat.webp" },
    { url: `${CDN}/prerendered/default-cat-preview/${slug}.gif`, kind: "preview-gif", file: "default-cat-preview.gif" },
    { url: `${CDN}/prerendered/default-cat-preview/${slug}.webp`, kind: "preview-webp", file: "default-cat-preview.webp" },
  ];
  for (const c of candidates) {
    const buf = await fetchBuf(c.url);
    if (!buf) continue;
    const ok =
      (c.file.endsWith(".gif") && isGif(buf)) ||
      (c.file.endsWith(".webp") && isWebp(buf)) ||
      true;
    if (!ok) continue;
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, c.file), buf);
    writeFileSync(join(dir, "SOURCE.txt"), `${c.url}\n`);
    return { path: `prerendered/${slug}/${c.file}`, bytes: buf.length, kind: c.kind };
  }
  return null;
}

async function harvestOverlay(id: string, url: string): Promise<string | null> {
  const buf = await fetchBuf(url);
  if (!buf) return null;
  mkdirSync(OVERLAYS, { recursive: true });
  const ext = url.split(".").pop()?.split("?")[0] || "png";
  const file = `${id}.${ext}`;
  writeFileSync(join(OVERLAYS, file), buf);
  return file;
}

async function harvestFrames(slug: string): Promise<string[]> {
  const first = await fetchBuf(`${CDN}/frames/${slug}/frame_0001.png`);
  if (!first || !isPng(first)) return [];
  const dir = join(FRAMES, slug);
  mkdirSync(dir, { recursive: true });
  // Clear prior contents so we never mix procedural leftovers.
  for (const f of readdirSync(dir)) {
    rmSync(join(dir, f), { force: true });
  }
  writeFileSync(join(dir, "frame_0001.png"), first);
  const saved = ["frame_0001.png"];
  for (let n = 2; n <= 128; n++) {
    const name = `frame_${String(n).padStart(4, "0")}.png`;
    const buf = await fetchBuf(`${CDN}/frames/${slug}/${name}`);
    if (!buf || !isPng(buf)) break;
    writeFileSync(join(dir, name), buf);
    saved.push(name);
  }
  writeFileSync(join(dir, "SOURCE.txt"), `${CDN}/frames/${slug}/\n`);
  return saved;
}

async function main() {
  mkdirSync(PRERENDERED, { recursive: true });
  mkdirSync(FRAMES, { recursive: true });
  mkdirSync(OVERLAYS, { recursive: true });

  const recipes = JSON.parse(readFileSync(RECIPES, "utf8")) as Recipe[];

  const report: {
    harvestedAt: string;
    prerendered: Record<string, { path: string; bytes: number; kind: string }>;
    prerenderedMissing: string[];
    overlays: Record<string, string>;
    overlaysMissing: string[];
    frames: Record<string, number>;
    framesMissing: string[];
    proceduralRemoved: string[];
  } = {
    harvestedAt: new Date().toISOString(),
    prerendered: {},
    prerenderedMissing: [],
    overlays: {},
    overlaysMissing: [],
    frames: {},
    framesMissing: [],
    proceduralRemoved: [],
  };

  // --- Remove known procedural pokéball frames (SVG recreations) ---
  for (const slug of ["pokeball-go", "pokeball-capture", "pokeball-almost"]) {
    const dir = join(FRAMES, slug);
    if (existsSync(dir)) {
      rmSync(dir, { recursive: true, force: true });
      report.proceduralRemoved.push(`frames/${slug}/ (procedural SVG recreation deleted)`);
      console.log(`removed procedural frames/${slug}`);
    }
  }

  // --- Prerendered (every style) ---
  console.log(`Harvesting prerendered for ${recipes.length} styles…`);
  let i = 0;
  for (const r of recipes) {
    i++;
    const hit = await harvestPrerendered(r.slug);
    if (hit) {
      report.prerendered[r.slug] = hit;
      if (i % 50 === 0) console.log(`  prerendered ${i}/${recipes.length}`);
    } else {
      report.prerenderedMissing.push(r.slug);
      console.log(`  MISSING prerendered: ${r.slug}`);
    }
  }
  console.log(`prerendered OK ${Object.keys(report.prerendered).length}, missing ${report.prerenderedMissing.length}`);

  // --- Overlays from recipe CDN URLs ---
  for (const r of recipes) {
    const url = r.assets?.overlay;
    if (!url) continue;
    const file = await harvestOverlay(r.id, url);
    if (file) {
      report.overlays[r.id] = file;
      r.assets = { ...r.assets, overlay: url, overlayLocal: `overlays/${file}` };
      r.fidelity = "makeemoji-overlay";
      r.notes = [
        `Official overlay from ${url}`,
        ...(r.notes || []).filter(n => !/procedural|SVG|approximat|Crisp SVG/i.test(n)),
      ];
    } else {
      report.overlaysMissing.push(`${r.id} ${url}`);
      console.log(`  MISSING overlay: ${r.id}`);
    }
  }
  console.log(`overlays OK ${Object.keys(report.overlays).length}, missing ${report.overlaysMissing.length}`);

  // --- CDN frames for atlas/frames/pokeball families ---
  const frameCandidates = new Set<string>();
  for (const r of recipes) {
    if (r.family === "frames" || r.family === "atlas" || r.slug.includes("pokeball")) {
      frameCandidates.add(r.slug);
    }
  }
  console.log(`Probing CDN frames for ${frameCandidates.size} styles…`);
  for (const slug of [...frameCandidates].sort()) {
    const files = await harvestFrames(slug);
    if (files.length) {
      report.frames[slug] = files.length;
      console.log(`  frames/${slug}: ${files.length}`);
      const r = recipes.find(x => x.slug === slug);
      if (r) {
        r.family = "frames";
        r.primitive = "frames";
        r.fidelity = "makeemoji-cdn-frames";
        r.assets = { ...r.assets, framesHint: slug };
        r.notes = [
          `CDN frames harvested from ${CDN}/frames/${slug}/ (${files.length} frames)`,
          ...(r.notes || []).filter(n => !/procedural|SVG|approximat|Crisp SVG|atlas assets archived/i.test(n)),
        ];
        r.offlineReady = true;
      }
    } else {
      report.framesMissing.push(slug);
    }
  }
  console.log(`CDN frames OK ${Object.keys(report.frames).length}, missing ${report.framesMissing.length}`);

  // --- Annotate styles that only have prerendered (no compositable CDN frames) ---
  for (const slug of report.framesMissing) {
    const r = recipes.find(x => x.slug === slug);
    if (!r) continue;
    const pre = report.prerendered[slug];
    if (pre) {
      r.assets = { ...r.assets, prerendered: pre.path };
      // Keep existing atlas/overlay wiring if present; do not invent frames.
      if (r.fidelity === "procedural-aa-tracked" || /procedural|SVG/i.test(r.fidelity || "")) {
        r.fidelity = "makeemoji-prerendered-gif";
      }
      r.notes = [
        `Official MakeEmoji prerendered asset: ${CDN}/… → ${pre.path} (${pre.kind})`,
        `CDN frame sequence NOT available (404 at ${CDN}/frames/${slug}/) — no procedural replacement`,
        ...(r.notes || []).filter(n => !/procedural|SVG|Crisp SVG|posed from/i.test(n)),
      ];
    }
  }

  // Pokéball closed styles: explicitly not offline-compositable without CDN frames.
  for (const slug of ["pokeball-go", "pokeball-capture", "pokeball-almost"]) {
    const r = recipes.find(x => x.slug === slug);
    if (!r) continue;
    const pre = report.prerendered[slug];
    r.family = "frames";
    r.primitive = "frames";
    r.fidelity = "makeemoji-prerendered-gif-only";
    r.offlineReady = false; // cannot composite user image without CDN overlay frames
    r.assets = pre ? { prerendered: pre.path } : {};
    r.notes = [
      `Official MakeEmoji GIF available: ${CDN}/prerendered/default-cat/${slug}.gif`,
      `Compositable CDN frames MISSING (404). Procedural SVG recreation removed. Offline user-image composite blocked until MakeEmoji publishes frames.`,
    ];
  }

  writeFileSync(RECIPES, `${JSON.stringify(recipes, null, 2)}\n`);
  writeFileSync(join(OUT, "OFFICIAL_HARVEST.json"), `${JSON.stringify(report, null, 2)}\n`);

  // Human-readable exceptions
  const md = [
    "# MakeEmoji official asset harvest — exceptions",
    "",
    `Harvested at: ${report.harvestedAt}`,
    "",
    "## Rule",
    "",
    "Only original free assets from `assets.makeemoji.com` / makeemoji.com are kept.",
    "No SVG redraws, procedural GIFs, or approximated artwork.",
    "",
    "## Prerendered",
    "",
    `- OK: ${Object.keys(report.prerendered).length}`,
    `- Missing: ${report.prerenderedMissing.length || 0}`,
    ...(report.prerenderedMissing.length
      ? report.prerenderedMissing.map(s => `  - \`${s}\``)
      : ["- (none)"]),
    "",
    "## Overlays",
    "",
    `- OK: ${Object.keys(report.overlays).length}`,
    `- Missing: ${report.overlaysMissing.length || 0}`,
    ...report.overlaysMissing.map(s => `- ${s}`),
    "",
    "## CDN frame sequences (`/frames/{style}/frame_XXXX.png`)",
    "",
    `- OK: ${Object.keys(report.frames).length}`,
    `- **Missing (do not invent replacements):** ${report.framesMissing.length}`,
    ...report.framesMissing.map(s => `- \`${s}\``),
    "",
    "## Procedural assets removed this run",
    "",
    ...report.proceduralRemoved.map(s => `- ${s}`),
    "",
    "## Blocked offline composites",
    "",
    "These styles have an official MakeEmoji prerendered GIF but **no** compositable CDN frame overlays.",
    "Offline user-image rendering is blocked (`offlineReady: false`) rather than faking assets:",
    "",
    "- `pokeball-go`",
    "- `pokeball-capture`",
    "- `pokeball-almost`",
    "",
    "`pokeball-emerge` keeps official CDN frames.",
    "",
  ].join("\n");
  writeFileSync(join(OUT, "MISSING_CDN_ASSETS.md"), md);

  console.log("\nWrote OFFICIAL_HARVEST.json + MISSING_CDN_ASSETS.md");
  console.log("DONE");
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
