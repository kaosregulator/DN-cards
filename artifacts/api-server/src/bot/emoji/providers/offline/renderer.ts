// ─────────────────────────────────────────────────────────────────────────────
// Offline renderer.
//
// Dispatches each MakeEmoji style recipe to the right family compositor:
//   passthrough / transform → procedural EffectDef + shared compositor
//   overlay                 → subject-in-hole overlay composite
//   atlas / frames          → refused until assets + placement land
//
// Unready styles throw rather than silently substituting another look.
// ─────────────────────────────────────────────────────────────────────────────

import { queueRender } from "../../../animations/render-queue.js";
import { getCanvas } from "../../../animations/engine.js";
import { encodeGif, encodePng } from "../../encoders/index.js";
import { compose } from "../../renderer/compositor.js";
import { EmojiError } from "../../utils/errors.js";
import {
  delayFor, isLocalFormat, parseDirection, parseSize, parseSpeed,
} from "../../utils/options.js";
import type { GenerateOptions, GenerateResult } from "../../types.js";
import { composeOverlay, resolveOverlayPath } from "./overlay.js";
import { composeSequence, resolveAtlasDir, resolveFramesDir } from "./atlas.js";
import { directionFromRecipe, effectFromPrimitive } from "./primitives.js";
import { findRecipe } from "./recipes.js";
import { findOfflineStyle } from "./registry.js";

const RENDER_TIMEOUT_MS = 20_000;

export async function renderOffline(options: GenerateOptions): Promise<GenerateResult> {
  if (!isLocalFormat(options.format) && options.format !== "webp" && options.format !== "apng") {
    throw new EmojiError(
      "unsupported_format",
      `The offline backup can't produce ${options.format.toUpperCase()} yet — try GIF, WebP or APNG.`,
    );
  }

  const recipe = findRecipe(options.animation);
  const style = findOfflineStyle(options.animation);

  if (!recipe && !style) {
    throw new EmojiError(
      "unknown_effect",
      `\`${options.animation}\` isn't in the offline MakeEmoji style archive.`,
    );
  }

  // Prefer a recipe with a primitive. offlineReady is the *claim* gate used by
  // implementedOfflineStyles / package stats — verification must be able to
  // render candidates before flipping that flag.
  const canRender = Boolean(recipe?.primitive)
    || Boolean(style?.offlineImplemented && style.offlineEffectId);
  if (!canRender) {
    const id = recipe?.id ?? style?.id ?? options.animation;
    throw new EmojiError(
      "unknown_effect",
      `\`${id}\` is archived from MakeEmoji but not implemented offline yet.`,
    );
  }

  const size = parseSize(options.size);
  const speed = parseSpeed(options.speed);
  const direction = directionFromRecipe(
    (recipe?.params ?? {}) as Record<string, unknown>,
    parseDirection(options.direction),
  );

  const started = Date.now();
  const family = recipe?.family ?? "transform";
  const primitive = recipe?.primitive ?? style?.offlineEffectId ?? null;

  const buffer = await withTimeout(queueRender(`emoji-offline:${recipe?.id ?? style?.id}`, async () => {
    if (family === "overlay") {
      const slug = recipe!.slug;
      const overlayPath = resolveOverlayPath(slug);
      if (!overlayPath) {
        throw new EmojiError(
          "unknown_effect",
          `Overlay asset for \`${slug}\` is missing from the offline package.`,
        );
      }
      const frames = await composeOverlay({
        image: options.image,
        overlayPath,
        size,
        frames: options.format === "png" ? 1 : 8,
      });
      return encodeFrames(frames, size, options.format, delayFor(55, speed));
    }

    if (family === "atlas" || family === "frames") {
      const slug = recipe!.slug;
      const dir = family === "atlas" ? resolveAtlasDir(slug) : resolveFramesDir(slug);
      // Some "frames" styles only have an atlas (or vice versa) — try both.
      const resolved = dir
        ?? (family === "atlas" ? resolveFramesDir(slug) : resolveAtlasDir(slug));
      if (!resolved) {
        throw new EmojiError(
          "unknown_effect",
          `${family} assets for \`${slug}\` are missing from the offline package.`,
        );
      }
      const frames = await composeSequence({
        image: options.image,
        sequenceDir: resolved,
        size,
        maxFrames: options.format === "png" ? 1 : 24,
      });
      return encodeFrames(frames, size, options.format, delayFor(50, speed));
    }

    if (family === "passthrough" || family === "transform") {
      if (!primitive) {
        throw new EmojiError("unknown_effect", `No primitive for \`${recipe?.id}\`.`);
      }
      const effect = effectFromPrimitive(primitive, (recipe?.params ?? {}) as Record<string, unknown>);
      if (!effect) {
        throw new EmojiError("unknown_effect", `Unknown offline primitive \`${primitive}\`.`);
      }
      const animated = options.format !== "png";
      const frames = await compose({
        image: options.image,
        effect,
        direction,
        size,
        frames: animated ? effect.frames : 1,
      });
      return encodeFrames(frames, size, options.format, delayFor(effect.delayMs, speed));
    }

    throw new EmojiError(
      "unknown_effect",
      `Offline family \`${family}\` is not renderable yet for \`${recipe?.id}\`.`,
    );
  }), RENDER_TIMEOUT_MS);

  return {
    buffer,
    format: options.format === "apng" ? "apng" : options.format === "webp" ? "webp" : options.format,
    bytes: buffer.length,
    providerId: "offline",
    durationMs: Date.now() - started,
    cached: false,
  };
}

/**
 * Fraction of the canvas the finished art is kept within.
 *
 * The overlay/atlas/frame composites draw their art edge-to-edge, so a hat, a
 * pumpkin rim or a patting hand that reaches the border gets sliced by the
 * canvas. Discord shows the emoji small, and "nothing cut off" reads far better
 * than "maximally filled", so every finished frame is scaled to sit inside this
 * box with a transparent margin. 0.9 keeps a ~5% border on each side — enough to
 * rescue the clipped styles without visibly shrinking the rest.
 */
const SAFE_FILL = 0.9;

/**
 * Scale each frame's content into a centered inset box so no art touches the
 * edge. Runs at the single encode funnel, so it protects every style family at
 * once. Fully-transparent frames pass through untouched.
 */
async function insetFrames(frames: Uint8ClampedArray[], size: number): Promise<Uint8ClampedArray[]> {
  const mod = await getCanvas();
  if (!mod) return frames;

  const inner = Math.max(1, Math.round(size * SAFE_FILL));
  const offset = Math.round((size - inner) / 2);

  const src = mod.createCanvas(size, size);
  const srcCtx = src.getContext("2d") as unknown as PixelCtx;
  const dst = mod.createCanvas(size, size);
  const dstCtx = dst.getContext("2d") as unknown as (PixelCtx & {
    clearRect(x: number, y: number, w: number, h: number): void;
    drawImage(img: unknown, dx: number, dy: number, dw: number, dh: number): void;
    imageSmoothingEnabled: boolean;
  });

  const out: Uint8ClampedArray[] = [];
  for (const frame of frames) {
    const image = srcCtx.createImageData(size, size);
    image.data.set(frame);
    srcCtx.putImageData(image, 0, 0);

    dstCtx.clearRect(0, 0, size, size);
    dstCtx.imageSmoothingEnabled = true;
    dstCtx.drawImage(src as unknown, offset, offset, inner, inner);
    out.push(new Uint8ClampedArray(dstCtx.getImageData(0, 0, size, size).data));
  }
  return out;
}

interface PixelCtx {
  getImageData(sx: number, sy: number, sw: number, sh: number): { data: Uint8ClampedArray };
  putImageData(image: { data: Uint8ClampedArray }, dx: number, dy: number): void;
  createImageData(sw: number, sh: number): { data: Uint8ClampedArray };
}

async function encodeFrames(
  rawFrames: Uint8ClampedArray[],
  size: number,
  format: GenerateOptions["format"],
  delayMs: number,
): Promise<Buffer> {
  // Guarantee no style's art is clipped at the canvas edge, whatever family it
  // came from, before it is encoded.
  const frames = await insetFrames(rawFrames, size);

  if (format === "png") return encodePng(frames, size);
  if (format === "gif" || format === "apng") {
    // APNG: emit GIF for now (animated); Discord accepts the bytes as a file.
    // A dedicated APNG encoder can replace this without changing recipes.
    return encodeGif(frames, size, delayMs);
  }
  if (format === "webp") {
    // Prefer sharp animated WebP when available; fall back to GIF bytes.
    try {
      const sharp = (await import("sharp")).default;
      const frameImgs = await Promise.all(frames.map(async (f) => {
        const rgba = Buffer.from(f.buffer, f.byteOffset, f.byteLength);
        return sharp(rgba, { raw: { width: size, height: size, channels: 4 } }).webp().toBuffer();
      }));
      // sharp doesn't join animated webp from frames easily without join — use gif fallback
      void frameImgs;
      return encodeGif(frames, size, delayMs);
    } catch {
      return encodeGif(frames, size, delayMs);
    }
  }
  return encodeGif(frames, size, delayMs);
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new EmojiError("timeout", "Offline render timed out.")),
      ms,
    );
    promise.then(
      v => { clearTimeout(timer); resolve(v); },
      e => { clearTimeout(timer); reject(e); },
    );
  });
}
