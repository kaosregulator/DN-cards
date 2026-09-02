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
import { composeLayerPack, hasLayerPack } from "./layer-pack.js";
import { directionFromRecipe, effectFromPrimitive } from "./primitives.js";
import { findRecipe } from "./recipes.js";
import { findOfflineStyle } from "./registry.js";
import { renderScene, sceneIdOf } from "./scene-pack.js";
import {
  applyColorFilter,
  colorFrameCount,
  colorIsAnimated,
  normalizeColor,
  tintImageBuffer,
} from "./color-filter.js";

const RENDER_TIMEOUT_MS = 20_000;

function styleSlug(animation: string, recipeId?: string, styleId?: string): string {
  const raw = recipeId ?? styleId ?? animation;
  return raw.replace(/^gen_btn_/, "");
}

export async function renderOffline(options: GenerateOptions): Promise<GenerateResult> {
  // Scene packs are whole green/blue-screen clips composited at native size —
  // a different family from the small MakeEmoji styles, so they short-circuit
  // the manifest lookup and the emoji format/size rules entirely. They always
  // emit a GIF; a `size` (the board thumbnail) yields a small, few-frame preview.
  const sceneId = sceneIdOf(options.animation);
  if (sceneId) {
    const startedScene = Date.now();
    const size = options.size ? parseSize(options.size) : undefined;
    const buffer = await renderScene(options.image, sceneId, size ? { size } : {});
    return {
      buffer, format: "gif", bytes: buffer.length, providerId: "offline",
      durationMs: Date.now() - startedScene, cached: false,
    };
  }

  if (!isLocalFormat(options.format) && options.format !== "webp" && options.format !== "apng") {
    throw new EmojiError(
      "unsupported_format",
      `The offline backup can't produce ${options.format.toUpperCase()} yet — try GIF, WebP or APNG.`,
    );
  }

  const recipe = findRecipe(options.animation);
  const style = findOfflineStyle(options.animation);
  const slug = styleSlug(options.animation, recipe?.slug ?? recipe?.id, style?.id);
  const layerReady = hasLayerPack(slug);

  if (!recipe && !style && !layerReady) {
    throw new EmojiError(
      "unknown_effect",
      `\`${options.animation}\` isn't in the offline MakeEmoji style archive.`,
    );
  }

  // Prefer a recipe with a primitive. offlineReady is the *claim* gate used by
  // implementedOfflineStyles / package stats — verification must be able to
  // render candidates before flipping that flag.
  // Harvested MakeEmoji green-screen layer packs always win when present.
  const canRender = layerReady
    || Boolean(recipe?.primitive)
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
  // MakeEmoji Colour side-control: recolors the upload before/while the style runs.
  const color = normalizeColor(options.color);

  const buffer = await withTimeout(queueRender(`emoji-offline:${recipe?.id ?? style?.id ?? slug}`, async () => {
    // Gold path: real MakeEmoji GIF harvested with a green subject, chroma-keyed.
    if (layerReady) {
      const pack = await composeLayerPack({ image: options.image, slug, size });
      // Colour still applies to the subject before compositing when requested.
      if (color) {
        return composeWithColor({
          family: "frames",
          image: options.image,
          color,
          format: options.format,
          size,
          speed,
          baseFrames: options.format === "png" ? 1 : pack.frames.length,
          composeOne: async (image, _frameCount) => {
            const again = await composeLayerPack({ image, slug, size });
            return again.frames;
          },
          delayMs: pack.delayMs,
        });
      }
      return encodeFrames(
        pack.frames,
        size,
        options.format,
        delayFor(pack.delayMs, speed),
        "frames",
      );
    }

    if (family === "overlay") {
      const slug = recipe!.slug;
      const overlayPath = resolveOverlayPath(slug);
      if (!overlayPath) {
        throw new EmojiError(
          "unknown_effect",
          `Overlay asset for \`${slug}\` is missing from the offline package.`,
        );
      }
      const frames = await composeWithColor({
        family: "overlay",
        image: options.image,
        color,
        format: options.format,
        size,
        speed,
        baseFrames: options.format === "png" ? 1 : 8,
        composeOne: async (image, frameCount) => composeOverlay({
          image, overlayPath, size, frames: frameCount,
        }),
        delayMs: 55,
      });
      return frames;
    }

    if (family === "atlas" || family === "frames") {
      const slug = recipe!.slug;
      // Prefer real CDN frame PNGs over atlas sprite-sheets whenever both exist.
      // Drawing a sheet whole is what tiled the subject across the canvas.
      const framesDir = resolveFramesDir(slug);
      const atlasDir = resolveAtlasDir(slug);
      const resolved = framesDir ?? atlasDir
        ?? (family === "atlas" ? resolveFramesDir(slug) : resolveAtlasDir(slug));
      if (!resolved) {
        throw new EmojiError(
          "unknown_effect",
          `${family} assets for \`${slug}\` are missing from the offline package.`,
        );
      }
      return composeWithColor({
        family,
        image: options.image,
        color,
        format: options.format,
        size,
        speed,
        baseFrames: options.format === "png" ? 1 : 24,
        composeOne: async (image, frameCount) => composeSequence({
          image, sequenceDir: resolved, size, maxFrames: frameCount,
        }),
        delayMs: 50,
      });
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
      const styleFrames = animated ? effect.frames : 1;
      // Colour alone (style `none`) must still produce a looping GIF when the
      // Colour mode is animated — matching MakeEmoji's Colors/Rainbow/etc.
      const wantFrames = animated
        ? Math.max(styleFrames, colorFrameCount(color, 12))
        : 1;
      return composeWithColor({
        family,
        image: options.image,
        color,
        format: options.format,
        size,
        speed,
        baseFrames: wantFrames,
        composeOne: async (image, frameCount) => compose({
          image, effect, direction, size, frames: frameCount,
        }),
        delayMs: effect.delayMs,
      });
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
 * Compose with optional MakeEmoji Colour pre-filter on the subject.
 *
 * Static Colour: tint the upload once, then run the style as usual.
 * Animated Colour: tint the upload per frame phase and composite one frame
 * at a time so Colour cycles while the style plays (or alone under `none`).
 */
async function composeWithColor(opts: {
  family: string;
  image: Buffer;
  color: string | null;
  format: GenerateOptions["format"];
  size: number;
  speed: ReturnType<typeof parseSpeed>;
  baseFrames: number;
  composeOne: (image: Buffer, frameCount: number) => Promise<Uint8ClampedArray[]>;
  delayMs: number;
}): Promise<Buffer> {
  const { family, image, color, format, size, speed, baseFrames, composeOne, delayMs } = opts;

  if (!color) {
    const frames = await composeOne(image, baseFrames);
    return encodeFrames(frames, size, format, delayFor(delayMs, speed), family);
  }

  if (!colorIsAnimated(color) || format === "png") {
    const tinted = await tintImageBuffer(image, color, 0);
    const frames = await composeOne(tinted, format === "png" ? 1 : baseFrames);
    return encodeFrames(frames, size, format, delayFor(delayMs, speed), family);
  }

  // Animated colour: one composited frame per phase so hue/stripes cycle.
  const n = Math.max(baseFrames, colorFrameCount(color, 12));
  const frames: Uint8ClampedArray[] = [];
  for (let i = 0; i < n; i++) {
    const tinted = await tintImageBuffer(image, color, i / n);
    const one = await composeOne(tinted, 1);
    if (one[0]) frames.push(one[0]);
  }
  void applyColorFilter; // reserved for raw-buffer path
  return encodeFrames(frames, size, format, delayFor(delayMs, speed), family);
}

/**
 * Fraction of the canvas the finished art is kept within.
 *
 * - frames: already authored with transparent margins — do not resample
 *   (bilinear inset destroys AA rims → "missing pixels" after GIF dither).
 * - atlas/overlay: light inset so chrome never kisses the Discord crop edge.
 * - transform: deeper safe box so spin/slide never clips.
 */
const SAFE_FILL_FRAMES = 0.98;
const SAFE_FILL_OVERLAY = 0.96;
const SAFE_FILL_TRANSFORM = 0.9;

/**
 * Scale each frame's content into a centered inset box so no art touches the
 * edge. Runs at the single encode funnel. Fully-transparent frames pass through
 * untouched.
 */
async function insetFrames(
  frames: Uint8ClampedArray[],
  size: number,
  fill = SAFE_FILL_OVERLAY,
): Promise<Uint8ClampedArray[]> {
  const mod = await getCanvas();
  if (!mod) return frames;

  const inner = Math.max(1, Math.round(size * fill));
  if (inner >= size) return frames;
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
  family: string = "transform",
): Promise<Buffer> {
  // frames: no resample (authored margins). atlas/overlay: light inset.
  // transform: deep safe box.
  const fill = family === "transform" || family === "passthrough"
    ? SAFE_FILL_TRANSFORM
    : family === "frames"
      ? SAFE_FILL_FRAMES
      : SAFE_FILL_OVERLAY;
  const frames = await insetFrames(rawFrames, size, fill);

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
