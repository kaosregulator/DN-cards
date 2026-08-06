// ─────────────────────────────────────────────────────────────────────────────
// HQ renderer — composites a player's Headquarters to a PNG as an ISOMETRIC room.
//
// Built as a "stack of pure layer functions" (the doctrine from
// battle/image/render.ts and raid/canvas.ts): renderHq only iterates the layers.
// Phase 3 replaced the flat back-wall look with a true isometric room — two
// corner walls, a diamond floor grid, and furniture placed on floor tiles / wall
// faces with depth-sorted draw order. Everything is still drawn PROCEDURALLY so
// the feature ships with zero art, and every visual first asks the asset manager
// (spriteForPrefix); a bundled/uploaded PNG transparently replaces the
// procedural drawing — walls, floor and furniture each swap independently.
//
// This renderer is a LEAF: it does its own createCanvas + encode and is queued
// once, so it must never call another queued renderer (deadlock rule in
// render-queue.ts). The hub builds the HqRenderView (resolving card art URLs,
// rarity via getCardDisplayRarity, and any sprite paths); this file never
// touches the DB.
// ─────────────────────────────────────────────────────────────────────────────

import {
  getCanvas, roundRectPath, hexToRgba,
  type Ctx, type CanvasMod,
} from "../animations/engine.js";
import {
  loadArt, drawCardArt, drawCardFrame, drawRarityGlow,
  drawTextWithShadow, drawTitle, fitText, TITLE_FONT,
} from "../animations/effects.js";
import { drawAtmosphere, atmospherePreset } from "../animations/atmosphere.js";
import { queueRender } from "../animations/render-queue.js";
import { loadSprite } from "./assets.js";
import type { HqTheme } from "./defs/themes.js";
import type { HqWall } from "./defs/walls.js";
import type { HqFloor } from "./defs/floors.js";
import type { DecoCategory } from "./defs/decorations.js";

const W = 1000, H = 560;
const HEADER_H = 66;

// ── Isometric projection ───────────────────────────────────────────────────────
// A GRID×GRID floor. project() maps a lattice point (gx,gy) to screen space; a
// floor tile (i,j) is the diamond between (i,j),(i+1,j),(i+1,j+1),(i,j+1).
const GRID = 6;
const TILE_W = 104, TILE_H = 52;   // full diamond width/height (2:1 iso)
const ORIGIN_X = W / 2, ORIGIN_Y = 150; // screen position of lattice corner (0,0)
const WALL_H = 140;

interface Pt { x: number; y: number }
function project(gx: number, gy: number): Pt {
  return {
    x: ORIGIN_X + (gx - gy) * (TILE_W / 2),
    y: ORIGIN_Y + (gx + gy) * (TILE_H / 2),
  };
}
function lerp(a: Pt, b: Pt, t: number): Pt {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

// `ellipse` exists on the Skia 2D context at runtime but is under-declared on the
// project's Ctx type (same as drawImage's source-rect overload).
type EllipseCtx = { ellipse(x: number, y: number, rx: number, ry: number, rot: number, a0: number, a1: number): void };
function ellipse(ctx: Ctx, x: number, y: number, rx: number, ry: number, rot = 0): void {
  (ctx as unknown as EllipseCtx).ellipse(x, y, rx, ry, rot, 0, Math.PI * 2);
}
type DrawImg = { drawImage(i: unknown, x: number, y: number, w: number, h: number): void };
function blit(ctx: Ctx, img: unknown, x: number, y: number, w: number, h: number): void {
  (ctx as unknown as DrawImg).drawImage(img, x, y, w, h);
}

// ── View contract (built by the hub) ───────────────────────────────────────────
export interface HqRenderCard {
  cardId: number;
  name: string;
  artUrl: string | null;
  rarityLabel: string;
  rarityColor: number;
}

export interface HqRenderDeco {
  slot: number;
  category: DecoCategory;
  name: string;
  rarityColor: number;
  spritePath: string | null;
}

export interface HqRenderView {
  ownerName: string;
  // Banner name shown in the header (custom HQ name or "<owner>'s HQ").
  displayTitle: string;
  ownerAvatarUrl: string | null;
  theme: HqTheme;   // lighting mood, ambient particles, accent, glass tint
  wall: HqWall;     // wall style (faces, trim, windows)
  floor: HqFloor;   // floor style (tiles, grout)
  // Optional art (resolved by the hub via spriteForPrefix). When present these
  // replace the procedural wall faces / floor tiles; otherwise procedural.
  wallSprite?: string | null;
  floorSprite?: string | null;
  roomName: string;
  roomEmoji: string;
  hqLevel: number;
  subtitle: string;
  pedestals: (HqRenderCard | null)[]; // length = room.pedestals
  decorations: HqRenderDeco[];        // placed decorations (with slot index)
}

// Fixed placement per slot index: a wall-mounted screen anchor or a floor tile.
// The shape drawn is self-contained so any category works at any anchor; rooms
// with more slots than anchors wrap harmlessly.
type SlotPlace =
  | { mount: "wall"; x: number; y: number; scale: number }
  | { mount: "floor"; gx: number; gy: number; scale: number };

const SLOT_PLACES: SlotPlace[] = [
  { mount: "wall", x: 648, y: 150, scale: 1 },      // left wall
  { mount: "wall", x: 352, y: 150, scale: 1 },      // right wall
  { mount: "wall", x: 500, y: 96, scale: 0.9 },     // near the corner
  { mount: "floor", gx: 4.5, gy: 3.2, scale: 1 },   // front-right floor
  { mount: "floor", gx: 3.2, gy: 4.5, scale: 1 },   // front-left floor
  { mount: "floor", gx: 4.3, gy: 4.3, scale: 0.95 },// front-centre floor
];

export async function renderHq(view: HqRenderView): Promise<Buffer | null> {
  return queueRender("hq", async () => {
    const mod = await getCanvas();
    if (!mod) return null;
    try {
      const canvas = mod.createCanvas(W, H);
      const ctx = canvas.getContext("2d") as unknown as Ctx;

      layerBackdrop(ctx, view.theme);
      await layerWalls(ctx, mod, view.wall, view.wallSprite ?? null);
      await layerWallDecorations(ctx, mod, view);
      await layerFloor(ctx, mod, view.floor, view.floorSprite ?? null);
      layerLighting(ctx, view.theme);
      await layerFurniture(ctx, mod, view);
      await layerHeader(ctx, mod, view);

      return await canvas.encode("png");
    } catch {
      return null;
    }
  });
}

// ── Layers ──────────────────────────────────────────────────────────────────
function layerBackdrop(ctx: Ctx, theme: HqTheme): void {
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, theme.palette.wallBottom);
  g.addColorStop(1, "#05070a");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
}

// Fill a wall face (a parallelogram) with shading, a top trim line, a baseboard,
// and optional window panels. `corners` are base-left, base-right, top-left,
// top-right along the same horizontal parameter u (v=0 base, v=1 top).
function drawWallFace(
  ctx: Ctx, bl: Pt, br: Pt, tl: Pt, tr: Pt, face: string, trim: string,
  window: boolean, windowTint: string,
): void {
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(bl.x, bl.y); ctx.lineTo(br.x, br.y); ctx.lineTo(tr.x, tr.y); ctx.lineTo(tl.x, tl.y);
  ctx.closePath();
  ctx.fillStyle = face;
  ctx.fill();
  ctx.clip();

  const bilerp = (u: number, v: number): Pt => lerp(lerp(bl, br, u), lerp(tl, tr, u), v);

  if (window) {
    const cols = 3;
    for (let c = 0; c < cols; c++) {
      const u0 = (c + 0.18) / cols, u1 = (c + 0.82) / cols;
      const p00 = bilerp(u0, 0.32), p10 = bilerp(u1, 0.32);
      const p01 = bilerp(u0, 0.9),  p11 = bilerp(u1, 0.9);
      ctx.beginPath();
      ctx.moveTo(p00.x, p00.y); ctx.lineTo(p10.x, p10.y); ctx.lineTo(p11.x, p11.y); ctx.lineTo(p01.x, p01.y);
      ctx.closePath();
      ctx.fillStyle = windowTint; ctx.fill();
      ctx.strokeStyle = hexToRgba(0xffffff, 0.28); ctx.lineWidth = 2; ctx.stroke();
      // Mullion.
      const m0 = bilerp((u0 + u1) / 2, 0.32), m1 = bilerp((u0 + u1) / 2, 0.9);
      ctx.beginPath(); ctx.moveTo(m0.x, m0.y); ctx.lineTo(m1.x, m1.y); ctx.stroke();
    }
  } else {
    // Subtle vertical paneling for texture.
    for (let c = 1; c < 4; c++) {
      const a = bilerp(c / 4, 0), b = bilerp(c / 4, 1);
      ctx.strokeStyle = hexToRgba(0x000000, 0.12); ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    }
  }
  ctx.restore();

  // Top trim + baseboard.
  ctx.strokeStyle = trim; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.moveTo(tl.x, tl.y); ctx.lineTo(tr.x, tr.y); ctx.stroke();
  ctx.lineWidth = 4;
  ctx.beginPath(); ctx.moveTo(bl.x, bl.y); ctx.lineTo(br.x, br.y); ctx.stroke();
}

// Blit an image to fill a quad by clipping to it and drawing to its bounding
// box. Good for a seamless wall/floor texture; exact for axis work isn't needed.
function blitClippedQuad(ctx: Ctx, img: unknown, p: Pt[]): void {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const q of p) { minX = Math.min(minX, q.x); minY = Math.min(minY, q.y); maxX = Math.max(maxX, q.x); maxY = Math.max(maxY, q.y); }
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(p[0]!.x, p[0]!.y);
  for (let i = 1; i < p.length; i++) ctx.lineTo(p[i]!.x, p[i]!.y);
  ctx.closePath(); ctx.clip();
  blit(ctx, img, minX, minY, maxX - minX, maxY - minY);
  ctx.restore();
}

async function layerWalls(ctx: Ctx, mod: CanvasMod, wall: HqWall, spritePath: string | null): Promise<void> {
  const up = (p: Pt): Pt => ({ x: p.x, y: p.y - WALL_H });
  const rBL = project(0, GRID), rBR = project(0, 0);
  const lBL = project(0, 0), lBR = project(GRID, 0);
  // Art path: blit a seamless wall texture onto each face (uploaded packs).
  const img = spritePath ? await loadSprite(mod, spritePath).catch(() => null) : null;
  if (img) {
    blitClippedQuad(ctx, img, [rBL, rBR, up(rBR), up(rBL)]);
    blitClippedQuad(ctx, img, [lBL, lBR, up(lBR), up(lBL)]);
    // Keep trims so the corner still reads crisply over the texture.
    ctx.strokeStyle = wall.trim; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(up(rBL).x, up(rBL).y); ctx.lineTo(up(rBR).x, up(rBR).y); ctx.lineTo(up(lBR).x, up(lBR).y); ctx.stroke();
    return;
  }
  // Procedural: two shaded faces with trim + optional windows.
  drawWallFace(ctx, rBL, rBR, up(rBL), up(rBR), wall.rightFace, wall.trim, wall.window, wall.windowTint);
  drawWallFace(ctx, lBL, lBR, up(lBL), up(lBR), wall.leftFace, wall.trim, wall.window, wall.windowTint);
}

async function layerFloor(ctx: Ctx, mod: CanvasMod, floor: HqFloor, spritePath: string | null): Promise<void> {
  const img = spritePath ? await loadSprite(mod, spritePath).catch(() => null) : null;
  for (let i = 0; i < GRID; i++) {
    for (let j = 0; j < GRID; j++) {
      const a = project(i, j), b = project(i + 1, j), c = project(i + 1, j + 1), d = project(i, j + 1);
      if (img) {
        blitClippedQuad(ctx, img, [a, b, c, d]);
        ctx.beginPath();
        ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.lineTo(c.x, c.y); ctx.lineTo(d.x, d.y); ctx.closePath();
        ctx.strokeStyle = floor.grout; ctx.lineWidth = 1; ctx.stroke();
        continue;
      }
      ctx.beginPath();
      ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.lineTo(c.x, c.y); ctx.lineTo(d.x, d.y); ctx.closePath();
      ctx.fillStyle = (i + j) % 2 === 0 ? floor.tileA : floor.tileB;
      ctx.fill();
      ctx.strokeStyle = floor.grout; ctx.lineWidth = 1; ctx.stroke();
    }
  }
}

function layerLighting(ctx: Ctx, theme: HqTheme): void {
  // Key light from above-centre.
  const r = ctx.createRadialGradient(W / 2, 40, 30, W / 2, 240, 640);
  r.addColorStop(0, theme.palette.light);
  r.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = r;
  ctx.fillRect(0, 0, W, H);

  // Ambient particles for depth (static frame → fixed phase).
  try {
    drawAtmosphere(ctx, W, H, atmospherePreset(theme.atmosphere), {
      seed: `hq-${theme.id}`, t: 0.35, color: theme.palette.accent, density: 0.4,
    });
  } catch { /* never break a render on ambience */ }

  // Vignette to focus the centre.
  const v = ctx.createRadialGradient(W / 2, H / 2, H * 0.34, W / 2, H / 2, W * 0.72);
  v.addColorStop(0, "rgba(0,0,0,0)");
  v.addColorStop(1, "rgba(0,0,0,0.5)");
  ctx.fillStyle = v;
  ctx.fillRect(0, 0, W, H);
}

// Wall-mounted decorations sit on the wall plane, drawn between walls and floor.
async function layerWallDecorations(ctx: Ctx, mod: CanvasMod, view: HqRenderView): Promise<void> {
  for (const deco of view.decorations) {
    const place = SLOT_PLACES[deco.slot % SLOT_PLACES.length]!;
    if (place.mount !== "wall") continue;
    await drawDecoAt(ctx, mod, place.x, place.y, place.scale, deco, false);
  }
}

// Floor furniture (decorations + card pedestals) drawn back-to-front by depth so
// nearer objects overlap further ones.
async function layerFurniture(ctx: Ctx, mod: CanvasMod, view: HqRenderView): Promise<void> {
  interface Item { depth: number; draw: () => Promise<void> }
  const items: Item[] = [];

  // Card pedestals along a back anti-diagonal (constant depth), centred and
  // spaced ~1.4 tiles apart so the display cases never overlap.
  const n = view.pedestals.length;
  const SPREAD = 1.4;
  for (let i = 0; i < n; i++) {
    const d = (i - (n - 1) / 2) * SPREAD;
    const p = project(2.5 + d, 2.5 - d);  // gx+gy = 5 → shallow back row
    const card = view.pedestals[i]!;
    items.push({ depth: p.y, draw: () => drawPedestal(ctx, mod, p.x, p.y, card, view.theme) });
  }

  // Floor decorations.
  for (const deco of view.decorations) {
    const place = SLOT_PLACES[deco.slot % SLOT_PLACES.length]!;
    if (place.mount !== "floor") continue;
    const p = project(place.gx, place.gy);
    items.push({ depth: p.y, draw: async () => { await drawDecoAt(ctx, mod, p.x, p.y, place.scale, deco, true); } });
  }

  items.sort((a, b) => a.depth - b.depth);
  for (const it of items) await it.draw();
}

// ── Card pedestal (upright display panel on an iso plinth) ─────────────────────
async function drawPedestal(
  ctx: Ctx, mod: CanvasMod, cx: number, cy: number, card: HqRenderCard | null, theme: HqTheme,
): Promise<void> {
  const cardW = 116, cardH = 150;
  const plinthH = 30, plinthW = cardW + 20;
  const cardBottom = cy - 6;           // card stands just above the plinth top
  const cardTop = cardBottom - cardH;
  const cardX = cx - cardW / 2;

  // Ground shadow.
  ctx.save();
  ctx.fillStyle = "rgba(0,0,0,0.34)";
  ctx.beginPath(); ellipse(ctx, cx, cy + plinthH - 4, plinthW / 2, 12); ctx.fill();
  ctx.restore();

  // Iso plinth (a short box).
  drawIsoBox(ctx, cx, cy, plinthW, plinthH, theme.palette.accent);

  if (!card) {
    drawGlassCase(ctx, cardX, cardTop, cardW, cardH, theme, 0x808895);
    ctx.save();
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    drawTitle(ctx, "+", cx, cardTop + cardH / 2 - 8, hexToRgba(theme.palette.accent, 0.85), 42);
    drawTextWithShadow(ctx, "Pin a card", cx, cardTop + cardH / 2 + 24, "rgba(230,230,235,0.75)", 13);
    ctx.restore();
    return;
  }

  drawRarityGlow(ctx, cardX, cardTop, cardW, cardH, card.rarityColor, 0.55);
  await drawCardArt(ctx, mod, cardX, cardTop, cardW, cardH, card.artUrl);
  drawCardFrame(ctx, cardX, cardTop, cardW, cardH, card.rarityColor, 5);
  drawGlassCase(ctx, cardX, cardTop, cardW, cardH, theme, card.rarityColor);

  // Nameplate on the plinth.
  ctx.save();
  ctx.textAlign = "center"; ctx.textBaseline = "middle";
  const nameY = cy + plinthH + 10;
  const nameSize = fitText(ctx, card.name, cardW + 40, 16, 11, TITLE_FONT);
  drawTitle(ctx, card.name, cx, nameY, "#ffffff", nameSize);
  drawTextWithShadow(ctx, card.rarityLabel.toUpperCase(), cx, nameY + 16, hexToRgba(card.rarityColor, 1), 11);
  ctx.restore();
}

// A short isometric box (used for pedestals): top diamond + two lit side faces.
function drawIsoBox(ctx: Ctx, cx: number, cyTop: number, w: number, h: number, accent: number): void {
  const hw = w / 2, hh = w / 4; // diamond half-extents (2:1)
  const top = { x: cx, y: cyTop - hh };
  const right = { x: cx + hw, y: cyTop };
  const bottom = { x: cx, y: cyTop + hh };
  const left = { x: cx - hw, y: cyTop };
  ctx.save();
  // Left face.
  ctx.beginPath();
  ctx.moveTo(left.x, left.y); ctx.lineTo(bottom.x, bottom.y);
  ctx.lineTo(bottom.x, bottom.y + h); ctx.lineTo(left.x, left.y + h); ctx.closePath();
  ctx.fillStyle = hexToRgba(accent, 0.22); ctx.fill();
  // Right face.
  ctx.beginPath();
  ctx.moveTo(right.x, right.y); ctx.lineTo(bottom.x, bottom.y);
  ctx.lineTo(bottom.x, bottom.y + h); ctx.lineTo(right.x, right.y + h); ctx.closePath();
  ctx.fillStyle = hexToRgba(accent, 0.34); ctx.fill();
  // Top diamond.
  ctx.beginPath();
  ctx.moveTo(top.x, top.y); ctx.lineTo(right.x, right.y); ctx.lineTo(bottom.x, bottom.y); ctx.lineTo(left.x, left.y);
  ctx.closePath();
  ctx.fillStyle = hexToRgba(accent, 0.5); ctx.fill();
  ctx.strokeStyle = hexToRgba(accent, 0.8); ctx.lineWidth = 1.5; ctx.stroke();
  ctx.restore();
}

// A glass display case: subtle tinted fill + rim highlight + a diagonal sheen.
function drawGlassCase(ctx: Ctx, x: number, y: number, w: number, h: number, theme: HqTheme, tint: number): void {
  ctx.save();
  roundRectPath(ctx, x - 6, y - 6, w + 12, h + 12, 12);
  ctx.clip();
  ctx.fillStyle = theme.palette.glass;
  ctx.fillRect(x - 6, y - 6, w + 12, h + 12);
  const s = ctx.createLinearGradient(x - 6, y - 6, x + w, y + h);
  s.addColorStop(0, "rgba(255,255,255,0.14)");
  s.addColorStop(0.45, "rgba(255,255,255,0.03)");
  s.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = s;
  ctx.fillRect(x - 6, y - 6, w + 12, h + 12);
  ctx.restore();
  ctx.save();
  ctx.strokeStyle = hexToRgba(tint, 0.5); ctx.lineWidth = 2;
  roundRectPath(ctx, x - 6, y - 6, w + 12, h + 12, 12); ctx.stroke();
  ctx.restore();
}

// Draw one decoration at a screen anchor. `grounded` floor items get a soft
// contact shadow and are lifted so their base sits on the tile; wall items hang.
async function drawDecoAt(
  ctx: Ctx, mod: CanvasMod, x: number, y: number, scale: number, deco: HqRenderDeco, grounded: boolean,
): Promise<void> {
  if (deco.spritePath) {
    const img = await loadSprite(mod, deco.spritePath).catch(() => null);
    if (img) {
      // Preserve the sprite's aspect ratio. Kenney iso furniture is tall
      // (256×512) and base-anchored at the bottom, so floor items fit to a
      // target WIDTH and sit their bottom on the tile; wall items (icons like
      // medals) fit to a target HEIGHT and centre on the anchor.
      const iw = Math.max(1, (img as { width: number }).width);
      const ih = Math.max(1, (img as { height: number }).height);
      if (grounded) {
        const w = 120 * scale, h = w * (ih / iw);
        ctx.save(); ctx.fillStyle = "rgba(0,0,0,0.28)";
        ctx.beginPath(); ellipse(ctx, x, y, w * 0.24, w * 0.09); ctx.fill(); ctx.restore();
        blit(ctx, img, x - w / 2, y - h + 6, w, h); // bottom sits on the tile
      } else {
        const h = 88 * scale, w = h * (iw / ih);
        blit(ctx, img, x - w / 2, y - h / 2, w, h);
      }
      return;
    }
  }
  if (grounded) {
    ctx.save(); ctx.fillStyle = "rgba(0,0,0,0.3)";
    ctx.beginPath(); ellipse(ctx, x, y, 34 * scale, 12 * scale); ctx.fill(); ctx.restore();
  }
  drawDecoration(ctx, x, grounded ? y - 30 * scale : y, scale, deco);
}

// ── Procedural decorations ────────────────────────────────────────────────────
// Each category draws a compact, self-contained glyph tinted by the decoration's
// rarity colour with a soft glow. An asset pack later replaces these per id.
function drawDecoration(ctx: Ctx, ox: number, oy: number, scale: number, deco: HqRenderDeco): void {
  const s = 62 * scale;
  const col = deco.rarityColor;
  ctx.save();
  ctx.translate(ox, oy);
  ctx.shadowColor = hexToRgba(col, 0.7);
  ctx.shadowBlur = 18;

  switch (deco.category) {
    case "banner": {
      ctx.fillStyle = hexToRgba(col, 0.9);
      ctx.beginPath();
      ctx.moveTo(-s * 0.3, -s * 0.55); ctx.lineTo(s * 0.3, -s * 0.55);
      ctx.lineTo(s * 0.3, s * 0.4); ctx.lineTo(0, s * 0.55); ctx.lineTo(-s * 0.3, s * 0.4);
      ctx.closePath(); ctx.fill();
      ctx.shadowBlur = 0;
      ctx.fillStyle = "rgba(255,255,255,0.85)";
      ctx.beginPath(); ctx.arc(0, -s * 0.05, s * 0.13, 0, Math.PI * 2); ctx.fill();
      break;
    }
    case "emblem": {
      ctx.fillStyle = hexToRgba(col, 0.9);
      ctx.beginPath(); ctx.arc(0, 0, s * 0.42, 0, Math.PI * 2); ctx.fill();
      ctx.shadowBlur = 0;
      ctx.strokeStyle = "rgba(255,255,255,0.85)"; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(0, 0, s * 0.24, 0, Math.PI * 2); ctx.stroke();
      break;
    }
    case "trophy": {
      ctx.fillStyle = hexToRgba(col, 0.95);
      ctx.beginPath();
      ctx.moveTo(-s * 0.28, -s * 0.4); ctx.lineTo(s * 0.28, -s * 0.4);
      ctx.quadraticCurveTo(s * 0.28, s * 0.05, 0, s * 0.12);
      ctx.quadraticCurveTo(-s * 0.28, s * 0.05, -s * 0.28, -s * 0.4);
      ctx.closePath(); ctx.fill();
      ctx.shadowBlur = 0;
      ctx.fillRect(-s * 0.06, s * 0.12, s * 0.12, s * 0.2);
      ctx.fillRect(-s * 0.22, s * 0.32, s * 0.44, s * 0.1);
      break;
    }
    case "statue": {
      ctx.fillStyle = hexToRgba(col, 0.5);
      ctx.fillRect(-s * 0.26, s * 0.2, s * 0.52, s * 0.28);
      ctx.shadowBlur = 0;
      ctx.fillStyle = hexToRgba(col, 0.95);
      ctx.beginPath(); ctx.arc(0, -s * 0.16, s * 0.14, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath();
      ctx.moveTo(0, -s * 0.02); ctx.lineTo(s * 0.16, s * 0.2); ctx.lineTo(-s * 0.16, s * 0.2);
      ctx.closePath(); ctx.fill();
      break;
    }
    case "monument": {
      ctx.fillStyle = hexToRgba(col, 0.9);
      ctx.beginPath();
      ctx.moveTo(-s * 0.12, s * 0.5); ctx.lineTo(-s * 0.06, -s * 0.55);
      ctx.lineTo(s * 0.06, -s * 0.55); ctx.lineTo(s * 0.12, s * 0.5);
      ctx.closePath(); ctx.fill();
      ctx.shadowBlur = 0;
      ctx.fillStyle = hexToRgba(col, 0.5);
      ctx.fillRect(-s * 0.22, s * 0.5, s * 0.44, s * 0.12);
      break;
    }
    case "plant": {
      ctx.shadowBlur = 0;
      ctx.fillStyle = hexToRgba(0xc58b4a, 0.95);
      ctx.beginPath();
      ctx.moveTo(-s * 0.2, s * 0.12); ctx.lineTo(s * 0.2, s * 0.12);
      ctx.lineTo(s * 0.14, s * 0.5); ctx.lineTo(-s * 0.14, s * 0.5);
      ctx.closePath(); ctx.fill();
      ctx.shadowColor = hexToRgba(0x2ecc71, 0.6); ctx.shadowBlur = 12;
      ctx.fillStyle = hexToRgba(0x2ecc71, 0.95);
      for (const dx of [-0.16, 0, 0.16]) {
        ctx.beginPath();
        ellipse(ctx, dx * s, -s * 0.08, s * 0.08, s * 0.24, dx); ctx.fill();
      }
      break;
    }
    case "light": {
      ctx.shadowColor = hexToRgba(col, 0.9); ctx.shadowBlur = 26;
      ctx.fillStyle = hexToRgba(col, 0.95);
      ctx.beginPath();
      ctx.moveTo(0, -s * 0.42);
      ctx.quadraticCurveTo(s * 0.24, 0, 0, s * 0.42);
      ctx.quadraticCurveTo(-s * 0.24, 0, 0, -s * 0.42);
      ctx.closePath(); ctx.fill();
      ctx.shadowBlur = 0;
      ctx.fillStyle = "rgba(255,255,255,0.9)";
      ctx.beginPath(); ctx.arc(0, 0, s * 0.1, 0, Math.PI * 2); ctx.fill();
      break;
    }
    case "case": {
      ctx.strokeStyle = hexToRgba(col, 0.9); ctx.lineWidth = 3;
      roundRectPath(ctx, -s * 0.3, -s * 0.42, s * 0.6, s * 0.84, 6); ctx.stroke();
      ctx.shadowBlur = 0;
      ctx.fillStyle = hexToRgba(col, 0.16);
      roundRectPath(ctx, -s * 0.3, -s * 0.42, s * 0.6, s * 0.84, 6); ctx.fill();
      ctx.fillStyle = "rgba(255,255,255,0.5)";
      ctx.fillRect(-s * 0.22, -s * 0.34, s * 0.12, s * 0.68);
      break;
    }
    case "crystal": {
      ctx.shadowColor = hexToRgba(col, 0.9); ctx.shadowBlur = 24;
      ctx.fillStyle = hexToRgba(col, 0.95);
      ctx.beginPath();
      ctx.moveTo(0, -s * 0.5); ctx.lineTo(s * 0.3, -s * 0.05);
      ctx.lineTo(0, s * 0.5); ctx.lineTo(-s * 0.3, -s * 0.05);
      ctx.closePath(); ctx.fill();
      ctx.shadowBlur = 0;
      ctx.fillStyle = "rgba(255,255,255,0.65)";
      ctx.beginPath();
      ctx.moveTo(0, -s * 0.5); ctx.lineTo(s * 0.12, -s * 0.05);
      ctx.lineTo(0, s * 0.18); ctx.lineTo(-s * 0.12, -s * 0.05);
      ctx.closePath(); ctx.fill();
      break;
    }
    case "rug": {
      ctx.shadowBlur = 0;
      ctx.fillStyle = hexToRgba(col, 0.85);
      ctx.beginPath();
      ctx.moveTo(0, -s * 0.24); ctx.lineTo(s * 0.5, 0); ctx.lineTo(0, s * 0.24); ctx.lineTo(-s * 0.5, 0);
      ctx.closePath(); ctx.fill();
      ctx.strokeStyle = "rgba(255,255,255,0.7)"; ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(0, -s * 0.16); ctx.lineTo(s * 0.34, 0); ctx.lineTo(0, s * 0.16); ctx.lineTo(-s * 0.34, 0);
      ctx.closePath(); ctx.stroke();
      break;
    }
  }
  ctx.restore();
}

// ── Header ─────────────────────────────────────────────────────────────────
async function layerHeader(ctx: Ctx, mod: CanvasMod, view: HqRenderView): Promise<void> {
  ctx.save();
  const g = ctx.createLinearGradient(0, 0, W, 0);
  g.addColorStop(0, "rgba(0,0,0,0.62)");
  g.addColorStop(1, "rgba(0,0,0,0.32)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, HEADER_H);
  ctx.fillStyle = hexToRgba(view.theme.palette.accent, 0.8);
  ctx.fillRect(0, HEADER_H, W, 2);
  ctx.restore();

  const av = 46, ax = 18, ay = (HEADER_H - av) / 2;
  if (view.ownerAvatarUrl) {
    const img = await loadArt(mod, view.ownerAvatarUrl).catch(() => null);
    if (img) {
      ctx.save();
      ctx.beginPath(); ctx.arc(ax + av / 2, ay + av / 2, av / 2, 0, Math.PI * 2); ctx.clip();
      const iw = (img as { width: number }).width, ih = (img as { height: number }).height;
      const sc = Math.max(av / iw, av / ih);
      blit(ctx, img, ax + (av - iw * sc) / 2, ay + (av - ih * sc) / 2, iw * sc, ih * sc);
      ctx.restore();
      ctx.save();
      ctx.strokeStyle = hexToRgba(view.theme.palette.accent, 1); ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(ax + av / 2, ay + av / 2, av / 2, 0, Math.PI * 2); ctx.stroke();
      ctx.restore();
    }
  }

  ctx.save();
  ctx.textAlign = "left"; ctx.textBaseline = "middle";
  const tx = ax + av + 14;
  // Left-align the banner name (drawTitle centres by default) so a long/custom
  // HQ name grows rightward instead of clipping the edge.
  drawTitle(ctx, view.displayTitle, tx, 24, "#ffffff", fitText(ctx, view.displayTitle, 520, 22, 14, TITLE_FONT), "left");
  drawTextWithShadow(ctx, view.subtitle, tx, 46, "rgba(225,225,230,0.85)", 13, "left");
  ctx.restore();

  ctx.save();
  ctx.textAlign = "right"; ctx.textBaseline = "middle";
  drawTextWithShadow(ctx, `${view.roomEmoji} ${view.roomName}`, W - 18, 22, "rgba(235,235,240,0.9)", 14, "right");
  const chip = `HQ LV ${view.hqLevel}`;
  ctx.font = `bold 13px "${TITLE_FONT}", "DejaVu Sans", Arial, sans-serif`;
  const cw = ctx.measureText(chip).width + 22;
  const cxp = W - 18 - cw, cyp = 38;
  ctx.fillStyle = hexToRgba(view.theme.palette.accent, 0.22);
  roundRectPath(ctx, cxp, cyp, cw, 20, 10); ctx.fill();
  ctx.strokeStyle = hexToRgba(view.theme.palette.accent, 0.8); ctx.lineWidth = 1;
  roundRectPath(ctx, cxp, cyp, cw, 20, 10); ctx.stroke();
  ctx.textAlign = "center";
  drawTextWithShadow(ctx, chip, cxp + cw / 2, cyp + 10, "#ffffff", 12);
  ctx.restore();
}
