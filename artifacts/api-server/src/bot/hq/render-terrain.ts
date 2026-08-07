// ─────────────────────────────────────────────────────────────────────────────
// HQ — terrain painter (the "sim world editor" surface layer).
//
// Draws the rectangles the player stamps with /hqbuild and the visual Build
// cursor. Everything is expressed against an `IsoProjector`, so the SAME painter
// serves the interior room lattice and the outdoor grounds lattice — build a
// pond indoors or a hill outside with one code path.
//
// Draw order is depth-sorted by the rectangle's far corner, then by explicit `z`,
// so a raised deck correctly overlaps the paving behind it. Sprite art keyed
// `surface/<id>` replaces the procedural fill when the asset pack has it.
// ─────────────────────────────────────────────────────────────────────────────

import { hexToRgba, roundRectPath, type Ctx, type CanvasMod } from "../animations/engine.js";
import { drawTextWithShadow, TITLE_FONT } from "../animations/effects.js";
import { polyPath, ellipse, shiftColor, seededRng, blitClippedQuad, stripEmoji, type Pt } from "./paint.js";
import { loadSprite, spriteForPrefix } from "./assets.js";
import { resolveSurface, type HqSurface } from "./defs/surfaces.js";

// How a lattice maps grid coordinates to screen space. `project(gx, gy)` returns
// the LATTICE POINT (a tile (i,j) is the diamond between (i,j) and (i+1,j+1)).
export interface IsoProjector {
  project: (gx: number, gy: number) => Pt;
  grid: number;
  tileW: number;
  tileH: number;
}

// One placed rectangle. `x,y` is the near-back tile corner; `w,h` the span in
// tiles; `elevation` overrides the material's default height in steps.
export interface HqTerrainFeature {
  id: number;
  materialId: string;
  x: number; y: number; w: number; h: number;
  elevation: number;
  z: number;
}

// A step of vertical lift/depth, in screen pixels.
const STEP_PX = 13;

function rectQuad(p: IsoProjector, f: { x: number; y: number; w: number; h: number }, lift = 0): Pt[] {
  const a = p.project(f.x, f.y);
  const b = p.project(f.x + f.w, f.y);
  const c = p.project(f.x + f.w, f.y + f.h);
  const d = p.project(f.x, f.y + f.h);
  return [
    { x: a.x, y: a.y - lift }, { x: b.x, y: b.y - lift },
    { x: c.x, y: c.y - lift }, { x: d.x, y: d.y - lift },
  ];
}

// Depth key: the screen-y of the rectangle's NEAREST corner, so things closer to
// the viewer paint last.
function depthOf(p: IsoProjector, f: HqTerrainFeature): number {
  return p.project(f.x + f.w, f.y + f.h).y;
}

/** Paint every terrain feature onto the lattice, back to front. */
export async function paintTerrain(
  ctx: Ctx, mod: CanvasMod, proj: IsoProjector, features: HqTerrainFeature[],
): Promise<void> {
  const ordered = features.slice().sort((a, b) => (a.z - b.z) || (depthOf(proj, a) - depthOf(proj, b)));
  for (const f of ordered) {
    const mat = resolveSurface(f.materialId);
    const steps = f.elevation > 0 ? f.elevation : mat.height;
    switch (mat.kind) {
      case "water": await paintWater(ctx, mod, proj, f, mat, steps); break;
      case "raised": await paintRaised(ctx, mod, proj, f, mat, steps); break;
      case "mound": paintMound(ctx, proj, f, mat, steps); break;
      default: await paintFlat(ctx, mod, proj, f, mat); break;
    }
  }
}

async function fillTop(
  ctx: Ctx, mod: CanvasMod, quad: Pt[], mat: HqSurface, tint: string,
): Promise<boolean> {
  const spritePath = spriteForPrefix("surface", mat.id);
  const img = spritePath ? await loadSprite(mod, spritePath).catch(() => null) : null;
  if (img) { blitClippedQuad(ctx, img, quad); return true; }
  polyPath(ctx, quad);
  ctx.fillStyle = tint;
  ctx.fill();
  return false;
}

// Overlay a material's texture inside an already-clipped quad.
function paintTexture(
  ctx: Ctx, proj: IsoProjector, f: HqTerrainFeature, mat: HqSurface, lift: number,
): void {
  const tile = (i: number, j: number): Pt[] => rectQuad(proj, { x: f.x + i, y: f.y + j, w: 1, h: 1 }, lift);
  switch (mat.texture) {
    case "checker": {
      for (let i = 0; i < f.w; i++) {
        for (let j = 0; j < f.h; j++) {
          if ((i + j) % 2 !== 0) continue;
          polyPath(ctx, tile(i, j)); ctx.fillStyle = hexToRgba(0x000000, 0.10); ctx.fill();
        }
      }
      break;
    }
    case "plank": {
      ctx.strokeStyle = mat.edge; ctx.lineWidth = 1.5;
      for (let j = 0; j <= f.h; j++) {
        const a = proj.project(f.x, f.y + j), b = proj.project(f.x + f.w, f.y + j);
        ctx.beginPath(); ctx.moveTo(a.x, a.y - lift); ctx.lineTo(b.x, b.y - lift); ctx.stroke();
      }
      break;
    }
    case "speckle": {
      const rnd = seededRng((f.id * 2654435761) >>> 0);
      ctx.fillStyle = hexToRgba(0x000000, 0.16);
      const n = Math.min(160, Math.max(12, f.w * f.h * 5));
      for (let k = 0; k < n; k++) {
        const p = proj.project(f.x + rnd() * f.w, f.y + rnd() * f.h);
        ctx.beginPath(); ellipse(ctx, p.x, p.y - lift, 1.6 + rnd() * 1.8, 1.0 + rnd() * 1.0); ctx.fill();
      }
      break;
    }
    case "wave":
    case "none":
    default:
      break;
  }
}

async function paintFlat(
  ctx: Ctx, mod: CanvasMod, proj: IsoProjector, f: HqTerrainFeature, mat: HqSurface,
): Promise<void> {
  const quad = rectQuad(proj, f);
  ctx.save();
  const used = await fillTop(ctx, mod, quad, mat, mat.base);
  if (!used) {
    polyPath(ctx, quad); ctx.clip();
    paintTexture(ctx, proj, f, mat, 0);
  }
  ctx.restore();
  ctx.save();
  polyPath(ctx, quad);
  ctx.strokeStyle = mat.edge; ctx.lineWidth = 2; ctx.stroke();
  ctx.restore();
}

// A pond: recessed banks stepping down to the water, ripple arcs and a specular
// band, then a bright shoreline so it reads as a hole in the ground.
async function paintWater(
  ctx: Ctx, mod: CanvasMod, proj: IsoProjector, f: HqTerrainFeature, mat: HqSurface, steps: number,
): Promise<void> {
  const depth = Math.max(1, steps) * STEP_PX * 0.55;
  const rim = rectQuad(proj, f);
  const bed = rectQuad(proj, f, -depth);

  // Bank walls between the rim and the sunken bed.
  ctx.save();
  for (let i = 0; i < 4; i++) {
    const a = rim[i]!, b = rim[(i + 1) % 4]!;
    const a2 = bed[i]!, b2 = bed[(i + 1) % 4]!;
    polyPath(ctx, [a, b, b2, a2]);
    ctx.fillStyle = i < 2 ? shiftColor(mat.shade, -18) : shiftColor(mat.shade, -34);
    ctx.fill();
  }
  ctx.restore();

  ctx.save();
  const used = await fillTop(ctx, mod, bed, mat, mat.base);
  polyPath(ctx, bed); ctx.clip();
  if (!used) {
    const g = ctx.createLinearGradient(0, bed[0]!.y, 0, bed[2]!.y);
    g.addColorStop(0, shiftColor(mat.base, -22));
    g.addColorStop(1, shiftColor(mat.base, 18));
    ctx.fillStyle = g; polyPath(ctx, bed); ctx.fill();
  }
  // Ripples: short highlight arcs along the lattice.
  ctx.strokeStyle = hexToRgba(0xffffff, 0.28);
  ctx.lineWidth = 2;
  for (let j = 0.35; j < f.h; j += 0.8) {
    for (let i = 0.25; i < f.w; i += 1.1) {
      const p0 = proj.project(f.x + i, f.y + j);
      const p1 = proj.project(f.x + i + 0.55, f.y + j);
      ctx.beginPath();
      ctx.moveTo(p0.x, p0.y - depth);
      ctx.quadraticCurveTo((p0.x + p1.x) / 2, p0.y - depth - 4, p1.x, p1.y - depth);
      ctx.stroke();
    }
  }
  // Specular sheen across the near half.
  const sheen = ctx.createLinearGradient(bed[3]!.x, bed[0]!.y, bed[1]!.x, bed[2]!.y);
  sheen.addColorStop(0, "rgba(255,255,255,0.16)");
  sheen.addColorStop(0.5, "rgba(255,255,255,0.02)");
  sheen.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = sheen; polyPath(ctx, bed); ctx.fill();
  ctx.restore();

  // Shoreline.
  ctx.save();
  polyPath(ctx, rim);
  ctx.strokeStyle = mat.edge; ctx.lineWidth = 3; ctx.stroke();
  ctx.strokeStyle = hexToRgba(0xffffff, 0.25); ctx.lineWidth = 1;
  polyPath(ctx, bed); ctx.stroke();
  ctx.restore();
}

// A raised slab: two lit side walls plus the top face.
async function paintRaised(
  ctx: Ctx, mod: CanvasMod, proj: IsoProjector, f: HqTerrainFeature, mat: HqSurface, steps: number,
): Promise<void> {
  const lift = Math.max(1, steps) * STEP_PX;
  const ground = rectQuad(proj, f);
  const top = rectQuad(proj, f, lift);

  // Contact shadow so the slab sits on the ground rather than floating.
  ctx.save();
  polyPath(ctx, ground);
  ctx.fillStyle = "rgba(0,0,0,0.28)"; ctx.fill();
  ctx.restore();

  // The two front-facing walls (near-left and near-right edges).
  ctx.save();
  const faces: [number, number][] = [[3, 2], [2, 1]];
  for (const [i, j] of faces) {
    polyPath(ctx, [top[i]!, top[j]!, ground[j]!, ground[i]!]);
    ctx.fillStyle = i === 3 ? shiftColor(mat.shade, -10) : shiftColor(mat.shade, -28);
    ctx.fill();
    ctx.strokeStyle = hexToRgba(0x000000, 0.3); ctx.lineWidth = 1; ctx.stroke();
  }
  ctx.restore();

  ctx.save();
  const used = await fillTop(ctx, mod, top, mat, mat.base);
  if (!used) {
    polyPath(ctx, top); ctx.clip();
    paintTexture(ctx, proj, f, mat, lift);
  }
  ctx.restore();
  ctx.save();
  polyPath(ctx, top);
  ctx.strokeStyle = hexToRgba(0xffffff, 0.35); ctx.lineWidth = 2; ctx.stroke();
  ctx.restore();
}

// A soft organic swell — hills and bumps. Built by lofting concentric rings of
// the rectangle inward while lifting them, which reads as a rounded dome in iso.
function paintMound(
  ctx: Ctx, proj: IsoProjector, f: HqTerrainFeature, mat: HqSurface, steps: number,
): void {
  const lift = Math.max(1, steps) * STEP_PX;
  const rings = 7;
  ctx.save();
  polyPath(ctx, rectQuad(proj, f));
  ctx.fillStyle = "rgba(0,0,0,0.22)"; ctx.fill();
  ctx.restore();

  for (let r = 0; r < rings; r++) {
    const t = r / (rings - 1);
    // Ease the inset so the dome is flatter on top than at the base.
    const inset = Math.sin(t * Math.PI * 0.5);
    const h = lift * (1 - Math.cos(t * Math.PI * 0.5));
    const shrinkW = (f.w / 2) * inset * 0.92;
    const shrinkH = (f.h / 2) * inset * 0.92;
    const quad = rectQuad(proj, {
      x: f.x + shrinkW, y: f.y + shrinkH,
      w: Math.max(0.08, f.w - shrinkW * 2), h: Math.max(0.08, f.h - shrinkH * 2),
    }, h);
    polyPath(ctx, quad);
    ctx.fillStyle = shiftColor(mat.base, Math.round(-16 + t * 30));
    ctx.fill();
  }
  // Crest highlight + a speckle of texture on the summit.
  const crest = rectQuad(proj, {
    x: f.x + f.w * 0.42, y: f.y + f.h * 0.42, w: Math.max(0.1, f.w * 0.16), h: Math.max(0.1, f.h * 0.16),
  }, lift);
  ctx.save();
  polyPath(ctx, crest);
  ctx.fillStyle = hexToRgba(0xffffff, 0.12); ctx.fill();
  ctx.restore();
  ctx.save();
  polyPath(ctx, rectQuad(proj, f));
  ctx.strokeStyle = mat.edge; ctx.lineWidth = 1.5; ctx.stroke();
  ctx.restore();
}

// ── Build cursor ──────────────────────────────────────────────────────────────
export interface TerrainCursor {
  x: number; y: number; w: number; h: number;
  color: number;
  label: string;
  valid: boolean;
}

/** The neon selection rectangle + coordinate readout that makes editing visual. */
export function paintCursor(ctx: Ctx, proj: IsoProjector, cur: TerrainCursor): void {
  const quad = rectQuad(proj, cur);
  const col = cur.valid ? cur.color : 0xd0483a;

  ctx.save();
  polyPath(ctx, quad);
  ctx.fillStyle = hexToRgba(col, 0.22);
  ctx.fill();
  ctx.setLineDash([10, 6]);
  ctx.strokeStyle = hexToRgba(col, 0.95);
  ctx.lineWidth = 3;
  ctx.shadowColor = hexToRgba(col, 0.8);
  ctx.shadowBlur = 14;
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.restore();

  // Corner ticks so the exact tiles are unmistakable at a glance.
  ctx.save();
  ctx.strokeStyle = "#ffffff"; ctx.lineWidth = 3;
  for (const p of quad) {
    ctx.beginPath();
    ctx.moveTo(p.x - 7, p.y); ctx.lineTo(p.x + 7, p.y);
    ctx.moveTo(p.x, p.y - 5); ctx.lineTo(p.x, p.y + 5);
    ctx.stroke();
  }
  ctx.restore();

  // Coordinate plate above the selection.
  const top = quad[0]!;
  const label = stripEmoji(cur.label);
  ctx.save();
  ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.font = `bold 14px "${TITLE_FONT}", "DejaVu Sans", Arial, sans-serif`;
  const w = Math.min(360, ctx.measureText(label).width + 22);
  ctx.fillStyle = "rgba(0,0,0,0.82)";
  roundRectPath(ctx, top.x - w / 2, top.y - 34, w, 24, 12); ctx.fill();
  ctx.strokeStyle = hexToRgba(col, 0.9); ctx.lineWidth = 1.5;
  roundRectPath(ctx, top.x - w / 2, top.y - 34, w, 24, 12); ctx.stroke();
  drawTextWithShadow(ctx, label, top.x, top.y - 22, "#ffffff", 13);
  ctx.restore();
}

/**
 * A faint lattice with X/Y rulers, so the coordinates the /hqbuild subcommands
 * take can be read straight off the picture instead of counted in the head.
 */
export function paintGridGuides(ctx: Ctx, proj: IsoProjector): void {
  ctx.save();
  ctx.strokeStyle = "rgba(255,255,255,0.16)";
  ctx.lineWidth = 1;
  for (let i = 0; i <= proj.grid; i++) {
    const a = proj.project(i, 0), b = proj.project(i, proj.grid);
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    const c = proj.project(0, i), d = proj.project(proj.grid, i);
    ctx.beginPath(); ctx.moveTo(c.x, c.y); ctx.lineTo(d.x, d.y); ctx.stroke();
  }
  // X ruler runs down the near-right edge, Y down the near-left edge — matching
  // how the two axes actually recede in this projection.
  ctx.textAlign = "center"; ctx.textBaseline = "middle";
  for (let i = 0; i < proj.grid; i++) {
    const px = proj.project(i + 0.5, proj.grid);
    drawTextWithShadow(ctx, String(i), px.x - 14, px.y + 11, "rgba(160,230,255,0.85)", 11);
    const py = proj.project(proj.grid, i + 0.5);
    drawTextWithShadow(ctx, String(i), py.x + 15, py.y + 10, "rgba(255,210,150,0.85)", 11);
  }
  const xEnd = proj.project(0, proj.grid), yEnd = proj.project(proj.grid, 0);
  drawTextWithShadow(ctx, "X", xEnd.x - 26, xEnd.y + 4, "rgba(160,230,255,0.95)", 13);
  drawTextWithShadow(ctx, "Y", yEnd.x + 26, yEnd.y + 4, "rgba(255,210,150,0.95)", 13);
  ctx.restore();
}
