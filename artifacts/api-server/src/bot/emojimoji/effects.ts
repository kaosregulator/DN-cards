// ─────────────────────────────────────────────────────────────────────────────
// Emojimoji — apply an animation effect to any image and encode it as a looping
// GIF sized for a Discord emoji. The effects are generic canvas transforms we
// implement ourselves (spin, shake, deal-with-it, …) — no third-party assets —
// so /emojimoji turns an upload / avatar / URL into an animated emote.
//
// Built on the bot's existing canvas loader (@napi-rs/canvas + gifencoder).
// ─────────────────────────────────────────────────────────────────────────────

import GIFEncoder from "gifencoder";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import type { Image } from "@napi-rs/canvas";
import { getCanvas, type Ctx, type CanvasMod } from "../animations/engine.js";

const SIZE = 128;                 // Discord animated-emoji canvas
const KEY = 0xff00ff;             // magenta → encoded as the transparent color
const KEY_CSS = "#ff00ff";

export interface EmojiEffect {
  id: string;
  name: string;
  emoji: string;
  desc: string;
  frames: number;
  delayMs: number;
  /** Draw one frame. `t` runs 0→1 over the loop; ctx is pre-cleared to the key color. */
  draw?: (ctx: Ctx, img: Image, t: number, mod: CanvasMod) => void;
  /** Overlay effect: composite this pre-extracted overlay sheet over the user image.
   *  Sheet is a 128×(128·frames) vertical strip under assets/emojimoji/<overlay>.png. */
  overlay?: string;
}

// ── overlay assets (extracted from the emoji packs, drawn over the user image) ──
function assetsDir(): string | null {
  const tries = [
    fileURLToPath(new URL("../../../assets/emojimoji/", import.meta.url)),
    join(process.cwd(), "assets/emojimoji"),
    join(process.cwd(), "artifacts/api-server/assets/emojimoji"),
  ];
  return tries.find((p) => existsSync(p)) ?? null;
}
const overlayCache = new Map<string, Image | null>();
async function loadOverlay(mod: CanvasMod, id: string): Promise<Image | null> {
  if (overlayCache.has(id)) return overlayCache.get(id)!;
  const dir = assetsDir();
  const file = dir ? join(dir, `${id}.png`) : null;
  let img: Image | null = null;
  try { if (file && existsSync(file)) img = await mod.loadImage(readFileSync(file)); } catch { img = null; }
  overlayCache.set(id, img);
  return img;
}

// ── drawing helpers ──────────────────────────────────────────────────────────
const C = SIZE / 2;
const TAU = Math.PI * 2;

/** Draw the source image centred and scaled to `fit` of the canvas. */
function base(ctx: Ctx, img: Image, fit = 0.84): void {
  const box = SIZE * fit;
  const scale = Math.min(box / img.width, box / img.height);
  const w = img.width * scale, h = img.height * scale;
  ctx.drawImage(img, (SIZE - w) / 2, (SIZE - h) / 2, w, h);
}

/** A tinted copy of the image (hue-rotated), masked to the image's own alpha. */
function tinted(mod: CanvasMod, img: Image, hue: number): import("@napi-rs/canvas").Canvas {
  const cv = mod.createCanvas(SIZE, SIZE);
  const c = cv.getContext("2d") as unknown as Ctx;
  base(c, img);
  c.globalCompositeOperation = "color";
  c.fillStyle = `hsl(${hue},100%,50%)`;
  c.fillRect(0, 0, SIZE, SIZE);
  c.globalCompositeOperation = "destination-in";
  base(c, img);
  c.globalCompositeOperation = "source-over";
  return cv;
}

function around(ctx: Ctx, cx: number, cy: number, fn: () => void): void {
  ctx.save(); ctx.translate(cx, cy); fn(); ctx.translate(-cx, -cy); ctx.restore();
}

// ── the effect library ───────────────────────────────────────────────────────
export const EMOJI_EFFECTS: EmojiEffect[] = [
  { id: "spin", name: "Spin", emoji: "🌀", desc: "Rotates around and around", frames: 24, delayMs: 40,
    draw: (ctx, img, t) => around(ctx, C, C, () => { ctx.rotate(t * TAU); base(ctx, img, 0.68); }) },
  { id: "spinrev", name: "Reverse Spin", emoji: "↩️", desc: "Spins the other way", frames: 24, delayMs: 40,
    draw: (ctx, img, t) => around(ctx, C, C, () => { ctx.rotate(-t * TAU); base(ctx, img, 0.68); }) },
  { id: "spin3d", name: "3D Flip", emoji: "🪙", desc: "Coin-flip around the vertical axis", frames: 24, delayMs: 45,
    draw: (ctx, img, t) => around(ctx, C, C, () => { const sx = Math.cos(t * TAU); ctx.scale(sx || 0.001, 1); base(ctx, img, 0.8); }) },
  { id: "shake", name: "Shake", emoji: "📳", desc: "Rapid jitter", frames: 12, delayMs: 30,
    draw: (ctx, img, t) => { ctx.translate(Math.sin(t * TAU * 3) * 6, Math.cos(t * TAU * 4) * 6); base(ctx, img); } },
  { id: "bounce", name: "Bounce", emoji: "⬆️", desc: "Hops up and down", frames: 20, delayMs: 40,
    draw: (ctx, img, t) => { ctx.translate(0, -Math.abs(Math.sin(t * TAU)) * SIZE * 0.16); base(ctx, img, 0.78); } },
  { id: "pulse", name: "Pulse", emoji: "💓", desc: "Zooms in and out", frames: 20, delayMs: 40,
    draw: (ctx, img, t) => around(ctx, C, C, () => { const s = 1 + Math.sin(t * TAU) * 0.16; ctx.scale(s, s); base(ctx, img, 0.72); }) },
  { id: "wobble", name: "Wobble", emoji: "🫨", desc: "Tilts side to side", frames: 20, delayMs: 40,
    draw: (ctx, img, t) => around(ctx, C, C, () => { ctx.rotate(Math.sin(t * TAU) * 0.28); base(ctx, img, 0.74); }) },
  { id: "slide", name: "Slide", emoji: "↔️", desc: "Glides left and right", frames: 20, delayMs: 40,
    draw: (ctx, img, t) => { ctx.translate(Math.sin(t * TAU) * SIZE * 0.22, 0); base(ctx, img, 0.78); } },
  { id: "squish", name: "Squish", emoji: "🟢", desc: "Glorp — squashes and stretches", frames: 18, delayMs: 40,
    draw: (ctx, img, t) => { const k = Math.sin(t * TAU); around(ctx, C, SIZE * 0.9, () => { ctx.scale(1 + k * 0.28, 1 - k * 0.28); base(ctx, img, 0.8); }); } },
  { id: "jello", name: "Jello", emoji: "🍮", desc: "Skew wobble", frames: 20, delayMs: 40,
    draw: (ctx, img, t) => { const k = Math.sin(t * TAU) * 0.35; ctx.transform(1, 0, k, 1, -k * C, 0); base(ctx, img, 0.76); } },
  { id: "party", name: "Party", emoji: "🎉", desc: "Flashing rainbow background", frames: 18, delayMs: 45,
    draw: (ctx, img, t) => { ctx.fillStyle = `hsl(${Math.floor(t * 360)},85%,55%)`; ctx.fillRect(0, 0, SIZE, SIZE); base(ctx, img, 0.82); } },
  { id: "rainbow", name: "Rainbow", emoji: "🌈", desc: "Cycles the image's colors", frames: 24, delayMs: 45,
    draw: (ctx, img, t, mod) => { ctx.drawImage(tinted(mod, img, Math.floor(t * 360)) as unknown as Image, 0, 0, SIZE, SIZE); } },
  { id: "glitch", name: "Glitch", emoji: "📺", desc: "RGB split + slice jitter", frames: 14, delayMs: 45,
    draw: (ctx, img, t) => {
      const j = (Math.sin(t * TAU * 5) * 5) | 0;
      ctx.globalCompositeOperation = "lighter";
      ctx.globalAlpha = 0.9; ctx.save(); ctx.translate(j, 0); base(ctx, img); ctx.restore();
      ctx.save(); ctx.translate(-j, 1); base(ctx, img); ctx.restore();
      ctx.globalAlpha = 1; ctx.globalCompositeOperation = "source-over";
    } },
  { id: "sparkle", name: "Sparkle", emoji: "✨", desc: "Twinkling sparkles", frames: 18, delayMs: 55,
    draw: (ctx, img, t) => {
      base(ctx, img, 0.82);
      for (let i = 0; i < 6; i++) {
        const seed = i * 97.13;
        const x = ((Math.sin(seed) * 0.5 + 0.5) * SIZE);
        const y = ((Math.cos(seed * 1.7) * 0.5 + 0.5) * SIZE);
        const tw = (Math.sin(t * TAU + i) * 0.5 + 0.5);
        const r = 2 + tw * 5;
        ctx.fillStyle = `rgba(255,255,${180 + (tw * 75) | 0},${tw})`;
        ctx.beginPath();
        for (let k = 0; k < 4; k++) { const a = k * (Math.PI / 2); ctx.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r); ctx.lineTo(x + Math.cos(a + Math.PI / 4) * r * 0.35, y + Math.sin(a + Math.PI / 4) * r * 0.35); }
        ctx.closePath(); ctx.fill();
      }
    } },
  // ── overlay effects: real pack art (extracted) composited over the user image ──
  // Only the *moving* pack overlays extract cleanly; the static ones (a foil hat,
  // a viewfinder frame) are drawn below so they render crisp with no base residue.
  { id: "dealwithit", name: "Deal With It", emoji: "🕶️", desc: "Sunglasses drop in", frames: 10, delayMs: 100, overlay: "dealwithit" },
  { id: "lasereyes", name: "Laser Eyes", emoji: "🔴", desc: "Laser beams from the eyes", frames: 10, delayMs: 50, overlay: "lasereyes" },
  { id: "caught", name: "Caught in 4K", emoji: "📸", desc: "Recording viewfinder frame", frames: 16, delayMs: 70,
    draw: (ctx, img, t) => { base(ctx, img, 0.92); drawViewfinder(ctx, t); } },
  { id: "tinfoil", name: "Tinfoil Hat", emoji: "🎩", desc: "Conspiracy foil hat", frames: 20, delayMs: 55,
    draw: (ctx, img, t) => { base(ctx, img, 0.9); drawFoilHat(ctx, t); } },
];

// ── hand-drawn static overlays ────────────────────────────────────────────────
/** A "recording" viewfinder: corner brackets, a blinking ● REC, and a 4K badge. */
function drawViewfinder(ctx: Ctx, t: number): void {
  const m = 8, L = 26, w = 4;
  ctx.fillStyle = "#ffffff";
  // four L-shaped corner brackets
  ctx.fillRect(m, m, L, w); ctx.fillRect(m, m, w, L);
  ctx.fillRect(SIZE - m - L, m, L, w); ctx.fillRect(SIZE - m - w, m, w, L);
  ctx.fillRect(m, SIZE - m - w, L, w); ctx.fillRect(m, SIZE - m - L, w, L);
  ctx.fillRect(SIZE - m - L, SIZE - m - w, L, w); ctx.fillRect(SIZE - m - w, SIZE - m - L, w, L);
  // blinking REC
  if (Math.sin(t * TAU * 2) > -0.2) {
    ctx.fillStyle = "#ff3b30";
    ctx.beginPath(); ctx.arc(m + 12, m + 16 + L, 5, 0, TAU); ctx.fill();
    ctx.fillStyle = "#ffffff"; ctx.font = "bold 13px sans-serif"; ctx.textBaseline = "middle";
    ctx.fillText("REC", m + 20, m + 16 + L);
  }
  // 4K badge
  ctx.fillStyle = "#ffffff"; ctx.font = "bold 16px sans-serif"; ctx.textAlign = "right"; ctx.textBaseline = "bottom";
  ctx.fillText("4K", SIZE - m - 6, SIZE - m - 6);
  ctx.textAlign = "left";
}

/** A crumpled tin-foil hat sitting on top of the head, with a moving shimmer. */
function drawFoilHat(ctx: Ctx, t: number): void {
  const cx = C, topY = 4, baseY = 46, halfW = 40;
  ctx.save();
  // hat body — a slightly lumpy cone
  ctx.beginPath();
  ctx.moveTo(cx - halfW, baseY);
  ctx.lineTo(cx - 14, topY + 6);
  ctx.lineTo(cx - 2, topY);
  ctx.lineTo(cx + 12, topY + 8);
  ctx.lineTo(cx + halfW, baseY);
  ctx.closePath();
  const g = ctx.createLinearGradient(cx - halfW, topY, cx + halfW, baseY);
  g.addColorStop(0, "#9aa1a9"); g.addColorStop(0.5, "#e7ebef"); g.addColorStop(1, "#aab0b8");
  ctx.fillStyle = g; ctx.fill();
  // brim
  ctx.fillStyle = "#c3c8ce";
  ctx.fillRect(cx - halfW - 4, baseY - 4, halfW * 2 + 8, 8);
  // crinkle creases
  ctx.strokeStyle = "#7d848c"; ctx.lineWidth = 1.5;
  for (let i = 0; i < 4; i++) {
    const x = cx - 24 + i * 16;
    ctx.beginPath(); ctx.moveTo(x, baseY - 2); ctx.lineTo(x + 6, topY + 14 + (i % 2) * 6); ctx.stroke();
  }
  // travelling shimmer highlight
  const sx = cx - halfW + ((t * (halfW * 2)) % (halfW * 2));
  ctx.globalAlpha = 0.7; ctx.strokeStyle = "#ffffff"; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.moveTo(sx, baseY - 2); ctx.lineTo(sx - 8, topY + 12); ctx.stroke();
  ctx.globalAlpha = 1;
  ctx.restore();
}

const MAP = new Map(EMOJI_EFFECTS.map((e) => [e.id, e]));

/** Render an image buffer as a looping GIF with the given effect. */
export async function renderEmojiGif(image: Buffer, effectId: string): Promise<Buffer | null> {
  const mod = await getCanvas();
  const eff = MAP.get(effectId);
  if (!mod || !eff) return null;
  let img: Image;
  try { img = await mod.loadImage(image); } catch { return null; }

  // Overlay effects composite the pack art over the user image; if the sheet is
  // missing they simply show the image (never error).
  const sheet = eff.overlay ? await loadOverlay(mod, eff.overlay) : null;

  const enc = new GIFEncoder(SIZE, SIZE);
  enc.start();
  enc.setRepeat(0);
  enc.setQuality(10);
  enc.setDelay(eff.delayMs);
  enc.setTransparent(KEY);
  for (let i = 0; i < eff.frames; i++) {
    const canvas = mod.createCanvas(SIZE, SIZE);
    const ctx = canvas.getContext("2d") as unknown as Ctx;
    ctx.fillStyle = KEY_CSS;
    ctx.fillRect(0, 0, SIZE, SIZE);
    ctx.save();
    if (eff.overlay) {
      base(ctx, img, 0.94);                                    // user image in the base footprint
      if (sheet) ctx.drawImage(sheet, 0, i * SIZE, SIZE, SIZE, 0, 0, SIZE, SIZE); // overlay frame on top
    } else {
      eff.draw?.(ctx, img, i / eff.frames, mod);
    }
    ctx.restore();
    enc.addFrame(ctx as never);
  }
  enc.finish();
  return enc.out.getData();
}
