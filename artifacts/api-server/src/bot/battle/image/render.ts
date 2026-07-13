// ─────────────────────────────────────────────────────────────────────────────
// Battle-image RENDERER — layered, runtime composition.
//
// Produces the "Card A  VS  Card B" battle image by STACKING independent layers
// onto one canvas: background → split tint → (per card: glow → frame → art →
// rarity badge → element icon → text) → VS badge. Works for ANY two cards with
// no pre-made per-matchup image.
//
// Modularity: every layer is a small pure function in LAYER form; the renderer
// only iterates them. Assets/geometry/colours live in ./theme.ts. To change the
// look, edit theme.ts or a layer — never the stack loop.
//
// Dependency: @napi-rs/canvas (prebuilt native, externalized in build.mjs). It
// is lazy-loaded; if it isn't installed the renderer returns null and callers
// fall back to the plain embed — battles never break over a missing image lib.
// ─────────────────────────────────────────────────────────────────────────────

import type { Rarity } from "../../cards-data.js";
import {
  CANVAS, CARD_BOX, VS_BADGE, resolveBackground, rarityHex,
  RARITY_BADGE_BG, RARITY_BADGE_FG, resolveElement, FONTS, FONT_FILES,
} from "./theme.js";

// The minimal card description the renderer needs. Decoupled from Combatant so
// the renderer can draw prep screens, previews, or anything else.
export interface RenderCard {
  name: string;
  series?: string | null;      // e.g. "ONE-PIECE"
  rarityLabel: string;         // e.g. "EPIC"
  rarity: Rarity;
  rarityColor?: number | null; // custom /rarity tier override
  cardId?: number | null;
  cardType?: string | null;    // drives the element icon
  level?: number | null;
  artUrl?: string | null;      // character artwork
  attack?: number | null;      // shown under the name
  special?: string | null;     // signature move name, shown under the name
}

export interface RenderOpts {
  background?: string | null;  // theme background key
}

// ── canvas module (lazy, cached) ─────────────────────────────────────────────
type CanvasMod = typeof import("@napi-rs/canvas");
let _canvas: CanvasMod | null | undefined;
let _fontsRegistered = false;

async function getCanvas(): Promise<CanvasMod | null> {
  if (_canvas !== undefined) return _canvas;
  try {
    _canvas = await import("@napi-rs/canvas");
    registerFonts(_canvas);
  } catch {
    _canvas = null; // not installed — callers fall back to the plain embed
  }
  return _canvas;
}

function registerFonts(mod: CanvasMod) {
  if (_fontsRegistered) return;
  _fontsRegistered = true;
  for (const f of FONT_FILES) {
    if (!f.path) continue;
    try { mod.GlobalFonts.registerFromPath(f.path, f.family); } catch { /* optional */ }
  }
}

// Fetch remote/local art into an Image the canvas can draw. Returns null on any
// failure so a broken URL just yields a card with no art (never a broken image).
async function loadArt(mod: CanvasMod, url: string | null | undefined) {
  if (!url) return null;
  try {
    if (/^https?:\/\//.test(url)) {
      const res = await fetch(url);
      if (!res.ok) return null;
      const buf = Buffer.from(await res.arrayBuffer());
      return await mod.loadImage(buf);
    }
    return await mod.loadImage(url); // local path
  } catch {
    return null;
  }
}

// Family string with graceful fallback to system sans.
function font(px: number, family: string, weight = "700") {
  return `${weight} ${px}px "${family}", "Arial", sans-serif`;
}

// ── Shared drawing helpers ───────────────────────────────────────────────────
type Ctx = import("@napi-rs/canvas").SKRSContext2D;

function roundRectPath(ctx: Ctx, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function fitText(ctx: Ctx, text: string, maxW: number, startPx: number, family: string, weight = "700"): number {
  let px = startPx;
  do {
    ctx.font = font(px, family, weight);
    if (ctx.measureText(text).width <= maxW) break;
    px -= 2;
  } while (px > 10);
  return px;
}

// ── LAYERS ───────────────────────────────────────────────────────────────────
// Background image (or gradient fallback) + diagonal split tint.
async function layerBackground(ctx: Ctx, mod: CanvasMod, opts: RenderOpts) {
  const bg = resolveBackground(opts.background);
  const img = await loadArt(mod, bg.src);
  if (img) {
    // cover-fit
    const scale = Math.max(CANVAS.width / img.width, CANVAS.height / img.height);
    const w = img.width * scale, h = img.height * scale;
    ctx.drawImage(img, (CANVAS.width - w) / 2, (CANVAS.height - h) / 2, w, h);
  } else {
    const g = ctx.createLinearGradient(0, 0, CANVAS.width, CANVAS.height);
    g.addColorStop(0, bg.fallbackGradient[0]);
    g.addColorStop(1, bg.fallbackGradient[1]);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, CANVAS.width, CANVAS.height);
  }
  // darkening vignette so cards pop
  const vg = ctx.createRadialGradient(CANVAS.width / 2, CANVAS.height / 2, CANVAS.height * 0.2, CANVAS.width / 2, CANVAS.height / 2, CANVAS.width * 0.7);
  vg.addColorStop(0, "rgba(0,0,0,0)");
  vg.addColorStop(1, "rgba(0,0,0,0.45)");
  ctx.fillStyle = vg;
  ctx.fillRect(0, 0, CANVAS.width, CANVAS.height);
  // diagonal split tint
  if (bg.splitTint) {
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(CANVAS.width * 0.52, 0);
    ctx.lineTo(CANVAS.width * 0.48, CANVAS.height);
    ctx.lineTo(CANVAS.width, CANVAS.height);
    ctx.lineTo(CANVAS.width, 0);
    ctx.closePath();
    ctx.fillStyle = bg.splitTint;
    ctx.fill();
    ctx.restore();
  }
}

// Coloured glow behind a card (rarity-tinted).
function layerGlow(ctx: Ctx, x: number, color: string) {
  ctx.save();
  ctx.shadowColor = color;
  ctx.shadowBlur = 40;
  ctx.fillStyle = color;
  roundRectPath(ctx, x - 2, CARD_BOX.y - 2, CARD_BOX.width + 4, CARD_BOX.height + 4, CARD_BOX.radius + 2);
  ctx.globalAlpha = 0.55;
  ctx.fill();
  ctx.restore();
}

// Card art clipped inside the frame, with a base fill behind it.
async function layerArt(ctx: Ctx, mod: CanvasMod, x: number, card: RenderCard) {
  const inset = CARD_BOX.borderWidth + CARD_BOX.artInset;
  const ax = x + inset, ay = CARD_BOX.y + inset;
  const aw = CARD_BOX.width - inset * 2, ah = CARD_BOX.height - inset * 2;
  ctx.save();
  roundRectPath(ctx, ax, ay, aw, ah, CARD_BOX.radius - 6);
  ctx.clip();
  ctx.fillStyle = "#0e0e12";
  ctx.fillRect(ax, ay, aw, ah);
  const img = await loadArt(mod, card.artUrl);
  if (img) {
    const scale = Math.max(aw / img.width, ah / img.height);
    const w = img.width * scale, h = img.height * scale;
    ctx.drawImage(img, ax + (aw - w) / 2, ay + (ah - h) / 2, w, h);
  }
  // bottom gradient so name text is readable over the art
  const g = ctx.createLinearGradient(0, ay + ah - 130, 0, ay + ah);
  g.addColorStop(0, "rgba(0,0,0,0)");
  g.addColorStop(1, "rgba(0,0,0,0.85)");
  ctx.fillStyle = g;
  ctx.fillRect(ax, ay + ah - 130, aw, 130);
  ctx.restore();
}

// Rarity-coloured frame border.
function layerFrame(ctx: Ctx, x: number, color: string) {
  ctx.save();
  ctx.lineWidth = CARD_BOX.borderWidth;
  ctx.strokeStyle = color;
  roundRectPath(ctx, x, CARD_BOX.y, CARD_BOX.width, CARD_BOX.height, CARD_BOX.radius);
  ctx.stroke();
  // inner hairline
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = "rgba(255,255,255,0.25)";
  roundRectPath(ctx, x + CARD_BOX.borderWidth, CARD_BOX.y + CARD_BOX.borderWidth, CARD_BOX.width - CARD_BOX.borderWidth * 2, CARD_BOX.height - CARD_BOX.borderWidth * 2, CARD_BOX.radius - 4);
  ctx.stroke();
  ctx.restore();
}

// Top-left chips: level + element icon.
function layerChips(ctx: Ctx, x: number, card: RenderCard) {
  const cx = x + CARD_BOX.borderWidth + 10;
  let cy = CARD_BOX.y + CARD_BOX.borderWidth + 10;
  const chip = (w: number, h: number) => {
    ctx.fillStyle = "rgba(245,245,245,0.92)";
    roundRectPath(ctx, cx, cy, w, h, 6);
    ctx.fill();
  };
  // level chip
  chip(34, 30);
  ctx.fillStyle = "#111";
  ctx.font = font(18, FONTS.body, "800");
  ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.fillText(String(card.level ?? 1), cx + 17, cy + 16);
  // element disc under it
  cy += 40;
  const el = resolveElement(card.cardType);
  ctx.beginPath();
  ctx.arc(cx + 17, cy + 15, 16, 0, Math.PI * 2);
  ctx.fillStyle = el.disc; ctx.fill();
  ctx.lineWidth = 2; ctx.strokeStyle = el.ring; ctx.stroke();
  ctx.fillStyle = "#fff";
  ctx.font = font(18, FONTS.body, "700");
  ctx.fillText(el.glyph, cx + 17, cy + 16);
}

// Top-right rarity badge + card id.
function layerRarityBadge(ctx: Ctx, x: number, card: RenderCard, color: string) {
  const rightX = x + CARD_BOX.width - CARD_BOX.borderWidth - 10;
  const y = CARD_BOX.y + CARD_BOX.borderWidth + 10;
  ctx.font = font(15, FONTS.body, "800");
  const label = card.rarityLabel.toUpperCase();
  const w = Math.max(64, ctx.measureText(label).width + 20);
  ctx.fillStyle = RARITY_BADGE_BG;
  roundRectPath(ctx, rightX - w, y, w, 26, 6);
  ctx.fill();
  ctx.lineWidth = 1.5; ctx.strokeStyle = color; ctx.stroke();
  ctx.fillStyle = RARITY_BADGE_FG;
  ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.fillText(label, rightX - w / 2, y + 14);
  if (card.cardId != null) {
    ctx.font = font(13, FONTS.body, "700");
    const idText = `#${card.cardId}`;
    const iw = ctx.measureText(idText).width + 16;
    ctx.fillStyle = "rgba(20,20,24,0.7)";
    roundRectPath(ctx, rightX - iw, y + 32, iw, 22, 5);
    ctx.fill();
    ctx.fillStyle = "#e8e8ec";
    ctx.fillText(idText, rightX - iw / 2, y + 43);
  }
}

// Bottom text: series + name.
function layerNameplate(ctx: Ctx, x: number, card: RenderCard, color: string) {
  const inset = CARD_BOX.borderWidth + CARD_BOX.artInset;
  const centerX = x + CARD_BOX.width / 2;
  const baseY = CARD_BOX.y + CARD_BOX.height - inset - 30;
  ctx.textAlign = "center"; ctx.textBaseline = "alphabetic";
  if (card.series) {
    ctx.font = font(13, FONTS.body, "700");
    ctx.fillStyle = "rgba(220,220,225,0.85)";
    ctx.fillText(card.series.toUpperCase().slice(0, 40), centerX, baseY - 26);
  }
  const namePx = fitText(ctx, card.name, CARD_BOX.width - inset * 2 - 10, 26, FONTS.display, "800");
  ctx.font = font(namePx, FONTS.display, "800");
  ctx.fillStyle = "#ffffff";
  ctx.shadowColor = "rgba(0,0,0,0.8)"; ctx.shadowBlur = 6;
  ctx.fillText(card.name, centerX, baseY);
  ctx.shadowBlur = 0;
  // rarity underline accent
  const uw = Math.min(CARD_BOX.width - inset * 2 - 20, ctx.measureText(card.name).width);
  ctx.fillStyle = color;
  ctx.fillRect(centerX - uw / 2, baseY + 6, uw, 3);
}

// A compact stat line under the name: ATK value + signature move name.
function layerStatline(ctx: Ctx, x: number, card: RenderCard) {
  if (card.attack == null && !card.special) return;
  const inset = CARD_BOX.borderWidth + CARD_BOX.artInset;
  const centerX = x + CARD_BOX.width / 2;
  const y = CARD_BOX.y + CARD_BOX.height - inset - 8;
  const parts: string[] = [];
  if (card.attack != null) parts.push(`ATK ${card.attack.toLocaleString()}`);
  if (card.special) parts.push(card.special);
  const text = parts.join("  ·  ");
  const px = fitText(ctx, text, CARD_BOX.width - inset * 2 - 6, 14, FONTS.body, "700");
  ctx.font = font(px, FONTS.body, "700");
  ctx.textAlign = "center"; ctx.textBaseline = "alphabetic";
  ctx.fillStyle = "rgba(235,235,240,0.9)";
  ctx.shadowColor = "rgba(0,0,0,0.85)"; ctx.shadowBlur = 4;
  ctx.fillText(text, centerX, y);
  ctx.shadowBlur = 0;
}

// The gold VS badge in the centre.
function layerVs(ctx: Ctx) {
  const { cx, cy, fontPx } = VS_BADGE;
  ctx.save();
  ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.font = font(fontPx, FONTS.display, "800");
  const grad = ctx.createLinearGradient(0, cy - fontPx / 2, 0, cy + fontPx / 2);
  grad.addColorStop(0, "#fff2b0");
  grad.addColorStop(0.5, "#ffcc33");
  grad.addColorStop(1, "#c8890f");
  ctx.lineWidth = 10;
  ctx.strokeStyle = "#3a2600";
  ctx.strokeText("VS", cx, cy);
  ctx.fillStyle = grad;
  ctx.fillText("VS", cx, cy);
  ctx.restore();
}

// One card = a stack of layers at an x-offset.
async function drawCard(ctx: Ctx, mod: CanvasMod, x: number, card: RenderCard) {
  const color = rarityHex(card.rarity, card.rarityColor);
  layerGlow(ctx, x, color);
  await layerArt(ctx, mod, x, card);
  layerFrame(ctx, x, color);
  layerChips(ctx, x, card);
  layerRarityBadge(ctx, x, card, color);
  layerNameplate(ctx, x, card, color);
  layerStatline(ctx, x, card);
}

// ── Public API ───────────────────────────────────────────────────────────────
// Returns a PNG Buffer, or null if @napi-rs/canvas isn't available (callers
// then fall back to the plain embed).
export async function renderBattleImage(
  a: RenderCard, b: RenderCard, opts: RenderOpts = {},
): Promise<Buffer | null> {
  const mod = await getCanvas();
  if (!mod) return null;
  try {
    const canvas = mod.createCanvas(CANVAS.width, CANVAS.height);
    const ctx = canvas.getContext("2d") as unknown as Ctx;
    await layerBackground(ctx, mod, opts);
    await drawCard(ctx, mod, CARD_BOX.leftX, a);
    await drawCard(ctx, mod, CARD_BOX.rightX, b);
    layerVs(ctx);
    return await canvas.encode("png");
  } catch {
    return null; // never let an image error break a battle
  }
}

// Whether the renderer can produce images in this runtime (canvas installed).
export async function battleImageAvailable(): Promise<boolean> {
  return (await getCanvas()) !== null;
}
