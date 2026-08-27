// ─────────────────────────────────────────────────────────────────────────────
// Emojimoji effects — replay the uploaded emoji-pack animations over the user's
// own image and encode a small, TRANSPARENT looping GIF.
//
// Nothing here is hand-drawn: every effect is a template extracted from the
// packs by scripts/build-emoji-*.mjs (packs.json + decoration sheets). A
// template is an ordered list of layers — back overlay → the user image (with an
// optional per-frame transform) → front overlay(s) — so a moving base plus one
// or more independent overlays keeps its z-order. The pack's own base face is
// never used; the user's image is what gets animated.
//
// Pipeline notes (perf / quality):
//   • Templates are authored at TILE (128). We compose directly at OUT (≥ TILE)
//     by scaling bb / pivots / transforms, so we never downscale a finished frame
//     and never upscale soft 96px output.
//   • One reused canvas + one getImageData per frame (no TILE→OUT blit, no second
//     pixel read before encode).
//   • Source buffers should arrive already normalized (see command.ts); we still
//     accept any PNG and decode once per render call.
// ─────────────────────────────────────────────────────────────────────────────

import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import type { Image } from "@napi-rs/canvas";
import { getCanvas, type Ctx, type CanvasMod } from "../animations/engine.js";
import { encodeTransparentGif } from "./encode.js";

/** Final GIF edge length. Templates are authored at TILE (128). Matching OUT to
 *  TILE avoids a quality-destroying downscale (old path: 128→96) and avoids
 *  upscaling pack overlays (160–192). Bench: 128 is the sweet spot for
 *  sharper-than-96 output without the ~2× encode cost of 160. */
export const OUT = 128;

/** Max longest-edge for the user source before render. Preserves native size
 *  when smaller; never upscales; only downscales large inputs (~2× OUT). */
export const SRC_MAX = 256;

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
/** Inset the whole composition by a margin so full-tile overlays (explosions,
 *  lasers, throws) never touch — and get clipped at — the frame edge. The GIF
 *  stays OUT×OUT; content is drawn into the INNER box, offset by MARGIN. */
const MARGIN = Math.round(OUT * 0.08);
const INNER = OUT - MARGIN * 2;
/** Scale from template tile space → inner (inset) output pixels. */
const S = INNER / TILE;

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
  const bw = (bx1 - bx0) * S, bh = (by1 - by0) * S;
  const obx = bx0 * S, oby = by0 * S;
  const [px0, py0] = tpl.pivot ?? PIVOT;
  const px = px0 * S, py = py0 * S;

  // Compose every frame first (with real alpha), so we can choose a transparent
  // key colour that is FAR from the actual content — otherwise gifencoder maps
  // the key to a near-by content colour (pink/red) and the background leaks.
  // Reuse one canvas; keep a copy of each frame's pixels (one read per frame).
  const cell = mod.createCanvas(OUT, OUT);
  const ctx = cell.getContext("2d") as unknown as Ctx;
  const frameData: Uint8ClampedArray[] = [];

  for (let f = 0; f < tpl.frames; f++) {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
    ctx.clearRect(0, 0, OUT, OUT);
    // Inset everything by MARGIN: subject bb, pivots, transforms and overlays are
    // all authored in tile space (0..TILE) scaled by S into the INNER box.
    ctx.translate(MARGIN, MARGIN);

    for (const L of tpl.layers) {
      if (L.kind === "base") {
        const t = tpl.transforms?.[f];
        if (t && t[1] <= 0.001) continue; // scale 0 → user hidden this frame
        ctx.save();
        if (t) {
          // [theta, sx, sy, cx, cy] (non-uniform, e.g. petpet squish) or the
          // shorter [theta, scale, cx, cy] (uniform). Coordinates are in TILE
          // space and scaled to OUT so composition matches the templates.
          const th = t[0]!;
          const sx = t.length >= 5 ? t[1]! : t[1]!;
          const sy = t.length >= 5 ? t[2]! : t[1]!;
          const cx = (t.length >= 5 ? t[3]! : t[2]!) * S;
          const cy = (t.length >= 5 ? t[4]! : t[3]!) * S;
          ctx.translate(cx, cy); ctx.rotate(th); ctx.scale(sx, sy); ctx.translate(-px, -py);
        }
        ctx.drawImage(user, 0, 0, user.width, user.height, obx, oby, bw, bh);
        if (tpl.hueCycle) {
          // Cycle the image's colours: tint to a rotating hue, masked to the
          // image's own alpha so the transparent background stays transparent.
          const hue = Math.floor((f / tpl.frames) * 360);
          ctx.globalCompositeOperation = "color";
          ctx.fillStyle = `hsl(${hue},100%,50%)`;
          ctx.fillRect(obx, oby, bw, bh);
          ctx.globalCompositeOperation = "destination-in";
          ctx.drawImage(user, 0, 0, user.width, user.height, obx, oby, bw, bh);
          ctx.globalCompositeOperation = "source-over";
        }
        ctx.restore();
      } else if (L.sheet) {
        const sheet = sheets.get(L.sheet);
        // Sheets are TILE×(TILE·frames); scale the cell into the INNER box (the
        // ctx is already translated by MARGIN, so this lands inset from the edge).
        if (sheet) ctx.drawImage(sheet, 0, f * TILE, TILE, TILE, 0, 0, INNER, INNER);
      }
    }

    const d = ctx.getImageData(0, 0, OUT, OUT).data;
    // Snapshot pixels (getImageData buffer is reused by Skia on the next call).
    frameData.push(d.slice());
  }

  return encodeTransparentGif(frameData, OUT, OUT, tpl.delayMs);
}
