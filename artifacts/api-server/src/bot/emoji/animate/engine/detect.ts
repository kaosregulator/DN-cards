// ─────────────────────────────────────────────────────────────────────────────
// Target feature detection.
//
// The engine must NOT assume Noto's face layout maps onto the target — the
// target is usually a custom emoji: a photo, a meme, an animal, a gem. So before
// any motion is applied we analyze the target's OWN pixels and locate, in the
// target's own coordinates:
//
//   • content box — the subject's real bounds (ignoring transparent/flat borders)
//   • eyes        — up to two dark, roughly-symmetric blobs in the upper face
//   • mouth       — a wide dark region below the eyes
//   • face        — the box those features sit in
//
// This is a heuristic detector (dark-blob + symmetry), deliberately dependency-
// free: it runs in the bot with no GPU and, unlike a human-face model, it either
// finds features on a cartoon/animal face or reports low confidence on a gem —
// at which point the compositor animates the whole object instead of faking a
// face. It sits behind a pluggable interface so a learned detector (MediaPipe
// FaceLandmarker / SAM, as avatar-graph-comfyui uses) can replace it later
// without touching the compositor.
// ─────────────────────────────────────────────────────────────────────────────

import sharp from "sharp";
import { logger } from "../../../../lib/logger.js";
import type { Features, FracBox, FracEllipse } from "../types.js";

/** Longest edge the analysis runs at — enough detail, cheap to scan. */
const ANALYSIS_EDGE = 144;

export interface FeatureDetector {
  readonly id: string;
  detect(image: Buffer): Promise<Features>;
}

// ── heuristic detector ───────────────────────────────────────────────────────

interface Grid { w: number; h: number; lum: Float32Array; opaque: Uint8Array }

/** Decode to raw RGBA at analysis size and precompute luminance + opacity. */
async function toGrid(image: Buffer): Promise<Grid> {
  const { data, info } = await sharp(image)
    .resize(ANALYSIS_EDGE, ANALYSIS_EDGE, { fit: "inside", withoutEnlargement: true })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const { width: w, height: h, channels } = info;
  const lum = new Float32Array(w * h);
  const opaque = new Uint8Array(w * h);

  // Background guess: average of the four corners (covers a flat matte too).
  const corners = [0, (w - 1) * channels, (h - 1) * w * channels, (w * h - 1) * channels];
  let br = 0, bg = 0, bb = 0;
  for (const c of corners) { br += data[c]!; bg += data[c + 1]!; bb += data[c + 2]!; }
  br /= 4; bg /= 4; bb /= 4;

  for (let i = 0, p = 0; i < w * h; i++, p += channels) {
    const r = data[p]!, g = data[p + 1]!, b = data[p + 2]!, a = channels === 4 ? data[p + 3]! : 255;
    lum[i] = 0.299 * r + 0.587 * g + 0.114 * b;
    // A pixel is "subject" if it's opaque AND not the background colour.
    const bgDist = Math.abs(r - br) + Math.abs(g - bg) + Math.abs(b - bb);
    opaque[i] = a > 32 && bgDist > 40 ? 1 : 0;
  }
  return { w, h, lum, opaque };
}

/** Tight bounds of the subject; falls back to the whole frame if nothing opaque. */
function contentBox(g: Grid): { x0: number; y0: number; x1: number; y1: number } {
  let x0 = g.w, y0 = g.h, x1 = 0, y1 = 0, any = false;
  for (let y = 0; y < g.h; y++) {
    for (let x = 0; x < g.w; x++) {
      if (g.opaque[y * g.w + x]) {
        any = true;
        if (x < x0) x0 = x; if (x > x1) x1 = x;
        if (y < y0) y0 = y; if (y > y1) y1 = y;
      }
    }
  }
  if (!any) return { x0: 0, y0: 0, x1: g.w - 1, y1: g.h - 1 };
  return { x0, y0, x1, y1 };
}

interface Blob { minX: number; minY: number; maxX: number; maxY: number; cx: number; cy: number; area: number }

/** Connected dark components inside the content box (4-neighbour flood fill). */
function darkBlobs(g: Grid, box: { x0: number; y0: number; x1: number; y1: number }): Blob[] {
  const bw = box.x1 - box.x0 + 1, bh = box.y1 - box.y0 + 1;
  // Dark threshold from the subject's own luminance stats.
  let sum = 0, sum2 = 0, n = 0;
  for (let y = box.y0; y <= box.y1; y++) for (let x = box.x0; x <= box.x1; x++) {
    const i = y * g.w + x;
    if (!g.opaque[i]) continue;
    sum += g.lum[i]!; sum2 += g.lum[i]! * g.lum[i]!; n++;
  }
  if (n === 0) return [];
  const mean = sum / n;
  const std = Math.sqrt(Math.max(0, sum2 / n - mean * mean));
  const thresh = mean - 0.55 * std;

  const seen = new Uint8Array(g.w * g.h);
  const blobs: Blob[] = [];
  const stack: number[] = [];
  const minArea = Math.max(3, (bw * bh) * 0.0008);
  const maxArea = (bw * bh) * 0.12;

  for (let y = box.y0; y <= box.y1; y++) {
    for (let x = box.x0; x <= box.x1; x++) {
      const start = y * g.w + x;
      if (seen[start] || !g.opaque[start] || g.lum[start]! >= thresh) continue;
      let minX = x, minY = y, maxX = x, maxY = y, area = 0, sx = 0, sy = 0;
      stack.length = 0; stack.push(start); seen[start] = 1;
      while (stack.length) {
        const p = stack.pop()!;
        const px = p % g.w, py = (p / g.w) | 0;
        area++; sx += px; sy += py;
        if (px < minX) minX = px; if (px > maxX) maxX = px;
        if (py < minY) minY = py; if (py > maxY) maxY = py;
        const neigh = [p - 1, p + 1, p - g.w, p + g.w];
        for (const q of neigh) {
          if (q < 0 || q >= g.w * g.h || seen[q]) continue;
          const qx = q % g.w;
          if (Math.abs(qx - px) > 1) continue; // row-wrap guard for ±1
          if (!g.opaque[q] || g.lum[q]! >= thresh) continue;
          seen[q] = 1; stack.push(q);
        }
      }
      if (area >= minArea && area <= maxArea) {
        blobs.push({ minX, minY, maxX, maxY, cx: sx / area, cy: sy / area, area });
      }
    }
  }
  return blobs;
}

/** Pick the best symmetric eye pair from candidate blobs in the upper face. */
function findEyes(blobs: Blob[], box: { x0: number; y0: number; x1: number; y1: number }): { pair: [Blob, Blob]; score: number } | null {
  const bw = box.x1 - box.x0 + 1, bh = box.y1 - box.y0 + 1;
  const midX = box.x0 + bw / 2;
  // Eyes sit in roughly the top 60% of the face.
  const upper = blobs.filter(b => b.cy < box.y0 + bh * 0.62);
  let best: { pair: [Blob, Blob]; score: number } | null = null;
  for (let i = 0; i < upper.length; i++) {
    for (let j = i + 1; j < upper.length; j++) {
      const a = upper[i]!, b = upper[j]!;
      const left = a.cx < b.cx ? a : b, right = a.cx < b.cx ? b : a;
      // Must straddle the centre line.
      if (!(left.cx < midX && right.cx > midX)) continue;
      const yDiff = Math.abs(a.cy - b.cy) / bh;              // aligned rows
      const symErr = Math.abs((midX - left.cx) - (right.cx - midX)) / bw; // mirror
      const sizeRatio = Math.min(a.area, b.area) / Math.max(a.area, b.area);
      const sep = (right.cx - left.cx) / bw;                 // eye spacing
      if (yDiff > 0.18 || symErr > 0.22 || sizeRatio < 0.35) continue;
      if (sep < 0.12 || sep > 0.85) continue;
      const score = (1 - yDiff) + (1 - symErr) + sizeRatio + (1 - Math.abs(sep - 0.4));
      if (!best || score > best.score) best = { pair: [left, right], score };
    }
  }
  return best;
}

/** The widest dark blob below the eyes is the mouth. */
function findMouth(blobs: Blob[], eyesY: number, box: { x0: number; y0: number; x1: number; y1: number }): Blob | null {
  const bw = box.x1 - box.x0 + 1;
  const midX = box.x0 + bw / 2;
  const below = blobs.filter(b => b.cy > eyesY + (box.y1 - box.y0) * 0.08);
  let best: Blob | null = null, bestScore = 0;
  for (const b of below) {
    const width = (b.maxX - b.minX + 1) / bw;
    const centred = 1 - Math.abs(b.cx - midX) / (bw / 2);
    const score = width * 1.5 + centred + b.area * 0.0005;
    if (score > bestScore && width > 0.08) { bestScore = score; best = b; }
  }
  return best;
}

function blobToEllipse(b: Blob, g: Grid, padX = 1.5, padY = 1.6): FracEllipse {
  const cx = b.cx / g.w, cy = b.cy / g.h;
  const rx = Math.max(0.02, ((b.maxX - b.minX + 1) / 2) * padX / g.w);
  const ry = Math.max(0.02, ((b.maxY - b.minY + 1) / 2) * padY / g.h);
  return { cx, cy, rx, ry };
}

export const heuristicDetector: FeatureDetector = {
  id: "heuristic",
  async detect(image: Buffer): Promise<Features> {
    try {
      const g = await toGrid(image);
      const cb = contentBox(g);
      const content: FracBox = {
        x: cb.x0 / g.w, y: cb.y0 / g.h,
        w: (cb.x1 - cb.x0 + 1) / g.w, h: (cb.y1 - cb.y0 + 1) / g.h,
      };
      const blobs = darkBlobs(g, cb);
      const eyesPair = findEyes(blobs, cb);

      const eyes: FracEllipse[] = [];
      let mouth: FracEllipse | null = null;
      let brows: FracEllipse | null = null;
      let face: FracBox | null = null;
      let confidence = 0;

      if (eyesPair) {
        const [l, r] = eyesPair.pair;
        eyes.push(blobToEllipse(l, g), blobToEllipse(r, g));
        const eyesY = (l.cy + r.cy) / 2;
        const mBlob = findMouth(blobs, eyesY, cb);
        if (mBlob) mouth = blobToEllipse(mBlob, g, 1.3, 1.5);
        // Brows: a band just above the eyes.
        const eyeCyFrac = eyesY / g.h;
        const eyeSpan = Math.abs(r.cx - l.cx) / g.w;
        brows = {
          cx: (l.cx + r.cx) / 2 / g.w,
          cy: Math.max(0, eyeCyFrac - eyeSpan * 0.4),
          rx: eyeSpan * 0.8, ry: 0.05,
        };
        // Face box spans the eyes horizontally and eyes→mouth vertically.
        const top = Math.min(l.minY, r.minY) / g.h - 0.08;
        const bottom = (mouth ? mouth.cy + mouth.ry : eyeCyFrac + 0.25);
        const fx0 = Math.min(l.minX, r.minX) / g.w - 0.06;
        const fx1 = Math.max(l.maxX, r.maxX) / g.w + 0.06;
        face = {
          x: Math.max(0, fx0), y: Math.max(0, top),
          w: Math.min(1, fx1 - fx0), h: Math.min(1, bottom - top),
        };
        confidence = Math.min(1, eyesPair.score / 4 + (mouth ? 0.2 : 0));
      }

      const method = "heuristic";
      logger.debug(
        { method, eyes: eyes.length, mouth: !!mouth, confidence: +confidence.toFixed(2) },
        "animate: target features detected",
      );
      return { method, content, eyes, mouth, brows, face, confidence };
    } catch (err) {
      logger.warn({ err }, "animate: feature detection failed — animating whole object");
      return {
        method: "none", content: { x: 0, y: 0, w: 1, h: 1 },
        eyes: [], mouth: null, brows: null, face: null, confidence: 0,
      };
    }
  },
};

// ── pluggable seam ─────────────────────────────────────────────────────────

let active: FeatureDetector = heuristicDetector;

export function setFeatureDetector(detector: FeatureDetector): void {
  active = detector;
}

export function detectFeatures(image: Buffer): Promise<Features> {
  return active.detect(image);
}
