// ─────────────────────────────────────────────────────────────────────────────
// HQ — open atmosphere painter (skyboxes).
//
// Skyboxes tint what sits BEYOND the playable isometric space. They do not
// rebuild rooms, replace architectural walls, or enclose the scene in giant
// textured backdrop planes. The canvas stays a dark void; a soft horizon wash
// and mood accents sit behind the island/room — Sims / Two Point / Zomboid
// framing, not a wallpapered diorama box.
// ─────────────────────────────────────────────────────────────────────────────

import { hexToRgba, type Ctx, type CanvasMod } from "../animations/engine.js";
import { blit, ellipse, seededRng, hashString } from "./paint.js";
import { loadSprite, spriteForPrefix } from "./assets.js";
import type { HqSkybox } from "./defs/skyboxes.js";

function parseHex(hex: string): number | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  return m ? parseInt(m[1]!, 16) : null;
}

/** Solid dark void — the canvas frame around the open isometric scene. */
export function paintVoid(ctx: Ctx, w: number, h: number): void {
  ctx.fillStyle = "#050608";
  ctx.fillRect(0, 0, w, h);
}

/**
 * Soft open atmosphere behind the playable footprint.
 * `focus` is the screen centre of the island/room; atmosphere is strongest
 * around/behind that area and fades into the void at the canvas edges.
 */
export async function paintOpenAtmosphere(
  ctx: Ctx,
  mod: CanvasMod,
  skybox: HqSkybox | null | undefined,
  bounds: { w: number; h: number; focusX: number; focusY: number; radius: number },
): Promise<void> {
  const sb = skybox;
  if (!sb) return;

  // Optional art: used as a soft distant wash, never a full-bleed cover.
  const key = sb.spriteKey.replace(/^skybox\//, "") || sb.id.replace(/^skybox-/, "");
  const path = spriteForPrefix("skybox", key) ?? spriteForPrefix("backdrop", key);
  if (path) {
    const img = await loadSprite(mod, path).catch(() => null);
    if (img) {
      const iw = Math.max(1, (img as { width: number }).width);
      const ih = Math.max(1, (img as { height: number }).height);
      const sc = Math.max(bounds.radius * 2.4 / iw, bounds.radius * 1.6 / ih);
      const dw = iw * sc, dh = ih * sc;
      ctx.save();
      ctx.globalAlpha = 0.42;
      blit(ctx, img, bounds.focusX - dw / 2, bounds.focusY - dh * 0.72, dw, dh);
      ctx.restore();
    }
  }

  const top = parseHex(sb.skyTop) ?? 0x5eb0ef;
  const mid = parseHex(sb.skyHorizon) ?? 0xc8e4ff;
  const land = parseHex(sb.land) ?? 0x7aaa4a;
  const accent = parseHex(sb.accent) ?? 0xffffff;
  const rnd = seededRng(hashString(sb.id));

  // Soft radial wash behind the scene — does NOT fill the whole canvas.
  ctx.save();
  const wash = ctx.createRadialGradient(
    bounds.focusX, bounds.focusY - bounds.radius * 0.35, bounds.radius * 0.15,
    bounds.focusX, bounds.focusY - bounds.radius * 0.1, bounds.radius * 1.35,
  );
  wash.addColorStop(0, hexToRgba(top, 0.55));
  wash.addColorStop(0.45, hexToRgba(mid, 0.28));
  wash.addColorStop(0.78, hexToRgba(land, 0.14));
  wash.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = wash;
  ctx.beginPath();
  ellipse(ctx, bounds.focusX, bounds.focusY - bounds.radius * 0.15, bounds.radius * 1.35, bounds.radius * 0.95);
  ctx.fill();
  ctx.restore();

  // Distant soft horizon silhouette — a thin band, not enclosing walls.
  ctx.save();
  ctx.globalAlpha = 0.35;
  ctx.fillStyle = hexToRgba(land, 0.9);
  ctx.beginPath();
  const hy = bounds.focusY - bounds.radius * 0.55;
  ctx.moveTo(bounds.focusX - bounds.radius * 1.2, hy + 40);
  for (let i = 0; i <= 10; i++) {
    const x = bounds.focusX - bounds.radius * 1.2 + (bounds.radius * 2.4) * (i / 10);
    const y = hy - Math.sin(i * 0.9 + rnd()) * 18 - (i % 3) * 6;
    ctx.lineTo(x, y);
  }
  ctx.lineTo(bounds.focusX + bounds.radius * 1.2, hy + 50);
  ctx.closePath();
  ctx.fill();
  ctx.restore();

  // Mood accents (sparse — support the scene, don't dominate).
  ctx.save();
  if (sb.mood === "night" || sb.mood === "space") {
    for (let i = 0; i < (sb.mood === "space" ? 55 : 28); i++) {
      const ang = rnd() * Math.PI * 2;
      const dist = rnd() * bounds.radius * 1.1;
      const x = bounds.focusX + Math.cos(ang) * dist;
      const y = bounds.focusY - bounds.radius * 0.4 + Math.sin(ang) * dist * 0.55;
      ctx.fillStyle = hexToRgba(accent, 0.35 + rnd() * 0.5);
      ctx.beginPath();
      ctx.arc(x, y, sb.mood === "space" ? 1.1 + rnd() * 1.6 : 0.7 + rnd(), 0, Math.PI * 2);
      ctx.fill();
    }
  } else if (sb.mood === "day" || sb.mood === "beach" || sb.mood === "courtyard" || sb.mood === "ocean") {
    for (let i = 0; i < 5; i++) {
      const x = bounds.focusX - bounds.radius * 0.7 + rnd() * bounds.radius * 1.4;
      const y = bounds.focusY - bounds.radius * 0.85 + rnd() * 70;
      const rw = 36 + rnd() * 60, rh = 12 + rnd() * 16;
      ctx.fillStyle = hexToRgba(accent, 0.22);
      ctx.beginPath(); ellipse(ctx, x, y, rw, rh); ctx.fill();
      ctx.beginPath(); ellipse(ctx, x + rw * 0.3, y - 4, rw * 0.5, rh * 0.8); ctx.fill();
    }
  } else if (sb.mood === "snow") {
    for (let i = 0; i < 40; i++) {
      ctx.fillStyle = "rgba(255,255,255,0.45)";
      ctx.beginPath();
      ctx.arc(
        bounds.focusX - bounds.radius + rnd() * bounds.radius * 2,
        bounds.focusY - bounds.radius * 0.9 + rnd() * bounds.radius,
        1 + rnd() * 2, 0, Math.PI * 2,
      );
      ctx.fill();
    }
  } else if (sb.mood === "volcano") {
    for (let i = 0; i < 18; i++) {
      const x = bounds.focusX - 80 + rnd() * 160;
      const y = bounds.focusY - bounds.radius * 0.7 + rnd() * 50;
      ctx.fillStyle = hexToRgba(accent, 0.25 + rnd() * 0.4);
      ctx.beginPath(); ctx.arc(x, y, 1.5 + rnd() * 3, 0, Math.PI * 2); ctx.fill();
    }
  } else if (sb.mood === "forest") {
    ctx.globalAlpha = 0.25;
    ctx.fillStyle = hexToRgba(land, 1);
    for (let i = 0; i < 9; i++) {
      const x = bounds.focusX - bounds.radius * 0.9 + i * (bounds.radius * 0.2);
      const h = 28 + (i % 3) * 14;
      ctx.beginPath();
      ctx.moveTo(x, hy + 20); ctx.lineTo(x + 10, hy + 20 - h); ctx.lineTo(x + 20, hy + 20);
      ctx.closePath(); ctx.fill();
    }
  }
  ctx.restore();
}
