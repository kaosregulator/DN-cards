// ─────────────────────────────────────────────────────────────────────────────
// Render orchestration — the public entry point of the emoji system.
//
// This is the seam every caller goes through: it resolves options, runs the
// compositor through the shared render queue, encodes, and enforces the output
// budget. Callers (the slash command, tests, anything later) never talk to the
// compositor or the encoders directly.
//
// Heavy work goes through `queueRender` so a burst of /emoji calls can't starve
// battles, packs and the rest of the bot of CPU — they all share one queue with
// a small concurrency cap.
// ─────────────────────────────────────────────────────────────────────────────

import { MAX_ANIMATION_BYTES } from "../../animations/engine.js";
import { queueRender } from "../../animations/render-queue.js";
import { logger } from "../../../lib/logger.js";
import { getEffect } from "../registry/index.js";
import { encodeGif, encodePng } from "../encoders/index.js";
import { EmojiError } from "../utils/errors.js";
import { delayFor } from "../utils/options.js";
import type { RenderOptions, RenderResult } from "../types.js";
import { compose } from "./compositor.js";

/** Wall-clock budget for one render before we give up. */
const RENDER_TIMEOUT_MS = 20_000;

/**
 * Render a normalised source image into an animated GIF or a static PNG.
 *
 * `image` must already be normalised (see utils/source.ts) — this function does
 * not fetch, and does not re-encode the input.
 */
export async function renderEmoji(image: Buffer, options: RenderOptions): Promise<RenderResult> {
  const effect = getEffect(options.effect);
  if (!effect) {
    throw new EmojiError("unknown_effect", `\`${options.effect}\` isn't an effect I know.`);
  }

  const started = Date.now();
  const isAnimated = options.format === "gif";
  const frameCount = isAnimated ? effect.frames : 1;

  const result = await withTimeout(
    queueRender(`emoji:${effect.id}`, async () => {
      const frames = await compose({
        image,
        effect,
        direction: options.direction,
        size: options.size,
        frames: frameCount,
      });

      // encodeGif mutates the frame buffers in place, so nothing may read them
      // after this point.
      return isAnimated
        ? encodeGif(frames, options.size, delayFor(effect.delayMs, options.speed))
        : await encodePng(frames, options.size);
    }),
    RENDER_TIMEOUT_MS,
  );

  if (!result || result.length === 0) {
    throw new EmojiError("encode_failed", "The emoji came out empty. Please try again.");
  }

  if (result.length > MAX_ANIMATION_BYTES) {
    throw new EmojiError(
      "too_big_to_send",
      "That emoji came out too large to upload. Try a smaller size or a slower speed.",
    );
  }

  const durationMs = Date.now() - started;
  logger.debug(
    {
      effect: effect.id, size: options.size, format: options.format,
      speed: options.speed, direction: options.direction,
      frames: frameCount, bytes: result.length, durationMs,
    },
    "emoji rendered",
  );

  return {
    buffer: result,
    format: options.format,
    size: options.size,
    frames: frameCount,
    bytes: result.length,
    durationMs,
  };
}

/**
 * Bound a render in wall-clock time.
 *
 * The underlying canvas work is synchronous and can't actually be cancelled — so
 * this bounds what the CALLER waits for, letting the interaction fail cleanly
 * instead of hanging until Discord times out the token.
 */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new EmojiError("timeout", "That emoji took too long to build. Please try again."));
    }, ms);

    promise.then(
      value => { clearTimeout(timer); resolve(value); },
      error => { clearTimeout(timer); reject(error); },
    );
  });
}
