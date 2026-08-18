// ─────────────────────────────────────────────────────────────────────────────
// Isometric tile art — every tile is drawn into a texture at runtime (no image
// files, CSP-safe) as a 2:1 diamond. Flat tiles are a single diamond; "raised"
// kinds (walls, trees, buildings, furniture) are extruded into a block with two
// shaded side faces so the world reads as 3-D, like the reference client.
//
// Placement contract: every tile/object is positioned by its GROUND diamond
// centre, so flat tiles and raised blocks line up on the same isometric grid.
// ─────────────────────────────────────────────────────────────────────────────

import Phaser from "phaser";
import type { TileKind } from "./tiles";

export const ISO_W = 64;    // diamond width
export const ISO_H = 32;    // diamond height
export const ISO_LIFT = 30; // extrusion height for raised blocks

interface Pal { base: number; dark: number; light: number; edge: number; }
const P = (base: number, dark: number, light: number, edge = 0x0a0d16): Pal => ({ base, dark, light, edge });

const PAL: Record<TileKind, Pal> = {
  grass:   P(0x3b8a4e, 0x2c6b3a, 0x59a869),
  grass2:  P(0x347f46, 0x265f33, 0x4f9d5f),
  path:    P(0xa89066, 0x7f6b48, 0xc4ac80),
  sand:    P(0xd8c288, 0xb09a63, 0xe9d7a0),
  water:   P(0x2f74d0, 0x21579e, 0x54a0ec),
  tree:    P(0x2b7a42, 0x184f28, 0x3fa05a),
  wall:    P(0x6b7194, 0x474d6b, 0x8b92b5),
  brick:   P(0x8a5555, 0x5f3838, 0xa66a6a),
  roof:    P(0xb0463f, 0x7d2c28, 0xd06a5c),
  door:    P(0x9c7a45, 0x6b5230, 0xc09a5e),
  floor:   P(0x8a7a5a, 0x63563e, 0xa89a78),
  carpet:  P(0xa04a68, 0x742f45, 0xc06a88),
  rug:     P(0x3f7aa0, 0x2c5570, 0x60a0c8),
  counter: P(0xb08a4a, 0x7c5f30, 0xceac6e),
  shelf:   P(0x7a5738, 0x4f3520, 0x9c7a52),
  fence:   P(0x9c8767, 0x6f5c40, 0xbda588),
  stone:   P(0x8b91a3, 0x62687a, 0xacb2c4),
  flower:  P(0x3b8a4e, 0x2c6b3a, 0xe0679a),
  void:    P(0x0a0d16, 0x05070f, 0x141a2e),
};

/** Kinds drawn as extruded blocks (everything a walker treats as solid, plus
 *  furniture) — water and void stay flat. */
const RAISED = new Set<TileKind>(["tree", "wall", "brick", "roof", "counter", "shelf", "fence"]);
export function isRaised(k: TileKind): boolean { return RAISED.has(k); }

export const ISO_KEY = (k: TileKind): string => `iso:${k}`;

/** Ground-diamond centre inside a block texture, as an origin fraction (0..1). */
export function isoOrigin(k: TileKind): { ox: number; oy: number } {
  if (!RAISED.has(k)) return { ox: 0.5, oy: 0.5 };
  const total = ISO_H + ISO_LIFT;
  return { ox: 0.5, oy: (ISO_LIFT + ISO_H / 2) / total };
}

function diamond(g: Phaser.GameObjects.Graphics, cx: number, cy: number): Phaser.Math.Vector2[] {
  return [
    new Phaser.Math.Vector2(cx, cy - ISO_H / 2),
    new Phaser.Math.Vector2(cx + ISO_W / 2, cy),
    new Phaser.Math.Vector2(cx, cy + ISO_H / 2),
    new Phaser.Math.Vector2(cx - ISO_W / 2, cy),
  ];
}

/** Draw every isometric tile texture once (idempotent). */
export function ensureIsoTextures(scene: Phaser.Scene): void {
  (Object.keys(PAL) as TileKind[]).forEach((kind) => {
    const key = ISO_KEY(kind);
    if (scene.textures.exists(key)) return;
    const pal = PAL[kind];
    const raised = RAISED.has(kind);
    const w = ISO_W, h = raised ? ISO_H + ISO_LIFT : ISO_H;
    const g = scene.make.graphics({ x: 0, y: 0 }, false);

    if (raised) {
      const topCy = ISO_H / 2;               // top-diamond centre
      const groundCy = ISO_LIFT + ISO_H / 2; // ground-diamond centre
      // Side faces (left lighter than right for a lit look).
      g.fillStyle(pal.dark, 1);
      g.fillPoints([
        new Phaser.Math.Vector2(ISO_W / 2 - ISO_W / 2, topCy),           // top-left
        new Phaser.Math.Vector2(ISO_W / 2, topCy + ISO_H / 2),           // top-bottom
        new Phaser.Math.Vector2(ISO_W / 2, groundCy + ISO_H / 2),        // ground-bottom
        new Phaser.Math.Vector2(0, groundCy),                           // ground-left
      ], true);
      g.fillStyle(shade(pal.dark, -0.18), 1);
      g.fillPoints([
        new Phaser.Math.Vector2(ISO_W / 2, topCy + ISO_H / 2),           // top-bottom
        new Phaser.Math.Vector2(ISO_W, topCy),                          // top-right
        new Phaser.Math.Vector2(ISO_W, groundCy),                       // ground-right
        new Phaser.Math.Vector2(ISO_W / 2, groundCy + ISO_H / 2),        // ground-bottom
      ], true);
      drawTop(g, ISO_W / 2, topCy, pal, kind);
    } else {
      drawTop(g, ISO_W / 2, ISO_H / 2, pal, kind);
    }
    g.generateTexture(key, w, h);
    g.destroy();
  });
}

function drawTop(g: Phaser.GameObjects.Graphics, cx: number, cy: number, pal: Pal, kind: TileKind): void {
  const pts = diamond(g, cx, cy);
  g.fillStyle(pal.base, 1);
  g.fillPoints(pts, true);
  // Lit top-left, shaded bottom-right triangles for a little volume.
  g.fillStyle(pal.light, 0.35);
  g.fillPoints([pts[0]!, pts[3]!, new Phaser.Math.Vector2(cx, cy)], true);
  g.fillStyle(pal.dark, 0.25);
  g.fillPoints([pts[1]!, pts[2]!, new Phaser.Math.Vector2(cx, cy)], true);
  // Speckle so big areas aren't flat.
  g.fillStyle(pal.light, 0.5);
  for (let i = 0; i < 6; i++) {
    const rx = (Math.sin(i * 12.9 + kind.length) * 0.5) * (ISO_W * 0.32);
    const ry = (Math.cos(i * 7.7 + kind.length) * 0.5) * (ISO_H * 0.32);
    g.fillRect(cx + rx, cy + ry, 1, 1);
  }
  // Water gets a couple of highlight ripples.
  if (kind === "water") {
    g.lineStyle(1, pal.light, 0.6);
    g.beginPath(); g.moveTo(cx - 10, cy); g.lineTo(cx - 4, cy - 2); g.strokePath();
    g.beginPath(); g.moveTo(cx + 4, cy + 3); g.lineTo(cx + 12, cy + 1); g.strokePath();
  }
  g.lineStyle(1, pal.edge, 0.25);
  g.strokePoints(pts, true, true);
  // Flower dot / grass2 tuft accents.
  if (kind === "flower") { g.fillStyle(0xffe36e, 1); g.fillCircle(cx, cy, 2); g.fillStyle(0xe0679a, 1); g.fillCircle(cx - 4, cy - 2, 1.5); g.fillCircle(cx + 4, cy - 1, 1.5); }
}

function shade(c: number, f: number): number {
  const r = (c >> 16) & 255, g = (c >> 8) & 255, b = c & 255;
  const m = (v: number) => Math.max(0, Math.min(255, Math.round(f < 0 ? v * (1 + f) : v + (255 - v) * f)));
  return (m(r) << 16) | (m(g) << 8) | m(b);
}
