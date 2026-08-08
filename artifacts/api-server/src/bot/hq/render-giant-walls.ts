// ─────────────────────────────────────────────────────────────────────────────
// HQ — giant back-walls (outdoor diorama sky).
//
// The outdoor sky is NOT wallpaper and NOT a soft radial wash. It is two tall
 // isometric planes that meet in a corner BEHIND the grassy platform — a
 // miniature diorama box. Players pick a sky theme (Sunny / Night / Desert / …)
 // which paints onto those planes. Turning giant walls OFF leaves the dark void
 // (mockup image with shield-only framing).
 // ─────────────────────────────────────────────────────────────────────────────

import { hexToRgba, type Ctx } from "../animations/engine.js";
import { blit, ellipse, seededRng, hashString, type Pt } from "./paint.js";
import type { HqSkybox } from "./defs/skyboxes.js";

function parseHex(hex: string): number {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  return m ? parseInt(m[1]!, 16) : 0x5eb0ef;
}

export interface GiantWallBounds {
  /** Back corner of the grass platform (where the two walls meet). */
  corner: Pt;
  /** West ground point of the back edge. */
  west: Pt;
  /** East ground point of the back edge. */
  east: Pt;
  /** How tall the giant walls rise (px). */
  wallH: number;
}

/**
 * Paint the two giant isometric back-walls with the active sky theme.
 * Call AFTER the void and BEFORE the grass platform.
 */
export function paintGiantWalls(ctx: Ctx, skybox: HqSkybox, bounds: GiantWallBounds): void {
  const top = parseHex(skybox.skyTop);
  const mid = parseHex(skybox.skyHorizon);
  const land = parseHex(skybox.land);
  const accent = parseHex(skybox.accent);
  const h = bounds.wallH;
  const { corner, west, east } = bounds;

  const up = (p: Pt): Pt => ({ x: p.x, y: p.y - h });
  const c0 = corner, c1 = up(corner);
  const w0 = west, w1 = up(west);
  const e0 = east, e1 = up(east);

  // Soft drop shadow behind the walls into the void.
  ctx.save();
  ctx.fillStyle = "rgba(0,0,0,0.45)";
  ctx.beginPath();
  ctx.moveTo(w0.x - 18, w0.y + 10);
  ctx.lineTo(c0.x, c0.y + 24);
  ctx.lineTo(e0.x + 18, e0.y + 10);
  ctx.lineTo(e1.x + 18, e1.y - 8);
  ctx.lineTo(c1.x, c1.y - 20);
  ctx.lineTo(w1.x - 18, w1.y - 8);
  ctx.closePath();
  ctx.fill();
  ctx.restore();

  // Left face (west → corner) — slightly cooler/darker.
  fillSkyFace(ctx, [w0, c0, c1, w1], top, mid, land, true);
  // Right face (corner → east) — slightly brighter.
  fillSkyFace(ctx, [c0, e0, e1, c1], top, mid, land, false);

  // Inside corner crease.
  ctx.save();
  ctx.strokeStyle = "rgba(0,0,0,0.35)";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(c0.x, c0.y);
  ctx.lineTo(c1.x, c1.y);
  ctx.stroke();
  ctx.restore();

  // Mood accents clipped to each face.
  paintSkyAccents(ctx, skybox, [w0, c0, c1, w1], accent, 1);
  paintSkyAccents(ctx, skybox, [c0, e0, e1, c1], accent, 2);

  // Top edge highlight.
  ctx.save();
  ctx.strokeStyle = hexToRgba(accent, 0.35);
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(w1.x, w1.y);
  ctx.lineTo(c1.x, c1.y);
  ctx.lineTo(e1.x, e1.y);
  ctx.stroke();
  ctx.restore();
}

function fillSkyFace(
  ctx: Ctx, pts: Pt[], top: number, mid: number, land: number, left: boolean,
): void {
  const [a, b, c, d] = pts;
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(a!.x, a!.y);
  ctx.lineTo(b!.x, b!.y);
  ctx.lineTo(c!.x, c!.y);
  ctx.lineTo(d!.x, d!.y);
  ctx.closePath();
  const g = ctx.createLinearGradient(a!.x, d!.y, a!.x, a!.y);
  g.addColorStop(0, hexToRgba(top, left ? 0.98 : 1));
  g.addColorStop(0.55, hexToRgba(mid, 0.95));
  g.addColorStop(1, hexToRgba(land, 0.85));
  ctx.fillStyle = g;
  ctx.fill();
  // Subtle face shading so the corner reads in 3D.
  ctx.fillStyle = left ? "rgba(0,0,0,0.10)" : "rgba(255,255,255,0.06)";
  ctx.fill();
  ctx.restore();
}

function paintSkyAccents(
  ctx: Ctx, skybox: HqSkybox, pts: Pt[], accent: number, seed: number,
): void {
  const rnd = seededRng(hashString(skybox.id) + seed * 997);
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(pts[0]!.x, pts[0]!.y);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i]!.x, pts[i]!.y);
  ctx.closePath();
  ctx.clip();

  const minX = Math.min(...pts.map(p => p.x));
  const maxX = Math.max(...pts.map(p => p.x));
  const minY = Math.min(...pts.map(p => p.y));
  const maxY = Math.max(...pts.map(p => p.y));

  if (skybox.mood === "night" || skybox.mood === "space") {
    for (let i = 0; i < (skybox.mood === "space" ? 40 : 22); i++) {
      ctx.fillStyle = hexToRgba(accent, 0.4 + rnd() * 0.5);
      ctx.beginPath();
      ctx.arc(minX + rnd() * (maxX - minX), minY + rnd() * (maxY - minY) * 0.7, 0.8 + rnd() * 1.8, 0, Math.PI * 2);
      ctx.fill();
    }
  } else if (
    skybox.mood === "day" || skybox.mood === "courtyard" || skybox.mood === "beach"
    || skybox.mood === "ocean" || skybox.mood === "autumn"
  ) {
    for (let i = 0; i < 7; i++) {
      const x = minX + 40 + rnd() * (maxX - minX - 80);
      const y = minY + 30 + rnd() * (maxY - minY) * 0.45;
      const rw = 28 + rnd() * 50, rh = 12 + rnd() * 14;
      ctx.fillStyle = hexToRgba(accent, 0.55);
      ctx.beginPath(); ellipse(ctx, x, y, rw, rh); ctx.fill();
      ctx.beginPath(); ellipse(ctx, x + rw * 0.35, y - 5, rw * 0.55, rh * 0.75); ctx.fill();
      ctx.beginPath(); ellipse(ctx, x - rw * 0.3, y - 3, rw * 0.4, rh * 0.65); ctx.fill();
    }
  } else if (skybox.mood === "snow") {
    for (let i = 0; i < 35; i++) {
      ctx.fillStyle = "rgba(255,255,255,0.55)";
      ctx.beginPath();
      ctx.arc(minX + rnd() * (maxX - minX), minY + rnd() * (maxY - minY), 1 + rnd() * 2.2, 0, Math.PI * 2);
      ctx.fill();
    }
  } else if (skybox.mood === "volcano") {
    for (let i = 0; i < 16; i++) {
      ctx.fillStyle = hexToRgba(accent, 0.3 + rnd() * 0.4);
      ctx.beginPath();
      ctx.arc(minX + rnd() * (maxX - minX), minY + rnd() * (maxY - minY) * 0.6, 1.5 + rnd() * 3, 0, Math.PI * 2);
      ctx.fill();
    }
  } else if (skybox.mood === "desert") {
    // Soft sand dunes along the bottom of the face.
    ctx.fillStyle = hexToRgba(parseHex(skybox.land), 0.55);
    ctx.beginPath();
    ctx.moveTo(minX, maxY);
    for (let i = 0; i <= 8; i++) {
      const x = minX + (maxX - minX) * (i / 8);
      const y = maxY - 40 - Math.sin(i * 0.9 + rnd()) * 18;
      ctx.lineTo(x, y);
    }
    ctx.lineTo(maxX, maxY);
    ctx.closePath();
    ctx.fill();
  } else if (skybox.mood === "forest") {
    ctx.fillStyle = hexToRgba(parseHex(skybox.land), 0.7);
    for (let i = 0; i < 10; i++) {
      const x = minX + 20 + i * ((maxX - minX) / 10);
      const th = 36 + (i % 3) * 16;
      ctx.beginPath();
      ctx.moveTo(x, maxY - 10);
      ctx.lineTo(x + 12, maxY - 10 - th);
      ctx.lineTo(x + 24, maxY - 10);
      ctx.closePath();
      ctx.fill();
    }
  }
  ctx.restore();
}

/** Optional: blit a soft sky sprite wash into the giant-wall region (when art exists). */
export function blitSkySprite(
  ctx: Ctx, img: unknown, bounds: GiantWallBounds,
): void {
  const { corner, west, east, wallH } = bounds;
  const topY = Math.min(west.y, corner.y, east.y) - wallH;
  const botY = Math.max(west.y, corner.y, east.y);
  const leftX = Math.min(west.x, corner.x) - 20;
  const rightX = Math.max(east.x, corner.x) + 20;
  ctx.save();
  ctx.globalAlpha = 0.35;
  blit(ctx, img, leftX, topY, rightX - leftX, botY - topY);
  ctx.restore();
}
