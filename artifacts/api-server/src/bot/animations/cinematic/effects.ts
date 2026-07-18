// ─────────────────────────────────────────────────────────────────────────────
// Cinematic effect layers — the reusable building blocks a cinematic is made of.
//
// Every export here is a LAYER FACTORY: it takes some options and returns a
// CinematicLayer (a per-frame draw). Scenes (fatality.ts, and future pack/boss/
// raid cinematics) assemble these into a layer list; nothing here knows about
// Fatality specifically. They lean on the already-shared atmosphere, physics,
// and effect helpers so there is one particle system, one debris system, etc.
// ─────────────────────────────────────────────────────────────────────────────

import type { CinematicLayer, CinematicFrame } from "./engine.js";
import { keyframes, ease, mixHex } from "./engine.js";
import { clamp01, hexToRgba, lerp, type Ctx } from "../engine.js";
import {
  drawCardArt, drawCardFrame, drawRarityGlow, drawFoilOverlay, drawTitle,
  drawTextWithShadow, getRarityEffectColor, loadArt,
} from "../effects.js";
import { drawAtmosphere, type AtmosphereLayer } from "../atmosphere.js";
import { simulateDebris, drawDebris } from "../physics.js";
import type { RenderCard } from "../../battle/image/render.js";

// ── Animated arena backdrop ───────────────────────────────────────────────────
// A living environment: a slowly breathing gradient + a full atmosphere pass
// (flames/smoke/embers/fog/weather/lightning, whatever layers you hand it),
// advancing on the frame phase so the scene never feels static.
export function arenaBackdrop(opts: {
  palette: [number, number, number];      // [top, mid, bottom]
  atmosphere: AtmosphereLayer[];
  accent: number;
  seed: string;
}): CinematicLayer {
  return ({ ctx, width, height, t }: CinematicFrame) => {
    const [top, mid, bot] = opts.palette;
    // Breathe the gradient centre so the light source feels alive.
    const cy = height * (0.42 + Math.sin(t * Math.PI * 2) * 0.03);
    const g = ctx.createRadialGradient(width / 2, cy, height * 0.1, width / 2, cy, width * 0.8);
    g.addColorStop(0, mixHex(top, mid, 0.15 + 0.1 * Math.sin(t * Math.PI * 2)));
    g.addColorStop(0.55, hexToRgba(mid, 1));
    g.addColorStop(1, hexToRgba(bot, 1));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, width, height);
    drawAtmosphere(ctx, width, height, opts.atmosphere, { seed: opts.seed, t, color: opts.accent });
  };
}

// ── Dynamic lighting ──────────────────────────────────────────────────────────
// A coloured key light that sweeps across the scene plus a pulsing vignette, so
// the whole frame is lit as if by fire — cheap fake of moving stage lighting.
export function dynamicLighting(opts: { color: number; intensity?: number }): CinematicLayer {
  const intensity = opts.intensity ?? 1;
  return ({ ctx, width, height, t }: CinematicFrame) => {
    // Sweeping key light.
    const lx = width * (0.5 + 0.32 * Math.sin(t * Math.PI * 2));
    const ly = height * (0.36 + 0.06 * Math.cos(t * Math.PI * 3));
    const flicker = 0.7 + 0.3 * Math.sin(t * Math.PI * 14) * Math.sin(t * Math.PI * 5);
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    const g = ctx.createRadialGradient(lx, ly, 0, lx, ly, width * 0.5);
    g.addColorStop(0, hexToRgba(opts.color, 0.22 * intensity * flicker));
    g.addColorStop(1, hexToRgba(opts.color, 0));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, width, height);
    ctx.restore();
    // Pulsing vignette to keep focus centre-stage.
    const v = ctx.createRadialGradient(width / 2, height / 2, height * 0.28, width / 2, height / 2, width * 0.72);
    v.addColorStop(0, "rgba(0,0,0,0)");
    v.addColorStop(1, `rgba(0,0,0,${0.45 + 0.1 * Math.sin(t * Math.PI * 2)})`);
    ctx.fillStyle = v;
    ctx.fillRect(0, 0, width, height);
  };
}

// ── Lightning / impact flashes ────────────────────────────────────────────────
// Full-frame colour flashes fired at given phases, each a sharp attack + quick
// decay — thunder strikes, the moment of the finishing blow, etc.
export function flashes(opts: { color: number; at: number[]; strength?: number }): CinematicLayer {
  const strength = opts.strength ?? 0.55;
  return ({ ctx, width, height, t }: CinematicFrame) => {
    let a = 0;
    for (const at of opts.at) {
      const d = t - at;
      if (d >= 0 && d < 0.12) a = Math.max(a, (1 - d / 0.12) * strength);
      // A tiny pre-flash flicker just before the strike.
      else if (d >= -0.03 && d < 0) a = Math.max(a, 0.15 * strength);
    }
    if (a > 0) {
      ctx.fillStyle = hexToRgba(opts.color, a);
      ctx.fillRect(0, 0, width, height);
    }
  };
}

// ── Big animated title (the "FATALITY" slam) ──────────────────────────────────
// Slams in with an overshoot + settle, glows, shakes on impact, and holds. A
// subtle chromatic split on the impact frames gives it weight.
export function bigTitle(opts: {
  text: string;
  color: number;
  accent: number;
  appearAt?: number;      // phase the slam starts
  subtitle?: string;
}): CinematicLayer {
  const appearAt = opts.appearAt ?? 0.12;
  return ({ ctx, width, height, t }: CinematicFrame) => {
    const local = clamp01((t - appearAt) / (1 - appearAt));
    if (local <= 0) return;
    const scale = keyframes(local, [
      { at: 0, value: 2.6 },
      { at: 0.35, value: 1, ease: ease.outExpo },
      { at: 1, value: 1 },
    ]);
    const alpha = keyframes(local, [
      { at: 0, value: 0 },
      { at: 0.18, value: 1, ease: ease.outCubic },
      { at: 1, value: 1 },
    ]);
    // Impact shake, only in the first slice after the slam lands.
    const shakeAmt = local < 0.4 ? (0.4 - local) / 0.4 * 6 : 0;
    const sx = Math.sin(t * 90) * shakeAmt;
    const sy = Math.cos(t * 80) * shakeAmt;
    const cx = width / 2 + sx, cy = height * 0.5 + sy;
    const fontPx = Math.round(96 * scale);

    ctx.save();
    ctx.globalAlpha = alpha;
    // Chromatic split on the slam frames.
    if (local < 0.4) {
      const split = (0.4 - local) / 0.4 * 6;
      drawTitle(ctx, opts.text, cx - split, cy, "rgba(255,40,40,0.6)", fontPx);
      drawTitle(ctx, opts.text, cx + split, cy, "rgba(40,120,255,0.6)", fontPx);
    }
    // Glow underlay.
    ctx.save();
    ctx.shadowColor = hexToRgba(opts.accent, 0.9);
    ctx.shadowBlur = 40 + 20 * Math.sin(t * Math.PI * 6);
    drawTitle(ctx, opts.text, cx, cy, hexToRgba(opts.color, 1), fontPx);
    ctx.restore();
    // Crisp top layer.
    drawTitle(ctx, opts.text, cx, cy, "#fff6d0", fontPx);
    ctx.globalAlpha = 1;
    if (opts.subtitle && local > 0.3) {
      const subA = clamp01((local - 0.3) / 0.2);
      ctx.globalAlpha = subA;
      drawTextWithShadow(ctx, opts.subtitle, width / 2, cy + fontPx * 0.62, hexToRgba(opts.accent, 1), 22);
      ctx.globalAlpha = 1;
    }
    ctx.restore();
  };
}

// ── Winner card spotlight (glow + shimmer) ────────────────────────────────────
// The victor rises into frame, haloed and shimmering. Reuses the shared card art
// clip, frame, rarity glow, and foil sweep so it matches the rest of the game.
export function cardSpotlight(opts: {
  card: RenderCard;
  x: number; y: number; w: number; h: number;
  enterFrom?: "left" | "right" | "bottom";
  appearAt?: number;
}): CinematicLayer {
  const appearAt = opts.appearAt ?? 0;
  const color = opts.card.rarityColor ?? getRarityEffectColor(opts.card.rarity);
  return async ({ ctx, mod, t, width, height }: CinematicFrame) => {
    const local = clamp01((t - appearAt) / (0.35));
    const eased = ease.outBack(local);
    let ox = 0, oy = 0;
    if (opts.enterFrom === "left") ox = lerp(-width * 0.4, 0, eased);
    else if (opts.enterFrom === "right") ox = lerp(width * 0.4, 0, eased);
    else oy = lerp(height * 0.5, 0, eased);
    const x = opts.x + ox, y = opts.y + oy;
    const alpha = clamp01(local * 1.4);
    ctx.save();
    ctx.globalAlpha = alpha;
    // Breathing halo behind the card.
    const pulse = 0.55 + 0.25 * Math.sin(t * Math.PI * 4);
    drawRarityGlow(ctx, x, y, opts.w, opts.h, color, pulse);
    await drawCardArt(ctx, mod, x, y, opts.w, opts.h, opts.card.artUrl);
    drawCardFrame(ctx, x, y, opts.w, opts.h, color, 7);
    // Shimmer sweep across the art.
    drawFoilOverlay(ctx as unknown as Ctx, x, y, opts.w, opts.h, (t * 1.6) % 1);
    // Name plate.
    drawTextWithShadow(ctx, opts.card.name, x + opts.w / 2, y + opts.h + 26, "#ffffff", 24);
    ctx.globalAlpha = 1;
    ctx.restore();
  };
}

// ── Enemy defeat effect ───────────────────────────────────────────────────────
// The loser card, then — after `defeatAt` — one of four finishers: explosion,
// shatter, energy burst, or collapse. All physics/particle driven and timed to
// the phase, so the enemy is visibly destroyed rather than just fading.
export type DefeatKind = "explosion" | "shatter" | "energy" | "collapse";

export function defeatEffect(opts: {
  card: RenderCard;
  x: number; y: number; w: number; h: number;
  kind: DefeatKind;
  color: number;
  defeatAt?: number;
  seed: string;
}): CinematicLayer {
  const defeatAt = opts.defeatAt ?? 0.45;
  const { x, y, w, h } = opts;
  const cx = x + w / 2, cy = y + h / 2;
  return async ({ ctx, mod, t }: CinematicFrame) => {
    const p = clamp01((t - defeatAt) / (1 - defeatAt)); // 0 before defeat → 1 end
    ctx.save();

    if (p <= 0) {
      // Pre-defeat: the doomed card, dimmed and trembling.
      const tremble = Math.sin(t * 80) * 2;
      ctx.globalAlpha = 0.85;
      await drawCardArt(ctx, mod, x + tremble, y, w, h, opts.card.artUrl);
      drawCardFrame(ctx, x + tremble, y, w, h, opts.color, 6);
      ctx.fillStyle = "rgba(0,0,0,0.25)";
      ctx.fillRect(x + tremble, y, w, h);
      ctx.restore();
      return;
    }

    switch (opts.kind) {
      case "explosion": {
        // Card fades as debris + shockwave rings blow outward.
        if (p < 0.5) {
          ctx.globalAlpha = 1 - p / 0.5;
          await drawCardArt(ctx, mod, x, y, w, h, opts.card.artUrl);
          drawCardFrame(ctx, x, y, w, h, opts.color, 6);
        }
        ctx.globalAlpha = 1;
        ring(ctx, cx, cy, p, Math.max(w, h) * 1.6, opts.color);
        const debris = await simulateDebris(cx, cy, {
          color: opts.color, count: 34, power: 18, spread: 0.5,
          steps: Math.max(2, Math.round(p * 22)), seed: `${opts.seed}-boom`,
        });
        for (const d of debris) d.alpha = 1 - p * 0.7;
        drawDebris(ctx, debris);
        break;
      }
      case "shatter": {
        // The card breaks into tinted shards that scatter and fall.
        if (p < 0.35) {
          ctx.globalAlpha = 1 - p / 0.35;
          await drawCardArt(ctx, mod, x, y, w, h, opts.card.artUrl);
          drawCardFrame(ctx, x, y, w, h, opts.color, 6);
        }
        ctx.globalAlpha = 1;
        const shards = await simulateDebris(cx, cy, {
          color: opts.color, count: 42, power: 12, spread: 0.35, gravity: 1.4,
          size: [8, 22], steps: Math.max(2, Math.round(p * 20)), seed: `${opts.seed}-shatter`,
        });
        for (const s of shards) s.alpha = clamp01(1 - p * 0.6);
        drawDebris(ctx, shards);
        break;
      }
      case "energy": {
        // Card dissolves upward inside an expanding energy burst.
        if (p < 0.6) {
          ctx.globalAlpha = (1 - p / 0.6) * 0.9;
          await drawCardArt(ctx, mod, x, y - p * 40, w, h, opts.card.artUrl);
        }
        ctx.globalAlpha = 1;
        ctx.save();
        ctx.globalCompositeOperation = "lighter";
        for (let i = 0; i < 3; i++) {
          ring(ctx, cx, cy, clamp01(p - i * 0.12), Math.max(w, h) * 1.8, opts.color, 0.5);
        }
        // Rising energy motes.
        const rng = seedRng(`${opts.seed}-energy`);
        for (let i = 0; i < 40; i++) {
          const px = cx + rng() * w - w / 2;
          const py = cy + (rng() - p) * h;
          const r = 1 + rng() * 3;
          ctx.fillStyle = hexToRgba(opts.color, (1 - p) * 0.8);
          ctx.beginPath(); ctx.arc(px, py, r, 0, Math.PI * 2); ctx.fill();
        }
        ctx.restore();
        break;
      }
      case "collapse": {
        // The card sinks and crumbles into a dust cloud at its feet.
        const sink = p * h * 0.6;
        const squash = 1 - p * 0.5;
        if (p < 0.9) {
          ctx.globalAlpha = 1 - p * 0.8;
          ctx.save();
          ctx.translate(cx, y + h);
          ctx.scale(1 + p * 0.1, squash);
          ctx.translate(-cx, -(y + h));
          await drawCardArt(ctx, mod, x, y + sink, w, h, opts.card.artUrl);
          drawCardFrame(ctx, x, y + sink, w, h, opts.color, 6);
          ctx.restore();
        }
        ctx.globalAlpha = 1;
        const dust = await simulateDebris(cx, y + h, {
          color: 0x6b6b6b, count: 30, power: 6, spread: 0.15, gravity: 0.3,
          size: [6, 16], steps: Math.max(2, Math.round(p * 16)), seed: `${opts.seed}-dust`,
        });
        for (const d of dust) d.alpha = clamp01((1 - p) * 0.7);
        drawDebris(ctx, dust);
        break;
      }
    }
    ctx.globalAlpha = 1;
    ctx.restore();
  };
}

// A single expanding shockwave ring at progress p (0→1).
function ring(ctx: Ctx, x: number, y: number, p: number, maxR: number, color: number, widthScale = 1): void {
  if (p <= 0 || p >= 1) return;
  const r = maxR * ease.outCubic(p);
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  ctx.strokeStyle = hexToRgba(color, (1 - p) * 0.8 * widthScale);
  ctx.lineWidth = 10 * (1 - p) + 2;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

// Tiny deterministic RNG for the per-frame energy motes (kept local so the
// defeat layer needs no external seed threading).
function seedRng(seed: string): () => number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) { h ^= seed.charCodeAt(i); h = Math.imul(h, 16777619); }
  return () => {
    h += 0x6d2b79f5;
    let x = Math.imul(h ^ (h >>> 15), 1 | h);
    x ^= x + Math.imul(x ^ (x >>> 7), 61 | x);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}
