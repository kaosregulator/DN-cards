/**
 * MakeEmoji Colour side-control — animates / recolors the subject independently
 * of the chosen style (works with `none` alone, or stacked under any style).
 *
 * Values match `artifacts/emoji-offline/controls.json` → color.values.
 */
import { colorize, planHue } from "../../renderer/colorize.js";

/** Colour ids that force a multi-frame GIF even when the style is `none`. */
export const ANIMATED_COLORS = new Set([
  "colors",
  "rainbow",
  "stripes",
  "circles",
  "flat-rainbow",
  "rainbow-stripes",
  "rainbow-circles",
]);

export function normalizeColor(raw: string | undefined | null): string | null {
  if (!raw) return null;
  const v = raw.trim().toLowerCase();
  if (!v || v === "normal" || v === "none" || v === "default") return null;
  return v;
}

export function colorIsAnimated(color: string | null): boolean {
  return color != null && ANIMATED_COLORS.has(color);
}

/** Suggested frame count when Colour alone drives the animation. */
export function colorFrameCount(color: string | null, fallback = 12): number {
  if (!colorIsAnimated(color)) return 1;
  return fallback;
}

/**
 * Apply a MakeEmoji Colour filter in-place to an RGBA buffer.
 * `t` is the normalised phase 0–1 across the animation.
 */
export function applyColorFilter(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  color: string,
  t: number,
): void {
  switch (color) {
    case "colors":
    case "rainbow":
      hueRotate(data, t * 360);
      return;
    case "flat-rainbow":
      colorize(data, planHue(35, 0.55));
      hueRotate(data, t * 360);
      return;
    case "stripes":
    case "rainbow-stripes":
      rainbowStripes(data, width, height, t);
      return;
    case "circles":
    case "rainbow-circles":
      rainbowCircles(data, width, height, t);
      return;
    case "deep fried":
    case "deep-fried":
      deepFried(data);
      return;
    case "x-ray":
    case "xray":
      duoTone(data, 8, 40, 48, 180, 220, 255);
      return;
    case "toxic":
      duoTone(data, 20, 60, 10, 80, 255, 40);
      return;
    case "vaporwave":
      duoTone(data, 40, 20, 80, 255, 120, 220);
      return;
    case "cherry cola":
    case "cherry-cola":
      duoTone(data, 40, 5, 10, 220, 40, 60);
      return;
    case "night vision":
    case "night-vision":
      duoTone(data, 0, 20, 0, 40, 255, 60);
      return;
    case "blue flame":
    case "blue-flame":
      duoTone(data, 5, 20, 60, 80, 180, 255);
      return;
    case "newsprint":
      newsprint(data, width, height);
      return;
    case "hellfire":
      duoTone(data, 40, 0, 0, 255, 160, 20);
      return;
    case "red":
      colorize(data, planHue(0, 0.92));
      return;
    case "orange":
      colorize(data, planHue(28, 0.92));
      return;
    case "yellow":
      colorize(data, planHue(52, 0.92));
      return;
    case "green":
      colorize(data, planHue(120, 0.92));
      return;
    case "blue":
      colorize(data, planHue(220, 0.92));
      return;
    case "purple":
      colorize(data, planHue(285, 0.92));
      return;
    default:
      if (color.startsWith("#") && (color.length === 7 || color.length === 4)) {
        colorize(data, planHue(hexToHue(color), 0.9));
      }
  }
}

function hueRotate(data: Uint8ClampedArray, degrees: number): void {
  const rad = (((degrees % 360) + 360) % 360) * Math.PI / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const a00 = 0.213 + cos * 0.787 - sin * 0.213;
  const a01 = 0.715 - cos * 0.715 - sin * 0.715;
  const a02 = 0.072 - cos * 0.072 + sin * 0.928;
  const a10 = 0.213 - cos * 0.213 + sin * 0.143;
  const a11 = 0.715 + cos * 0.285 + sin * 0.140;
  const a12 = 0.072 - cos * 0.072 - sin * 0.283;
  const a20 = 0.213 - cos * 0.213 - sin * 0.787;
  const a21 = 0.715 - cos * 0.715 + sin * 0.715;
  const a22 = 0.072 + cos * 0.928 + sin * 0.072;

  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3]! < 8) continue;
    const r = data[i]!, g = data[i + 1]!, b = data[i + 2]!;
    data[i] = clamp(a00 * r + a01 * g + a02 * b);
    data[i + 1] = clamp(a10 * r + a11 * g + a12 * b);
    data[i + 2] = clamp(a20 * r + a21 * g + a22 * b);
  }
}

function rainbowStripes(data: Uint8ClampedArray, w: number, h: number, t: number): void {
  const phase = t * 360;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      if (data[i + 3]! < 8) continue;
      tintPixel(data, i, ((x + y) * 4 + phase) % 360, 0.85);
    }
  }
}

function rainbowCircles(data: Uint8ClampedArray, w: number, h: number, t: number): void {
  const cx = w / 2;
  const cy = h / 2;
  const phase = t * 360;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      if (data[i + 3]! < 8) continue;
      const dist = Math.hypot(x - cx, y - cy);
      tintPixel(data, i, (dist * 6 + phase) % 360, 0.85);
    }
  }
}

function tintPixel(data: Uint8ClampedArray, i: number, hue: number, strength: number): void {
  const plan = planHue(hue, strength);
  const r = data[i]!, g = data[i + 1]!, b = data[i + 2]!;
  const l = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  const c = 1 - Math.abs(2 * l - 1);
  const x = c * plan.k;
  const m = l - c / 2;
  let tr = 0, tg = 0, tb = 0;
  switch (plan.sector) {
    case 0: tr = c; tg = x; tb = 0; break;
    case 1: tr = x; tg = c; tb = 0; break;
    case 2: tr = 0; tg = c; tb = x; break;
    case 3: tr = 0; tg = x; tb = c; break;
    case 4: tr = x; tg = 0; tb = c; break;
    default: tr = c; tg = 0; tb = x; break;
  }
  const s = plan.strength;
  data[i] = r + ((tr + m) * 255 - r) * s;
  data[i + 1] = g + ((tg + m) * 255 - g) * s;
  data[i + 2] = b + ((tb + m) * 255 - b) * s;
}

function deepFried(data: Uint8ClampedArray): void {
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3]! < 8) continue;
    data[i] = clamp((data[i]! - 128) * 1.8 + 128 + 30);
    data[i + 1] = clamp((data[i + 1]! - 128) * 1.6 + 128 + 10);
    data[i + 2] = clamp((data[i + 2]! - 128) * 1.4 + 128 - 20);
  }
}

function duoTone(
  data: Uint8ClampedArray,
  r0: number, g0: number, b0: number,
  r1: number, g1: number, b1: number,
): void {
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3]! < 8) continue;
    const l = (0.2126 * data[i]! + 0.7152 * data[i + 1]! + 0.0722 * data[i + 2]!) / 255;
    data[i] = clamp(r0 + (r1 - r0) * l);
    data[i + 1] = clamp(g0 + (g1 - g0) * l);
    data[i + 2] = clamp(b0 + (b1 - b0) * l);
  }
}

function newsprint(data: Uint8ClampedArray, w: number, h: number): void {
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      if (data[i + 3]! < 8) continue;
      const l = 0.2126 * data[i]! + 0.7152 * data[i + 1]! + 0.0722 * data[i + 2]!;
      const thresh = ((x * 3 + y * 7) % 17) * (255 / 17);
      const v = l > thresh ? 245 : 25;
      data[i] = data[i + 1] = data[i + 2] = v;
    }
  }
}

function hexToHue(hex: string): number {
  let r = 0, g = 0, b = 0;
  if (hex.length === 4) {
    r = parseInt(hex[1]! + hex[1]!, 16);
    g = parseInt(hex[2]! + hex[2]!, 16);
    b = parseInt(hex[3]! + hex[3]!, 16);
  } else {
    r = parseInt(hex.slice(1, 3), 16);
    g = parseInt(hex.slice(3, 5), 16);
    b = parseInt(hex.slice(5, 7), 16);
  }
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max === min) return 0;
  const d = max - min;
  let h = 0;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) * 60;
  else if (max === g) h = ((b - r) / d + 2) * 60;
  else h = ((r - g) / d + 4) * 60;
  return h;
}

function clamp(n: number): number {
  return n < 0 ? 0 : n > 255 ? 255 : n;
}

/**
 * Decode `image` → apply Colour filter at phase `t` → return PNG bytes.
 * Used so Colour can recolour the subject before any style is composited
 * (matching MakeEmoji: Colour hits the upload, then the style draws on top).
 */
export async function tintImageBuffer(
  image: Buffer,
  color: string,
  t: number,
): Promise<Buffer> {
  const sharp = (await import("sharp")).default;
  const { data, info } = await sharp(image)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const out = Buffer.from(data);
  applyColorFilter(
    new Uint8ClampedArray(out.buffer, out.byteOffset, out.byteLength),
    info.width,
    info.height,
    color,
    t,
  );
  return sharp(out, {
    raw: { width: info.width, height: info.height, channels: 4 },
  }).png().toBuffer();
}

/** Aliases matching offline/renderer.ts imports. */
// normalizeColor already exported under this name
// colorIsAnimated already exported under this name
// colorFrameCount already exported under this name
// applyColorFilter already exported under this name
// tintImageBuffer already exported under this name
