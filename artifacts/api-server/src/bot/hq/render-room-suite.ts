// ─────────────────────────────────────────────────────────────────────────────
// HQ — the room SUITE renderer ("the mini hotel", indoors).
//
// Paints a whole floor of connected rooms in isometric, from the real sprite
// art: a landscape subfloor, stone partitions with doorways and windows, and
// furniture standing on the tiles or hung on the walls.
//
// Two things make it read as a room rather than a tile grid:
//
//  • DOLLHOUSE CUTAWAY. Only the two FAR walls of any run are drawn. Near walls
//    would stand between the camera and the furniture, so they're skipped — the
//    same trick the reference art uses to keep an interior readable.
//  • DEPTH ORDER. Everything is emitted into one list and painted back-to-front
//    by (x + y), with walls before the props on the same tile, so a chest in
//    front of a wall overlaps it and a chest behind one is overlapped.
//
// The palette is deliberately charcoal: the source art is warm sandstone, so a
// cool wash is composited over the masonry and a warm torch pool laid back on
// top. That's what matches the dark interiors in the design reference while
// still using the CC0 art as-is.
//
// This module only draws INTERIORS. The outdoor base renderer is untouched.
// ─────────────────────────────────────────────────────────────────────────────

import { getCanvas, type Ctx, type CanvasMod } from "../animations/engine.js";
import { queueRender } from "../animations/render-queue.js";
import { drawHqHeader, type HqHeaderInfo } from "./paint.js";
import { loadSprite, spriteForPrefix } from "./assets.js";
import {
  suiteWalls, suiteFloorSprite, suiteWallSprite, roomAt,
  type SuiteLayout, type SuiteAxis, type SuiteItem,
} from "./defs/room-suites.js";
import { logger } from "../../lib/logger.js";

const W = 1120, H = 700;

// Sprite geometry, measured off the pack: every 256x512 tile sprite carries its
// top-face diamond (180x90) centred at (127.5, 440). Anchoring to that point —
// not to the image corner — is what lets floors, walls and props share a grid.
const SPRITE_W = 256, SPRITE_H = 512;
const ANCHOR_X = 127.5, ANCHOR_Y = 440;
const TILE_W = 180, TILE_H = 90;

// Furniture is drawn larger than its natural tile size: the source props are
// modelled to sit one-per-tile on a dense dungeon grid, and at a whole floor's
// zoom they'd otherwise read as specks on the stone. Wall fittings stay small —
// they hang on masonry, they don't stand on the ground.
const FLOOR_ITEM_SCALE = 1.55;
const WALL_ITEM_SCALE = 0.62;
// How far up the masonry a wall fitting hangs, in tile units. Tuned so the
// emblem sits ON the wall face rather than hovering above its top edge.
const WALL_MOUNT_LIFT = 26;

export interface RoomSuiteView extends HqHeaderInfo {
  layout: SuiteLayout;
  /** Room id to spotlight (dims the others), or null for the whole floor. */
  focusRoomId?: string | null;
  /** Draw the tile grid, for the placement/editor mode. */
  showGrid?: boolean;
  /** Highlight one tile — the editor's cursor. */
  cursor?: { x: number; y: number } | null;
  /** Name plates over each room. */
  showLabels?: boolean;
}

interface Cam { ox: number; oy: number; s: number }

function iso(gx: number, gy: number, cam: Cam): { x: number; y: number } {
  return {
    x: cam.ox + (gx - gy) * (TILE_W / 2) * cam.s,
    y: cam.oy + (gx + gy) * (TILE_H / 2) * cam.s,
  };
}

// Fit the whole floor into the frame, whatever its footprint, so a 12x7 hotel
// floor and a small starter room are both framed sensibly.
function fitCamera(layout: SuiteLayout): Cam {
  const cols = layout.cols, rows = layout.rows;
  const spanX = (cols + rows) * (TILE_W / 2);
  const spanY = (cols + rows) * (TILE_H / 2);
  const pad = 96;
  const s = Math.min((W - pad) / spanX, (H - pad - 90) / (spanY + 210));
  const scale = Math.max(0.28, Math.min(0.78, s));
  return {
    // x origin centres the diamond; y leaves headroom for the tallest wall.
    ox: W / 2 + (rows - cols) * (TILE_W / 4) * scale,
    oy: 150,
    s: scale,
  };
}

// ── Draw list ────────────────────────────────────────────────────────────────
// Everything is queued with a depth key first, then painted in one sorted pass.
interface Piece {
  depth: number;   // painter order: back (low) → front (high)
  sub: number;     // tie-break within a tile: floor < rug < wall < prop
  sprite: string;
  gx: number;
  gy: number;
  lift: number;
  alpha: number;
  scale: number;
  /** Rugs lie flat: anchor them by the middle of their art, not by its feet. */
  flat: boolean;
  /** Standing props get a faint contact shadow; floors, rugs and walls don't. */
  shadow: boolean;
}

export async function renderRoomSuite(view: RoomSuiteView): Promise<Buffer | null> {
  return queueRender("hq-room-suite", async () => {
    const mod = await getCanvas();
    if (!mod) return null;
    try {
      const canvas = mod.createCanvas(W, H);
      const ctx = canvas.getContext("2d") as unknown as Ctx;
      const layout = view.layout;
      const cam = fitCamera(layout);

      paintBackdrop(ctx);

      // The masonry + floor + props are drawn onto their own layer so the warm
      // sandstone art can be cooled to charcoal without tinting the backdrop,
      // the header or the labels.
      const layer = mod.createCanvas(W, H);
      const lctx = layer.getContext("2d") as unknown as Ctx;

      const pieces = buildPieces(view, cam);
      await paintPieces(lctx, mod, pieces, cam);
      tintLayer(lctx);
      (ctx as unknown as { drawImage(i: unknown, x: number, y: number): void }).drawImage(layer, 0, 0);

      paintTorchlight(ctx);
      if (view.showGrid) paintGrid(ctx, layout, cam, view.cursor ?? null);
      if (view.showLabels !== false) paintRoomLabels(ctx, layout, cam);

      await drawHqHeader(ctx, mod, view, W);
      return await canvas.encode("png");
    } catch (err) {
      logger.error({ err }, "renderRoomSuite failed");
      return null;
    }
  });
}

function buildPieces(view: RoomSuiteView, _cam: Cam): Piece[] {
  const layout = view.layout;
  const out: Piece[] = [];
  const focus = view.focusRoomId ?? null;
  const dim = (roomId: string | null): number =>
    !focus || roomId === focus ? 1 : 0.34;

  // Floors.
  for (let gy = 0; gy < layout.rows; gy++) {
    for (let gx = 0; gx < layout.cols; gx++) {
      const room = roomAt(layout, gx, gy);
      if (!room) continue;
      out.push({
        depth: gx + gy, sub: 0, sprite: suiteFloorSprite(room.floor),
        gx, gy, lift: 0, alpha: dim(room.id), scale: 1, flat: true, shadow: false,
      });
    }
  }

  // Walls — but only the FAR runs, so the camera looks into the rooms.
  // With this projection the far edges of a tile are its north and west ones,
  // which is exactly what `suiteWalls` emits, so a wall is dropped only when it
  // would stand in front of the room it encloses (an exterior wall on the near
  // side of the floor).
  for (const w of suiteWalls(layout)) {
    if (isNearWall(layout, w.axis, w.x, w.y)) continue;
    const owner = roomAt(layout, w.x, w.y) ?? roomAt(layout, w.axis === "n" ? w.x : w.x - 1, w.axis === "n" ? w.y - 1 : w.y);
    out.push({
      depth: w.x + w.y, sub: 1,
      sprite: suiteWallSprite(w.kind, w.axis),
      gx: w.x, gy: w.y, lift: 0, alpha: dim(owner?.id ?? null), scale: 1, flat: false, shadow: false,
    });
  }

  // Items. Wall mounts hang above the floor against their tile's far wall.
  for (const it of layout.items) {
    const room = roomAt(layout, it.gx, it.gy);
    const sub = it.mount === "rug" ? 0.5 : it.mount === "wall" ? 1.5 : 2;
    out.push({
      depth: it.gx + it.gy, sub,
      sprite: it.sprite, gx: it.gx, gy: it.gy,
      lift: it.lift ?? (it.mount === "wall" ? WALL_MOUNT_LIFT : 0),
      alpha: dim(room?.id ?? null),
      scale: it.scale ?? (it.mount === "floor" ? FLOOR_ITEM_SCALE : it.mount === "wall" ? WALL_ITEM_SCALE : 1),
      flat: it.mount === "rug",
      shadow: it.mount === "floor",
    });
  }

  out.sort((a, b) => a.depth - b.depth || a.sub - b.sub || a.gy - b.gy);
  return out;
}

/**
 * True when a wall segment would sit between the camera and the room it
 * encloses. Only exterior walls can be "near": a partition always has a room on
 * both sides, so it belongs to whichever room is behind it and must be drawn.
 */
function isNearWall(layout: SuiteLayout, axis: SuiteAxis, x: number, y: number): boolean {
  const here = roomAt(layout, x, y);
  const behind = axis === "n" ? roomAt(layout, x, y - 1) : roomAt(layout, x - 1, y);
  // A wall with nothing behind it is a FAR shell wall (keep it). A wall with
  // nothing in front of it is a NEAR shell wall (drop it, it would block view).
  return !!behind && !here;
}

// Sprite keys are written as "<folder>/<name>.png"; the asset layer wants the
// folder and the bare name, and resolves the real file (manifest or convention).
function resolveSprite(key: string): string | null {
  const slash = key.indexOf("/");
  if (slash < 0) return spriteForPrefix("", key.replace(/\.png$/i, ""));
  return spriteForPrefix(key.slice(0, slash), key.slice(slash + 1).replace(/\.png$/i, ""));
}

// Natural pixel size of a decoded sprite (the canvas Image shape).
function imgSize(img: unknown): { w: number; h: number } {
  const i = img as { width?: number; height?: number };
  return { w: i.width ?? SPRITE_W, h: i.height ?? SPRITE_H };
}

/**
 * Where a sprite's art actually sits inside its (often mostly transparent)
 * canvas, measured once and cached.
 *
 * This matters because the art comes from several packs that do NOT share an
 * anchor: the dungeon tiles carry their content low in a 256x512 frame, the
 * older HQ furniture sits ~100px higher in the same frame, and the medals are
 * small square icons. Assuming any single anchor makes one of those groups
 * float or sink. Measuring the opaque box instead lets every sprite be stood on
 * its tile by its own feet, whatever pack it came from.
 */
interface SpriteAnchor { w: number; h: number; footX: number; footY: number; midY: number }
const anchorCache = new Map<string, SpriteAnchor>();

function measureAnchor(mod: CanvasMod, key: string, img: unknown): SpriteAnchor {
  const cached = anchorCache.get(key);
  if (cached) return cached;
  const { w, h } = imgSize(img);
  let a: SpriteAnchor = { w, h, footX: w / 2, footY: h, midY: h / 2 };
  try {
    const c = mod.createCanvas(w, h);
    const cx = c.getContext("2d") as unknown as Ctx;
    (cx as unknown as { drawImage(i: unknown, x: number, y: number): void }).drawImage(img, 0, 0);
    const data = (cx as unknown as {
      getImageData(x: number, y: number, w: number, h: number): { data: Uint8ClampedArray };
    }).getImageData(0, 0, w, h).data;
    let minX = w, maxX = -1, maxY = -1, minY = h;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (data[(y * w + x) * 4 + 3]! > 8) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y > maxY) maxY = y;
          if (y < minY) minY = y;
        }
      }
    }
    if (maxY >= 0) a = { w, h, footX: (minX + maxX) / 2, footY: maxY, midY: (minY + maxY) / 2 };
  } catch { /* fall back to the frame's own bottom-centre */ }
  anchorCache.set(key, a);
  return a;
}

async function paintPieces(ctx: Ctx, mod: CanvasMod, pieces: Piece[], cam: Cam): Promise<void> {
  const cache = new Map<string, unknown>();
  for (const p of pieces) {
    let img = cache.get(p.sprite);
    if (img === undefined) {
      const path = resolveSprite(p.sprite);
      img = path ? await loadSprite(mod, path).catch(() => null) : null;
      cache.set(p.sprite, img);
    }
    if (!img) continue;
    const at = iso(p.gx, p.gy, cam);
    // Scaling a prop keeps its FEET on the tile: grow around the anchor point,
    // not the sprite's corner, or a bigger table would drift off its floor.
    const s = cam.s * p.scale;
    const anc = measureAnchor(mod, p.sprite, img);
    // Normalise every pack to the same physical size: a sprite's opaque WIDTH is
    // treated as one tile across, so a dungeon tile, an old HQ prop and a medal
    // all land at a believable scale instead of at whatever their frame implies.
    // Tile-family art (the 256x512 frames) is already drawn to this grid, so it
    // keeps its natural size — only its FEET move, which is the whole fix. Art
    // from other packs (small icons/emblems) has no grid relationship at all, so
    // it's sized as a fraction of a tile instead of being blown up to fill one.
    const isTileFrame = anc.w === SPRITE_W && anc.h === SPRITE_H;
    const unit = isTileFrame ? s : (TILE_W * 0.34 * s) / Math.max(1, anc.w);
    const dw = anc.w * unit, dh = anc.h * unit;
    // Standing art puts its FEET on the tile; flat art (floors, rugs) puts its
    // MIDDLE there, because a rug lies across the tile rather than on top of it.
    const x = at.x - anc.footX * unit;
    // Feet land EXACTLY on the tile point (and flat art on its middle) — no
    // fudge offset, so nothing hovers above its tile or sinks into it.
    const y = p.flat
      ? at.y - anc.midY * unit - p.lift * cam.s
      : at.y - anc.footY * unit - p.lift * cam.s;
    ctx.save();
    ctx.globalAlpha = p.alpha;
    // A whisper of contact shadow under STANDING props only. Without it a prop
    // reads as pasted onto the floor; more than a whisper and it fights the
    // shading already baked into the art, so this stays deliberately faint and
    // is skipped for flat art (which is already on the ground) and for walls.
    if (p.shadow) {
      const rx = Math.max(4, dw * 0.26), ry = Math.max(2, rx * 0.42);
      ctx.globalAlpha = p.alpha * 0.22;
      ctx.fillStyle = "#05070c";
      ctx.beginPath();
      (ctx as unknown as {
        ellipse(x: number, y: number, rx: number, ry: number, rot: number, a0: number, a1: number): void;
      }).ellipse(at.x, at.y, rx, ry, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = p.alpha;
    }
    (ctx as unknown as {
      drawImage(i: unknown, x: number, y: number, w: number, h: number): void;
    }).drawImage(img, x, y, dw, dh);
    ctx.restore();
  }
}

// ── Atmosphere ───────────────────────────────────────────────────────────────

function paintBackdrop(ctx: Ctx): void {
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, "#12151c");
  g.addColorStop(0.55, "#0c0e14");
  g.addColorStop(1, "#06070d");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
}

/**
 * Cool the sandstone art to charcoal — masonry only, never the chrome.
 * Kept under ~0.6 so the stone still shows its own shading: past that the art
 * flattens into a silhouette and the room stops reading as a 3D space.
 */
function tintLayer(ctx: Ctx): void {
  ctx.save();
  ctx.globalCompositeOperation = "source-atop";
  ctx.fillStyle = "rgba(24,29,42,0.56)";
  ctx.fillRect(0, 0, W, H);
  ctx.restore();
}

/** Warm pools so the dark floor still reads as torch-lit, not switched off. */
function paintTorchlight(ctx: Ctx): void {
  ctx.save();
  for (const [cx, cy, r, a] of [
    [W * 0.42, H * 0.50, 430, 0.22],
    [W * 0.72, H * 0.44, 320, 0.16],
    [W * 0.22, H * 0.64, 280, 0.13],
  ] as const) {
    const g = ctx.createRadialGradient(cx, cy, 20, cx, cy, r);
    g.addColorStop(0, `rgba(255,176,92,${a})`);
    g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  }
  ctx.restore();
}

// ── Editor overlays ──────────────────────────────────────────────────────────

function tileDiamond(gx: number, gy: number, cam: Cam): { x: number; y: number }[] {
  const c = iso(gx, gy, cam);
  const hw = (TILE_W / 2) * cam.s, hh = (TILE_H / 2) * cam.s;
  return [
    { x: c.x, y: c.y - hh }, { x: c.x + hw, y: c.y },
    { x: c.x, y: c.y + hh }, { x: c.x - hw, y: c.y },
  ];
}

function paintGrid(ctx: Ctx, layout: SuiteLayout, cam: Cam, cursor: { x: number; y: number } | null): void {
  ctx.save();
  ctx.lineWidth = 1;
  ctx.strokeStyle = "rgba(150,190,240,0.16)";
  for (let gy = 0; gy < layout.rows; gy++) {
    for (let gx = 0; gx < layout.cols; gx++) {
      const p = tileDiamond(gx, gy, cam);
      ctx.beginPath();
      ctx.moveTo(p[0]!.x, p[0]!.y);
      for (let i = 1; i < p.length; i++) ctx.lineTo(p[i]!.x, p[i]!.y);
      ctx.closePath();
      ctx.stroke();
    }
  }
  if (cursor) {
    const p = tileDiamond(cursor.x, cursor.y, cam);
    ctx.beginPath();
    ctx.moveTo(p[0]!.x, p[0]!.y);
    for (let i = 1; i < p.length; i++) ctx.lineTo(p[i]!.x, p[i]!.y);
    ctx.closePath();
    ctx.fillStyle = "rgba(90,220,140,0.28)";
    ctx.fill();
    ctx.strokeStyle = "rgba(120,255,170,0.95)";
    ctx.lineWidth = 2.5;
    ctx.stroke();
  }
  ctx.restore();
}

function paintRoomLabels(ctx: Ctx, layout: SuiteLayout, cam: Cam): void {
  ctx.save();
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  for (const room of layout.rooms) {
    const cx = room.rect.x + room.rect.w / 2 - 0.5;
    const cy = room.rect.y + room.rect.h / 2 - 0.5;
    const p = iso(cx, cy, cam);
    ctx.font = `bold 13px "DejaVu Sans", Arial, sans-serif`;
    const tw = ctx.measureText(room.label).width + 22;
    const x = p.x - tw / 2, y = p.y - 12;
    ctx.fillStyle = "rgba(6,10,16,0.84)";
    roundRect(ctx, x, y, tw, 24, 7);
    ctx.fill();
    ctx.strokeStyle = "rgba(126,172,232,0.55)";
    ctx.lineWidth = 1.2;
    roundRect(ctx, x, y, tw, 24, 7);
    ctx.stroke();
    ctx.fillStyle = "#e2e8f4";
    ctx.fillText(room.label, p.x, y + 13);
  }
  ctx.restore();
}

function roundRect(ctx: Ctx, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
