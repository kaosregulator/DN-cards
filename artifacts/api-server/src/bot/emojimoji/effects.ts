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

import sharp from "sharp";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import type { Image } from "@napi-rs/canvas";
import { getCanvas, type Ctx, type CanvasMod } from "../animations/engine.js";

const OUT = 96; // sent/preview size — emoji-scale, not sticker-scale

// ── template data (generated) ────────────────────────────────────────────────
interface Layer { kind: "overlay" | "base"; sheet?: string }
interface Template {
  id: string; name: string; emoji: string; desc: string;
  frames: number; delayMs: number;
  transforms: number[][] | null;  // per-frame [theta, scale, cx, cy] for the base layer
  layers: Layer[];
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

  const [bx0, by0, bx1, by1] = BASE_BB;
  const bw = bx1 - bx0, bh = by1 - by0;
  const [px, py] = PIVOT;

  const stacked = Buffer.alloc(OUT * OUT * tpl.frames * 4, 0);
  for (let f = 0; f < tpl.frames; f++) {
    const cell = mod.createCanvas(TILE, TILE);
    const ctx = cell.getContext("2d") as unknown as Ctx;
    for (const L of tpl.layers) {
      if (L.kind === "base") {
        ctx.save();
        const t = tpl.transforms?.[f];
        if (t) { const [th, sc, cx, cy] = t; ctx.translate(cx, cy); ctx.rotate(th); ctx.scale(sc, sc); ctx.translate(-px, -py); }
        ctx.drawImage(user, 0, 0, user.width, user.height, bx0, by0, bw, bh);
        ctx.restore();
      } else if (L.sheet) {
        const sheet = sheets.get(L.sheet);
        if (sheet) ctx.drawImage(sheet, 0, f * TILE, TILE, TILE, 0, 0, TILE, TILE);
      }
    }
    // downscale this frame into the output buffer
    const outCell = mod.createCanvas(OUT, OUT);
    const octx = outCell.getContext("2d") as unknown as Ctx;
    octx.drawImage(cell as unknown as Image, 0, 0, TILE, TILE, 0, 0, OUT, OUT);
    const data = octx.getImageData(0, 0, OUT, OUT).data;
    stacked.set(data, f * OUT * OUT * 4);
  }

  // assemble a real-alpha animated GIF (binary transparency — no colour key)
  try {
    return await sharp(stacked, { raw: { width: OUT, height: OUT * tpl.frames, channels: 4 }, animated: true, pageHeight: OUT })
      .gif({ delay: Array(tpl.frames).fill(tpl.delayMs), loop: 0 })
      .toBuffer();
  } catch { return null; }
}
