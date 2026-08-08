// ─────────────────────────────────────────────────────────────────────────────
// HQ — outdoor miniverse (fresh recreate from mockups).
//
 // A single flat grassy isometric platform with fence, river, bridge, trees,
 // rocks, and the player's castle. Giant back-walls (optional sky diorama) sit
 // BEHIND the platform. No stacked cliff tiers, no prototype pegs.
 // ─────────────────────────────────────────────────────────────────────────────

import { hexToRgba, type Ctx, type CanvasMod } from "../animations/engine.js";
import {
  ellipse, blit, diamond, polyPath, seededRng, hashString, type Pt,
} from "./paint.js";
import { loadSprite, spriteForPrefix } from "./assets.js";
import { paintVoid } from "./render-atmosphere.js";
import { paintGiantWalls, type GiantWallBounds } from "./render-giant-walls.js";
import { drawProp } from "./props.js";
import { spriteForProp } from "./prop-sprites.js";
import type { HqSkybox } from "./defs/skyboxes.js";

export interface OutdoorLayout {
  cx: number;
  cy: number;
  hw: number;
  hh: number;
  thick: number;
}

/** Mockup-matched flat platform geometry for the 1120×680 HQ canvas. */
export const OUTDOOR: OutdoorLayout = {
  cx: 560,
  cy: 400,
  hw: 420,
  hh: 210,
  thick: 42,
};

export function outdoorProject(gx: number, gy: number, grid: number): Pt {
  const tw = (OUTDOOR.hw * 2) / grid;
  const th = (OUTDOOR.hh * 2) / grid;
  return {
    x: OUTDOOR.cx + (gx - gy) * (tw / 2),
    y: (OUTDOOR.cy - OUTDOOR.hh) + (gx + gy) * (th / 2),
  };
}

export interface OutdoorSceneOpts {
  skybox: HqSkybox | null;
  /** When true, skip giant back-walls → dark void (mockup image 3). */
  giantWallsOff?: boolean;
  shieldActive?: boolean;
  shieldPulse?: number;
  showGrid?: boolean;
  seed?: string;
  /** Skip castle + nature for a bare starter platform. */
  empty?: boolean;
}

/** Paint the complete outdoor miniverse into an already-sized canvas. */
export async function paintOutdoorMiniverse(
  ctx: Ctx,
  mod: CanvasMod,
  opts: OutdoorSceneOpts,
): Promise<{ castleTop: number; castleFeetY: number }> {
  const { cx, cy, hw, hh, thick } = OUTDOOR;
  paintVoid(ctx, 1120, 680);

  // Giant diorama walls BEHIND the platform (or dark void when off).
  if (!opts.giantWallsOff && opts.skybox) {
    const [top, right, , left] = diamond(cx, cy, hw, hh);
    const bounds: GiantWallBounds = {
      corner: { x: top!.x, y: top!.y - 8 },
      west: { x: left!.x - 30, y: left!.y - 40 },
      east: { x: right!.x + 30, y: right!.y - 40 },
      wallH: 320,
    };
    paintGiantWalls(ctx, opts.skybox, bounds);
  }

  drawFlatPlatform(ctx, cx, cy, hw, hh, thick);
  if (opts.showGrid) drawGrassGrid(ctx, cx, cy, hw, hh, 10);
  drawRiverAndBridge(ctx, cx, cy, hw, hh);
  drawPerimeterFence(ctx, cx, cy, hw, hh);

  const castleFeetY = cy - 20;
  if (opts.empty) {
    return { castleTop: castleFeetY - 40, castleFeetY };
  }

  drawNatureScatter(ctx, opts.seed ?? "base");
  const castleTop = await drawOutdoorCastle(ctx, mod, cx, castleFeetY);

  if (opts.shieldActive) {
    drawCastleShield(ctx, mod, cx, castleFeetY - 40, opts.shieldPulse ?? 0.55);
  }

  return { castleTop, castleFeetY };
}

/** Single clean grassy slab — matches the mockup floating platform. */
function drawFlatPlatform(
  ctx: Ctx, cx: number, cy: number, hw: number, hh: number, thick: number,
): void {
  const [t, r, b, l] = diamond(cx, cy, hw, hh);

  // Cliff sides
  ctx.save();
  // Left face
  ctx.beginPath();
  ctx.moveTo(l!.x, l!.y); ctx.lineTo(b!.x, b!.y);
  ctx.lineTo(b!.x, b!.y + thick); ctx.lineTo(l!.x, l!.y + thick);
  ctx.closePath();
  const leftG = ctx.createLinearGradient(l!.x, l!.y, b!.x, b!.y + thick);
  leftG.addColorStop(0, "#6a4a28");
  leftG.addColorStop(0.45, "#5a3a1e");
  leftG.addColorStop(1, "#3a2410");
  ctx.fillStyle = leftG; ctx.fill();
  // Right face
  ctx.beginPath();
  ctx.moveTo(r!.x, r!.y); ctx.lineTo(b!.x, b!.y);
  ctx.lineTo(b!.x, b!.y + thick); ctx.lineTo(r!.x, r!.y + thick);
  ctx.closePath();
  const rightG = ctx.createLinearGradient(r!.x, r!.y, b!.x, b!.y + thick);
  rightG.addColorStop(0, "#8a5a30");
  rightG.addColorStop(0.45, "#6e4524");
  rightG.addColorStop(1, "#4a2e14");
  ctx.fillStyle = rightG; ctx.fill();
  // Strata lines
  ctx.strokeStyle = "rgba(0,0,0,0.22)"; ctx.lineWidth = 1.5;
  for (const dy of [12, 24, 34]) {
    ctx.beginPath();
    ctx.moveTo(l!.x + 4, l!.y + dy); ctx.lineTo(b!.x, b!.y + dy); ctx.lineTo(r!.x - 4, r!.y + dy);
    ctx.stroke();
  }
  ctx.restore();

  // Grass top
  ctx.save();
  polyPath(ctx, [t!, r!, b!, l!]);
  const grass = ctx.createLinearGradient(cx, cy - hh, cx, cy + hh);
  grass.addColorStop(0, "#6bb84a");
  grass.addColorStop(0.45, "#5aa43c");
  grass.addColorStop(1, "#4a8e32");
  ctx.fillStyle = grass; ctx.fill();
  // Soft sun highlight
  const sun = ctx.createRadialGradient(cx - hw * 0.25, cy - hh * 0.35, 20, cx, cy, hw * 0.9);
  sun.addColorStop(0, "rgba(200,255,140,0.22)");
  sun.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = sun; ctx.fill();
  // Edge rim
  ctx.strokeStyle = "rgba(40,80,30,0.45)"; ctx.lineWidth = 2;
  polyPath(ctx, [t!, r!, b!, l!]); ctx.stroke();
  ctx.restore();

  // Drop shadow under platform
  ctx.save();
  ctx.fillStyle = "rgba(0,0,0,0.35)";
  ctx.beginPath();
  ellipse(ctx, cx, cy + hh + thick + 8, hw * 0.88, 22);
  ctx.fill();
  ctx.restore();
}

function drawGrassGrid(
  ctx: Ctx, cx: number, cy: number, hw: number, hh: number, n: number,
): void {
  ctx.save();
  ctx.strokeStyle = "rgba(255,255,255,0.14)";
  ctx.lineWidth = 1;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    // NE-SW lines
    const a1 = { x: cx - hw + (hw * 2) * t * 0.5, y: cy - hh + hh * t };
    const a2 = { x: cx + hw - (hw * 2) * (1 - t) * 0.5, y: cy - hh + hh * t + hh };
    // simpler: interpolate along edges
    const top = { x: cx, y: cy - hh };
    const right = { x: cx + hw, y: cy };
    const bottom = { x: cx, y: cy + hh };
    const left = { x: cx - hw, y: cy };
    const pL = lerp(left, bottom, t);
    const pR = lerp(top, right, t);
    ctx.beginPath(); ctx.moveTo(pL.x, pL.y); ctx.lineTo(pR.x, pR.y); ctx.stroke();
    const pT = lerp(left, top, t);
    const pB = lerp(bottom, right, t);
    ctx.beginPath(); ctx.moveTo(pT.x, pT.y); ctx.lineTo(pB.x, pB.y); ctx.stroke();
  }
  ctx.restore();
}

function lerp(a: Pt, b: Pt, t: number): Pt {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

function drawRiverAndBridge(ctx: Ctx, cx: number, cy: number, hw: number, hh: number): void {
  ctx.save();
  // Clip to grass diamond
  polyPath(ctx, diamond(cx, cy, hw, hh));
  ctx.clip();

  // Meandering river — left-mid to right-mid like the mockup
  const path = (ox: number) => {
    ctx.beginPath();
    ctx.moveTo(cx - hw * 0.95, cy - 10 + ox);
    ctx.quadraticCurveTo(cx - hw * 0.4, cy + 50 + ox, cx - 40, cy + 10 + ox);
    ctx.quadraticCurveTo(cx + 80, cy - 40 + ox, cx + hw * 0.55, cy + 30 + ox);
    ctx.quadraticCurveTo(cx + hw * 0.85, cy + 55 + ox, cx + hw * 0.98, cy + 20 + ox);
  };
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.strokeStyle = "#1a6aa8";
  ctx.lineWidth = 34;
  path(0); ctx.stroke();
  ctx.strokeStyle = "#3a9fd4";
  ctx.lineWidth = 26;
  path(0); ctx.stroke();
  ctx.strokeStyle = "#6ec8f0";
  ctx.lineWidth = 10;
  path(-4); ctx.stroke();
  ctx.restore();

  // Wooden bridge
  const bx = cx + 30, by = cy + 8;
  ctx.save();
  ctx.fillStyle = "#8a6239";
  ctx.beginPath();
  ctx.moveTo(bx - 34, by - 8); ctx.lineTo(bx + 34, by - 14);
  ctx.lineTo(bx + 34, by + 10); ctx.lineTo(bx - 34, by + 16);
  ctx.closePath(); ctx.fill();
  ctx.strokeStyle = "#5a3d22"; ctx.lineWidth = 2;
  for (let i = -3; i <= 3; i++) {
    const t = (i + 3) / 6;
    const x1 = bx - 32 + t * 64, y1 = by - 7 + t * (-6);
    ctx.beginPath();
    ctx.moveTo(x1, y1); ctx.lineTo(x1 + 2, y1 + 22);
    ctx.stroke();
  }
  // Rails
  ctx.strokeStyle = "#c19a5b"; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.moveTo(bx - 30, by - 18); ctx.lineTo(bx + 30, by - 24); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(bx - 30, by + 4); ctx.lineTo(bx + 30, by - 2); ctx.stroke();
  ctx.restore();
}

function drawPerimeterFence(ctx: Ctx, cx: number, cy: number, hw: number, hh: number): void {
  const inset = 0.96;
  const [t, r, b, l] = diamond(cx, cy, hw * inset, hh * inset);
  const edges: [Pt, Pt][] = [[t!, r!], [r!, b!], [b!, l!], [l!, t!]];
  ctx.save();
  for (const [a, bpt] of edges) {
    // Rails
    for (const lift of [10, 22]) {
      ctx.strokeStyle = "#c4a06a";
      ctx.lineWidth = 3.5;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y - lift); ctx.lineTo(bpt.x, bpt.y - lift);
      ctx.stroke();
      ctx.strokeStyle = "rgba(90,60,30,0.45)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y - lift + 2); ctx.lineTo(bpt.x, bpt.y - lift + 2);
      ctx.stroke();
    }
    // Posts
    const posts = 9;
    for (let i = 0; i <= posts; i++) {
      const p = lerp(a, bpt, i / posts);
      ctx.fillStyle = "#a87840";
      ctx.beginPath();
      ctx.moveTo(p.x - 3.5, p.y);
      ctx.lineTo(p.x - 3.5, p.y - 32);
      ctx.lineTo(p.x, p.y - 38);
      ctx.lineTo(p.x + 3.5, p.y - 32);
      ctx.lineTo(p.x + 3.5, p.y);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = "#d4b078";
      ctx.fillRect(p.x - 2, p.y - 30, 2, 26);
    }
  }
  ctx.restore();
}

/** Stylized mockup pines + rocks — consistent vector look, not tiny 64px peeks. */
function drawNatureScatter(ctx: Ctx, seed: string): void {
  const rnd = seededRng(hashString(seed));
  const { cx, cy, hw, hh } = OUTDOOR;
  const spots: { x: number; y: number; kind: "pine" | "pine-tall" | "rock" | "stump" }[] = [];
  let tries = 0;
  while (spots.length < 28 && tries++ < 400) {
    const u = rnd() * 2 - 1, v = rnd() * 2 - 1;
    if (Math.abs(u) + Math.abs(v) > 0.88) continue;
    if (Math.abs(u) + Math.abs(v) < 0.22) continue; // keep castle clear
    const x = cx + u * hw, y = cy + v * hh;
    // Avoid river band
    if (Math.abs((x - cx) * 0.35 + (y - cy)) < 28) continue;
    const roll = rnd();
    spots.push({
      x, y,
      kind: roll < 0.55 ? "pine" : roll < 0.75 ? "pine-tall" : roll < 0.9 ? "rock" : "stump",
    });
  }
  spots.sort((a, b) => a.y - b.y);
  for (const s of spots) {
    if (s.kind === "pine" || s.kind === "pine-tall") {
      drawMockupPine(ctx, s.x, s.y, s.kind === "pine-tall" ? 1.25 : 0.9 + rnd() * 0.25);
    } else if (s.kind === "rock") {
      drawMockupRock(ctx, s.x, s.y, 0.8 + rnd() * 0.4);
    } else {
      drawStump(ctx, s.x, s.y, 0.85);
    }
  }
}

export function drawMockupPine(ctx: Ctx, cx: number, feetY: number, s = 1): void {
  ctx.save();
  // Shadow
  ctx.fillStyle = "rgba(0,0,0,0.28)";
  ctx.beginPath(); ellipse(ctx, cx, feetY, 14 * s, 5 * s); ctx.fill();
  // Trunk
  ctx.fillStyle = "#5a3d22";
  ctx.fillRect(cx - 3.5 * s, feetY - 22 * s, 7 * s, 22 * s);
  // Tiered rounded foliage (mockup style)
  const layers = [
    { y: 0.05, w: 0.42, c: "#2a6a28", c2: "#3a8a38" },
    { y: -0.18, w: 0.34, c: "#328a32", c2: "#44a844" },
    { y: -0.38, w: 0.24, c: "#3aaa3a", c2: "#55c055" },
  ];
  for (const L of layers) {
    const ty = feetY + L.y * 90 * s;
    ctx.fillStyle = L.c;
    ctx.beginPath();
    ctx.moveTo(cx, ty - 32 * s);
    ctx.bezierCurveTo(cx + L.w * 70 * s, ty - 8 * s, cx + L.w * 70 * s, ty + 6 * s, cx, ty + 10 * s);
    ctx.bezierCurveTo(cx - L.w * 70 * s, ty + 6 * s, cx - L.w * 70 * s, ty - 8 * s, cx, ty - 32 * s);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = L.c2;
    ctx.beginPath();
    ctx.ellipse(cx - 4 * s, ty - 10 * s, L.w * 28 * s, 14 * s, -0.3, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function drawMockupRock(ctx: Ctx, cx: number, feetY: number, s = 1): void {
  ctx.save();
  ctx.fillStyle = "rgba(0,0,0,0.25)";
  ctx.beginPath(); ellipse(ctx, cx, feetY, 16 * s, 5 * s); ctx.fill();
  ctx.fillStyle = "#8b9099";
  ctx.beginPath();
  ctx.moveTo(cx - 16 * s, feetY);
  ctx.lineTo(cx - 10 * s, feetY - 16 * s);
  ctx.lineTo(cx + 4 * s, feetY - 20 * s);
  ctx.lineTo(cx + 16 * s, feetY - 8 * s);
  ctx.lineTo(cx + 12 * s, feetY);
  ctx.closePath(); ctx.fill();
  ctx.fillStyle = "#aeb4bc";
  ctx.beginPath();
  ctx.moveTo(cx - 8 * s, feetY - 14 * s);
  ctx.lineTo(cx + 2 * s, feetY - 18 * s);
  ctx.lineTo(cx - 2 * s, feetY - 8 * s);
  ctx.closePath(); ctx.fill();
  ctx.restore();
}

function drawStump(ctx: Ctx, cx: number, feetY: number, s = 1): void {
  ctx.save();
  ctx.fillStyle = "rgba(0,0,0,0.25)";
  ctx.beginPath(); ellipse(ctx, cx, feetY, 10 * s, 4 * s); ctx.fill();
  ctx.fillStyle = "#6b4f2c";
  ctx.fillRect(cx - 8 * s, feetY - 12 * s, 16 * s, 12 * s);
  ctx.fillStyle = "#c4a06a";
  ctx.beginPath(); ellipse(ctx, cx, feetY - 12 * s, 9 * s, 4 * s); ctx.fill();
  ctx.strokeStyle = "#8a6a3f"; ctx.lineWidth = 1;
  ctx.beginPath(); ellipse(ctx, cx, feetY - 12 * s, 5 * s, 2 * s); ctx.stroke();
  ctx.restore();
}

async function drawOutdoorCastle(
  ctx: Ctx, mod: CanvasMod, cx: number, feetY: number,
): Promise<number> {
  const path = spriteForPrefix("building", "castle")
    ?? spriteForPrefix("building", "keep")
    ?? spriteForPrefix("building", "tower");
  if (path) {
    const img = await loadSprite(mod, path).catch(() => null);
    if (img) {
      const iw = Math.max(1, (img as { width: number }).width);
      const ih = Math.max(1, (img as { height: number }).height);
      // Dominant castle — mockup scale
      const h = 210, w = h * (iw / ih);
      ctx.save();
      ctx.fillStyle = "rgba(0,0,0,0.3)";
      ctx.beginPath(); ellipse(ctx, cx, feetY, w * 0.32, 14); ctx.fill();
      ctx.restore();
      blit(ctx, img, cx - w / 2, feetY - h + 8, w, h);
      return feetY - h + 8;
    }
  }
  // Procedural fallback keep
  drawProp(ctx, "monument", cx, feetY, 2.2, 0xa0a8b0);
  return feetY - 120;
}

/** Soft blue shield dome around the castle — mockup style. */
function drawCastleShield(
  ctx: Ctx, _mod: CanvasMod, cx: number, cy: number, pulse: number,
): void {
  const p = Math.max(0, Math.min(1, pulse));
  const rx = 150 + p * 8, ry = 95 + p * 6;
  ctx.save();
  // Soft hemispheric wash
  const g = ctx.createRadialGradient(cx, cy, 20, cx, cy, rx);
  g.addColorStop(0, `rgba(120,200,255,${0.08 + p * 0.06})`);
  g.addColorStop(0.65, `rgba(80,170,255,${0.12 + p * 0.08})`);
  g.addColorStop(1, "rgba(80,170,255,0)");
  ctx.fillStyle = g;
  ctx.beginPath(); ellipse(ctx, cx, cy, rx, ry); ctx.fill();
  // Rim
  ctx.strokeStyle = `rgba(150,220,255,${0.55 + p * 0.25})`;
  ctx.lineWidth = 2.5;
  ctx.shadowColor = "rgba(100,190,255,0.8)";
  ctx.shadowBlur = 14;
  ctx.beginPath(); ellipse(ctx, cx, cy, rx * 0.92, ry * 0.92); ctx.stroke();
  ctx.shadowBlur = 0;
  // Equator highlight
  ctx.strokeStyle = `rgba(200,240,255,${0.35 + p * 0.2})`;
  ctx.lineWidth = 1.5;
  ctx.beginPath(); ellipse(ctx, cx, cy + ry * 0.15, rx * 0.85, ry * 0.22); ctx.stroke();
  ctx.restore();
}

/** Draw outdoor visitors with character sprites when available. */
export async function drawOutdoorVisitors(
  ctx: Ctx, mod: CanvasMod, count: number,
): Promise<void> {
  const spots = [
    { x: OUTDOOR.cx + 140, y: OUTDOOR.cy + 130 },
    { x: OUTDOOR.cx - 200, y: OUTDOOR.cy + 90 },
    { x: OUTDOOR.cx + 220, y: OUTDOOR.cy + 70 },
    { x: OUTDOOR.cx - 100, y: OUTDOOR.cy + 150 },
  ];
  const n = Math.max(0, Math.min(spots.length, count));
  for (let i = 0; i < n; i++) {
    const p = spots[i]!;
    const path = spriteForProp("npc", i + 3);
    if (path) {
      const img = await loadSprite(mod, path).catch(() => null);
      if (img) {
        const iw = Math.max(1, (img as { width: number }).width);
        const ih = Math.max(1, (img as { height: number }).height);
        const h = 70, w = h * (iw / ih);
        ctx.save();
        ctx.fillStyle = "rgba(0,0,0,0.25)";
        ctx.beginPath(); ellipse(ctx, p.x, p.y, w * 0.25, 5); ctx.fill();
        ctx.restore();
        blit(ctx, img, p.x - w / 2, p.y - h + 4, w, h);
        continue;
      }
    }
    drawProp(ctx, "npc", p.x, p.y, 0.95, 0x3a5a8b, i + 3);
  }
}
