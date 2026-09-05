// ─────────────────────────────────────────────────────────────────────────────
// The animate compositor — Recipe + target image → raw RGBA frames.
//
// It is the only module here that touches a canvas, and it knows nothing about
// any specific movement. What it DOES know is that the target must drive its own
// animation, so the pipeline is:
//
//   1. DETECT the target's own geometry (content box, eyes, mouth) — once.
//   2. Map each region track onto the DETECTED feature (eyes track → the real
//      eyes, mouth track → the real mouth). No Noto coordinate is assumed.
//   3. Build a smooth DISPLACEMENT FIELD localised around those features and
//      MESH-WARP the target's own pixels — the emoji itself blinks / opens its
//      mouth; the rest of the artwork is untouched, nothing is pasted on.
//   4. Apply the GLOBAL track as one whole-subject transform (bob/nod/spin) —
//      this needs no face, so it works on anything.
//   5. Paint EFFECT overlays anchored to the detected features (tears from the
//      eyes), falling back to the content box when no face was found.
//
// If detection finds no face, facial region tracks are simply dropped and the
// subject still animates as a whole object — the graceful fallback, not a crash.
// ─────────────────────────────────────────────────────────────────────────────

import type { Canvas } from "@napi-rs/canvas";
import { getCanvas, type CanvasMod, type Ctx } from "../../../animations/engine.js";
import { EmojiError } from "../../utils/errors.js";
import type { Features, FracEllipse, MotionTrack, Recipe, Region } from "../types.js";
import { sampleTrack, type ChannelValues } from "./sampler.js";
import { applyAmp, levelFor } from "./intensity.js";
import { paintEffect, type Anchor2, type EffectAnchors } from "./effects.js";
import { detectFeatures } from "./detect.js";
import { meshWarp, type Pt } from "./warp-mesh.js";

export type Frames = Uint8ClampedArray[];

/** Resting footprint: the subject occupies this fraction so global motion never clips. */
const INSET = 0.82;

/** Below this face confidence, facial region tracks are dropped (animate whole object). */
const FACE_CONFIDENCE = 0.28;

interface StripCtx {
  drawImage(src: Canvas, dx: number, dy: number, dw: number, dh: number): void;
}

const WARP_REGIONS: Exclude<Region, "global" | "effect">[] = ["brows", "eyes", "cheeks", "mouth"];

function fitContain(sw: number, sh: number, box: number): { w: number; h: number } {
  if (sw <= 0 || sh <= 0) return { w: box, h: box };
  const s = Math.min(box / sw, box / sh);
  return { w: sw * s, h: sh * s };
}

export interface ComposeInput {
  image: Buffer;
  recipe: Recipe;
  size: number;
  /** Detected geometry — passed in so it's computed once per target, not per recipe. */
  features?: Features;
}

function sampleAmped(track: MotionTrack, phase: number, amp: number): ChannelValues {
  const raw = sampleTrack(track, phase);
  const out = { ...raw };
  for (const ch of Object.keys(out) as (keyof ChannelValues)[]) out[ch] = applyAmp(ch, out[ch], amp);
  return out;
}

/** A detected ellipse mapped into render-canvas pixels. */
interface CanvasEllipse { cx: number; cy: number; rx: number; ry: number }

interface Placement {
  boxLeft: number; boxTop: number; dw: number; dh: number;
}

/** Map a target-image-fraction ellipse into canvas pixels via the subject placement. */
function mapEllipse(e: FracEllipse, pl: Placement): CanvasEllipse {
  return {
    cx: pl.boxLeft + e.cx * pl.dw,
    cy: pl.boxTop + e.cy * pl.dh,
    rx: Math.max(2, e.rx * pl.dw),
    ry: Math.max(2, e.ry * pl.dh),
  };
}

/** Which detected ellipses a warp region drives. Empty → region is dropped. */
function targetsFor(
  region: Exclude<Region, "global" | "effect">, features: Features, pl: Placement,
): CanvasEllipse[] {
  const faceOk = features.confidence >= FACE_CONFIDENCE;
  switch (region) {
    case "eyes":
      return faceOk ? features.eyes.map(e => mapEllipse(e, pl)) : [];
    case "mouth":
      return faceOk && features.mouth ? [mapEllipse(features.mouth, pl)] : [];
    case "brows":
      return faceOk && features.brows ? [mapEllipse(features.brows, pl)] : [];
    case "cheeks": {
      if (!faceOk || !features.face) return [];
      const f = features.face;
      // Two soft ellipses on the lower sides of the face box.
      const y = f.y + f.h * 0.72, rx = f.w * 0.22, ry = f.h * 0.16;
      return [
        mapEllipse({ cx: f.x + f.w * 0.24, cy: y, rx, ry }, pl),
        mapEllipse({ cx: f.x + f.w * 0.76, cy: y, rx, ry }, pl),
      ];
    }
  }
}

/** Build the canvas-space anchors the effect painters use. */
function effectAnchors(features: Features, pl: Placement, size: number): EffectAnchors {
  const eyes: Anchor2[] = features.eyes.map(e => {
    const c = mapEllipse(e, pl);
    return { x: c.cx, y: c.cy, rx: c.rx, ry: c.ry };
  });
  const mouth = features.mouth ? (() => { const c = mapEllipse(features.mouth!, pl); return { x: c.cx, y: c.cy, rx: c.rx, ry: c.ry }; })() : null;
  const box = (b: { x: number; y: number; w: number; h: number }) => ({
    x: pl.boxLeft + b.x * pl.dw, y: pl.boxTop + b.y * pl.dh, w: b.w * pl.dw, h: b.h * pl.dh,
  });
  return {
    size,
    content: box(features.content),
    eyes: features.confidence >= FACE_CONFIDENCE ? eyes : [],
    mouth: features.confidence >= FACE_CONFIDENCE ? mouth : null,
    face: features.confidence >= FACE_CONFIDENCE && features.face ? box(features.face) : null,
  };
}

/** Smooth localized falloff (1 at centre → 0 at the ellipse edge). */
function falloff(x: number, y: number, e: CanvasEllipse): number {
  const nx = (x - e.cx) / e.rx, ny = (y - e.cy) / e.ry;
  const d2 = nx * nx + ny * ny;
  if (d2 >= 1) return 0;
  const w = 1 - d2;
  return w * w; // smoother than linear at the rim
}

/** Render every frame of `recipe` over `image`. */
export async function compose(input: ComposeInput): Promise<Frames> {
  const { image, recipe, size } = input;
  const { frames } = recipe;
  const level = levelFor(recipe.intensity);

  const mod: CanvasMod | null = await getCanvas();
  if (!mod) throw new EmojiError("canvas_missing", "The animation renderer isn't available right now. Please try again later.");

  let subject;
  try {
    subject = await mod.loadImage(image);
  } catch {
    throw new EmojiError("not_an_image", "That target couldn't be read as an image. Try a PNG, JPG, WebP or GIF.");
  }

  const features = input.features ?? await detectFeatures(image);

  const box = size * INSET;
  const { w: dw, h: dh } = fitContain(subject.width, subject.height, box);
  const pl: Placement = { boxLeft: (size - dw) / 2, boxTop: (size - dh) / 2, dw, dh };

  const base: Canvas = mod.createCanvas(size, size);
  const baseCtx = base.getContext("2d") as unknown as Ctx;
  baseCtx.drawImage(subject, pl.boxLeft, pl.boxTop, dw, dh);

  const warped: Canvas = mod.createCanvas(size, size);
  const warpedCtx = warped.getContext("2d") as unknown as Ctx;
  const frameCanvas: Canvas = mod.createCanvas(size, size);
  const frameCtx = frameCanvas.getContext("2d") as unknown as Ctx;

  // Static per-region plans: the detected target ellipses + the source track.
  interface RegionPlan { track: MotionTrack; gain: number; targets: CanvasEllipse[] }
  const regionPlans: RegionPlan[] = [];
  for (const region of WARP_REGIONS) {
    const track = recipe.tracks[region];
    if (!track) continue;
    const targets = targetsFor(region, features, pl);
    if (targets.length === 0) continue; // detection said this feature isn't here
    regionPlans.push({ track, gain: recipe.gain?.[region] ?? 1, targets });
  }
  const globalTrack = recipe.tracks.global ?? null;
  const anchors = effectAnchors(features, pl, size);

  const out: Frames = [];

  for (let frame = 0; frame < frames; frame++) {
    const phase = frames > 1 ? frame / frames : 0;

    // ── region mesh warp → `warped` ───────────────────────────────────────────
    reset(warpedCtx, size);
    if (regionPlans.length === 0) {
      (warpedCtx as unknown as StripCtx).drawImage(base, 0, 0, size, size);
    } else {
      const active = regionPlans.map(p => ({ p, v: sampleAmped(p.track, phase, level.amp) }));
      meshWarp(warpedCtx, base, size, (x, y): Pt => {
        let dx = 0, dy = 0;
        for (const { p, v } of active) {
          for (const e of p.targets) {
            const w = falloff(x, y, e) * p.gain;
            if (w <= 0) continue;
            dy += w * ((v.squashY - 1) * (y - e.cy) + v.ty * size);
            dx += w * ((v.scaleX - 1) * (x - e.cx) + v.tx * size + v.shearX * (y - e.cy));
          }
        }
        return { x: dx, y: dy };
      });
    }

    // ── global transform + effects → frame ────────────────────────────────────
    reset(frameCtx, size);
    frameCtx.save();
    if (globalTrack) {
      const g = sampleAmped(globalTrack, phase, level.amp);
      frameCtx.translate(size / 2 + g.tx * size, size / 2 + g.ty * size);
      if (g.rotate) frameCtx.rotate(g.rotate);
      frameCtx.scale(g.scaleX, g.scaleY);
      if (g.shearX) frameCtx.transform(1, 0, g.shearX, 1, 0, 0);
      frameCtx.globalAlpha = Math.max(0, Math.min(1, g.alpha));
      frameCtx.translate(-size / 2, -size / 2);
    }
    (frameCtx as unknown as StripCtx).drawImage(warped, 0, 0, size, size);
    frameCtx.restore();

    for (const fx of recipe.effects) {
      if (!fx.effect) continue;
      const env = sampleTrack(fx, phase).alpha;
      frameCtx.save();
      paintEffect(frameCtx, fx.effect, { phase, alpha: env, gain: level.effectGain, anchors });
      frameCtx.restore();
    }

    out.push(frameCtx.getImageData(0, 0, size, size).data.slice());
  }

  return out;
}

function reset(ctx: Ctx, size: number): void {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = "source-over";
  ctx.clearRect(0, 0, size, size);
}

// Re-exported so callers (render, session) can detect once and pass through.
export { detectFeatures } from "./detect.js";
