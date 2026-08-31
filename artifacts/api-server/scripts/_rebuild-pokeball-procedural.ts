/**
 * Rebuild closed pokéball overlays with crisp SVG art + a real face window.
 *
 * MakeEmoji HQ prerenders are 112×112 palette GIFs — extracts look crunchy at 128.
 * Track ball pose from those GIFs, draw a fresh SVG pokéball (sharp/librsvg AA),
 * and punch a soft subject window (rim + band + button kept).
 *
 * pokeball-emerge keeps official CDN frames.
 */
import sharp from "sharp";
import {
  mkdirSync, existsSync, readdirSync, unlinkSync, writeFileSync, readFileSync,
} from "node:fs";
import { join } from "node:path";

const OUT = "/workspace/artifacts/emoji-offline";
const SIZE = 128;
const HQ_DIR = "/tmp/me-hq";
const STYLES = ["pokeball-go", "pokeball-capture", "pokeball-almost"] as const;

function isBallPaint(r: number, g: number, b: number, a: number): boolean {
  if (a < 40) return false;
  if (r > 130 && g < 110 && b < 110) return true;
  if (r > 180 && g > 140 && b > 140 && r - g < 50) return true;
  if (r > 185 && g > 185 && b > 185) return true;
  if (r < 55 && g < 55 && b < 55) return true;
  if (Math.abs(r - g) < 28 && Math.abs(g - b) < 28 && r >= 55 && r <= 200) return true;
  return false;
}

function looksLikeCat(r: number, g: number, b: number, a: number): boolean {
  if (a < 40) return false;
  if (r > 205 && g > 155 && b > 95 && b < 210 && g < 235 && r - b > 30) return true;
  if (r > 175 && g > 75 && g < 195 && b < 145 && r - g < 120 && g - b > 15) return true;
  if (r > 140 && r < 210 && g > 55 && g < 140 && b < 100 && g > b + 10 && r > g + 25) return true;
  return false;
}

interface BallPose {
  cx: number;
  cy: number;
  radius: number;
  holeFrac: number;
}

function detectPose(data: Buffer, w: number, h: number): BallPose {
  let minX = w, minY = h, maxX = 0, maxY = 0, ballN = 0;
  let catN = 0, catMinX = w, catMinY = h, catMaxX = 0, catMaxY = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4;
      const r = data[o]!, g = data[o + 1]!, b = data[o + 2]!, a = data[o + 3]!;
      if (isBallPaint(r, g, b, a)) {
        ballN++;
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      } else if (looksLikeCat(r, g, b, a)) {
        catN++;
        if (x < catMinX) catMinX = x;
        if (y < catMinY) catMinY = y;
        if (x > catMaxX) catMaxX = x;
        if (y > catMaxY) catMaxY = y;
      }
    }
  }
  if (ballN < 80) {
    return { cx: w / 2, cy: h / 2, radius: Math.min(w, h) * 0.42, holeFrac: 0.58 };
  }
  const radius = Math.max(maxX - minX + 1, maxY - minY + 1) / 2;
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  let holeFrac = 0.58;
  if (catN > 60) {
    const catSpan = Math.max(catMaxX - catMinX + 1, catMaxY - catMinY + 1);
    holeFrac = Math.min(0.72, Math.max(0.48, (catSpan * 0.55) / Math.max(1, radius)));
  }
  // Keep a few px of transparent margin so Discord crop never clips chrome.
  const margin = 3;
  const maxR = Math.min(cx - margin, cy - margin, w - 1 - cx - margin, h - 1 - cy - margin);
  return { cx, cy, radius: Math.min(radius, Math.max(8, maxR)), holeFrac };
}

function ballSvg(pose: BallPose, size: number): string {
  const { cx, cy, radius: R } = pose;
  const stroke = Math.max(1.5, R * 0.045);
  const bandH = Math.max(2.5, R * 0.12);
  const btnOuter = Math.max(3, R * 0.22);
  const btnMid = btnOuter * 0.78;
  const btnInner = btnOuter * 0.55;
  const hx = cx - R * 0.28;
  const hy = cy - R * 0.38;
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <defs>
    <clipPath id="ball"><circle cx="${cx}" cy="${cy}" r="${R}"/></clipPath>
    <linearGradient id="red" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#ff6b6b"/>
      <stop offset="35%" stop-color="#e62812"/>
      <stop offset="100%" stop-color="#c41e0a"/>
    </linearGradient>
    <linearGradient id="white" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#f5f5f5"/>
      <stop offset="60%" stop-color="#ffffff"/>
      <stop offset="100%" stop-color="#d8d8d8"/>
    </linearGradient>
  </defs>
  <g clip-path="url(#ball)">
    <rect x="${cx - R - 1}" y="${cy - R - 1}" width="${R * 2 + 2}" height="${R + 1}" fill="url(#red)"/>
    <rect x="${cx - R - 1}" y="${cy}" width="${R * 2 + 2}" height="${R + 1}" fill="url(#white)"/>
    <ellipse cx="${hx}" cy="${hy}" rx="${R * 0.32}" ry="${R * 0.18}" transform="rotate(-25 ${hx} ${hy})" fill="rgba(255,255,255,0.35)"/>
    <rect x="${cx - R}" y="${cy - bandH / 2}" width="${R * 2}" height="${bandH}" fill="#1a1a1a"/>
  </g>
  <circle cx="${cx}" cy="${cy}" r="${R - stroke / 2}" fill="none" stroke="#1a1a1a" stroke-width="${stroke}"/>
  <circle cx="${cx}" cy="${cy}" r="${btnOuter}" fill="#1a1a1a"/>
  <circle cx="${cx}" cy="${cy}" r="${btnMid}" fill="#f0f0f0"/>
  <circle cx="${cx}" cy="${cy}" r="${btnInner}" fill="#ffffff" stroke="#1a1a1a" stroke-width="${Math.max(1, R * 0.03)}"/>
</svg>`;
}

async function rasterBall(pose: BallPose, size: number): Promise<Buffer> {
  return sharp(Buffer.from(ballSvg(pose, size)))
    .resize(size, size)
    .ensureAlpha()
    .png()
    .toBuffer();
}

async function punchHole(png: Buffer, pose: BallPose): Promise<Buffer> {
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const w = info.width;
  const h = info.height;
  const out = Buffer.from(data);
  const holeR = pose.radius * pose.holeFrac;
  const rimInner = pose.radius * 0.88;
  const bandHalf = Math.max(2.2, pose.radius * 0.065);
  const btnKeep = pose.radius * 0.26;
  const feather = Math.max(1.5, pose.radius * 0.045);

  const buttonBackup: { i: number; r: number; g: number; b: number; a: number }[] = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const dx = x + 0.5 - pose.cx;
      const dy = y + 0.5 - pose.cy;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist <= btnKeep && out[i + 3]! > 8) {
        buttonBackup.push({ i, r: out[i]!, g: out[i + 1]!, b: out[i + 2]!, a: out[i + 3]! });
      }
    }
  }

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      if (out[i + 3]! < 8) continue;
      const dx = x + 0.5 - pose.cx;
      const dy = y + 0.5 - pose.cy;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (dist >= rimInner) continue;
      if (Math.abs(dy) <= bandHalf && dist <= pose.radius) continue;
      if (dist <= btnKeep) continue;

      let clear = 0;
      if (dist <= holeR - feather) clear = 1;
      else if (dist < holeR + feather) {
        clear = Math.max(0, Math.min(1, (holeR + feather - dist) / (2 * feather)));
      }
      if (clear > 0) {
        out[i + 3] = Math.round(out[i + 3]! * (1 - clear));
        if (out[i + 3]! < 8) {
          out[i] = out[i + 1] = out[i + 2] = out[i + 3] = 0;
        }
      }
    }
  }

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const dx = x + 0.5 - pose.cx;
      const dy = y + 0.5 - pose.cy;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist > pose.radius + 1.5) {
        out[i] = out[i + 1] = out[i + 2] = out[i + 3] = 0;
      } else if (dist > pose.radius - 0.8 && out[i + 3]! > 0) {
        const t = Math.max(0, Math.min(1, (pose.radius + 0.6 - dist) / 1.4));
        out[i + 3] = Math.round(out[i + 3]! * t);
      }
    }
  }

  for (const p of buttonBackup) {
    out[p.i] = p.r;
    out[p.i + 1] = p.g;
    out[p.i + 2] = p.b;
    out[p.i + 3] = p.a;
  }

  return sharp(out, { raw: { width: w, height: h, channels: 4 } }).png().toBuffer();
}

async function rebuild(style: string): Promise<number> {
  const gifPath = join(HQ_DIR, `default-cat_${style}.gif`);
  if (!existsSync(gifPath)) throw new Error(`missing ${gifPath}`);
  const meta = await sharp(gifPath, { animated: true }).metadata();
  const pages = meta.pages ?? 1;
  const dir = join(OUT, "assets", "frames", style);
  mkdirSync(dir, { recursive: true });
  for (const f of readdirSync(dir)) {
    if (f.endsWith(".png")) unlinkSync(join(dir, f));
  }

  for (let p = 0; p < pages; p++) {
    const up = await sharp(gifPath, { page: p })
      .ensureAlpha()
      .resize(SIZE, SIZE, {
        fit: "contain",
        background: { r: 0, g: 0, b: 0, alpha: 0 },
        kernel: "lanczos3",
      })
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });

    const pose = detectPose(Buffer.from(up.data), up.info.width, up.info.height);
    const punched = await punchHole(await rasterBall(pose, SIZE), pose);
    writeFileSync(join(dir, `frame_${String(p + 1).padStart(4, "0")}.png`), punched);
  }
  return pages;
}

async function main() {
  for (const id of STYLES) {
    const n = await rebuild(id);
    console.log(`${id}: ${n} procedural AA frames (with face window)`);
  }

  const recipesPath = join(OUT, "recipes", "recipes.json");
  const recipes = JSON.parse(readFileSync(recipesPath, "utf8")) as Array<Record<string, unknown>>;
  for (const style of ["pokeball-emerge", ...STYLES]) {
    const r = recipes.find(x => x.id === style || x.slug === style);
    if (!r) continue;
    r.family = "frames";
    r.primitive = "frames";
    r.assets = { framesHint: style };
    r.offlineReady = true;
    if (style === "pokeball-emerge") {
      r.fidelity = "makeemoji-cdn-frames";
      r.notes = [
        "Full CDN frame set from assets.makeemoji.com/frames/pokeball-emerge/",
        "Near-opaque AA edges preserved for GIF encoding",
      ];
    } else {
      r.fidelity = "procedural-aa-tracked";
      r.notes = [
        "Crisp SVG pokéball (librsvg AA) posed from MakeEmoji HQ prerender motion",
        "Soft face window with rim/band/button preserved — avoids GIF-extract pixelation",
      ];
    }
  }
  writeFileSync(recipesPath, JSON.stringify(recipes, null, 2) + "\n");
  console.log("recipes updated");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
