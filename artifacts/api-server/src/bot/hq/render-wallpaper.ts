// ─────────────────────────────────────────────────────────────────────────────
// HQ — wallpaper painter.
//
// Papers a repeating motif onto one isometric wall face. The face is a
// parallelogram, so instead of blitting a flat bitmap (which shears and reads as
// a sticker) every motif is stamped in the face's own (u,v) parameter space via
// `bilerp` — u runs along the wall, v runs up it. The pattern therefore follows
// the wall's perspective the way real paper does, at any room size.
//
// A bundled seamless tile (`wallpaper/<id>` in the asset manifest) short-circuits
// the procedural motif, so uploaded 2D art drops straight in.
// ─────────────────────────────────────────────────────────────────────────────

import { hexToRgba, type Ctx, type CanvasMod } from "../animations/engine.js";
import { polyPath, lerpPt, shiftColor, ellipse, blit, type Pt } from "./paint.js";
import { loadSprite, spriteForPrefix } from "./assets.js";
import type { HqWallpaper } from "./defs/wallpapers.js";

// Paint `wp` across the wall face bounded by base-left/base-right (v=0) and
// top-left/top-right (v=1). Callers pass the same corners they'd fill.
export async function drawWallpaperFace(
  ctx: Ctx, mod: CanvasMod, bl: Pt, br: Pt, tl: Pt, tr: Pt, wp: HqWallpaper,
): Promise<void> {
  const at = (u: number, v: number): Pt => lerpPt(lerpPt(bl, br, u), lerpPt(tl, tr, u), v);
  const quad = (u0: number, v0: number, u1: number, v1: number): Pt[] =>
    [at(u0, v0), at(u1, v0), at(u1, v1), at(u0, v1)];

  ctx.save();
  polyPath(ctx, [bl, br, tr, tl]);
  ctx.clip();

  // Wall body with a gentle top-to-bottom light falloff.
  const g = ctx.createLinearGradient(0, Math.min(tl.y, tr.y), 0, Math.max(bl.y, br.y));
  g.addColorStop(0, shiftColor(wp.base, 16));
  g.addColorStop(1, shiftColor(wp.base, -14));
  ctx.fillStyle = g;
  polyPath(ctx, [bl, br, tr, tl]);
  ctx.fill();

  // Real art beats the procedural motif when the pack ships a seamless tile.
  const spritePath = spriteForPrefix("wallpaper", wp.id);
  const img = spritePath ? await loadSprite(mod, spritePath).catch(() => null) : null;
  if (img) {
    await tileSprite(ctx, img, at, wp.repeatX, wp.repeatY);
  } else {
    stampMotif(ctx, wp, at, quad);
  }

  ctx.restore();

  // Dado rail + skirting sit ON TOP of the paper, unclipped, so they keep the
  // crisp horizontal lines that make a wall read as an interior.
  if (wp.dado) {
    const a = at(0, 0.42), b = at(1, 0.42);
    ctx.save();
    ctx.strokeStyle = wp.dado; ctx.lineWidth = 5;
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    ctx.strokeStyle = "rgba(0,0,0,0.25)"; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(a.x, a.y + 3); ctx.lineTo(b.x, b.y + 3); ctx.stroke();
    ctx.restore();
  }
  const sk0 = at(0, 0), sk1 = at(1, 0), skTop0 = at(0, 0.05), skTop1 = at(1, 0.05);
  ctx.save();
  ctx.fillStyle = wp.skirting;
  polyPath(ctx, [sk0, sk1, skTop1, skTop0]);
  ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,0.18)"; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.moveTo(skTop0.x, skTop0.y); ctx.lineTo(skTop1.x, skTop1.y); ctx.stroke();
  ctx.restore();

  // Top cornice line so the paper stops cleanly at the ceiling.
  ctx.save();
  ctx.strokeStyle = hexToRgba(0xffffff, 0.22); ctx.lineWidth = 3;
  ctx.beginPath(); ctx.moveTo(tl.x, tl.y); ctx.lineTo(tr.x, tr.y); ctx.stroke();
  ctx.restore();
}

type AtFn = (u: number, v: number) => Pt;
type QuadFn = (u0: number, v0: number, u1: number, v1: number) => Pt[];

// Repeat a seamless tile across the face by clipping each (u,v) cell and
// drawing the tile into that cell's bounding box.
async function tileSprite(ctx: Ctx, img: unknown, at: AtFn, cols: number, rows: number): Promise<void> {
  const nx = Math.max(1, Math.min(24, Math.round(cols)));
  const ny = Math.max(1, Math.min(24, Math.round(rows)));
  for (let i = 0; i < nx; i++) {
    for (let j = 0; j < ny; j++) {
      const p = [at(i / nx, j / ny), at((i + 1) / nx, j / ny), at((i + 1) / nx, (j + 1) / ny), at(i / nx, (j + 1) / ny)];
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const q of p) {
        minX = Math.min(minX, q.x); minY = Math.min(minY, q.y);
        maxX = Math.max(maxX, q.x); maxY = Math.max(maxY, q.y);
      }
      ctx.save(); polyPath(ctx, p); ctx.clip();
      blit(ctx, img, minX, minY, Math.max(1, maxX - minX), Math.max(1, maxY - minY));
      ctx.restore();
    }
  }
}

function stampMotif(ctx: Ctx, wp: HqWallpaper, at: AtFn, quad: QuadFn): void {
  const nx = Math.max(1, Math.min(24, Math.round(wp.repeatX)));
  const ny = Math.max(1, Math.min(24, Math.round(wp.repeatY)));
  const fill = (pts: Pt[], style: string) => { ctx.fillStyle = style; polyPath(ctx, pts); ctx.fill(); };

  switch (wp.motif) {
    case "plain": {
      // A soft vertical sheen so a flat wall still has some life.
      for (let i = 0; i < 6; i++) {
        const u0 = i / 6, u1 = (i + 0.5) / 6;
        fill(quad(u0, 0, u1, 1), hexToRgba(0xffffff, i % 2 === 0 ? 0.03 : 0.0));
      }
      break;
    }
    case "stripe": {
      for (let i = 0; i < nx; i += 2) fill(quad(i / nx, 0, (i + 1) / nx, 1), wp.accent);
      for (let i = 0; i < nx; i += 2) {
        const p = quad(i / nx + 0.004, 0, i / nx + 0.010, 1);
        fill(p, hexToRgba(0xffffff, 0.10));
      }
      break;
    }
    case "chevron": {
      for (let j = 0; j < ny; j++) {
        const v0 = j / ny, v1 = (j + 1) / ny, vm = (v0 + v1) / 2;
        ctx.fillStyle = j % 2 === 0 ? wp.accent : wp.highlight;
        for (let i = 0; i < nx; i++) {
          const u0 = i / nx, u1 = (i + 1) / nx, um = (u0 + u1) / 2;
          polyPath(ctx, [at(u0, v0), at(um, vm), at(u1, v0), at(u1, v0 + (v1 - v0) * 0.28), at(um, vm + (v1 - v0) * 0.28), at(u0, v0 + (v1 - v0) * 0.28)]);
          ctx.fill();
        }
      }
      break;
    }
    case "diamond": {
      for (let j = 0; j < ny; j++) {
        for (let i = 0; i < nx; i++) {
          if ((i + j) % 2 !== 0) continue;
          const u0 = i / nx, u1 = (i + 1) / nx, v0 = j / ny, v1 = (j + 1) / ny;
          const um = (u0 + u1) / 2, vm = (v0 + v1) / 2;
          fill([at(um, v0), at(u1, vm), at(um, v1), at(u0, vm)], wp.accent);
        }
      }
      // Lattice lines through the diamond corners.
      ctx.strokeStyle = hexToRgba(0xffffff, 0.14); ctx.lineWidth = 1;
      for (let j = 0; j <= ny; j++) {
        const a = at(0, j / ny), b = at(1, j / ny);
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      }
      break;
    }
    case "brickwork": {
      const bh = 1 / ny;
      for (let j = 0; j < ny; j++) {
        const v0 = j / ny, v1 = v0 + bh * 0.88;
        const offset = (j % 2) * (0.5 / nx);
        for (let i = -1; i < nx; i++) {
          const u0 = i / nx + offset, u1 = u0 + (1 / nx) * 0.94;
          if (u1 <= 0 || u0 >= 1) continue;
          const shade = (i + j) % 3 === 0 ? shiftColor(wp.accent, 12) : (i + j) % 3 === 1 ? wp.accent : shiftColor(wp.accent, -12);
          fill(quad(Math.max(0, u0), v0, Math.min(1, u1), v1), shade);
        }
      }
      break;
    }
    case "panel": {
      // Wainscot: framed rectangles on the lower half, plain paper above.
      for (let i = 0; i < nx; i++) {
        const u0 = i / nx + 0.012, u1 = (i + 1) / nx - 0.012;
        fill(quad(u0, 0.07, u1, 0.38), shiftColor(wp.base, -18));
        fill(quad(u0 + 0.008, 0.10, u1 - 0.008, 0.35), wp.accent);
        ctx.strokeStyle = wp.highlight; ctx.lineWidth = 1.5;
        polyPath(ctx, quad(u0, 0.07, u1, 0.38)); ctx.stroke();
      }
      break;
    }
    case "damask": {
      for (let j = 0; j < ny; j++) {
        for (let i = 0; i < nx; i++) {
          const u = (i + (j % 2 ? 0.5 : 0)) / nx, v = (j + 0.5) / ny;
          // Radii stay well under one cell so the medallions read as separate
          // ornaments on a coloured ground instead of merging into a field.
          damaskMedallion(ctx, at, u, v, 0.42 / nx, 0.44 / ny, wp.accent, wp.highlight);
        }
      }
      break;
    }
    case "floral": {
      for (let j = 0; j < ny; j++) {
        for (let i = 0; i < nx; i++) {
          const u = (i + (j % 2 ? 0.5 : 0)) / nx, v = (j + 0.5) / ny;
          const stemTop = at(u, v + 0.36 / ny), stemBase = at(u, v - 0.42 / ny);
          ctx.strokeStyle = wp.highlight; ctx.lineWidth = 1.5;
          ctx.beginPath(); ctx.moveTo(stemBase.x, stemBase.y); ctx.lineTo(stemTop.x, stemTop.y); ctx.stroke();
          const c = at(u, v + 0.34 / ny);
          const r = Math.max(2.5, 220 / (nx * ny));
          ctx.fillStyle = wp.accent;
          for (let k = 0; k < 5; k++) {
            const a = (k / 5) * Math.PI * 2;
            ctx.beginPath(); ellipse(ctx, c.x + Math.cos(a) * r, c.y + Math.sin(a) * r * 0.7, r * 0.72, r * 0.5, a); ctx.fill();
          }
          ctx.fillStyle = "rgba(255,240,190,0.95)";
          ctx.beginPath(); ellipse(ctx, c.x, c.y, r * 0.42, r * 0.32); ctx.fill();
        }
      }
      break;
    }
    case "hex": {
      ctx.strokeStyle = hexToRgba(0xffffff, 0.0);
      for (let j = 0; j < ny; j++) {
        for (let i = 0; i < nx; i++) {
          const u = (i + (j % 2 ? 0.5 : 0)) / nx, v = (j + 0.5) / ny;
          const ru = 0.46 / nx, rv = 0.5 / ny;
          const pts: Pt[] = [];
          for (let k = 0; k < 6; k++) {
            const a = (k / 6) * Math.PI * 2 + Math.PI / 6;
            pts.push(at(u + Math.cos(a) * ru, v + Math.sin(a) * rv));
          }
          ctx.strokeStyle = hexToRgba(0xffffff, 0.10);
          polyPath(ctx, pts); ctx.fillStyle = (i + j) % 3 === 0 ? hexToRgba(0xffffff, 0.05) : "rgba(0,0,0,0)"; ctx.fill();
          ctx.strokeStyle = wp.accent; ctx.lineWidth = 1.2; polyPath(ctx, pts); ctx.stroke();
        }
      }
      break;
    }
    case "circuit": {
      ctx.lineWidth = 1.4;
      for (let j = 0; j < ny; j++) {
        const v = (j + 0.5) / ny;
        ctx.strokeStyle = j % 2 === 0 ? wp.accent : wp.highlight;
        ctx.beginPath();
        for (let i = 0; i <= nx; i++) {
          const u = i / nx;
          const p = at(u, v + (i % 2 === 0 ? 0.16 / ny : -0.16 / ny));
          if (i === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y);
        }
        ctx.stroke();
        ctx.fillStyle = wp.accent;
        for (let i = 0; i <= nx; i += 2) {
          const p = at(i / nx, v + 0.16 / ny);
          ctx.beginPath(); ellipse(ctx, p.x, p.y, 2.2, 1.8); ctx.fill();
        }
      }
      break;
    }
    case "starfield": {
      for (let j = 0; j < ny; j++) {
        for (let i = 0; i < nx; i++) {
          const jitter = ((i * 7 + j * 13) % 5) / 12;
          const u = (i + 0.5 + jitter) / nx, v = (j + 0.5 - jitter) / ny;
          if (u > 1 || v > 1) continue;
          const p = at(u, v);
          const big = (i * 3 + j) % 7 === 0;
          ctx.fillStyle = big ? wp.accent : wp.highlight;
          const r = big ? 2.8 : 1.5;
          ctx.beginPath(); ellipse(ctx, p.x, p.y, r, r); ctx.fill();
          if (big) {
            ctx.strokeStyle = hexToRgba(0xffffff, 0.5); ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(p.x - r * 2.4, p.y); ctx.lineTo(p.x + r * 2.4, p.y);
            ctx.moveTo(p.x, p.y - r * 2.4); ctx.lineTo(p.x, p.y + r * 2.4);
            ctx.stroke();
          }
        }
      }
      break;
    }
    case "tartan": {
      for (let i = 0; i < nx; i++) {
        fill(quad(i / nx, 0, i / nx + 0.55 / nx, 1), hexToRgba(0x000000, 0.0));
        ctx.globalAlpha = 0.42; fill(quad(i / nx, 0, i / nx + 0.55 / nx, 1), wp.accent); ctx.globalAlpha = 1;
      }
      for (let j = 0; j < ny; j++) {
        ctx.globalAlpha = 0.42; fill(quad(0, j / ny, 1, j / ny + 0.55 / ny), wp.accent); ctx.globalAlpha = 1;
      }
      ctx.strokeStyle = wp.highlight; ctx.lineWidth = 1.2;
      for (let i = 0; i < nx; i++) {
        const a = at(i / nx + 0.8 / nx, 0), b = at(i / nx + 0.8 / nx, 1);
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      }
      for (let j = 0; j < ny; j++) {
        const a = at(0, j / ny + 0.8 / ny), b = at(1, j / ny + 0.8 / ny);
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      }
      break;
    }
  }
}

// A classic quatrefoil damask: four pointed lobes on the cardinal axes, a
// rotated square between them and a centre boss. Built out of (u,v) polygons so
// the ornament follows the wall's perspective like the rest of the paper.
function damaskMedallion(
  ctx: Ctx, at: AtFn, u: number, v: number, ru: number, rv: number, accent: string, highlight: string,
): void {
  // One pointed lobe along direction (dx,dy), teardrop-shaped: a rounded belly
  // near the centre tapering to a point at the tip.
  const lobe = (dx: number, dy: number, len: number, wide: number): Pt[] => {
    const pts: Pt[] = [];
    const steps = 14;
    for (let i = 0; i <= steps; i++) {
      const s = i / steps;                      // 0 at centre → 1 at tip
      const belly = Math.sin(s * Math.PI) * wide * (1 - s * 0.35);
      pts.push(at(u + (dx * s * len - dy * belly) * ru, v + (dy * s * len + dx * belly) * rv));
    }
    for (let i = steps; i >= 0; i--) {
      const s = i / steps;
      const belly = Math.sin(s * Math.PI) * wide * (1 - s * 0.35);
      pts.push(at(u + (dx * s * len + dy * belly) * ru, v + (dy * s * len - dx * belly) * rv));
    }
    return pts;
  };

  ctx.fillStyle = accent;
  for (const [dx, dy] of [[0, 1], [0, -1], [1, 0], [-1, 0]] as const) {
    // The vertical lobes run longer than the horizontal ones, which is what
    // gives damask its upright rhythm.
    const len = dy !== 0 ? 1.0 : 0.86;
    polyPath(ctx, lobe(dx, dy, len, 0.34)); ctx.fill();
  }
  // Diagonal filler leaves, short and slim so the ornament stays open.
  const d = Math.SQRT1_2;
  for (const [dx, dy] of [[d, d], [-d, d], [d, -d], [-d, -d]] as const) {
    polyPath(ctx, lobe(dx, dy, 0.46, 0.12)); ctx.fill();
  }

  // Central diamond cartouche and boss.
  ctx.fillStyle = highlight;
  polyPath(ctx, [
    at(u, v + rv * 0.34), at(u + ru * 0.30, v), at(u, v - rv * 0.34), at(u - ru * 0.30, v),
  ]);
  ctx.fill();
  ctx.fillStyle = accent;
  polyPath(ctx, [
    at(u, v + rv * 0.15), at(u + ru * 0.13, v), at(u, v - rv * 0.15), at(u - ru * 0.13, v),
  ]);
  ctx.fill();
}
