#!/usr/bin/env node
/**
 * Build Discord-ready layer packs from MakeEmoji green-screen ZIP/GIFs.
 *
 * Output per style:
 *   front.png  — vertical sprite sheet, green keyed out (foreground chrome)
 *   slot.png   — vertical sprite sheet, green subject mask (white alpha)
 *   meta.json  — per-frame slot geometry + timing (motion data)
 *
 * The compositor stamps the user image through each frame's slot mask so the
 * subject inherits MakeEmoji's per-frame position/scale/deformation, then
 * draws front.png on top.
 */
import sharp from "sharp";
import {
  existsSync, mkdirSync, writeFileSync, readdirSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "../../..");
const RAW = join(REPO, "artifacts/emoji-offline/greenscreen/raw");
const OUT = join(REPO, "artifacts/emoji-offline/layers");
const INDEX = join(REPO, "artifacts/emoji-offline/layers-index.json");

const S = 128;
const CAP = 48;

function isGreen(r, g, b) {
  return g > 90 && g > r * 1.45 && g > b * 1.35;
}

async function processGif(file, id) {
  const path = join(RAW, file);
  const m = await sharp(path, { animated: true, unlimited: true }).metadata();
  const pages = m.pages || 1;
  const delays = Array.isArray(m.delay) && m.delay.length ? m.delay : null;
  const delay0 = delays?.[0] || 50;
  const step = Math.max(1, Math.ceil(pages / CAP));
  const indices = [];
  for (let i = 0; i < pages && indices.length < CAP; i += step) indices.push(i);

  const frames = [];
  const frameDelays = [];
  for (const i of indices) {
    const buf = await sharp(path, { page: i, unlimited: true })
      .ensureAlpha()
      .resize(S, S, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .raw()
      .toBuffer();
    frames.push(buf);
    const d = delays?.[i] ?? delay0;
    frameDelays.push(Math.max(20, Math.min(200, Math.round((d * step) / 10) * 10)));
  }

  const frontSheet = Buffer.alloc(S * S * frames.length * 4, 0);
  const slotSheet = Buffer.alloc(S * S * frames.length * 4, 0);
  const perFrame = [];
  let greenTotal = 0;
  let layerTotal = 0;
  let union = { x: S, y: S, x2: 0, y2: 0 };

  for (let f = 0; f < frames.length; f++) {
    const F = frames[f];
    const base = f * S * S * 4;
    let mnx = S, mny = S, mxx = -1, mxy = -1;
    let gCount = 0;
    let sumX = 0, sumY = 0;
    let lCount = 0;

    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const j = (y * S + x) * 4;
        const r = F[j], g = F[j + 1], b = F[j + 2], a = F[j + 3];
        if (a < 8) continue;
        if (isGreen(r, g, b)) {
          gCount++;
          greenTotal++;
          sumX += x;
          sumY += y;
          if (x < mnx) mnx = x;
          if (x > mxx) mxx = x;
          if (y < mny) mny = y;
          if (y > mxy) mxy = y;
          // slot mask: opaque white where subject lived
          slotSheet[base + j] = 255;
          slotSheet[base + j + 1] = 255;
          slotSheet[base + j + 2] = 255;
          slotSheet[base + j + 3] = 255;
          continue;
        }
        lCount++;
        layerTotal++;
        frontSheet[base + j] = r;
        frontSheet[base + j + 1] = g;
        frontSheet[base + j + 2] = b;
        frontSheet[base + j + 3] = a;
      }
    }

    if (gCount > 0) {
      union.x = Math.min(union.x, mnx);
      union.y = Math.min(union.y, mny);
      union.x2 = Math.max(union.x2, mxx);
      union.y2 = Math.max(union.y2, mxy);
      perFrame.push({
        x: mnx,
        y: mny,
        w: mxx - mnx + 1,
        h: mxy - mny + 1,
        cx: sumX / gCount,
        cy: sumY / gCount,
        greenPixels: gCount,
        visible: true,
        delayMs: frameDelays[f],
      });
    } else {
      // Subject gone this frame — user should disappear too.
      perFrame.push({
        x: 0, y: 0, w: 0, h: 0, cx: S / 2, cy: S / 2,
        greenPixels: 0, visible: false, delayMs: frameDelays[f],
      });
    }
  }

  const dir = join(OUT, id);
  mkdirSync(dir, { recursive: true });
  await sharp(frontSheet, { raw: { width: S, height: S * frames.length, channels: 4 } })
    .png()
    .toFile(join(dir, "front.png"));
  await sharp(slotSheet, { raw: { width: S, height: S * frames.length, channels: 4 } })
    .png()
    .toFile(join(dir, "slot.png"));

  const kind =
    greenTotal < 40 ? "no-slot" :
    layerTotal < 40 ? "transform-slot" :
    "layer";

  const avgDelay = Math.round(
    frameDelays.reduce((a, b) => a + b, 0) / Math.max(1, frameDelays.length),
  );

  // Motion amplitude: max centroid travel across visible frames (for tests/docs).
  const visible = perFrame.filter(p => p.visible);
  let motion = 0;
  if (visible.length >= 2) {
    const cxs = visible.map(p => p.cx);
    const cys = visible.map(p => p.cy);
    const areas = visible.map(p => p.w * p.h);
    motion = Math.hypot(
      Math.max(...cxs) - Math.min(...cxs),
      Math.max(...cys) - Math.min(...cys),
    );
    var areaRatio = Math.max(...areas) / Math.max(1, Math.min(...areas));
  } else {
    var areaRatio = 1;
  }

  const meta = {
    id,
    kind,
    frames: frames.length,
    sourcePages: pages,
    delayMs: avgDelay,
    size: S,
    // Legacy union bbox (fallback only).
    slot: greenTotal >= 40 ? {
      x: union.x, y: union.y,
      w: Math.max(1, union.x2 - union.x + 1),
      h: Math.max(1, union.y2 - union.y + 1),
      greenPixels: greenTotal,
    } : null,
    perFrame,
    motionPx: Math.round(motion * 10) / 10,
    areaRatio: Math.round(areaRatio * 100) / 100,
    layerPixels: layerTotal,
    source: `greenscreen/raw/${file}`,
    animationMode: "per-frame-slot-mask",
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
  const index = { builtAt: new Date().toISOString(), size: S, items: {}, animationMode: "per-frame-slot-mask" };
  let n = 0;
  for (const file of files) {
    const id = file.replace(/\.(gif|png|webp|jpe?g)$/i, "");
    process.stdout.write(`build ${id}… `);
    try {
      const meta = await processGif(file, id);
      index.items[id] = {
        id: meta.id, kind: meta.kind, frames: meta.frames, delayMs: meta.delayMs,
        motionPx: meta.motionPx, areaRatio: meta.areaRatio, source: meta.source,
      };
      console.log(`${meta.kind} frames=${meta.frames} motion=${meta.motionPx}px area×${meta.areaRatio}`);
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
