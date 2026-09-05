// ─────────────────────────────────────────────────────────────────────────────
// Effect overlays — painted particles that ANCHOR to the target's own geometry.
//
// Tears fall from the DETECTED eyes; steam rises from the top of the DETECTED
// subject; sparkles scatter inside its content box. Nothing is pasted at fixed
// canvas coordinates any more — the anchors come from the feature detector, so
// an effect follows the emoji's real features (and, when no face was found,
// falls back to the subject's bounding box rather than a guessed face position).
//
// Each painter is a pure, deterministic function of the loop phase, so the same
// recipe always renders the same GIF and stays cacheable. Shapes are vector — no
// emoji font, no external artwork.
// ─────────────────────────────────────────────────────────────────────────────

import type { Ctx } from "../../../animations/engine.js";
import type { EffectKind } from "../types.js";

/** All in canvas pixels. */
export interface Anchor2 { x: number; y: number; rx: number; ry: number }
export interface EffectAnchors {
  size: number;
  content: { x: number; y: number; w: number; h: number };
  eyes: Anchor2[];
  mouth: Anchor2 | null;
  face: { x: number; y: number; w: number; h: number } | null;
}

function rand(seed: number): number {
  const x = Math.sin(seed * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}
function riseProgress(phase: number, i: number, count: number): number {
  return (phase + i / count) % 1;
}

function teardrop(ctx: Ctx, x: number, y: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x, y - r * 1.6);
  ctx.bezierCurveTo(x + r, y - r * 0.2, x + r, y + r, x, y + r);
  ctx.bezierCurveTo(x - r, y + r, x - r, y - r * 0.2, x, y - r * 1.6);
  ctx.closePath();
  ctx.fill();
}
function heart(ctx: Ctx, x: number, y: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x, y + r * 0.9);
  ctx.bezierCurveTo(x + r * 1.4, y - r * 0.3, x + r * 0.5, y - r * 1.2, x, y - r * 0.4);
  ctx.bezierCurveTo(x - r * 0.5, y - r * 1.2, x - r * 1.4, y - r * 0.3, x, y + r * 0.9);
  ctx.closePath();
  ctx.fill();
}
function star4(ctx: Ctx, x: number, y: number, r: number): void {
  ctx.beginPath();
  for (let k = 0; k < 4; k++) {
    const a = (k / 4) * Math.PI * 2;
    ctx.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
    const ma = a + Math.PI / 4;
    ctx.lineTo(x + Math.cos(ma) * r * 0.32, y + Math.sin(ma) * r * 0.32);
  }
  ctx.closePath();
  ctx.fill();
}
function star5(ctx: Ctx, x: number, y: number, r: number): void {
  ctx.beginPath();
  for (let k = 0; k < 10; k++) {
    const a = (k / 10) * Math.PI * 2 - Math.PI / 2;
    const rr = k % 2 === 0 ? r : r * 0.45;
    if (k === 0) ctx.moveTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
    else ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
  }
  ctx.closePath();
  ctx.fill();
}

export interface EffectPaint {
  phase: number;
  alpha: number;
  gain: number;
  anchors: EffectAnchors;
}

/** Where tears/anger/dizzy originate: detected eyes, else the upper content box. */
function eyePoints(a: EffectAnchors): Anchor2[] {
  if (a.eyes.length) return a.eyes;
  const c = a.content;
  const r = Math.min(c.w, c.h) * 0.12;
  return [
    { x: c.x + c.w * 0.38, y: c.y + c.h * 0.4, rx: r, ry: r },
    { x: c.x + c.w * 0.62, y: c.y + c.h * 0.4, rx: r, ry: r },
  ];
}

export function paintEffect(ctx: Ctx, kind: EffectKind, p: EffectPaint): void {
  const { phase, alpha, gain, anchors } = p;
  const size = anchors.size;
  const c = anchors.content;
  ctx.globalAlpha = Math.max(0, Math.min(1, alpha));

  switch (kind) {
    case "tears": {
      const eyes = eyePoints(anchors);
      const perEye = Math.max(1, Math.round(1 + gain));
      ctx.fillStyle = "#4aa3ff";
      for (const eye of eyes) {
        const startY = eye.y + eye.ry * 0.7;
        const fallTo = Math.min(size, c.y + c.h + size * 0.02);
        for (let i = 0; i < perEye; i++) {
          const prog = riseProgress(phase, i, perEye);
          const x = eye.x + (rand(i * 7 + eye.x) - 0.5) * eye.rx * 0.6;
          const y = startY + prog * (fallTo - startY);
          teardrop(ctx, x, y, Math.max(2, eye.rx * 0.4));
        }
      }
      break;
    }
    case "sweat": {
      const anchor = anchors.face
        ? { x: anchors.face.x + anchors.face.w * 0.92, y: anchors.face.y }
        : { x: c.x + c.w * 0.85, y: c.y + c.h * 0.15 };
      const prog = phase % 1;
      ctx.fillStyle = "#7ec8ff";
      teardrop(ctx, anchor.x, anchor.y + prog * c.h * 0.35, Math.max(2, Math.min(c.w, c.h) * 0.05));
      break;
    }
    case "hearts": {
      const count = Math.round(2 + gain * 2);
      ctx.fillStyle = "#ff4d7d";
      const baseY = c.y + c.h * 0.9;
      for (let i = 0; i < count; i++) {
        const prog = riseProgress(phase, i, count);
        const x = c.x + c.w * (0.3 + rand(i * 13) * 0.4) + Math.sin(prog * Math.PI * 2) * c.w * 0.04;
        const y = baseY - prog * c.h * 0.8;
        ctx.globalAlpha = Math.max(0, Math.min(1, alpha)) * (1 - prog * 0.5);
        heart(ctx, x, y, Math.max(3, Math.min(c.w, c.h) * 0.06));
      }
      break;
    }
    case "sparkles": {
      const count = Math.round(3 + gain * 3);
      ctx.fillStyle = "#fff2a8";
      for (let i = 0; i < count; i++) {
        const tw = Math.abs(Math.sin((phase + rand(i * 5)) * Math.PI * 2));
        const x = c.x + rand(i * 17) * c.w;
        const y = c.y + rand(i * 29) * c.h;
        ctx.globalAlpha = Math.max(0, Math.min(1, alpha)) * tw;
        star4(ctx, x, y, Math.max(2, Math.min(c.w, c.h) * (0.03 + 0.03 * tw)));
      }
      break;
    }
    case "steam": {
      const count = Math.round(2 + gain * 2);
      ctx.fillStyle = "#cfd8e3";
      for (let i = 0; i < count; i++) {
        const prog = riseProgress(phase, i, count);
        const x = c.x + c.w * (0.25 + i * 0.18) + Math.sin(prog * Math.PI * 2) * c.w * 0.03;
        const y = c.y - prog * c.h * 0.2;
        ctx.globalAlpha = Math.max(0, Math.min(1, alpha)) * (1 - prog) * 0.7;
        ctx.beginPath();
        ctx.arc(x, y, Math.max(2, Math.min(c.w, c.h) * 0.05 * (1 + prog)), 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    }
    case "anger": {
      const anchor = anchors.face
        ? { x: anchors.face.x + anchors.face.w * 0.95, y: anchors.face.y - c.h * 0.02 }
        : { x: c.x + c.w * 0.85, y: c.y + c.h * 0.12 };
      const pulse = 0.7 + 0.3 * Math.abs(Math.sin(phase * Math.PI * 2));
      ctx.strokeStyle = "#ff2d2d";
      const r = Math.min(c.w, c.h) * 0.1 * pulse;
      ctx.lineWidth = Math.max(1, size * 0.02);
      for (let k = 0; k < 4; k++) {
        const a = (k / 4) * Math.PI * 2;
        ctx.beginPath();
        ctx.moveTo(anchor.x + Math.cos(a) * r * 0.4, anchor.y + Math.sin(a) * r * 0.4);
        ctx.lineTo(anchor.x + Math.cos(a) * r, anchor.y + Math.sin(a) * r);
        ctx.stroke();
      }
      break;
    }
    case "dizzy": {
      const count = Math.round(3 + gain);
      ctx.fillStyle = "#ffd93b";
      const cx = anchors.face ? anchors.face.x + anchors.face.w / 2 : c.x + c.w / 2;
      const cy = anchors.face ? anchors.face.y : c.y + c.h * 0.1;
      const orbit = (anchors.face ? anchors.face.w : c.w) * 0.5;
      for (let i = 0; i < count; i++) {
        const a = phase * Math.PI * 2 + (i / count) * Math.PI * 2;
        star5(ctx, cx + Math.cos(a) * orbit, cy + Math.sin(a) * orbit * 0.4, Math.max(2, Math.min(c.w, c.h) * 0.04));
      }
      break;
    }
  }
  ctx.globalAlpha = 1;
}
