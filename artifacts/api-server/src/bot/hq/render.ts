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

// A card assigned to defend the base — rendered as an upright "standee" figure
// (the card art) standing on an isometric base, like tabletop miniatures.
export interface HqRenderDefender {
  slot: number;
  cardId: number;
  name: string;
  artUrl: string | null;
  rarityColor: number;
  basePath: string | null; // base sprite (CC0); procedural disc when null
}

// The fields the shared header band needs — satisfied structurally by both the
// interior room view and the exterior base view, so layerHeader serves both.
export interface HqHeaderInfo {
  ownerAvatarUrl: string | null;
  displayTitle: string;
  subtitle: string;
  theme: HqTheme;
  roomEmoji: string;
  roomName: string;
  hqLevel: number;
}

export interface HqRenderView extends HqHeaderInfo {
  ownerName: string;
  wall: HqWall;     // wall style (faces, trim, windows)
  floor: HqFloor;   // floor style (tiles, grout)
  // Optional art (resolved by the hub via spriteForPrefix). When present these
  // replace the procedural wall faces / floor tiles; otherwise procedural.
  wallSprite?: string | null;
  floorSprite?: string | null;
  pedestals: (HqRenderCard | null)[]; // length = room.pedestals
  decorations: HqRenderDeco[];        // placed decorations (with slot index)
  defenders?: HqRenderDefender[];     // cards set to defend the base (figures on bases)
}

// ── Exterior "town base" view ──────────────────────────────────────────────────
// A SEPARATE outdoor scene (castles/buildings) — the attackable/defendable town,
// not the interior showcase room. Buildings are placed by ROLE; each resolves art
// via spriteForPrefix("building", role) with a procedural fallback. Defenders
// stand out front as standees (reusing drawDefender), and the whole scene is
// depth-sorted by screen-y.
export type HqBuildingRole = "keep" | "wall" | "camp" | "hut";

export interface HqBaseBuilding {
  role: HqBuildingRole;
  spritePath: string | null; // spriteForPrefix("building", role); null → procedural
}

export interface HqBaseView extends HqHeaderInfo {
  ownerName: string;
  buildings: HqBaseBuilding[];    // which structures the town has
  defenders: HqRenderDefender[];  // stationed cards, rendered as standees
  captured?: boolean;             // future: show a captured/shield state banner
}

// Placement encoding (stored in hq_placements.slot, so no schema change):
//   • floor tile (gx,gy) → slot = gy*GRID + gx   (0 … GRID²-1)
//   • wall anchor i       → slot = WALL_SLOT_BASE + i
// The renderer decodes the slot back to a screen position; the hub builds the
// same encoding when the player picks a tile/wall spot.
export const HQ_GRID = GRID;
export const HQ_WALL_SLOT_BASE = 100;
const WALL_ANCHORS: { x: number; y: number; scale: number }[] = [
  { x: 648, y: 150, scale: 1 },    // left wall
  { x: 352, y: 150, scale: 1 },    // right wall
  { x: 500, y: 96, scale: 0.9 },   // near the corner
];
export const HQ_WALL_ANCHOR_COUNT = WALL_ANCHORS.length;
export function floorSlot(gx: number, gy: number): number { return gy * GRID + gx; }
export function wallSlot(i: number): number { return HQ_WALL_SLOT_BASE + i; }
export function slotIsWall(slot: number): boolean { return slot >= HQ_WALL_SLOT_BASE; }
export function slotToTile(slot: number): { gx: number; gy: number } {
  return { gx: slot % GRID, gy: Math.floor(slot / GRID) % GRID };
}

// Where defenders stand — a front arc facing the viewer, centre outwards.
const DEFENDER_TILES: { gx: number; gy: number }[] = [
  { gx: 3.0, gy: 3.0 }, { gx: 1.7, gy: 4.0 }, { gx: 4.3, gy: 1.7 },
  { gx: 4.6, gy: 3.4 }, { gx: 1.7, gy: 1.7 },
];
export const HQ_DEFENDER_SLOTS = DEFENDER_TILES.length;

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

// ── Exterior town-base renderer ─────────────────────────────────────────────
// A separate leaf renderer (own queue label) for the outdoor base scene. Ground
// slab → buildings + defenders depth-sorted by screen-y → lighting → header.
// Buildings blit their art base-anchored to a target height (procedural fallback
// per role when no art), so the copyrighted/CC0 pack and the drawn version share
// one placement path.
const BASE_TILE_W = 150, BASE_TILE_H = 74;
const BASE_ORIGIN_X = W / 2, BASE_ORIGIN_Y = 250;
function projectBase(gx: number, gy: number): Pt {
  return {
    x: BASE_ORIGIN_X + (gx - gy) * (BASE_TILE_W / 2),
    y: BASE_ORIGIN_Y + (gx + gy) * (BASE_TILE_H / 2),
  };
}
// Building anchor tiles (lattice coords, centred on 0). Keep back-centre, camp/
// hut on the flanks, wall/gate at the front. Target heights scale each sprite.
const BUILDING_LAYOUT: Record<HqBuildingRole, { gx: number; gy: number; targetH: number }> = {
  keep: { gx: 0,    gy: -1.1, targetH: 300 },
  camp: { gx: -1.7, gy: 0.1,  targetH: 150 },
  hut:  { gx: 1.7,  gy: 0.1,  targetH: 158 },
  wall: { gx: 0,    gy: 1.5,  targetH: 150 },
};
// Where stationed defenders stand — a front arc between the keep and the wall.
const BASE_DEFENDER_TILES: { gx: number; gy: number }[] = [
  { gx: 0, gy: 0.6 }, { gx: -1.15, gy: 0.9 }, { gx: 1.15, gy: 0.9 },
  { gx: -0.6, gy: 0.1 }, { gx: 0.6, gy: 0.1 },
];

export async function renderBase(view: HqBaseView): Promise<Buffer | null> {
  return queueRender("hq-base", async () => {
    const mod = await getCanvas();
    if (!mod) return null;
    try {
      const canvas = mod.createCanvas(W, H);
      const ctx = canvas.getContext("2d") as unknown as Ctx;

      layerSky(ctx, view.theme);
      layerGroundSlab(ctx, view.theme);

      // Collect every placed object with its feet screen-y, then paint far→near.
      interface Item { depth: number; draw: () => Promise<void> | void }
      const items: Item[] = [];
      for (const b of view.buildings) {
        const a = BUILDING_LAYOUT[b.role];
        const p = projectBase(a.gx, a.gy);
        items.push({ depth: p.y, draw: () => drawBuilding(ctx, mod, p.x, p.y, a.targetH, b, view.theme) });
      }
      view.defenders.slice(0, BASE_DEFENDER_TILES.length).forEach((def, i) => {
        const t = BASE_DEFENDER_TILES[i]!;
        const p = projectBase(t.gx, t.gy);
        items.push({ depth: p.y + 1, draw: () => drawDefender(ctx, mod, p.x, p.y, def, view.theme) });
      });
      items.sort((a, b) => a.depth - b.depth);
      for (const it of items) await it.draw();

      layerLighting(ctx, view.theme);
      await layerHeader(ctx, mod, view);
      return await canvas.encode("png");
    } catch {
      return null;
    }
  });
}

// Outdoor sky: theme-tinted gradient with a soft horizon glow + distant hills.
function layerSky(ctx: Ctx, theme: HqTheme): void {
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, theme.palette.wallTop);
  g.addColorStop(0.55, theme.palette.wallBottom);
  g.addColorStop(1, "#05070a");
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  // Horizon glow.
  const hg = ctx.createRadialGradient(W / 2, 300, 40, W / 2, 300, 620);
  hg.addColorStop(0, hexToRgba(theme.palette.accent, 0.18));
  hg.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = hg; ctx.fillRect(0, 0, W, 380);
  // Distant hill silhouettes.
  ctx.save();
  ctx.fillStyle = "rgba(0,0,0,0.28)";
  for (const [cx, cy, rw, rh] of [[180, 300, 320, 90], [760, 300, 360, 78], [500, 306, 300, 70]] as const) {
    ctx.beginPath(); ellipse(ctx, cx, cy, rw, rh); ctx.fill();
  }
  ctx.restore();
}

// The town's ground: a big isometric slab with thickness (top diamond + two
// side faces), grass/dirt toned, with a faint tile grid on top.
function layerGroundSlab(ctx: Ctx, theme: HqTheme): void {
  const n = 2.6; // half-extent in tiles
  const top = projectBase(0, -n), right = projectBase(n, 0), bottom = projectBase(0, n), left = projectBase(-n, 0);
  const thick = 26;
  // Side faces.
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(left.x, left.y); ctx.lineTo(bottom.x, bottom.y);
  ctx.lineTo(bottom.x, bottom.y + thick); ctx.lineTo(left.x, left.y + thick); ctx.closePath();
  ctx.fillStyle = "#3a2a1c"; ctx.fill();
  ctx.beginPath();
  ctx.moveTo(right.x, right.y); ctx.lineTo(bottom.x, bottom.y);
  ctx.lineTo(bottom.x, bottom.y + thick); ctx.lineTo(right.x, right.y + thick); ctx.closePath();
  ctx.fillStyle = "#2e2115"; ctx.fill();
  // Top diamond (grass).
  ctx.beginPath();
  ctx.moveTo(top.x, top.y); ctx.lineTo(right.x, right.y); ctx.lineTo(bottom.x, bottom.y); ctx.lineTo(left.x, left.y); ctx.closePath();
  const gg = ctx.createLinearGradient(0, top.y, 0, bottom.y);
  gg.addColorStop(0, "#3f6b3a"); gg.addColorStop(1, "#2c4c2a");
  ctx.fillStyle = gg; ctx.fill();
  // Tile grid on the slab.
  ctx.clip();
  ctx.strokeStyle = "rgba(255,255,255,0.05)"; ctx.lineWidth = 1;
  for (let g = -Math.ceil(n); g <= Math.ceil(n); g++) {
    const a1 = projectBase(g, -n), a2 = projectBase(g, n);
    const b1 = projectBase(-n, g), b2 = projectBase(n, g);
    ctx.beginPath(); ctx.moveTo(a1.x, a1.y); ctx.lineTo(a2.x, a2.y); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(b1.x, b1.y); ctx.lineTo(b2.x, b2.y); ctx.stroke();
  }
  // Rim highlight.
  ctx.restore();
  ctx.save();
  ctx.strokeStyle = hexToRgba(theme.palette.accent, 0.3); ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(top.x, top.y); ctx.lineTo(right.x, right.y); ctx.lineTo(bottom.x, bottom.y); ctx.lineTo(left.x, left.y); ctx.closePath();
  ctx.stroke();
  ctx.restore();
}

// Draw one building base-anchored at (cx, feetY). Art blits to `targetH`
// (aspect-preserved) with a contact shadow; procedural fallback per role.
async function drawBuilding(
  ctx: Ctx, mod: CanvasMod, cx: number, feetY: number, targetH: number, b: HqBaseBuilding, theme: HqTheme,
): Promise<void> {
  // Contact shadow.
  ctx.save(); ctx.fillStyle = "rgba(0,0,0,0.32)";
  ctx.beginPath(); ellipse(ctx, cx, feetY, targetH * 0.34, targetH * 0.1); ctx.fill(); ctx.restore();

  if (b.spritePath) {
    const img = await loadSprite(mod, b.spritePath).catch(() => null);
    if (img) {
      const iw = Math.max(1, (img as { width: number }).width);
      const ih = Math.max(1, (img as { height: number }).height);
      const h = targetH, w = h * (iw / ih);
      blit(ctx, img, cx - w / 2, feetY - h, w, h); // bottom sits on the ground
      return;
    }
  }
  drawBuildingProcedural(ctx, cx, feetY, targetH, b.role, theme);
}

// Compact, recognisable procedural buildings (used when no art is bundled).
function drawBuildingProcedural(ctx: Ctx, cx: number, feetY: number, h: number, role: HqBuildingRole, theme: HqTheme): void {
  const stone = "#7b8089", stoneDark = "#565b64", wood = "#7a5433", roof = hexToRgba(theme.palette.accent, 0.9);
  ctx.save();
  ctx.translate(cx, feetY);
  switch (role) {
    case "keep": {
      const w = h * 0.52;
      // Tower body (tapered).
      ctx.beginPath();
      ctx.moveTo(-w / 2, 0); ctx.lineTo(-w * 0.42, -h * 0.8); ctx.lineTo(w * 0.42, -h * 0.8); ctx.lineTo(w / 2, 0); ctx.closePath();
      const gg = ctx.createLinearGradient(-w / 2, 0, w / 2, 0);
      gg.addColorStop(0, stoneDark); gg.addColorStop(0.5, stone); gg.addColorStop(1, stoneDark);
      ctx.fillStyle = gg; ctx.fill();
      // Battlements.
      ctx.fillStyle = stone;
      for (let i = -2; i <= 2; i++) ctx.fillRect(i * (w * 0.16) - w * 0.05, -h * 0.9, w * 0.1, h * 0.12);
      // Door + windows.
      ctx.fillStyle = "#20242b";
      ctx.fillRect(-w * 0.1, -h * 0.28, w * 0.2, h * 0.28);
      for (const wy of [-0.62, -0.45]) { ctx.fillRect(-w * 0.24, h * wy, w * 0.12, h * 0.08); ctx.fillRect(w * 0.12, h * wy, w * 0.12, h * 0.08); }
      // Pennant.
      ctx.strokeStyle = "#cfd3da"; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(0, -h * 0.9); ctx.lineTo(0, -h * 1.04); ctx.stroke();
      ctx.fillStyle = roof; ctx.beginPath();
      ctx.moveTo(0, -h * 1.04); ctx.lineTo(w * 0.22, -h * 0.99); ctx.lineTo(0, -h * 0.94); ctx.closePath(); ctx.fill();
      break;
    }
    case "wall": {
      const w = h * 1.7;
      ctx.fillStyle = stone;
      ctx.fillRect(-w / 2, -h * 0.62, w, h * 0.62);
      ctx.fillStyle = stoneDark;
      ctx.fillRect(-w / 2, -h * 0.62, w, h * 0.1);
      // Gate arch.
      ctx.fillStyle = "#1c2027";
      ctx.beginPath();
      ctx.moveTo(-w * 0.12, 0); ctx.lineTo(-w * 0.12, -h * 0.34);
      ctx.arc(0, -h * 0.34, w * 0.12, Math.PI, 0); ctx.lineTo(w * 0.12, 0); ctx.closePath(); ctx.fill();
      // Battlement teeth.
      ctx.fillStyle = stone;
      for (let x = -w / 2; x < w / 2; x += w * 0.12) ctx.fillRect(x, -h * 0.72, w * 0.07, h * 0.1);
      break;
    }
    case "camp": {
      const w = h * 0.9;
      // Tent.
      ctx.fillStyle = hexToRgba(theme.palette.accent, 0.8);
      ctx.beginPath(); ctx.moveTo(0, -h * 0.86); ctx.lineTo(w / 2, 0); ctx.lineTo(-w / 2, 0); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = "rgba(0,0,0,0.35)"; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(0, -h * 0.86); ctx.lineTo(0, 0); ctx.stroke();
      ctx.fillStyle = "#20242b"; // entrance
      ctx.beginPath(); ctx.moveTo(0, -h * 0.5); ctx.lineTo(w * 0.14, 0); ctx.lineTo(-w * 0.14, 0); ctx.closePath(); ctx.fill();
      // Campfire.
      ctx.fillStyle = "#e8873a"; ctx.beginPath(); ellipse(ctx, w * 0.7, -4, 8, 4); ctx.fill();
      break;
    }
    case "hut": {
      const w = h * 0.8;
      // Body.
      ctx.fillStyle = wood; ctx.fillRect(-w / 2, -h * 0.5, w, h * 0.5);
      // Roof.
      ctx.fillStyle = roof;
      ctx.beginPath(); ctx.moveTo(-w * 0.6, -h * 0.5); ctx.lineTo(0, -h * 0.86); ctx.lineTo(w * 0.6, -h * 0.5); ctx.closePath(); ctx.fill();
      // Door + window.
      ctx.fillStyle = "#20242b"; ctx.fillRect(-w * 0.12, -h * 0.28, w * 0.24, h * 0.28);
      ctx.fillStyle = "#2f6b8f"; ctx.fillRect(w * 0.18, -h * 0.38, w * 0.16, h * 0.14);
      break;
    }
  }
  ctx.restore();
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
    if (!slotIsWall(deco.slot)) continue;
    const a = WALL_ANCHORS[(deco.slot - HQ_WALL_SLOT_BASE) % WALL_ANCHORS.length]!;
    await drawDecoAt(ctx, mod, a.x, a.y, a.scale, deco, false);
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

  // Floor decorations, positioned on their exact grid tile.
  for (const deco of view.decorations) {
    if (slotIsWall(deco.slot)) continue;
    const { gx, gy } = slotToTile(deco.slot);
    const p = project(gx + 0.5, gy + 0.5); // tile centre
    items.push({ depth: p.y, draw: async () => { await drawDecoAt(ctx, mod, p.x, p.y, 0.95, deco, true); } });
  }

  // Defenders — cards standing on bases along a front arc.
  const defs = view.defenders ?? [];
  for (let i = 0; i < defs.length; i++) {
    const t = DEFENDER_TILES[i % DEFENDER_TILES.length]!;
    const p = project(t.gx, t.gy);
    const def = defs[i]!;
    items.push({ depth: p.y + 1, draw: () => drawDefender(ctx, mod, p.x, p.y, def, view.theme) });
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

// A defender: a card rendered as an upright standee figure standing on an
// isometric base (Kenney base sprite when available, else a procedural disc).
async function drawDefender(
  ctx: Ctx, mod: CanvasMod, cx: number, cy: number, def: HqRenderDefender, theme: HqTheme,
): Promise<void> {
  // Base.
  let baseTopY = cy; // where the figure's feet rest
  const baseImg = def.basePath ? await loadSprite(mod, def.basePath).catch(() => null) : null;
  ctx.save(); ctx.fillStyle = "rgba(0,0,0,0.3)";
  ctx.beginPath(); ellipse(ctx, cx, cy, 46, 16); ctx.fill(); ctx.restore();
  if (baseImg) {
    const iw = Math.max(1, (baseImg as { width: number }).width);
    const ih = Math.max(1, (baseImg as { height: number }).height);
    const w = 120, h = w * (ih / iw);
    blit(ctx, baseImg, cx - w / 2, cy - h + 8, w, h);
    baseTopY = cy - 16; // stand the figure back on the base top so the plate shows
  } else {
    // Procedural round base.
    ctx.save();
    ctx.fillStyle = hexToRgba(theme.palette.accent, 0.45);
    ctx.beginPath(); ellipse(ctx, cx, cy, 44, 15); ctx.fill();
    ctx.fillStyle = hexToRgba(theme.palette.accent, 0.28);
    ctx.beginPath(); ellipse(ctx, cx, cy - 5, 44, 15); ctx.fill();
    ctx.strokeStyle = hexToRgba(theme.palette.accent, 0.8); ctx.lineWidth = 1.5;
    ctx.beginPath(); ellipse(ctx, cx, cy - 5, 44, 15); ctx.stroke();
    ctx.restore();
    baseTopY = cy - 8;
  }

  // Standee figure: a tall rounded-top panel carrying the card art, tinted by
  // rarity, standing on the base.
  const fw = 74, fh = 104;
  const fx = cx - fw / 2, fy = baseTopY - fh;
  ctx.save();
  ctx.shadowColor = hexToRgba(def.rarityColor, 0.6); ctx.shadowBlur = 14;
  standeePath(ctx, fx, fy, fw, fh);
  ctx.fillStyle = "#0d0f14"; ctx.fill();
  ctx.restore();

  ctx.save();
  standeePath(ctx, fx, fy, fw, fh);
  ctx.clip();
  await drawCardArt(ctx, mod, fx, fy - 6, fw, fh + 12, def.artUrl);
  // Bottom gradient for the nameplate legibility.
  const g = ctx.createLinearGradient(0, fy + fh - 34, 0, fy + fh);
  g.addColorStop(0, "rgba(0,0,0,0)"); g.addColorStop(1, "rgba(0,0,0,0.8)");
  ctx.fillStyle = g; ctx.fillRect(fx, fy + fh - 34, fw, 34);
  ctx.restore();

  // Rarity border.
  ctx.save();
  standeePath(ctx, fx, fy, fw, fh);
  ctx.strokeStyle = hexToRgba(def.rarityColor, 0.95); ctx.lineWidth = 3; ctx.stroke();
  ctx.restore();

  // Name label on the figure.
  ctx.save();
  ctx.textAlign = "center"; ctx.textBaseline = "middle";
  const size = fitText(ctx, def.name, fw - 8, 13, 9, TITLE_FONT);
  drawTitle(ctx, def.name, cx, fy + fh - 14, "#ffffff", size);
  ctx.restore();
}

// A "standee" silhouette: rounded top, straight sides, flat bottom.
function standeePath(ctx: Ctx, x: number, y: number, w: number, h: number): void {
  const r = w / 2;
  ctx.beginPath();
  ctx.moveTo(x, y + r);
  ctx.arc(x + r, y + r, r, Math.PI, 0);
  ctx.lineTo(x + w, y + h);
  ctx.lineTo(x, y + h);
  ctx.closePath();
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
async function layerHeader(ctx: Ctx, mod: CanvasMod, view: HqHeaderInfo): Promise<void> {
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
