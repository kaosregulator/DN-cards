// ─────────────────────────────────────────────────────────────────────────────
// 2D mesh warp — deform the target's OWN pixels, locally, preserving the artwork.
//
// The old strip warp moved whole rows, which looked like the picture sliding.
// Instead we lay a grid over the subject, push each grid vertex by a smooth
// DISPLACEMENT FIELD (localised around the detected eye/mouth ellipses, zero
// everywhere else), and redraw each grid cell as two source→dest triangles with
// an affine transform. Pixels near a feature stretch; the rest of the artwork is
// untouched. This is the same idea a puppet/Live2D warp uses — no artwork is
// pasted on, the emoji itself moves.
// ─────────────────────────────────────────────────────────────────────────────

import type { Canvas } from "@napi-rs/canvas";
import type { Ctx } from "../../../animations/engine.js";

export interface Pt { x: number; y: number }

/** Grid resolution (cells per axis). 12 is smooth enough at ≤128px, cheap enough. */
export const GRID = 12;

interface TriCtx {
  save(): void; restore(): void; beginPath(): void; closePath(): void; clip(): void;
  moveTo(x: number, y: number): void; lineTo(x: number, y: number): void;
  setTransform(a: number, b: number, c: number, d: number, e: number, f: number): void;
  drawImage(src: Canvas, dx: number, dy: number, dw: number, dh: number): void;
}

/**
 * Paint one source triangle to one dest triangle: solve the affine that maps
 * src→dest, clip to the (slightly grown) source triangle, and blit the whole
 * source under that transform. Growing the clip a hair hides inter-triangle
 * seams.
 */
function drawTriangle(ctx: Ctx, src: Canvas, size: number, s: [Pt, Pt, Pt], d: [Pt, Pt, Pt]): void {
  const [s0, s1, s2] = s;
  const [d0, d1, d2] = d;
  const den = (s0.x - s2.x) * (s1.y - s2.y) - (s1.x - s2.x) * (s0.y - s2.y);
  if (Math.abs(den) < 1e-6) return;
  const a = ((d0.x - d2.x) * (s1.y - s2.y) - (d1.x - d2.x) * (s0.y - s2.y)) / den;
  const b = ((d0.y - d2.y) * (s1.y - s2.y) - (d1.y - d2.y) * (s0.y - s2.y)) / den;
  const c = ((d1.x - d2.x) * (s0.x - s2.x) - (d0.x - d2.x) * (s1.x - s2.x)) / den;
  const dd = ((d1.y - d2.y) * (s0.x - s2.x) - (d0.y - d2.y) * (s1.x - s2.x)) / den;
  const e = d0.x - a * s0.x - c * s0.y;
  const f = d0.y - b * s0.x - dd * s0.y;

  // Grow the source clip triangle slightly around its centroid.
  const gx = (s0.x + s1.x + s2.x) / 3, gy = (s0.y + s1.y + s2.y) / 3;
  const grow = (p: Pt): Pt => {
    const dx = p.x - gx, dy = p.y - gy;
    const len = Math.hypot(dx, dy) || 1;
    return { x: p.x + (dx / len) * 0.75, y: p.y + (dy / len) * 0.75 };
  };
  const g0 = grow(s0), g1 = grow(s1), g2 = grow(s2);

  const t = ctx as unknown as TriCtx;
  t.save();
  t.setTransform(a, b, c, dd, e, f);
  t.beginPath();
  t.moveTo(g0.x, g0.y); t.lineTo(g1.x, g1.y); t.lineTo(g2.x, g2.y); t.closePath();
  t.clip();
  t.drawImage(src, 0, 0, size, size);
  t.restore();
}

/**
 * Warp `src` into `dstCtx` using a displacement function that returns the
 * (dx,dy) offset for a source pixel. Source vertices come from a regular grid;
 * dest vertices are src + displace(src).
 */
export function meshWarp(
  dstCtx: Ctx, src: Canvas, size: number,
  displace: (x: number, y: number) => Pt,
): void {
  const step = size / GRID;
  // Precompute the displaced grid.
  const cols = GRID + 1;
  const sv: Pt[] = new Array(cols * cols);
  const dv: Pt[] = new Array(cols * cols);
  for (let gy = 0; gy <= GRID; gy++) {
    for (let gx = 0; gx <= GRID; gx++) {
      const x = gx * step, y = gy * step;
      const idx = gy * cols + gx;
      sv[idx] = { x, y };
      const off = displace(x, y);
      dv[idx] = { x: x + off.x, y: y + off.y };
    }
  }
  (dstCtx as unknown as TriCtx).setTransform(1, 0, 0, 1, 0, 0);
  for (let gy = 0; gy < GRID; gy++) {
    for (let gx = 0; gx < GRID; gx++) {
      const i00 = gy * cols + gx, i10 = i00 + 1, i01 = i00 + cols, i11 = i01 + 1;
      drawTriangle(dstCtx, src, size, [sv[i00]!, sv[i10]!, sv[i11]!], [dv[i00]!, dv[i10]!, dv[i11]!]);
      drawTriangle(dstCtx, src, size, [sv[i00]!, sv[i11]!, sv[i01]!], [dv[i00]!, dv[i11]!, dv[i01]!]);
    }
  }
  (dstCtx as unknown as TriCtx).setTransform(1, 0, 0, 1, 0, 0);
}
