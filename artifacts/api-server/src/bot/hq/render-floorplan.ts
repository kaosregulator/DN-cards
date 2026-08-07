// ─────────────────────────────────────────────────────────────────────────────
// HQ — continuous floorplan renderer.
//
// Draws the entire connected headquarters as one isometric layout: zones joined
 // by doors/hallways, auto-merged walls (corners / T / cross), and reserved
 // expansion parcels. This replaces the "teleport between isolated squares" look.
 // ─────────────────────────────────────────────────────────────────────────────

import {
  getCanvas, hexToRgba, type Ctx, type CanvasMod,
} from "../animations/engine.js";
import { queueRender } from "../animations/render-queue.js";
import {
  polyPath, drawHqHeader, HQ_HEADER_H, type Pt, type HqHeaderInfo,
} from "./paint.js";
import { paintVoid, paintOpenAtmosphere } from "./render-atmosphere.js";
import { drawProp, type PropKind } from "./props.js";
import { resolveWall } from "./defs/walls.js";
import { resolveFloor } from "./defs/floors.js";
import { resolveSkybox, type HqSkybox } from "./defs/skyboxes.js";
import { roomBlueprint } from "./defs/room-blueprints.js";
import {
  parseEdge, junctionAt, isHallwayType,
  type FloorplanState, type FloorplanZone, type FloorplanOpening,
} from "./defs/floorplan.js";
import { wallSet as wallsOf, openingSet as openingsOf } from "./floorplan.js";

const W = 1120, H = 680;

export interface FloorplanRenderView extends HqHeaderInfo {
  ownerName: string;
  floorplan: FloorplanState;
  skybox?: HqSkybox | null;
  /** Show build grid overlay. */
  showGrid?: boolean;
  /** Highlighted wall edge key (cursor). */
  cursorEdge?: string | null;
  /** Optional label under the header. */
  statusLine?: string;
}

function project(
  gx: number, gy: number,
  originX: number, originY: number, tileW: number, tileH: number,
): Pt {
  return {
    x: originX + (gx - gy) * (tileW / 2),
    y: originY + (gx + gy) * (tileH / 2),
  };
}

function fitLattice(fp: FloorplanState): {
  originX: number; originY: number; tileW: number; tileH: number;
} {
  // Fit the whole plan under the header with padding.
  const pad = 48;
  const usableW = W - pad * 2;
  const usableH = H - HQ_HEADER_H - pad * 2;
  const cols = fp.width, rows = fp.height;
  // Iso bounding box of a cols×rows grid is roughly:
  // width  = (cols+rows) * tileW/2
  // height = (cols+rows) * tileH/2
  const span = cols + rows;
  const tileW = Math.min(36, Math.floor((usableW * 2) / span));
  const tileH = Math.min(18, Math.floor(tileW / 2));
  const totalW = span * (tileW / 2);
  const totalH = span * (tileH / 2);
  const originX = W / 2;
  const originY = HQ_HEADER_H + pad + (usableH - totalH) / 2 + 8;
  void totalW;
  return { originX, originY, tileW, tileH };
}

function floorColors(zone: FloorplanZone): { a: string; b: string; grout: string } {
  if (isHallwayType(zone.roomTypeId)) {
    return { a: "#6a6560", b: "#5a5550", grout: "rgba(0,0,0,0.25)" };
  }
  const floor = resolveFloor(
    zone.roomTypeId === "treasury" || zone.roomTypeId === "arcane-vault" ? "marble"
      : zone.roomTypeId === "entrance" ? "tile"
        : "wood",
  );
  return { a: floor.tileA, b: floor.tileB, grout: floor.grout };
}

function wallColor(styleId: string, exterior: boolean): { fill: string; stroke: string } {
  const w = resolveWall(styleId);
  return {
    fill: exterior ? w.rightFace : w.leftFace,
    stroke: w.trim,
  };
}

export async function renderFloorplan(view: FloorplanRenderView): Promise<Buffer | null> {
  return queueRender("hq-floorplan", async () => {
    const mod = await getCanvas();
    if (!mod) return null;
    try {
      const canvas = mod.createCanvas(W, H);
      const ctx = canvas.getContext("2d") as unknown as Ctx;
      await paintFloorplanScene(ctx, mod, view);
      return await canvas.encode("png");
    } catch {
      return null;
    }
  });
}

async function paintFloorplanScene(ctx: Ctx, mod: CanvasMod, view: FloorplanRenderView): Promise<void> {
  const fp = view.floorplan;
  const sky = view.skybox ?? resolveSkybox("skybox-clouds");
  paintVoid(ctx, W, H);
  await paintOpenAtmosphere(ctx, mod, sky, {
    w: W, h: H, focusX: W / 2, focusY: H * 0.45, radius: 380,
  });

  const { originX, originY, tileW, tileH } = fitLattice(fp);
  const proj = (gx: number, gy: number) => project(gx, gy, originX, originY, tileW, tileH);
  const walls = wallsOf(fp);
  const openings = openingsOf(fp);

  // 1. Locked parcels (dim footprints)
  for (const z of fp.zones.filter(z => !z.unlocked)) {
    drawZoneFootprint(ctx, z, proj, tileW, tileH, true);
  }

  // 2. Unlocked floors
  for (const z of fp.zones.filter(z => z.unlocked)) {
    drawZoneFloor(ctx, z, proj, tileW, tileH, z.id === fp.focusZoneId);
  }

  // 3. Walls (auto-merged posts + segments), skipping opening gaps
  drawWalls(ctx, fp, walls, openings, proj, tileW, tileH);

  // 4. Doors / archways / windows
  drawOpenings(ctx, openings, walls, proj, tileW, tileH);

  // 5. Furniture blueprints inside unlocked non-hallway zones
  for (const z of fp.zones.filter(z => z.unlocked && !isHallwayType(z.roomTypeId))) {
    drawZoneFurniture(ctx, z, proj, tileW, tileH);
  }

  // 6. Zone labels
  for (const z of fp.zones.filter(z => z.unlocked)) {
    drawZoneLabel(ctx, z, proj, z.id === fp.focusZoneId);
  }

  // 7. Cursor edge highlight
  if (view.cursorEdge) {
    drawEdgeHighlight(ctx, view.cursorEdge, proj, tileW, tileH);
  }

  if (view.showGrid) drawLatticeGuides(ctx, fp, proj, tileW, tileH);

  // Soft vignette
  const v = ctx.createRadialGradient(W / 2, H / 2, H * 0.3, W / 2, H / 2, W * 0.7);
  v.addColorStop(0, "rgba(0,0,0,0)");
  v.addColorStop(1, "rgba(0,0,0,0.45)");
  ctx.fillStyle = v; ctx.fillRect(0, 0, W, H);

  await drawHqHeader(ctx, mod, view, W);
  if (view.statusLine) {
    ctx.save();
    ctx.fillStyle = "rgba(0,0,0,0.55)";
    ctx.fillRect(0, H - 28, W, 28);
    ctx.fillStyle = "rgba(230,230,235,0.9)";
    ctx.font = '12px "DejaVu Sans", Arial, sans-serif';
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(view.statusLine, W / 2, H - 14);
    ctx.restore();
  }
  void mod;
}

function drawZoneFootprint(
  ctx: Ctx, z: FloorplanZone,
  proj: (x: number, y: number) => Pt,
  tileW: number, tileH: number,
  locked: boolean,
): void {
  const r = z.rect;
  const corners = [
    proj(r.x, r.y), proj(r.x + r.w, r.y),
    proj(r.x + r.w, r.y + r.h), proj(r.x, r.y + r.h),
  ];
  ctx.save();
  polyPath(ctx, corners);
  ctx.fillStyle = locked ? "rgba(40,44,52,0.55)" : "rgba(80,90,100,0.4)";
  ctx.fill();
  ctx.strokeStyle = locked ? "rgba(120,130,150,0.35)" : "rgba(200,200,210,0.4)";
  ctx.lineWidth = 1.5;
  ctx.setLineDash?.([6, 4]);
  ctx.stroke();
  ctx.setLineDash?.([]);
  // Lock glyph
  if (locked) {
    const c = proj(r.x + r.w / 2, r.y + r.h / 2);
    ctx.fillStyle = "rgba(180,180,190,0.55)";
    ctx.font = `bold ${Math.max(10, tileH)}px "DejaVu Sans", Arial, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("🔒", c.x, c.y - 6);
    ctx.font = `10px "DejaVu Sans", Arial, sans-serif`;
    ctx.fillText(z.name, c.x, c.y + 12);
  }
  ctx.restore();
  void tileW;
}

function drawZoneFloor(
  ctx: Ctx, z: FloorplanZone,
  proj: (x: number, y: number) => Pt,
  tileW: number, tileH: number,
  focused: boolean,
): void {
  const cols = floorColors(z);
  const r = z.rect;
  for (let y = r.y; y < r.y + r.h; y++) {
    for (let x = r.x; x < r.x + r.w; x++) {
      const a = proj(x, y), b = proj(x + 1, y), c = proj(x + 1, y + 1), d = proj(x, y + 1);
      polyPath(ctx, [a, b, c, d]);
      ctx.fillStyle = (x + y) % 2 === 0 ? cols.a : cols.b;
      ctx.fill();
      ctx.strokeStyle = cols.grout; ctx.lineWidth = 0.8; ctx.stroke();
    }
  }
  if (focused) {
    const corners = [
      proj(r.x, r.y), proj(r.x + r.w, r.y),
      proj(r.x + r.w, r.y + r.h), proj(r.x, r.y + r.h),
    ];
    ctx.save();
    polyPath(ctx, corners);
    ctx.strokeStyle = "rgba(80,180,255,0.85)"; ctx.lineWidth = 3; ctx.stroke();
    ctx.restore();
  }
  void tileW; void tileH;
}

function drawWalls(
  ctx: Ctx,
  fp: FloorplanState,
  walls: Set<string>,
  openings: Map<string, FloorplanOpening>,
  proj: (x: number, y: number) => Pt,
  tileW: number, tileH: number,
): void {
  const wallH = Math.max(14, tileH * 1.6);
  const byKey = new Map(fp.walls.map(w => [w.key, w]));

  for (const key of walls) {
    if (openings.has(key)) continue; // gap — opening painter draws the frame
    const edge = parseEdge(key);
    if (!edge) continue;
    const meta = byKey.get(key);
    const col = wallColor(meta?.styleId ?? "stone", meta?.kind !== "interior");
    const { axis, x, y } = edge;

    if (axis === "h") {
      const a = proj(x, y), b = proj(x + 1, y);
      drawWallSeg(ctx, a, b, wallH, col.fill, col.stroke);
    } else {
      const a = proj(x, y), b = proj(x, y + 1);
      drawWallSeg(ctx, a, b, wallH, col.fill, col.stroke);
    }
  }

  // Junction posts at vertices that have 2+ stubs
  const verts = new Set<string>();
  for (const key of walls) {
    const e = parseEdge(key);
    if (!e) continue;
    if (e.axis === "h") {
      verts.add(`${e.x},${e.y}`); verts.add(`${e.x + 1},${e.y}`);
    } else {
      verts.add(`${e.x},${e.y}`); verts.add(`${e.x},${e.y + 1}`);
    }
  }
  for (const v of verts) {
    const [vx, vy] = v.split(",").map(Number) as [number, number];
    const j = junctionAt(walls, vx, vy);
    if (j === "none" || j === "h" || j === "v" || j.startsWith("cap")) continue;
    const p = proj(vx, vy);
    ctx.fillStyle = "#5a564e";
    ctx.fillRect(p.x - 3, p.y - wallH - 2, 6, wallH + 4);
  }
}

function drawWallSeg(ctx: Ctx, a: Pt, b: Pt, wallH: number, fill: string, stroke: string): void {
  // Extrude upward for a short isometric wall face
  const aTop = { x: a.x, y: a.y - wallH };
  const bTop = { x: b.x, y: b.y - wallH };
  polyPath(ctx, [a, b, bTop, aTop]);
  ctx.fillStyle = fill; ctx.fill();
  ctx.strokeStyle = stroke; ctx.lineWidth = 1.2; ctx.stroke();
  // Top edge highlight
  ctx.strokeStyle = "rgba(255,255,255,0.25)"; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.moveTo(aTop.x, aTop.y); ctx.lineTo(bTop.x, bTop.y); ctx.stroke();
}

function drawOpenings(
  ctx: Ctx,
  openings: Map<string, FloorplanOpening>,
  walls: Set<string>,
  proj: (x: number, y: number) => Pt,
  tileW: number, tileH: number,
): void {
  const wallH = Math.max(14, tileH * 1.6);
  for (const [key, op] of openings) {
    if (!walls.has(key) && op.kind === "window") continue;
    const edge = parseEdge(key);
    if (!edge) continue;
    const { axis, x, y } = edge;
    const a = axis === "h" ? proj(x, y) : proj(x, y);
    const b = axis === "h" ? proj(x + 1, y) : proj(x, y + 1);
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };

    // Frame posts
    ctx.fillStyle = "#6b4f2c";
    ctx.fillRect(a.x - 2, a.y - wallH, 4, wallH);
    ctx.fillRect(b.x - 2, b.y - wallH, 4, wallH);

    if (op.kind === "window") {
      ctx.fillStyle = "rgba(150,200,255,0.35)";
      polyPath(ctx, [
        { x: a.x, y: a.y - wallH * 0.25 }, { x: b.x, y: b.y - wallH * 0.25 },
        { x: b.x, y: b.y - wallH * 0.85 }, { x: a.x, y: a.y - wallH * 0.85 },
      ]);
      ctx.fill();
      continue;
    }

    // Door / double-door / archway lintel
    ctx.strokeStyle = "#8a6a3f"; ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y - wallH);
    if (op.kind === "archway") {
      ctx.quadraticCurveTo(mid.x, mid.y - wallH - 10, b.x, b.y - wallH);
    } else {
      ctx.lineTo(b.x, b.y - wallH);
    }
    ctx.stroke();

    if (op.kind === "door" || op.kind === "double-door") {
      // Door leaf hint
      ctx.fillStyle = "rgba(120,80,40,0.55)";
      const swing = op.kind === "double-door" ? 0.35 : 0.45;
      const leaf = {
        x: a.x + (b.x - a.x) * swing,
        y: a.y + (b.y - a.y) * swing - wallH * 0.4,
      };
      ctx.beginPath();
      ctx.moveTo(a.x, a.y - 2);
      ctx.lineTo(leaf.x, leaf.y);
      ctx.lineTo(leaf.x, leaf.y + wallH * 0.55);
      ctx.lineTo(a.x, a.y - 2 + wallH * 0.55);
      ctx.closePath();
      ctx.fill();
      if (op.kind === "double-door") {
        ctx.beginPath();
        ctx.moveTo(b.x, b.y - 2);
        ctx.lineTo(mid.x, mid.y - wallH * 0.4);
        ctx.lineTo(mid.x, mid.y - wallH * 0.4 + wallH * 0.55);
        ctx.lineTo(b.x, b.y - 2 + wallH * 0.55);
        ctx.closePath();
        ctx.fill();
      }
    }
  }
  void tileW;
}

function drawZoneFurniture(
  ctx: Ctx, z: FloorplanZone,
  proj: (x: number, y: number) => Pt,
  tileW: number, tileH: number,
): void {
  // Map 8×8 blueprint coords into the zone rect.
  const props = roomBlueprint(z.roomTypeId);
  const r = z.rect;
  for (const p of props) {
    if (p.wall) continue; // wall props skipped on overview — architectural walls handle that
    const u = (p.gx + 0.5) / 8;
    const v = (p.gy + 0.5) / 8;
    const gx = r.x + u * r.w;
    const gy = r.y + v * r.h;
    const pt = proj(gx, gy);
    const scale = Math.max(0.35, Math.min(0.7, (tileW / 40) * (p.scale ?? 1) * 0.85));
    drawProp(ctx, p.kind as PropKind, pt.x, pt.y, scale, p.tint ?? 0xc0392b, p.seed ?? 1);
  }
}

function drawZoneLabel(
  ctx: Ctx, z: FloorplanZone,
  proj: (x: number, y: number) => Pt,
  focused: boolean,
): void {
  const r = z.rect;
  const c = proj(r.x + r.w / 2, r.y + r.h / 2);
  const label = `${z.emoji} ${z.name}`;
  ctx.save();
  ctx.font = `bold ${focused ? 13 : 11}px "DejaVu Sans", Arial, sans-serif`;
  const tw = ctx.measureText(label).width + 14;
  const th = focused ? 22 : 18;
  ctx.fillStyle = focused ? "rgba(20,40,70,0.82)" : "rgba(0,0,0,0.62)";
  const x = c.x - tw / 2, y = c.y - r.h * 2 - th; // lift above furniture
  // Keep labels readable — clamp near zone center top
  const ly = Math.min(c.y - 20, proj(r.x + r.w / 2, r.y).y + 8);
  ctx.fillRect(c.x - tw / 2, ly, tw, th);
  ctx.strokeStyle = focused ? "rgba(100,190,255,0.9)" : "rgba(255,255,255,0.2)";
  ctx.lineWidth = 1; ctx.strokeRect(c.x - tw / 2, ly, tw, th);
  ctx.fillStyle = "#fff";
  ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.fillText(label, c.x, ly + th / 2);
  ctx.restore();
  void x; void y;
}

function drawEdgeHighlight(
  ctx: Ctx, key: string,
  proj: (x: number, y: number) => Pt,
  tileW: number, tileH: number,
): void {
  const e = parseEdge(key);
  if (!e) return;
  const a = e.axis === "h" ? proj(e.x, e.y) : proj(e.x, e.y);
  const b = e.axis === "h" ? proj(e.x + 1, e.y) : proj(e.x, e.y + 1);
  ctx.save();
  ctx.strokeStyle = "rgba(80,220,180,0.95)"; ctx.lineWidth = 4;
  ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
  ctx.restore();
  void tileW; void tileH;
}

function drawLatticeGuides(
  ctx: Ctx, fp: FloorplanState,
  proj: (x: number, y: number) => Pt,
  tileW: number, tileH: number,
): void {
  ctx.save();
  ctx.strokeStyle = "rgba(255,255,255,0.08)"; ctx.lineWidth = 1;
  for (let y = 0; y <= fp.height; y++) {
    const a = proj(0, y), b = proj(fp.width, y);
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
  }
  for (let x = 0; x <= fp.width; x++) {
    const a = proj(x, 0), b = proj(x, fp.height);
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
  }
  ctx.restore();
  void tileW; void tileH;
}
