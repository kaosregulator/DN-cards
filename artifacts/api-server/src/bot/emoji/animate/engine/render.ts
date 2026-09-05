// ─────────────────────────────────────────────────────────────────────────────
// Render orchestration — the engine's public entry point.
//
// recipe(s) + target image → animated GIF candidate(s), through the shared
// render queue, with the result cache in front and the output budget enforced.
// The command layer calls this and nothing deeper. Multiple candidates render
// as separate queued jobs so a busy bot interleaves them with everything else.
//
// The CPU canvas compositor is installed here as the default renderer; a GPU
// backend can replace it via setRenderer() without changing this file's callers.
// ─────────────────────────────────────────────────────────────────────────────

import { MAX_ANIMATION_BYTES } from "../../../animations/engine.js";
import { queueRender, RENDER_PRIORITY } from "../../../animations/render-queue.js";
import { logger } from "../../../../lib/logger.js";
import { encodeGif } from "../../encoders/index.js";
import { EmojiError } from "../../utils/errors.js";
import type { Candidate, Features, Recipe } from "../types.js";
import { compose } from "./compositor.js";
import { detectFeatures } from "./detect.js";
import { setRenderer, getRenderer } from "./renderer.js";
import { cacheKey, hashImage, withCandidateCache } from "./cache.js";
import { credit } from "./explain.js";

/** Wall-clock budget for one candidate before we give up. */
const RENDER_TIMEOUT_MS = 20_000;

/** Install the default CPU renderer once, on first use. */
setRenderer({
  id: "canvas",
  renderFrames: (image, recipe, size, features) => compose({ image, recipe, size, features }),
});

export interface RenderRequest {
  image: Buffer;
  /** Precomputed once per session and reused across recipes (see hashImage). */
  imageHash?: string;
  /** Detected geometry, computed once per target and reused across recipes. */
  features?: Features;
  recipe: Recipe;
  size: number;
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new EmojiError("timeout", "That animation took too long to build. Please try again.")),
      ms,
    );
    promise.then(
      v => { clearTimeout(timer); resolve(v); },
      e => { clearTimeout(timer); reject(e); },
    );
  });
}

/** Render (or serve from cache) one candidate. */
export async function renderCandidate(req: RenderRequest): Promise<Candidate> {
  const { image, recipe, size } = req;
  const imageHash = req.imageHash ?? hashImage(image);
  const key = cacheKey(imageHash, recipe, size);

  return withCandidateCache(key, async () => {
    const buffer = await withTimeout(
      queueRender(`animate:${recipe.label}`, async () => {
        const renderer = getRenderer();
        const frames = await renderer.renderFrames(image, recipe, size, req.features);
        if (frames.length === 0) {
          throw new EmojiError("encode_failed", "The animation came out empty. Please try again.");
        }
        // encodeGif mutates the frame buffers in place — nothing may read them after.
        return encodeGif(frames, size, recipe.delayMs);
      }, RENDER_PRIORITY.output),
      RENDER_TIMEOUT_MS,
    );

    if (!buffer || buffer.length === 0) {
      throw new EmojiError("encode_failed", "The animation came out empty. Please try again.");
    }
    if (buffer.length > MAX_ANIMATION_BYTES) {
      throw new EmojiError(
        "too_big_to_send",
        "That animation came out too large. Try a smaller size or a lower intensity.",
      );
    }

    logger.debug(
      { label: recipe.label, size, frames: recipe.frames, bytes: buffer.length },
      "animate candidate rendered",
    );

    return {
      recipe,
      buffer,
      format: "gif" as const,
      size,
      frames: recipe.frames,
      bytes: buffer.length,
      credit: credit(recipe),
    };
  });
}

/**
 * Render several candidates. Each is a separate cached, queued job; a single
 * failure doesn't sink the batch — the user still gets the ones that rendered.
 */
export async function renderCandidates(
  image: Buffer, recipes: Recipe[], size: number, features?: Features,
): Promise<Candidate[]> {
  const imageHash = hashImage(image);
  // Detect once for the whole batch; every candidate reuses it.
  const detected = features ?? await detectFeatures(image);
  const settled = await Promise.allSettled(
    recipes.map(recipe => renderCandidate({ image, imageHash, features: detected, recipe, size })),
  );
  const ok: Candidate[] = [];
  for (const r of settled) {
    if (r.status === "fulfilled") ok.push(r.value);
    else logger.warn({ err: r.reason }, "animate: a candidate failed to render");
  }
  if (ok.length === 0) {
    // Surface the first real error rather than a generic one.
    const first = settled.find(s => s.status === "rejected") as PromiseRejectedResult | undefined;
    throw first?.reason ?? new EmojiError("generation_failed", "Couldn't build any animation. Please try again.");
  }
  return ok;
}
