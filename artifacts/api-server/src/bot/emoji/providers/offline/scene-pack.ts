// ─────────────────────────────────────────────────────────────────────────────
// Scene packs — green/blue-screen mini-scenes for /emoji.
//
// Unlike the MakeEmoji layer packs (a green subject sized to a small emoji), a
// scene pack is a whole clip that plays out at its native size: a movie theater,
// an explosion, a TV, someone holding a card. Part of the frame is a green (or
// blue) screen; the user's target image is composited INTO that region and the
// rest of the scene — actors, text, effects — stays on top. Nothing is cropped;
// the whole scene plays.
//
// Pipeline per frame:
//   1) decode the source frame (gifuct)
//   2) key the chroma to transparent  → that's the foreground chrome
//   3) fit the target into the chroma region's per-frame bbox (tracks zoom/pan)
//   4) draw target behind, foreground on top, plus the style's effect
//
// Effects layer extra motion on the TARGET: explode, shake, cut, rip, punch
// (+ fake blood), channel (TV-static reveal), fuzzytv (static overlay).
// ─────────────────────────────────────────────────────────────────────────────

import GIFEncoder from "gifencoder";
import sharp from "sharp";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { getCanvas, type CanvasMod } from "../../../animations/engine.js";
import { logger } from "../../../../lib/logger.js";
import { EmojiError } from "../../utils/errors.js";
import { offlinePackageRoot } from "./registry.js";

export type SceneChroma = "green" | "blue";
export type SceneEffect =
  | "none" | "explode" | "shake" | "fuzzytv" | "cut" | "rip" | "punch" | "channel";
export type SceneFit = "cover" | "stretch";

export interface SceneConfig {
  id: string;
  label: string;
  chroma: SceneChroma;
  effect: SceneEffect;
  fit: SceneFit;
}

interface ScenesFile { scenes: SceneConfig[] }

/** Value prefix that marks a style as a scene pack (vs a MakeEmoji style). */
export const SCENE_PREFIX = "scene:";

/** Frame ceilings — full quality vs the small board thumbnail. */
const FULL_MAX_FRAMES = 30;
const THUMB_MAX_FRAMES = 12;
/**
 * Long edges. The board thumbnail is tiny for responsiveness. The full render is
 * capped too — not to crop (nothing is cropped), but to keep the whole-scene GIF
 * a reasonable size to share. 360px reads crisp at Discord's display size while
 * keeping files roughly half of a 600px render (worst case ~1.5 MB, most < 1 MB).
 */
const THUMB_LONG_EDGE = 150;
const FULL_LONG_EDGE = 360;

let cache: { list: SceneConfig[]; byId: Map<string, SceneConfig>; dir: string } | null | undefined;

/** Directory holding the scene GIFs + scenes.json, or null when unavailable. */
function scenesDir(): string | null {
  const root = offlinePackageRoot();
  if (!root) return null;
  const dir = join(root, "scenes");
  return existsSync(join(dir, "scenes.json")) ? dir : null;
}

/** Load and cache the scene catalog. */
export function loadScenes(): { list: SceneConfig[]; byId: Map<string, SceneConfig>; dir: string } | null {
  if (cache !== undefined) return cache;
  const dir = scenesDir();
  if (!dir) { cache = null; return null; }
  try {
    const parsed = JSON.parse(readFileSync(join(dir, "scenes.json"), "utf8")) as ScenesFile;
    const list = parsed.scenes.filter(s => existsSync(join(dir, `${s.id}.gif`)));
    const byId = new Map(list.map(s => [s.id, s]));
    cache = { list, byId, dir };
    return cache;
  } catch (err) {
    logger.warn({ err }, "scene catalog failed to load");
    cache = null;
    return null;
  }
}

/** Test/reload helper. */
export function reloadScenes(): void { cache = undefined; }

/** The scene id for an animation value, or null when it isn't a scene. */
export function sceneIdOf(animation: string): string | null {
  if (!animation) return null;
  const id = animation.startsWith(SCENE_PREFIX) ? animation.slice(SCENE_PREFIX.length) : animation;
  return loadScenes()?.byId.has(id) ? id : null;
}

/** Every scene as `{ value: "scene:<id>", label }`, in featured order. */
export function sceneStyleEntries(): { value: string; label: string }[] {
  return loadScenes()?.list.map(s => ({ value: `${SCENE_PREFIX}${s.id}`, label: s.label })) ?? [];
}

/** True when an animation value refers to a scene pack. */
export function isSceneAnimation(animation: string): boolean {
  return sceneIdOf(animation) != null;
}

/** Friendly label for a scene animation value, or null when it isn't a scene. */
export function sceneLabelOf(animation: string): string | null {
  const id = sceneIdOf(animation);
  return id ? (loadScenes()?.byId.get(id)?.label ?? id) : null;
}

// ── Chroma keys ──────────────────────────────────────────────────────────────
const isGreen = (r: number, g: number, b: number) => g > 90 && g - r > 40 && g - b > 40;
// Saturated screen blue only — pale sky/cloud blue has high R and G.
const isBlue = (r: number, g: number, b: number) => b > 110 && r < 120 && g < 130 && b - r > 60 && b - g > 55;

interface Ctx2D {
  fillStyle: string; globalAlpha: number; font: string; textAlign: string; textBaseline: string;
  clearRect(x: number, y: number, w: number, h: number): void;
  fillRect(x: number, y: number, w: number, h: number): void;
  createImageData(w: number, h: number): { data: Uint8ClampedArray };
  putImageData(d: { data: Uint8ClampedArray }, x: number, y: number): void;
  getImageData(x: number, y: number, w: number, h: number): { data: Uint8ClampedArray };
  drawImage(img: unknown, ...a: number[]): void;
  save(): void; restore(): void;
  beginPath(): void; ellipse(x: number, y: number, rx: number, ry: number, rot: number, s: number, e: number): void; fill(): void;
}

interface Frame { data: Uint8ClampedArray; delay: number }

interface Box { x: number; y: number; w: number; h: number; absent: boolean }

/** Seeded RNG so blood/static are stable per frame but accumulate. */
function mulberry(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface RenderSceneOptions {
  /** Board thumbnail edge (small preview); omitted = full native quality. */
  size?: number;
}

/**
 * Composite `image` into scene `id`, returning an animated GIF. Full native size
 * by default; a smaller, fewer-framed preview when `size` is given (the board).
 */
export async function renderScene(
  image: Buffer, id: string, opts: RenderSceneOptions = {},
): Promise<Buffer> {
  const scenes = loadScenes();
  const cfg = scenes?.byId.get(id.startsWith(SCENE_PREFIX) ? id.slice(SCENE_PREFIX.length) : id);
  if (!scenes || !cfg) throw new EmojiError("unknown_effect", `\`${id}\` is not a known scene.`);

  const mod = await getCanvas();
  if (!mod) throw new EmojiError("internal", "Canvas backend unavailable for scene rendering.");

  const target = await mod.loadImage(image);
  const key = cfg.chroma === "blue" ? isBlue : isGreen;

  // Extract only the frames we need, already scaled to the output size, in a
  // single native (sharp) decode — far cheaper than compositing every source
  // frame at full resolution.
  const path = join(scenes.dir, `${cfg.id}.gif`);
  const src = await sharp(path, { animated: true }).metadata();
  const pages = src.pages ?? 1;
  const srcW = src.width ?? 1, srcH = src.pageHeight ?? src.height ?? 1;
  const delays = (src.delay ?? []) as number[];

  const longEdge = opts.size ? THUMB_LONG_EDGE : FULL_LONG_EDGE;
  const scale = Math.min(1, longEdge / Math.max(srcW, srcH));
  const W = Math.max(1, Math.round(srcW * scale)), H = Math.max(1, Math.round(srcH * scale));
  const N = Math.min(pages, opts.size ? THUMB_MAX_FRAMES : FULL_MAX_FRAMES);
  const pick = Array.from({ length: N }, (_, i) => Math.round(i * (pages - 1) / (Math.max(1, N - 1))));

  // One decode: the whole animation resized to width W, pages stacked vertically.
  const stacked = await sharp(path, { animated: true })
    .resize({ width: W }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const pageH = Math.round(stacked.info.height / pages);
  const frames: Frame[] = pick.map(p => {
    const start = p * pageH * W * 4;
    return {
      data: stacked.data.subarray(start, start + pageH * W * 4) as unknown as Uint8ClampedArray,
      delay: delays[p] && delays[p]! > 0 ? delays[p]! : 80,
    };
  });
  const H2 = pageH; // actual per-page height sharp produced

  // Per-frame chroma bbox (on the picked frames), EMA-smoothed.
  const boxes: (Box | null)[] = frames.map(f => {
    const d = f.data; let minX = W, minY = H2, maxX = -1, maxY = -1, cnt = 0;
    for (let y = 0; y < H2; y++) for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      if (key(d[i]!, d[i + 1]!, d[i + 2]!)) {
        cnt++; if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y;
      }
    }
    if (cnt < W * H2 * 0.004) return null;
    return { x: minX, y: minY, w: maxX - minX, h: maxY - minY, absent: false };
  });
  const smooth: (Box | null)[] = [];
  let last: Box | null = null;
  for (const b of boxes) {
    if (!b) { smooth.push(last ? { ...last, absent: true } : null); continue; }
    if (!last) last = b;
    const a = 0.5;
    last = {
      x: last.x + (b.x - last.x) * a, y: last.y + (b.y - last.y) * a,
      w: last.w + (b.w - last.w) * a, h: last.h + (b.h - last.h) * a, absent: false,
    };
    smooth.push({ ...last });
  }

  let explodeStart: number | null = null;
  if (cfg.effect === "explode") {
    for (let k = 0; k < frames.length; k++) {
      const d = frames[k]!.data; let fire = 0;
      for (let i = 0; i < d.length; i += 4) if (d[i]! > 180 && d[i + 1]! > 80 && d[i + 1]! < 190 && d[i + 2]! < 90) fire++;
      if (fire > W * H2 * 0.02) { explodeStart = k; break; }
    }
  }
  let revealAt = 0;
  for (let i = 0; i < smooth.length; i++) { const s = smooth[i]; if (s && !s.absent) { revealAt = i; break; } }

  const encoder = new GIFEncoder(W, H2);
  encoder.start(); encoder.setRepeat(0); encoder.setQuality(opts.size ? 12 : 10);

  const canvas = mod.createCanvas(W, H2);
  const ctx = canvas.getContext("2d") as unknown as Ctx2D;
  const fgCanvas = mod.createCanvas(W, H2);
  const fgctx = fgCanvas.getContext("2d") as unknown as Ctx2D;

  for (let f = 0; f < frames.length; f++) {
    const frame = frames[f]!;
    // Foreground = frame with chroma keyed out + light despill.
    const fg = new Uint8ClampedArray(frame.data);
    for (let i = 0; i < fg.length; i += 4) {
      if (key(fg[i]!, fg[i + 1]!, fg[i + 2]!)) fg[i + 3] = 0;
      else if (cfg.chroma === "green" && fg[i + 1]! > fg[i]! && fg[i + 1]! > fg[i + 2]!) fg[i + 1] = Math.max(fg[i]!, fg[i + 2]!);
      else if (cfg.chroma === "blue" && fg[i + 2]! > fg[i]! && fg[i + 2]! > fg[i + 1]!) fg[i + 2] = Math.max(fg[i]!, fg[i + 1]!);
    }

    ctx.clearRect(0, 0, W, H2);
    ctx.fillStyle = "#000"; ctx.fillRect(0, 0, W, H2);

    const box = smooth[f];
    if (box && !box.absent) drawTarget(mod, ctx, target, box, cfg, f, frames.length, explodeStart, revealAt);

    const fgId = fgctx.createImageData(W, H2);
    fgId.data.set(fg);
    fgctx.putImageData(fgId, 0, 0);
    ctx.globalAlpha = 1;
    ctx.drawImage(fgCanvas as unknown, 0, 0);

    encoder.setDelay(frame.delay);
    encoder.addFrame(ctx as unknown as never);
  }
  encoder.finish();
  return encoder.out.getData();
}

/** Draw the target into the chroma box with the scene's fit + effect. */
function drawTarget(
  mod: CanvasMod, ctx: Ctx2D, target: { width: number; height: number },
  box: Box, cfg: SceneConfig, idx: number, total: number,
  explodeStart: number | null, revealAt: number,
): void {
  let tw: number, th: number, tx: number, ty: number;
  if (cfg.fit === "stretch") { tw = box.w; th = box.h; tx = box.x; ty = box.y; }
  else {
    const s = Math.max(box.w / target.width, box.h / target.height);
    tw = target.width * s; th = target.height * s;
    tx = box.x + (box.w - tw) / 2; ty = box.y + (box.h - th) / 2;
  }
  let alpha = 1, ox = 0, oy = 0, sc = 1;
  if (cfg.effect === "shake") { ox = 6 * Math.sin(idx * 0.9); oy = 4 * Math.cos(idx * 1.3); }
  if (cfg.effect === "punch") { ox = 11 * Math.sin(idx * 1.7); oy = 8 * Math.cos(idx * 2.3); }
  if (cfg.effect === "explode" && explodeStart != null && idx >= explodeStart) {
    const t = Math.min(1, (idx - explodeStart) / 8); sc = 1 + t * 0.7; alpha = 1 - t * 0.65;
    ox = Math.sin(idx * 7) * 18 * t; oy = Math.cos(idx * 5) * 18 * t;
  }

  ctx.save();
  ctx.globalAlpha = alpha;
  const cw = tw * sc, ch = th * sc;
  const dx = tx + ox - (cw - tw) / 2, dy = ty + oy - (ch - th) / 2;

  const chFlash = cfg.effect === "channel" && idx >= revealAt && idx < revealAt + 5;
  if (chFlash) {
    const r = mulberry(idx * 911);
    for (let s = 0; s < 900; s++) {
      const v = (r() * 255) | 0; ctx.fillStyle = `rgb(${v},${v},${v})`;
      ctx.fillRect(box.x + r() * box.w, box.y + r() * box.h, 2, 2);
    }
  } else if (cfg.effect === "cut" || cfg.effect === "rip") {
    const prog = idx / (total - 1);
    const cutT = Math.max(0, Math.min(1, (prog - 0.5) / 0.4));
    // Build the target on its own layer, then blit the halves apart with a gap.
    const lw = Math.max(1, Math.round(dx + cw) + 4);
    const lh = Math.max(1, Math.round(dy + ch) + 4);
    const layer = mod.createCanvas(lw, lh);
    const lctx = layer.getContext("2d") as unknown as Ctx2D;
    lctx.drawImage(target as unknown, dx, dy, cw, ch);
    const midX = Math.round(box.x + box.w / 2);
    const gap = box.w * (cfg.effect === "rip" ? 0.06 : 0.16) * cutT;
    const tear = cfg.effect === "rip" ? box.h * 0.03 * cutT : 0;
    ctx.drawImage(layer as unknown, 0, 0, midX, lh, -gap / 2, -tear, midX, lh);
    ctx.drawImage(layer as unknown, midX, 0, lw - midX, lh, midX + gap / 2, tear, lw - midX, lh);
  } else {
    ctx.drawImage(target as unknown, dx, dy, cw, ch);
  }

  if (cfg.effect === "punch") {
    const r = mulberry(4242);
    const nSpl = Math.floor(4 + (idx / (total - 1)) * 26);
    for (let s = 0; s < nSpl; s++) {
      const px = box.x + r() * box.w, py = box.y + r() * box.h, rad = 3 + r() * 15;
      ctx.globalAlpha = (0.5 + r() * 0.45) * alpha;
      ctx.fillStyle = r() > 0.3 ? "#7a0b0b" : "#b01414";
      ctx.beginPath(); ctx.ellipse(px, py, rad, rad * (0.6 + r() * 0.8), r() * 6, 0, 7); ctx.fill();
      if (r() > 0.7) ctx.fillRect(px - 1, py, 2 + r() * 2, rad + r() * 22);
    }
    ctx.globalAlpha = alpha;
  }
  if (cfg.effect === "fuzzytv" || (cfg.effect === "channel" && !chFlash)) {
    const r = mulberry(idx * 17 + 3);
    ctx.globalAlpha = (cfg.effect === "fuzzytv" ? 0.18 : 0.12) * alpha;
    for (let s = 0; s < 34; s++) {
      ctx.fillStyle = r() > 0.5 ? "#fff" : "#000";
      ctx.fillRect(box.x, box.y + r() * box.h, box.w, 1 + r() * 2);
    }
    ctx.globalAlpha = alpha;
  }
  ctx.restore();
}
