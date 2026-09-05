// ─────────────────────────────────────────────────────────────────────────────
// Debug output — see what the detector saw and how motion maps onto it.
//
// `renderDebugOverlay` draws the target with its detected content box (grey),
// eyes (cyan), mouth (magenta), face (yellow) and the confidence/method, so an
// arbitrary custom emoji can be sanity-checked: are the eyes actually on the
// eyes? `describeMapping` states, per region, which detected feature a recipe
// would drive (or why it was dropped). Both are used by the admin/test surface,
// never in the hot render path.
// ─────────────────────────────────────────────────────────────────────────────

import type { Canvas } from "@napi-rs/canvas";
import { getCanvas, type CanvasMod, type Ctx } from "../../../animations/engine.js";
import { encodePng } from "../../encoders/index.js";
import type { Features, FracEllipse, Recipe } from "../types.js";
import { detectFeatures } from "./detect.js";

const FACE_CONFIDENCE = 0.28;

/** ellipse()/strokeRect() exist on Skia's context but are lost without the DOM lib. */
interface ShapeCtx {
  ellipse(cx: number, cy: number, rx: number, ry: number, rot: number, s: number, e: number): void;
  strokeRect(x: number, y: number, w: number, h: number): void;
  beginPath(): void; stroke(): void;
}

function ellipse(ctx: Ctx, cx: number, cy: number, rx: number, ry: number): void {
  const s = ctx as unknown as ShapeCtx;
  s.beginPath();
  s.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
  s.stroke();
}

/** Render the target with detected regions drawn on top; returns a PNG + features. */
export async function renderDebugOverlay(
  image: Buffer, size = 256,
): Promise<{ png: Buffer; features: Features }> {
  const mod: CanvasMod | null = await getCanvas();
  if (!mod) throw new Error("canvas unavailable");
  const features = await detectFeatures(image);

  const subject = await mod.loadImage(image);
  const scale = Math.min(size / subject.width, size / subject.height);
  const dw = subject.width * scale, dh = subject.height * scale;
  const left = (size - dw) / 2, top = (size - dh) / 2;

  const canvas: Canvas = mod.createCanvas(size, size);
  const ctx = canvas.getContext("2d") as unknown as Ctx;
  ctx.fillStyle = "#1a1a1e";
  ctx.fillRect(0, 0, size, size);
  ctx.drawImage(subject, left, top, dw, dh);

  const mapE = (e: FracEllipse) => ({
    cx: left + e.cx * dw, cy: top + e.cy * dh, rx: Math.max(2, e.rx * dw), ry: Math.max(2, e.ry * dh),
  });
  ctx.lineWidth = Math.max(1.5, size * 0.008);

  // content box
  ctx.strokeStyle = "#888";
  (ctx as unknown as ShapeCtx).strokeRect(left + features.content.x * dw, top + features.content.y * dh, features.content.w * dw, features.content.h * dh);

  if (features.face) {
    ctx.strokeStyle = "#ffd93b";
    (ctx as unknown as ShapeCtx).strokeRect(left + features.face.x * dw, top + features.face.y * dh, features.face.w * dw, features.face.h * dh);
  }
  ctx.strokeStyle = "#3bd6ff";
  for (const e of features.eyes) { const c = mapE(e); ellipse(ctx, c.cx, c.cy, c.rx, c.ry); }
  if (features.mouth) { ctx.strokeStyle = "#ff4dd2"; const c = mapE(features.mouth); ellipse(ctx, c.cx, c.cy, c.rx, c.ry); }
  if (features.brows) { ctx.strokeStyle = "#7dff7d"; const c = mapE(features.brows); ellipse(ctx, c.cx, c.cy, c.rx, c.ry); }

  ctx.fillStyle = "#fff";
  ctx.font = `${Math.round(size * 0.05)}px sans-serif`;
  ctx.fillText(`${features.method}  conf ${features.confidence.toFixed(2)}  eyes ${features.eyes.length}  mouth ${features.mouth ? "y" : "n"}`, 6, size - 8);

  const png = await encodePng([ctx.getImageData(0, 0, size, size).data.slice()], size);
  return { png, features };
}

/** Per-region: which detected feature this recipe drives, or why it's dropped. */
export function describeMapping(recipe: Recipe, features: Features): string[] {
  const faceOk = features.confidence >= FACE_CONFIDENCE;
  const lines: string[] = [
    `method=${features.method} confidence=${features.confidence.toFixed(2)} (face ${faceOk ? "USED" : "not used → whole-object"})`,
  ];
  const say = (region: string, present: boolean, detail: string) => {
    const track = (recipe.tracks as Record<string, { name: string } | null | undefined>)[region];
    if (!track) return;
    lines.push(present ? `${region}: ${track.name} → ${detail}` : `${region}: ${track.name} → DROPPED (${detail})`);
  };
  if (recipe.tracks.global) lines.push(`global: ${recipe.tracks.global.name} → whole subject (always)`);
  say("eyes", faceOk && features.eyes.length > 0, faceOk ? `${features.eyes.length} detected eye(s)` : "no face");
  say("mouth", faceOk && !!features.mouth, faceOk && features.mouth ? "detected mouth" : "no mouth detected");
  say("brows", faceOk && !!features.brows, faceOk && features.brows ? "brow band" : "no face");
  say("cheeks", faceOk && !!features.face, faceOk && features.face ? "face sides" : "no face");
  for (const fx of recipe.effects) {
    lines.push(`effect ${fx.effect}: anchored to ${faceOk && features.eyes.length ? "detected eyes/face" : "content box (no face)"}`);
  }
  return lines;
}
