#!/usr/bin/env node
/**
 * Build Discord-ready layer packs from MakeEmoji green-screen harvest GIFs.
 *
 * Input:  artifacts/emoji-offline/greenscreen/raw/{style}.gif
 * Output: artifacts/emoji-offline/layers/{style}/
 *           front.png   — vertical sprite sheet, green keyed to alpha
 *           meta.json   — frame count, delay, slot bbox
 *
 * Same chroma idea as the old /emojimoji green-screen builder.
 */
import sharp from "sharp";
import {
  existsSync, mkdirSync, writeFileSync, readdirSync, readFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "../../..");
const RAW = join(REPO, "artifacts/emoji-offline/greenscreen/raw");
const OUT = join(REPO, "artifacts/emoji-offline/layers");
const INDEX = join(REPO, "artifacts/emoji-offline/layers-index.json");

const S = 128;
const CAP = 48; // max frames kept (Discord GIF size budget)

/** True green-screen pixel (MakeEmoji subject was solid #00FF00). */
function isGreen(r, g, b) {
  return g > 90 && g > r * 1.45 && g > b * 1.35;
}

async function processGif(file, id) {
  const path = join(RAW, file);
  const m = await sharp(path, { animated: true, unlimited: true }).metadata();
  const pages = m.pages || 1;
  const delay0 = Array.isArray(m.delay) && m.delay[0] ? m.delay[0] : 50;
  const step = Math.max(1, Math.ceil(pages / CAP));
  const indices = [];
  for (let i = 0; i < pages && indices.length < CAP; i += step) indices.push(i);

  const frames = [];
  for (const i of indices) {
    const buf = await sharp(path, { page: i, unlimited: true })
      .ensureAlpha()
      .resize(S, S, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .raw()
      .toBuffer();
    frames.push(buf);
  }

  let mnx = S, mny = S, mxx = 0, mxy = 0, greenTotal = 0, layerTotal = 0;
  const sheet = Buffer.alloc(S * S * frames.length * 4, 0);

  for (let f = 0; f < frames.length; f++) {
    const F = frames[f];
    const base = f * S * S * 4;
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const j = (y * S + x) * 4;
        const r = F[j], g = F[j + 1], b = F[j + 2], a = F[j + 3];
        if (a < 8) continue;
        if (isGreen(r, g, b)) {
          greenTotal++;
          if (x < mnx) mnx = x;
          if (x > mxx) mxx = x;
          if (y < mny) mny = y;
          if (y > mxy) mxy = y;
          continue; // leave transparent — user slot
        }
        layerTotal++;
        sheet[base + j] = r;
        sheet[base + j + 1] = g;
        sheet[base + j + 2] = b;
        sheet[base + j + 3] = a;
      }
    }
  }

  const dir = join(OUT, id);
  mkdirSync(dir, { recursive: true });
  await sharp(sheet, { raw: { width: S, height: S * frames.length, channels: 4 } })
    .png()
    .toFile(join(dir, "front.png"));

  const kind =
    greenTotal < 40 ? "no-slot" :
    layerTotal < 40 ? "transform-slot" : // green moved, little/no overlay chrome
    "layer";

  const meta = {
    id,
    kind,
    frames: frames.length,
    sourcePages: pages,
    delayMs: Math.max(20, Math.min(200, Math.round((delay0 * step) / 10) * 10)),
    size: S,
    slot: greenTotal >= 40 ? {
      x: mnx, y: mny, w: mxx - mnx + 1, h: mxy - mny + 1,
      greenPixels: greenTotal,
    } : null,
    layerPixels: layerTotal,
    source: `greenscreen/raw/${file}`,
  };
  writeFileSync(join(dir, "meta.json"), JSON.stringify(meta, null, 2));
  return meta;
}

async function main() {
  if (!existsSync(RAW)) {
    console.error("No raw greenscreen harvest at", RAW);
    process.exit(1);
  }
  mkdirSync(OUT, { recursive: true });
  const files = readdirSync(RAW).filter(f => /\.(gif|png|webp|jpe?g)$/i.test(f)).sort();
  const index = { builtAt: new Date().toISOString(), size: S, items: {} };
  let n = 0;
  for (const file of files) {
    const id = file.replace(/\.(gif|png|webp|jpe?g)$/i, "");
    process.stdout.write(`build ${id}… `);
    try {
      const meta = await processGif(file, id);
      index.items[id] = meta;
      console.log(`${meta.kind} frames=${meta.frames} green=${meta.slot?.greenPixels ?? 0} layer=${meta.layerPixels}`);
      n++;
    } catch (err) {
      console.log("ERR", err?.message || err);
      index.items[id] = { id, ok: false, error: String(err?.message || err) };
    }
  }
  writeFileSync(INDEX, JSON.stringify(index, null, 2));
  const kinds = {};
  for (const it of Object.values(index.items)) {
    if (it.kind) kinds[it.kind] = (kinds[it.kind] || 0) + 1;
  }
  console.log(`\nBuilt ${n} layers → ${INDEX}`, kinds);
}

main().catch((e) => { console.error(e); process.exit(1); });
