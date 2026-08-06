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
  getCanvas, roundRectPath, hexToRgba, encodeAnimation,
  type Ctx, type CanvasMod,
} from "../animations/engine.js";
import {
  loadArt, drawCardArt, drawCardFrame, drawRarityGlow,
  drawTextWithShadow, drawTitle, fitText, TITLE_FONT,
} from "../animations/effects.js";
import { drawAtmosphere, atmospherePreset } from "../animations/atmosphere.js";
import { queueRender } from "../animations/render-queue.js";
import { loadSprite, spriteForPrefix } from "./assets.js";
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
export type HqBuildingRole =
  | "castle" | "keep" | "tower" | "wall" | "cathedral" | "houses" | "village" | "camp" | "hut";

export interface HqBaseBuilding {
  role: HqBuildingRole;
  spritePath: string | null; // spriteForPrefix("building", role); null → procedural
}

export interface HqBaseView extends HqHeaderInfo {
  ownerName: string;
  buildings: HqBaseBuilding[];    // which structures the town has
  defenders: HqRenderDefender[];  // stationed cards, rendered as standees
  decorations?: HqRenderDeco[];   // player-placed grounds decorations (trees, items…)
  captured?: boolean;             // show a captured/held banner (red)
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
// A clean, cohesive PROCEDURAL isometric map (no mismatched building sprites,
// which stacked into a mess). A tiered grass island with cliff edges, a river,
// pine forests and rocks, and the player's light-stone castle crowned with an
// owner BANNER + a defence HEALTH BAR — with the stationed cards shown as framed
// DEFENDERS out front ("the cards you left to guard"). Drawn entirely on the
// canvas so it always reads as one artwork, matching the reference map.
const BASE_CX = W / 2;
const ISLAND_CY = 312;      // vertical centre of the base tier
const ISLAND_HW = 430;      // half-width of the base (top) diamond
const ISLAND_HH = 196;      // half-height
const TIER_THICK = 30;      // cliff thickness
const CASTLE_W = 150, CASTLE_H = 138;

interface Pt2 { x: number; y: number }
function diamond(cx: number, cy: number, hw: number, hh: number): Pt2[] {
  return [{ x: cx, y: cy - hh }, { x: cx + hw, y: cy }, { x: cx, y: cy + hh }, { x: cx - hw, y: cy }];
}
function polyPath(ctx: Ctx, pts: Pt2[]): void {
  ctx.beginPath(); ctx.moveTo(pts[0]!.x, pts[0]!.y);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i]!.x, pts[i]!.y);
  ctx.closePath();
}
// Deterministic RNG so a base's scenery is stable between renders.
function baseRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

// A siege overlay painted ON the base scene (no separate VS screen): the castle
// health drains, defeated defenders dim + get an ✕, the attacker champion
// advances on the castle, and a result banner lands at the end.
export interface SiegeOverlay {
  healthFrac: number;         // castle HP remaining (0..1)
  defeated: Set<number>;      // defender indices knocked out
  attacker: HqRenderDefender | null; // attacker champion assaulting
  advance: number;            // 0..1 how far the attacker has pushed in
  banner: { text: string; color: number } | null;
  caption?: { text: string; color: number } | null; // "X used <Move>!" (classic)
  flashSlot?: number | null;  // defender post taking the current hit (classic)
}

// Deterministic castle-sprite pick per base among the real building art the pack
// ships (falls back to procedural when none is bundled).
const CASTLE_SPRITE_ROLES = ["castle", "keep", "tower"];
function pickCastleSprite(view: HqBaseView): string | null {
  const avail = CASTLE_SPRITE_ROLES.map(r => spriteForPrefix("building", r)).filter((p): p is string => !!p);
  if (avail.length === 0) return null;
  let seed = 0; for (const c of (view.displayTitle || "base")) seed = (seed * 31 + c.charCodeAt(0)) | 0;
  return avail[Math.abs(seed) % avail.length]!;
}

// Screen anchors where the OWNER can place grounds decorations (trees, items…)
// on the outdoor base — spread on the grass, clear of the castle and defender row.
const BASE_DECO_TILES: { x: number; y: number }[] = [
  { x: BASE_CX - 300, y: ISLAND_CY - 6 }, { x: BASE_CX + 300, y: ISLAND_CY - 6 },
  { x: BASE_CX - 340, y: ISLAND_CY + 70 }, { x: BASE_CX + 340, y: ISLAND_CY + 70 },
  { x: BASE_CX - 210, y: ISLAND_CY + 150 }, { x: BASE_CX + 210, y: ISLAND_CY + 150 },
  { x: BASE_CX - 130, y: ISLAND_CY - 70 }, { x: BASE_CX + 150, y: ISLAND_CY - 70 },
];
export const HQ_BASE_DECO_SLOTS = BASE_DECO_TILES.length;

// Player-placed grounds decorations on the base (slot = index into BASE_DECO_TILES).
async function drawBaseDecorations(ctx: Ctx, mod: CanvasMod, view: HqBaseView): Promise<void> {
  const decos = (view.decorations ?? []).slice().sort((a, b) => {
    const pa = BASE_DECO_TILES[a.slot % BASE_DECO_TILES.length]!, pb = BASE_DECO_TILES[b.slot % BASE_DECO_TILES.length]!;
    return pa.y - pb.y;
  });
  for (const d of decos) {
    const p = BASE_DECO_TILES[d.slot % BASE_DECO_TILES.length]!;
    await drawDecoAt(ctx, mod, p.x, p.y, 0.9, d, true);
  }
}

// The whole base scene in one painter, reused for the static base view AND every
// frame of a live siege (so the siege looks identical to the base, just in motion).
async function paintBaseScene(ctx: Ctx, mod: CanvasMod, view: HqBaseView, siege?: SiegeOverlay): Promise<void> {
  ctx.fillStyle = "#0f1117"; ctx.fillRect(0, 0, W, H); // void backdrop
  drawIslandTier(ctx, BASE_CX, ISLAND_CY, ISLAND_HW, ISLAND_HH);
  drawRiver(ctx);
  const plateauCy = ISLAND_CY - 40;
  drawIslandTier(ctx, BASE_CX, plateauCy, 168, 80, true);
  drawScatter(ctx, view);
  await drawBaseDecorations(ctx, mod, view); // player-placed grounds items (behind the front row)
  const castleFeetY = plateauCy + 6;
  // Use a real castle sprite when the pack has one (deterministic pick per base),
  // else the procedural castle. drawCastle returns the top for the banner.
  const castleTop = await drawCastle(ctx, mod, BASE_CX, castleFeetY, pickCastleSprite(view));
  drawBannerAndHealth(ctx, BASE_CX, castleTop, view, siege?.healthFrac);
  await drawBaseDefenders(ctx, mod, view, siege?.defeated, siege?.flashSlot ?? null);
  if (siege?.attacker) await drawAttacker(ctx, mod, siege.attacker, siege.advance);
  const lg = ctx.createRadialGradient(BASE_CX, 120, 60, BASE_CX, 300, 640);
  lg.addColorStop(0, "rgba(255,244,214,0.10)"); lg.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = lg; ctx.fillRect(0, 0, W, H);
  if (siege?.caption) drawMoveCaption(ctx, siege.caption.text, siege.caption.color);
  if (siege?.banner) drawResultBanner(ctx, siege.banner.text, siege.banner.color);
  await layerHeader(ctx, mod, view);
}

export async function renderBase(view: HqBaseView): Promise<Buffer | null> {
  return queueRender("hq-base", async () => {
    const mod = await getCanvas();
    if (!mod) return null;
    try {
      const canvas = mod.createCanvas(W, H);
      const ctx = canvas.getContext("2d") as unknown as Ctx;
      await paintBaseScene(ctx, mod, view);
      return await canvas.encode("png");
    } catch { return null; }
  });
}

// ── Siege on the base scene (static frame OR live GIF) ────────────────────────
export interface SiegePlan {
  duels: { slot: number; attackerWon: boolean; move: string }[]; // in order; slot = defender index
  defenderCount: number;
  captured: boolean;
  attacker: HqRenderDefender | null;
  attackerName: string;
  defenderName: string;
}

// The overlay state at battle progress p (0=start, 1=resolved+banner). When
// `showMoves` is on (CLASSIC mode) the current duel surfaces a move caption and
// flashes the defender being hit — the move-by-move battle, on the castle.
function siegeStateAt(plan: SiegePlan, p: number, showMoves: boolean): SiegeOverlay {
  const D = plan.duels.length;
  const step = p * (D + 0.999);
  const resolved = Math.min(D, Math.floor(step)); // fully-resolved duels
  const defeated = new Set<number>();
  let fallen = 0;
  for (let i = 0; i < resolved; i++) { const d = plan.duels[i]!; if (d.attackerWon) { defeated.add(d.slot); fallen++; } }
  const remainingFrac = plan.defenderCount > 0 ? (plan.defenderCount - fallen) / plan.defenderCount : 0;
  const done = resolved >= D;
  const healthFrac = done && plan.captured ? 0 : remainingFrac;
  const banner = done
    ? (plan.captured
      ? { text: `⚔️ ${plan.attackerName} CAPTURED THE BASE`, color: 0xc0392b }
      : { text: `🛡️ ${plan.defenderName} HELD THE BASE`, color: 0x4fd06a })
    : null;
  const current = !done ? plan.duels[resolved] : undefined; // the duel being fought now
  const caption = showMoves && current
    ? { text: `${plan.attacker?.name ?? plan.attackerName} used ${current.move}!`, color: current.attackerWon ? 0x4fd06a : 0xd0483a }
    : null;
  const flashSlot = showMoves && current ? current.slot : null;
  return { healthFrac, defeated, attacker: plan.attacker, advance: Math.min(1, p * 1.15), banner, caption, flashSlot };
}

export async function renderSiege(view: HqBaseView, plan: SiegePlan, live: boolean, showMoves = false): Promise<Buffer | null> {
  if (!live) {
    return queueRender("hq-siege", async () => {
      const mod = await getCanvas();
      if (!mod) return null;
      try {
        const canvas = mod.createCanvas(W, H);
        const ctx = canvas.getContext("2d") as unknown as Ctx;
        await paintBaseScene(ctx, mod, view, siegeStateAt(plan, 1, false));
        return await canvas.encode("png");
      } catch { return null; }
    });
  }
  // Classic (moves) runs a touch slower + more frames so captions are readable.
  const res = await encodeAnimation({
    width: W, height: H, speed: "normal", durationMs: showMoves ? 3600 : 2800,
    maxFrames: showMoves ? 26 : 20, quality: 26, renderScale: 0.6,
    render: async ({ ctx, t, mod }) => { await paintBaseScene(ctx as unknown as Ctx, mod, view, siegeStateAt(plan, t, showMoves)); },
  });
  return res?.buffer ?? null;
}

// The attacker champion assaulting the castle: a framed card that advances from
// the front of the island up toward the gate as the battle progresses.
async function drawAttacker(ctx: Ctx, mod: CanvasMod, def: HqRenderDefender, advance: number): Promise<void> {
  const cw = 78, ch = 104;
  const x = BASE_CX - cw / 2;
  const y = lerp({ x: 0, y: ISLAND_CY + 150 }, { x: 0, y: ISLAND_CY + 34 }, advance).y - ch / 2;
  ctx.save(); ctx.fillStyle = "rgba(0,0,0,0.34)"; ctx.beginPath(); ellipse(ctx, x + cw / 2, y + ch, cw * 0.5, 9); ctx.fill(); ctx.restore();
  ctx.save(); ctx.shadowColor = hexToRgba(def.rarityColor, 0.7); ctx.shadowBlur = 14;
  roundRectPath(ctx, x, y, cw, ch, 8); ctx.fillStyle = "#0d0f14"; ctx.fill(); ctx.restore();
  ctx.save(); roundRectPath(ctx, x, y, cw, ch, 8); ctx.clip();
  await drawCardArt(ctx, mod, x, y, cw, ch, def.artUrl);
  ctx.restore();
  ctx.save(); roundRectPath(ctx, x, y, cw, ch, 8); ctx.strokeStyle = hexToRgba(def.rarityColor, 0.95); ctx.lineWidth = 3; ctx.stroke(); ctx.restore();
  ctx.save(); ctx.textAlign = "center"; ctx.textBaseline = "middle";
  drawTextWithShadow(ctx, "⚔️", x + cw / 2, y - 8, "#ffffff", 20);
  ctx.restore();
}

function drawResultBanner(ctx: Ctx, text: string, color: number): void {
  ctx.save();
  const bw = W - 160, bh = 60, bx = 80, by = H / 2 - 30;
  ctx.fillStyle = "rgba(0,0,0,0.72)"; roundRectPath(ctx, bx, by, bw, bh, 16); ctx.fill();
  ctx.strokeStyle = hexToRgba(color, 0.95); ctx.lineWidth = 3; roundRectPath(ctx, bx, by, bw, bh, 16); ctx.stroke();
  ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.shadowColor = hexToRgba(color, 0.8); ctx.shadowBlur = 16;
  drawTitle(ctx, text, W / 2, by + bh / 2, "#ffffff", fitText(ctx, text, bw - 40, 30, 16, TITLE_FONT));
  ctx.restore();
}

// One terraced slab: grass top (with tile shimmer + rim), and two cliff faces
// (front-left, front-right) banded dirt→rock for a chunky floating look.
function drawIslandTier(ctx: Ctx, cx: number, cy: number, hw: number, hh: number, raised = false): void {
  const [top, right, bottom, left] = diamond(cx, cy, hw, hh) as [Pt2, Pt2, Pt2, Pt2];
  const thick = raised ? 20 : TIER_THICK;
  // Cliff faces.
  ctx.fillStyle = "#5b4327";
  polyPath(ctx, [left, bottom, { x: bottom.x, y: bottom.y + thick }, { x: left.x, y: left.y + thick }]); ctx.fill();
  ctx.fillStyle = "#463322";
  polyPath(ctx, [right, bottom, { x: bottom.x, y: bottom.y + thick }, { x: right.x, y: right.y + thick }]); ctx.fill();
  // Rock band at the very bottom of each face.
  ctx.fillStyle = "rgba(0,0,0,0.28)";
  polyPath(ctx, [{ x: left.x, y: left.y + thick - 6 }, { x: bottom.x, y: bottom.y + thick - 6 }, { x: bottom.x, y: bottom.y + thick }, { x: left.x, y: left.y + thick }]); ctx.fill();
  polyPath(ctx, [{ x: right.x, y: right.y + thick - 6 }, { x: bottom.x, y: bottom.y + thick - 6 }, { x: bottom.x, y: bottom.y + thick }, { x: right.x, y: right.y + thick }]); ctx.fill();
  // Grass top.
  polyPath(ctx, [top, right, bottom, left]);
  const gg = ctx.createLinearGradient(0, top.y, 0, bottom.y);
  gg.addColorStop(0, raised ? "#5a8a44" : "#4f7f3c"); gg.addColorStop(1, raised ? "#3f6a32" : "#365c2b");
  ctx.fillStyle = gg; ctx.fill();
  // Faint tile shimmer.
  ctx.save(); polyPath(ctx, [top, right, bottom, left]); ctx.clip();
  ctx.strokeStyle = "rgba(255,255,255,0.05)"; ctx.lineWidth = 1;
  const step = hw / 6;
  for (let i = -6; i <= 6; i++) {
    ctx.beginPath(); ctx.moveTo(cx + i * step, cy - hh); ctx.lineTo(cx + i * step + hw, cy); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(cx + i * step, cy - hh); ctx.lineTo(cx + i * step - hw, cy); ctx.stroke();
  }
  ctx.restore();
  // Sunlit top rim.
  ctx.strokeStyle = "rgba(180,220,150,0.5)"; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(left.x, left.y); ctx.lineTo(top.x, top.y); ctx.lineTo(right.x, right.y); ctx.stroke();
}

// A meandering river across the base tier, clipped to the grass, with a bridge.
function drawRiver(ctx: Ctx): void {
  const [top, right, bottom, left] = diamond(BASE_CX, ISLAND_CY, ISLAND_HW, ISLAND_HH) as [Pt2, Pt2, Pt2, Pt2];
  ctx.save();
  polyPath(ctx, [top, right, bottom, left]); ctx.clip();
  const pts: Pt2[] = [
    { x: BASE_CX + 210, y: ISLAND_CY - 150 },
    { x: BASE_CX + 90, y: ISLAND_CY - 40 },
    { x: BASE_CX + 150, y: ISLAND_CY + 60 },
    { x: BASE_CX + 20, y: ISLAND_CY + 150 },
  ];
  (ctx as unknown as { lineCap: string; lineJoin: string }).lineCap = "round";
  (ctx as unknown as { lineCap: string; lineJoin: string }).lineJoin = "round";
  ctx.strokeStyle = "#2f5d86"; ctx.lineWidth = 30;
  ctx.beginPath(); ctx.moveTo(pts[0]!.x, pts[0]!.y);
  for (let i = 1; i < pts.length; i++) { const p = pts[i]!, pv = pts[i - 1]!; ctx.quadraticCurveTo(pv.x, (pv.y + p.y) / 2, p.x, p.y); }
  ctx.stroke();
  ctx.strokeStyle = "#4a86bd"; ctx.lineWidth = 18;
  ctx.beginPath(); ctx.moveTo(pts[0]!.x, pts[0]!.y);
  for (let i = 1; i < pts.length; i++) { const p = pts[i]!, pv = pts[i - 1]!; ctx.quadraticCurveTo(pv.x, (pv.y + p.y) / 2, p.x, p.y); }
  ctx.stroke();
  ctx.strokeStyle = "rgba(200,230,255,0.4)"; ctx.lineWidth = 4;
  ctx.beginPath(); ctx.moveTo(pts[0]!.x, pts[0]!.y);
  for (let i = 1; i < pts.length; i++) { const p = pts[i]!, pv = pts[i - 1]!; ctx.quadraticCurveTo(pv.x, (pv.y + p.y) / 2, p.x, p.y); }
  ctx.stroke();
  ctx.restore();
  // Bridge across the lower bend.
  const bx = BASE_CX + 95, by = ISLAND_CY + 95;
  ctx.save(); ctx.translate(bx, by); ctx.rotate(-0.5);
  ctx.fillStyle = "#8a6a3f"; ctx.fillRect(-30, -12, 60, 24);
  ctx.fillStyle = "#6b4f2c"; for (let i = -28; i < 30; i += 8) ctx.fillRect(i, -12, 4, 24);
  ctx.restore();
}

// Seeded pine forests + rocks scattered on the base grass, avoiding the plateau,
// the river and the very centre.
function drawScatter(ctx: Ctx, view: HqBaseView): void {
  let seed = 0; for (const c of (view.displayTitle || "base")) seed = (seed * 31 + c.charCodeAt(0)) | 0;
  const rnd = baseRng(seed);
  const inRiver = (x: number, y: number) => Math.abs((x - BASE_CX) - (ISLAND_CY - y) * 0.4) < 46 && y > ISLAND_CY - 150 && y < ISLAND_CY + 150;
  let placed = 0, tries = 0;
  while (placed < 26 && tries++ < 400) {
    const u = rnd() * 2 - 1, v = rnd() * 2 - 1;
    if (Math.abs(u) + Math.abs(v) > 0.96) continue;              // inside diamond
    const x = BASE_CX + u * ISLAND_HW, y = ISLAND_CY + v * ISLAND_HH;
    if (Math.abs(u) + Math.abs(v) < 0.34) continue;             // keep centre for the castle
    if (inRiver(x, y)) continue;
    const s = 0.8 + rnd() * 0.5;
    if (rnd() < 0.8) drawPine(ctx, x, y, s); else drawRock(ctx, x, y, s);
    placed++;
  }
}

function drawPine(ctx: Ctx, x: number, y: number, s: number): void {
  ctx.save();
  ctx.fillStyle = "rgba(0,0,0,0.22)"; ctx.beginPath(); ellipse(ctx, x, y, 12 * s, 5 * s); ctx.fill();
  ctx.fillStyle = "#5a3d22"; ctx.fillRect(x - 2 * s, y - 10 * s, 4 * s, 10 * s);
  for (let i = 0; i < 3; i++) {
    const ty = y - 6 * s - i * 12 * s, wsp = (16 - i * 3) * s;
    ctx.fillStyle = i === 0 ? "#2f6b34" : i === 1 ? "#357a3b" : "#3d8a43";
    ctx.beginPath(); ctx.moveTo(x, ty - 16 * s); ctx.lineTo(x + wsp, ty); ctx.lineTo(x - wsp, ty); ctx.closePath(); ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,0.12)";
    ctx.beginPath(); ctx.moveTo(x, ty - 16 * s); ctx.lineTo(x - wsp, ty); ctx.lineTo(x - wsp * 0.4, ty); ctx.closePath(); ctx.fill();
  }
  ctx.restore();
}

function drawRock(ctx: Ctx, x: number, y: number, s: number): void {
  ctx.save();
  ctx.fillStyle = "rgba(0,0,0,0.22)"; ctx.beginPath(); ellipse(ctx, x, y, 16 * s, 6 * s); ctx.fill();
  ctx.fillStyle = "#8b9099"; ctx.beginPath();
  ctx.moveTo(x - 16 * s, y); ctx.lineTo(x - 8 * s, y - 16 * s); ctx.lineTo(x + 6 * s, y - 18 * s); ctx.lineTo(x + 16 * s, y - 4 * s); ctx.closePath(); ctx.fill();
  ctx.fillStyle = "#a9aeb6"; ctx.beginPath();
  ctx.moveTo(x - 8 * s, y - 16 * s); ctx.lineTo(x + 6 * s, y - 18 * s); ctx.lineTo(x + 2 * s, y - 8 * s); ctx.lineTo(x - 4 * s, y - 8 * s); ctx.closePath(); ctx.fill();
  ctx.restore();
}

// A clean light-stone castle: central keep + two crenellated towers, front-iso.
// Draw the castle and return the Y of its top (where the banner/health sit).
// Uses a real castle SPRITE when one is bundled; otherwise a clean procedural
// castle. Either way the feet sit on the plateau at `feetY`.
async function drawCastle(ctx: Ctx, mod: CanvasMod, cx: number, feetY: number, spritePath: string | null): Promise<number> {
  ctx.save(); ctx.fillStyle = "rgba(0,0,0,0.34)"; ctx.beginPath(); ellipse(ctx, cx, feetY, CASTLE_W * 0.62, 18); ctx.fill(); ctx.restore();
  if (spritePath) {
    const img = await loadSprite(mod, spritePath).catch(() => null);
    if (img) {
      const iw = Math.max(1, (img as { width: number }).width);
      const ih = Math.max(1, (img as { height: number }).height);
      const h = 250, w = h * (iw / ih);
      blit(ctx, img, cx - w / 2, feetY - h, w, h);
      return feetY - h + 24; // banner just above the towers
    }
  }
  return drawCastleProcedural(ctx, cx, feetY);
}

function drawCastleProcedural(ctx: Ctx, cx: number, feetY: number): number {
  const stoneL = "#d8d2c0", stone = "#c3bca7", stoneD = "#9a927c", dark = "#2a2620";

  const crenel = (x: number, w: number, topY: number) => {
    ctx.fillStyle = stone;
    const teeth = Math.max(3, Math.floor(w / 12));
    const tw = w / (teeth * 2 - 1);
    for (let i = 0; i < teeth; i++) ctx.fillRect(x + i * tw * 2, topY, tw, 8);
  };
  const tower = (tx: number, tw: number, th: number) => {
    const g = ctx.createLinearGradient(tx, 0, tx + tw, 0);
    g.addColorStop(0, stoneL); g.addColorStop(0.5, stone); g.addColorStop(1, stoneD);
    ctx.fillStyle = g; ctx.fillRect(tx, feetY - th, tw, th);
    crenel(tx - 2, tw + 4, feetY - th - 8);
    ctx.fillStyle = dark; // slit windows
    for (const wy of [0.72, 0.5, 0.28]) { ctx.fillRect(tx + tw * 0.42, feetY - th * wy, tw * 0.16, th * 0.12); }
  };

  // Back central keep (tallest).
  const keepW = CASTLE_W * 0.34;
  tower(cx - keepW / 2, keepW, CASTLE_H);
  // Front curtain wall.
  const wallW = CASTLE_W * 0.86, wallH = CASTLE_H * 0.52;
  const wg = ctx.createLinearGradient(cx - wallW / 2, 0, cx + wallW / 2, 0);
  wg.addColorStop(0, stoneL); wg.addColorStop(1, stoneD);
  ctx.fillStyle = wg; ctx.fillRect(cx - wallW / 2, feetY - wallH, wallW, wallH);
  crenel(cx - wallW / 2, wallW, feetY - wallH - 8);
  // Gate.
  ctx.fillStyle = dark;
  ctx.beginPath();
  ctx.moveTo(cx - wallW * 0.1, feetY); ctx.lineTo(cx - wallW * 0.1, feetY - wallH * 0.5);
  ctx.arc(cx, feetY - wallH * 0.5, wallW * 0.1, Math.PI, 0); ctx.lineTo(cx + wallW * 0.1, feetY); ctx.closePath(); ctx.fill();
  // Two front corner towers.
  const ctw = CASTLE_W * 0.2, cth = CASTLE_H * 0.78;
  tower(cx - wallW / 2 - ctw * 0.3, ctw, cth);
  tower(cx + wallW / 2 - ctw * 0.7, ctw, cth);
  return feetY - CASTLE_H - 8;
}

// Owner banner (colour + crest) hanging from a pole, with a defence health bar
// floating above the castle — exactly the "banner + HP bar on top" from the mock.
function drawBannerAndHealth(ctx: Ctx, cx: number, castleTopY: number, view: HqBaseView, healthFrac?: number): void {
  const owner = view.captured ? 0xc0392b : 0x3f78c8; // red if captured, else blue (self)
  const barY = castleTopY - 54, barW = 96, barH = 9;
  // Health = the siege's remaining castle HP when besieged, else share of posts filled.
  const filled = healthFrac ?? Math.min(1, (view.defenders?.length ?? 0) / Math.max(1, HQ_DEFENDER_SLOTS));
  ctx.save();
  ctx.fillStyle = "rgba(0,0,0,0.6)"; roundRectPath(ctx, cx - barW / 2 - 2, barY - 2, barW + 4, barH + 4, 5); ctx.fill();
  ctx.fillStyle = "#203020"; roundRectPath(ctx, cx - barW / 2, barY, barW, barH, 4); ctx.fill();
  const hpCol = filled > 0.5 ? "#4fd06a" : filled > 0.25 ? "#e0b83a" : "#d0483a"; // green→amber→red
  ctx.fillStyle = hpCol; roundRectPath(ctx, cx - barW / 2, barY, Math.max(2, barW * filled), barH, 4); ctx.fill();
  ctx.restore();
  // Banner pole + cloth.
  const poleTop = barY + 14, cloth = 44, bw = 34;
  ctx.strokeStyle = "#c9c1a8"; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.moveTo(cx, poleTop); ctx.lineTo(cx, castleTopY + 6); ctx.stroke();
  ctx.fillStyle = hexToRgba(owner, 1);
  ctx.beginPath();
  ctx.moveTo(cx - bw / 2, poleTop); ctx.lineTo(cx + bw / 2, poleTop);
  ctx.lineTo(cx + bw / 2, poleTop + cloth); ctx.lineTo(cx, poleTop + cloth - 10); ctx.lineTo(cx - bw / 2, poleTop + cloth);
  ctx.closePath(); ctx.fill();
  ctx.fillStyle = "rgba(0,0,0,0.18)"; ctx.fillRect(cx, poleTop, bw / 2, cloth - 5); // shaded half
  // Crest (a simple 4-point star).
  ctx.fillStyle = "rgba(255,255,255,0.95)";
  const sc = 8, cyC = poleTop + 18;
  ctx.beginPath();
  ctx.moveTo(cx, cyC - sc); ctx.lineTo(cx + sc * 0.32, cyC - sc * 0.32); ctx.lineTo(cx + sc, cyC);
  ctx.lineTo(cx + sc * 0.32, cyC + sc * 0.32); ctx.lineTo(cx, cyC + sc); ctx.lineTo(cx - sc * 0.32, cyC + sc * 0.32);
  ctx.lineTo(cx - sc, cyC); ctx.lineTo(cx - sc * 0.32, cyC - sc * 0.32); ctx.closePath(); ctx.fill();
}

// The stationed cards, shown as small framed portraits standing in front of the
// castle — "the cards you left to defend." Each: card art + rarity border + name.
async function drawBaseDefenders(ctx: Ctx, mod: CanvasMod, view: HqBaseView, defeated?: Set<number>, flashSlot?: number | null): Promise<void> {
  const defs = view.defenders ?? [];
  if (defs.length === 0) return;
  const n = Math.min(defs.length, 5);
  const cw = 74, ch = 96, gap = 14;
  const totalW = n * cw + (n - 1) * gap;
  const startX = BASE_CX - totalW / 2;
  const rowY = ISLAND_CY + 96;
  for (let i = 0; i < n; i++) {
    const def = defs[i]!;
    const hit = flashSlot === i;
    const jitter = hit ? (Math.random() * 6 - 3) : 0;
    const x = startX + i * (cw + gap) + jitter, y = rowY - ch;
    const down = defeated?.has(i) ?? false;
    ctx.save(); ctx.fillStyle = "rgba(0,0,0,0.32)"; ctx.beginPath(); ellipse(ctx, x + cw / 2, rowY, cw * 0.5, 9); ctx.fill(); ctx.restore();
    ctx.save();
    ctx.shadowColor = hexToRgba(def.rarityColor, down ? 0.15 : 0.6); ctx.shadowBlur = 12;
    roundRectPath(ctx, x, y, cw, ch, 8); ctx.fillStyle = "#0d0f14"; ctx.fill();
    ctx.restore();
    ctx.save(); roundRectPath(ctx, x, y, cw, ch, 8); ctx.clip();
    await drawCardArt(ctx, mod, x, y, cw, ch, def.artUrl);
    const g = ctx.createLinearGradient(0, y + ch - 28, 0, y + ch);
    g.addColorStop(0, "rgba(0,0,0,0)"); g.addColorStop(1, "rgba(0,0,0,0.82)");
    ctx.fillStyle = g; ctx.fillRect(x, y + ch - 28, cw, 28);
    if (down) { ctx.fillStyle = "rgba(0,0,0,0.6)"; ctx.fillRect(x, y, cw, ch); } // knocked out
    ctx.restore();
    ctx.save(); roundRectPath(ctx, x, y, cw, ch, 8);
    ctx.strokeStyle = hexToRgba(down ? 0x555a63 : def.rarityColor, 0.95); ctx.lineWidth = 3; ctx.stroke(); ctx.restore();
    ctx.save(); ctx.textAlign = "center"; ctx.textBaseline = "middle";
    drawTitle(ctx, def.name, x + cw / 2, y + ch - 12, down ? "#9aa0a8" : "#ffffff", fitText(ctx, def.name, cw - 8, 12, 9, TITLE_FONT));
    if (down) { // red ✕ over the fallen defender
      ctx.strokeStyle = "rgba(220,70,60,0.9)"; ctx.lineWidth = 5; ctx.beginPath();
      ctx.moveTo(x + 14, y + 20); ctx.lineTo(x + cw - 14, y + ch - 34);
      ctx.moveTo(x + cw - 14, y + 20); ctx.lineTo(x + 14, y + ch - 34); ctx.stroke();
    }
    ctx.restore();
    if (hit && !down) { // impact flash on the defender taking the current blow
      ctx.save(); roundRectPath(ctx, x, y, cw, ch, 8);
      ctx.fillStyle = "rgba(255,240,180,0.5)"; ctx.fill();
      ctx.strokeStyle = "rgba(255,255,255,0.95)"; ctx.lineWidth = 4; ctx.stroke();
      ctx.restore();
      ctx.save(); ctx.textAlign = "center"; ctx.textBaseline = "middle";
      drawTextWithShadow(ctx, "💥", x + cw / 2, y + ch / 2, "#ffffff", 34);
      ctx.restore();
    }
  }
}

// A move caption banner (classic mode) — "X used <Move>!" high on the scene.
function drawMoveCaption(ctx: Ctx, text: string, color: number): void {
  ctx.save();
  ctx.font = `bold 22px "${TITLE_FONT}", "DejaVu Sans", Arial, sans-serif`;
  const w = Math.min(W - 80, ctx.measureText(text).width + 48), h = 40, x = (W - w) / 2, y = 86;
  ctx.fillStyle = "rgba(0,0,0,0.72)"; roundRectPath(ctx, x, y, w, h, 12); ctx.fill();
  ctx.strokeStyle = hexToRgba(color, 0.95); ctx.lineWidth = 2; roundRectPath(ctx, x, y, w, h, 12); ctx.stroke();
  ctx.textAlign = "center"; ctx.textBaseline = "middle";
  drawTitle(ctx, text, W / 2, y + h / 2, "#ffffff", 20);
  ctx.restore();
}

// ── World map (top-level: bases to raid) ─────────────────────────────────────
export interface WorldBaseMarker {
  name: string;
  defenders: number;
  maxDefenders: number;
  held: boolean;      // currently under someone else's flag
  color: number;      // banner colour (per base)
}
export interface HqWorldView extends HqHeaderInfo { markers: WorldBaseMarker[] }

// Anchor slots for up to 8 castles, spread across the map like the reference.
const WORLD_ANCHORS: { x: number; y: number }[] = [
  { x: 300, y: 210 }, { x: 520, y: 180 }, { x: 720, y: 210 },
  { x: 210, y: 320 }, { x: 520, y: 300 }, { x: 800, y: 320 },
  { x: 360, y: 420 }, { x: 660, y: 420 },
];

export async function renderWorldMap(view: HqWorldView): Promise<Buffer | null> {
  return queueRender("hq-world", async () => {
    const mod = await getCanvas();
    if (!mod) return null;
    try {
      const canvas = mod.createCanvas(W, H);
      const ctx = canvas.getContext("2d") as unknown as Ctx;
      ctx.fillStyle = "#0f1117"; ctx.fillRect(0, 0, W, H);
      // A big terraced landmass.
      drawIslandTier(ctx, W / 2, 330, 470, 240);
      const castleImg = await (async () => {
        const p = spriteForPrefix("building", "castle") ?? spriteForPrefix("building", "keep");
        return p ? await loadSprite(mod, p).catch(() => null) : null;
      })();
      const markers = view.markers.slice(0, WORLD_ANCHORS.length)
        .map((m, i) => ({ m, a: WORLD_ANCHORS[i]! }))
        .sort((p, q) => p.a.y - q.a.y);
      for (const { m, a } of markers) drawMiniCastle(ctx, mod, a.x, a.y, m, castleImg);
      const lg = ctx.createRadialGradient(W / 2, 120, 60, W / 2, 300, 700);
      lg.addColorStop(0, "rgba(255,244,214,0.08)"); lg.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = lg; ctx.fillRect(0, 0, W, H);
      await layerHeader(ctx, mod, view);
      return await canvas.encode("png");
    } catch { return null; }
  });
}

function drawMiniCastle(ctx: Ctx, _mod: CanvasMod, cx: number, feetY: number, m: WorldBaseMarker, img: unknown): void {
  ctx.save(); ctx.fillStyle = "rgba(0,0,0,0.34)"; ctx.beginPath(); ellipse(ctx, cx, feetY, 44, 13); ctx.fill(); ctx.restore();
  if (img) {
    const iw = Math.max(1, (img as { width: number }).width), ih = Math.max(1, (img as { height: number }).height);
    const h = 108, w = h * (iw / ih);
    blit(ctx, img, cx - w / 2, feetY - h, w, h);
  } else {
    ctx.fillStyle = "#c3bca7"; ctx.fillRect(cx - 26, feetY - 60, 52, 60);
    ctx.fillStyle = "#9a927c"; for (let i = 0; i < 4; i++) ctx.fillRect(cx - 26 + i * 15, feetY - 68, 8, 8);
  }
  // Banner + health bar above (owner colour / red if held).
  const topY = feetY - 128;
  const owner = m.held ? 0xc0392b : m.color;
  const barW = 74, barH = 8, barY = topY - 4;
  ctx.fillStyle = "rgba(0,0,0,0.6)"; roundRectPath(ctx, cx - barW / 2 - 2, barY - 2, barW + 4, barH + 4, 5); ctx.fill();
  ctx.fillStyle = "#203020"; roundRectPath(ctx, cx - barW / 2, barY, barW, barH, 4); ctx.fill();
  const frac = m.maxDefenders > 0 ? m.defenders / m.maxDefenders : 0;
  ctx.fillStyle = frac > 0.5 ? "#4fd06a" : frac > 0.25 ? "#e0b83a" : "#d0483a";
  roundRectPath(ctx, cx - barW / 2, barY, Math.max(2, barW * frac), barH, 4); ctx.fill();
  // Small pennant.
  ctx.strokeStyle = "#c9c1a8"; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(cx, barY + 12); ctx.lineTo(cx, topY + 34); ctx.stroke();
  ctx.fillStyle = hexToRgba(owner, 1);
  ctx.beginPath(); ctx.moveTo(cx - 12, barY + 12); ctx.lineTo(cx + 12, barY + 12); ctx.lineTo(cx + 12, barY + 30); ctx.lineTo(cx, barY + 24); ctx.lineTo(cx - 12, barY + 30); ctx.closePath(); ctx.fill();
  // Name plate.
  ctx.save();
  ctx.textAlign = "center"; ctx.textBaseline = "middle";
  const label = m.held ? `${m.name} (held)` : m.name;
  ctx.font = `bold 13px "${TITLE_FONT}", "DejaVu Sans", Arial, sans-serif`;
  const lw = Math.min(180, ctx.measureText(label).width + 16);
  ctx.fillStyle = "rgba(0,0,0,0.66)"; roundRectPath(ctx, cx - lw / 2, feetY + 4, lw, 20, 8); ctx.fill();
  drawTextWithShadow(ctx, label, cx, feetY + 14, m.held ? "#ff9a8a" : "#ffffff", 13);
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
      // Small source art = pixel sprite (e.g. 16px figurines): render crisp
      // (nearest-neighbour) and modestly sized so it doesn't blur or tower.
      const pixel = iw <= 48;
      const smooth = ctx as unknown as { imageSmoothingEnabled: boolean };
      if (pixel) smooth.imageSmoothingEnabled = false;
      if (grounded) {
        const h = pixel ? 76 * scale : 120 * scale * (ih / iw);
        const w = pixel ? h * (iw / ih) : 120 * scale;
        ctx.save(); ctx.fillStyle = "rgba(0,0,0,0.28)";
        ctx.beginPath(); ellipse(ctx, x, y, w * 0.3, w * 0.11); ctx.fill(); ctx.restore();
        blit(ctx, img, x - w / 2, y - h + 6, w, h); // bottom sits on the tile
      } else {
        const h = 88 * scale, w = h * (iw / ih);
        blit(ctx, img, x - w / 2, y - h / 2, w, h);
      }
      if (pixel) smooth.imageSmoothingEnabled = true;
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
    case "tree": {
      ctx.shadowBlur = 0;
      ctx.fillStyle = "#5a3d22"; ctx.fillRect(-s * 0.06, s * 0.2, s * 0.12, s * 0.32); // trunk
      for (let i = 0; i < 3; i++) {
        const ty = s * 0.2 - i * s * 0.26, wsp = s * (0.34 - i * 0.07);
        ctx.fillStyle = i === 0 ? "#2f6b34" : i === 1 ? "#357a3b" : "#3d8a43";
        ctx.beginPath(); ctx.moveTo(0, ty - s * 0.34); ctx.lineTo(wsp, ty); ctx.lineTo(-wsp, ty); ctx.closePath(); ctx.fill();
      }
      break;
    }
    case "rock": {
      ctx.shadowBlur = 0;
      ctx.fillStyle = "#8b9099"; ctx.beginPath();
      ctx.moveTo(-s * 0.34, s * 0.2); ctx.lineTo(-s * 0.16, -s * 0.24); ctx.lineTo(s * 0.14, -s * 0.28);
      ctx.lineTo(s * 0.34, s * 0.06); ctx.lineTo(s * 0.2, s * 0.2); ctx.closePath(); ctx.fill();
      ctx.fillStyle = "#a9aeb6"; ctx.beginPath();
      ctx.moveTo(-s * 0.16, -s * 0.24); ctx.lineTo(s * 0.14, -s * 0.28); ctx.lineTo(s * 0.04, -s * 0.06); ctx.lineTo(-s * 0.08, -s * 0.06); ctx.closePath(); ctx.fill();
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
