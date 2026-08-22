// ─────────────────────────────────────────────────────────────────────────────
// Emojimoji effects — replay the uploaded emoji-pack animations over the user's
// own image and encode a small, TRANSPARENT looping GIF.
//
// Nothing here is hand-drawn: every effect is a template extracted from the
// packs by scripts/build-emoji-packs.mjs (packs.json + decoration sheets). A
// template is an ordered list of layers — back overlay → the user image (with an
// optional per-frame transform) → front overlay(s) — so a moving base plus one
// or more independent overlays keeps its z-order. The pack's own base face is
// never used; the user's image is what gets animated.
// ─────────────────────────────────────────────────────────────────────────────

import GIFEncoder from "gifencoder";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import type { Image } from "@napi-rs/canvas";
import { getCanvas, type Ctx, type CanvasMod } from "../animations/engine.js";

const OUT = 96;          // sent/preview size — emoji-scale, not sticker-scale

// ── template data (generated) ────────────────────────────────────────────────
interface Layer { kind: "overlay" | "base"; sheet?: string }
interface Template {
  id: string; name: string; emoji: string; desc: string;
  frames: number; delayMs: number;
  transforms: number[][] | null;  // per-frame [theta, scale, cx, cy] for the base layer
  layers: Layer[];
  bb?: number[];                  // per-effect subject slot [x0,y0,x1,y1] (else manifest.base.bb)
  pivot?: number[];               // per-effect transform pivot (else manifest.base.pivot)
  hueCycle?: boolean;             // cycle the user image's colours over the loop (rainbow)
}
interface Manifest { tile: number; base: { bb: number[]; pivot: number[] }; effects: Template[] }

/** Public, lightweight descriptor used by the picker UI. */
export interface EmojiEffect { id: string; name: string; emoji: string; desc: string }

function assetsDir(): string | null {
  const tries = [
    fileURLToPath(new URL("../../../assets/emojimoji/", import.meta.url)),
    join(process.cwd(), "assets/emojimoji"),
    join(process.cwd(), "artifacts/api-server/assets/emojimoji"),
  ];
  return tries.find((p) => existsSync(join(p, "packs.json"))) ?? null;
}

const DIR = assetsDir();
const MANIFEST: Manifest = (() => {
  try { if (DIR) return JSON.parse(readFileSync(join(DIR, "packs.json"), "utf8")); } catch { /* fall through */ }
  return { tile: 128, base: { bb: [0, 0, 128, 128], pivot: [64, 64] }, effects: [] };
})();
const TILE = MANIFEST.tile;
const BASE_BB = MANIFEST.base.bb;
const PIVOT = MANIFEST.base.pivot;
const TEMPLATES = new Map(MANIFEST.effects.map((e) => [e.id, e]));

export const EMOJI_EFFECTS: EmojiEffect[] =
  MANIFEST.effects.map((e) => ({ id: e.id, name: e.name, emoji: e.emoji, desc: e.desc }));

// ── decoration sheets (cached) ───────────────────────────────────────────────
const sheetCache = new Map<string, Image | null>();
async function loadSheet(mod: CanvasMod, file: string): Promise<Image | null> {
  if (sheetCache.has(file)) return sheetCache.get(file)!;
  let img: Image | null = null;
  try { if (DIR) { const p = join(DIR, file); if (existsSync(p)) img = await mod.loadImage(readFileSync(p)); } } catch { img = null; }
  sheetCache.set(file, img);
  return img;
}

// ── rendering ────────────────────────────────────────────────────────────────
/** Render the user's image through the pack template `effectId`; transparent GIF. */
export async function renderEmojiGif(image: Buffer, effectId: string): Promise<Buffer | null> {
  const mod = await getCanvas();
  const tpl = TEMPLATES.get(effectId);
  if (!mod || !tpl) return null;

  let user: Image;
  try { user = await mod.loadImage(image); } catch { return null; }

  // preload this template's overlay sheets
  const sheets = new Map<string, Image | null>();
  for (const L of tpl.layers) if (L.kind === "overlay" && L.sheet && !sheets.has(L.sheet)) sheets.set(L.sheet, await loadSheet(mod, L.sheet));

  const [bx0, by0, bx1, by1] = tpl.bb ?? BASE_BB;
  const bw = bx1 - bx0, bh = by1 - by0;
  const [px, py] = tpl.pivot ?? PIVOT;

  // Compose every frame first (with real alpha), so we can choose a transparent
  // key colour that is FAR from the actual content — otherwise gifencoder maps
  // the key to a near-by content colour (pink/red) and the background leaks.
  const frames: Ctx[] = [];
  const content = new Set<number>();
  for (let f = 0; f < tpl.frames; f++) {
    const cell = mod.createCanvas(TILE, TILE);
    const ctx = cell.getContext("2d") as unknown as Ctx;
    for (const L of tpl.layers) {
      if (L.kind === "base") {
        const t = tpl.transforms?.[f];
        if (t && t[1] <= 0.001) continue; // scale 0 → user hidden this frame
        ctx.save();
        if (t) {
          // [theta, sx, sy, cx, cy] (non-uniform, e.g. petpet squish) or the
          // shorter [theta, scale, cx, cy] (uniform).
          const th = t[0]!;
          const sx = t.length >= 5 ? t[1]! : t[1]!;
          const sy = t.length >= 5 ? t[2]! : t[1]!;
          const cx = t.length >= 5 ? t[3]! : t[2]!;
          const cy = t.length >= 5 ? t[4]! : t[3]!;
          ctx.translate(cx, cy); ctx.rotate(th); ctx.scale(sx, sy); ctx.translate(-px, -py);
        }
        ctx.drawImage(user, 0, 0, user.width, user.height, bx0, by0, bw, bh);
        if (tpl.hueCycle) {
          // Cycle the image's colours: tint to a rotating hue, masked to the
          // image's own alpha so the transparent background stays transparent.
          const hue = Math.floor((f / tpl.frames) * 360);
          ctx.globalCompositeOperation = "color";
          ctx.fillStyle = `hsl(${hue},100%,50%)`;
          ctx.fillRect(bx0, by0, bw, bh);
          ctx.globalCompositeOperation = "destination-in";
          ctx.drawImage(user, 0, 0, user.width, user.height, bx0, by0, bw, bh);
          ctx.globalCompositeOperation = "source-over";
        }
        ctx.restore();
      } else if (L.sheet) {
        const sheet = sheets.get(L.sheet);
        if (sheet) ctx.drawImage(sheet, 0, f * TILE, TILE, TILE, 0, 0, TILE, TILE);
      }
    }
    const outCell = mod.createCanvas(OUT, OUT);
    const octx = outCell.getContext("2d") as unknown as Ctx;
    octx.drawImage(cell as unknown as Image, 0, 0, TILE, TILE, 0, 0, OUT, OUT);
    const d = octx.getImageData(0, 0, OUT, OUT).data;
    for (let i = 0; i < d.length; i += 4) if (d[i + 3]! >= 128) content.add(((d[i]! >> 4) << 8) | ((d[i + 1]! >> 4) << 4) | (d[i + 2]! >> 4));
    frames.push(octx);
  }
  const [kr, kg, kb] = pickKey(content);
  const keyInt = (kr << 16) | (kg << 8) | kb;

  const enc = new GIFEncoder(OUT, OUT);
  enc.start();
  enc.setRepeat(0);
  enc.setQuality(5);            // finer NeuQuant sampling so the key survives quantization
  enc.setDelay(tpl.delayMs);
  enc.setTransparent(keyInt);
  for (const octx of frames) {
    const img = octx.getImageData(0, 0, OUT, OUT);
    const d = img.data;
    // Hard 1-bit alpha: gifencoder forces every alpha==0 pixel to the transparent
    // palette index, so keep transparent areas at alpha 0 (with the content-far
    // key colour so they cluster into one palette entry). Opaque elsewhere.
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3]! < 128) { d[i] = kr; d[i + 1] = kg; d[i + 2] = kb; d[i + 3] = 0; }
      else d[i + 3] = 255;
    }
    octx.putImageData(img, 0, 0);
    enc.addFrame(octx as never);
  }
  enc.finish();
  return enc.out.getData();
}

// Candidate key colours; pick the one whose nearest content colour is farthest.
const KEY_CANDIDATES: [number, number, number][] = [
  [255, 0, 255], [0, 255, 0], [0, 255, 255], [255, 255, 0], [0, 0, 255],
  [255, 128, 0], [128, 0, 255], [0, 255, 128], [255, 0, 128], [128, 255, 0],
];
function pickKey(content: Set<number>): [number, number, number] {
  let best: [number, number, number] = KEY_CANDIDATES[0]!, bestDist = -1;
  for (const cand of KEY_CANDIDATES) {
    let near = Infinity;
    for (const c of content) {
      const r = ((c >> 8) & 0xf) * 17, g = ((c >> 4) & 0xf) * 17, b = (c & 0xf) * 17;
      const dr = r - cand[0], dg = g - cand[1], db = b - cand[2];
      const dist = dr * dr + dg * dg + db * db;
      if (dist < near) near = dist;
    }
    if (near > bestDist) { bestDist = near; best = cand; }
  }
  return best;
}
