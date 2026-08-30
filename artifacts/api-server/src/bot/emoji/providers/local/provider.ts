// ─────────────────────────────────────────────────────────────────────────────
// Local fallback provider — OFF unless an operator turns it on.
//
// This wraps the procedural renderer that already exists in this package. It is
// deliberately NOT the default: the system is meant to use MakeEmoji, and
// quietly substituting our own effects would mean users get something different
// from what they asked for without being told.
//
// It exists because "MakeEmoji is down" and "the bot is broken" should be
// distinguishable, and an operator may prefer degraded output to no output.
// Enable with EMOJI_ALLOW_LOCAL_FALLBACK=1; every result it produces is labelled
// so the command can say where the emoji came from.
// ─────────────────────────────────────────────────────────────────────────────

import { EmojiError } from "../../utils/errors.js";
import { isLocalFormat, parseDirection, parseSize, parseSpeed } from "../../utils/options.js";
import { hasEffect } from "../../registry/index.js";
import { renderEmoji } from "../../renderer/render.js";
import type { GenerateOptions, GenerateResult } from "../../types.js";
import type { EmojiProvider, ProviderStatus } from "../types.js";

const ENV_ENABLE = "EMOJI_ALLOW_LOCAL_FALLBACK";

export function isLocalFallbackEnabled(): boolean {
  return /^(1|true|yes|on)$/i.test(process.env[ENV_ENABLE]?.trim() ?? "");
}

export class LocalProvider implements EmojiProvider {
  readonly id = "local";
  readonly name = "Local renderer (fallback)";

  async status(): Promise<ProviderStatus> {
    return isLocalFallbackEnabled()
      ? { available: true }
      : { available: false, reason: `disabled — set ${ENV_ENABLE}=1 to allow degraded local rendering` };
  }

  async generate(options: GenerateOptions): Promise<GenerateResult> {
    if (!isLocalFallbackEnabled()) {
      throw new EmojiError("provider_unavailable", "The emoji generator isn't available right now.");
    }

    if (!isLocalFormat(options.format)) {
      throw new EmojiError(
        "unsupported_format",
        `The local fallback can't produce ${options.format.toUpperCase()} — try GIF or PNG.`,
      );
    }

    // The local renderer has its own effect vocabulary, which is not MakeEmoji's.
    // Rather than map one onto the other — which would silently give the user a
    // different animation from the one they picked — an unknown name is refused.
    if (!hasEffect(options.animation)) {
      throw new EmojiError(
        "unknown_effect",
        `\`${options.animation}\` isn't available from the local fallback renderer.`,
      );
    }

    const started = Date.now();
    const result = await renderEmoji(options.image, {
      effect: options.animation,
      speed: parseSpeed(options.speed),
      direction: parseDirection(options.direction),
      size: parseSize(options.size),
      format: options.format,
    });

    return {
      buffer: result.buffer,
      format: options.format,
      bytes: result.bytes,
      providerId: this.id,
      durationMs: Date.now() - started,
      cached: false,
    };
  }
}

export const localProvider = new LocalProvider();
