// ─────────────────────────────────────────────────────────────────────────────
// Offline renderer.
//
// For the partial proof-of-concept, exact-name MakeEmoji styles that overlap
// the local procedural effect registry are rendered locally — offline, with no
// network. Unmapped styles are refused rather than silently substituted.
// ─────────────────────────────────────────────────────────────────────────────

import { hasEffect } from "../../registry/index.js";
import { renderEmoji } from "../../renderer/render.js";
import { EmojiError } from "../../utils/errors.js";
import { isLocalFormat, parseDirection, parseSize, parseSpeed } from "../../utils/options.js";
import type { GenerateOptions, GenerateResult } from "../../types.js";
import { findOfflineStyle } from "./registry.js";

export async function renderOffline(options: GenerateOptions): Promise<GenerateResult> {
  if (!isLocalFormat(options.format)) {
    throw new EmojiError(
      "unsupported_format",
      `The offline backup can't produce ${options.format.toUpperCase()} yet — try GIF or PNG.`,
    );
  }

  const style = findOfflineStyle(options.animation);
  if (!style) {
    throw new EmojiError(
      "unknown_effect",
      `\`${options.animation}\` isn't in the offline MakeEmoji style archive.`,
    );
  }
  if (!style.offlineImplemented || !style.offlineEffectId) {
    throw new EmojiError(
      "unknown_effect",
      `\`${style.id}\` is archived from MakeEmoji but not implemented offline yet.`,
    );
  }
  if (!hasEffect(style.offlineEffectId)) {
    throw new EmojiError(
      "unknown_effect",
      `Offline mapping for \`${style.id}\` points at a missing local effect.`,
    );
  }

  const started = Date.now();
  const result = await renderEmoji(options.image, {
    effect: style.offlineEffectId,
    speed: parseSpeed(options.speed),
    direction: parseDirection(options.direction),
    size: parseSize(options.size),
    format: options.format,
  });

  return {
    buffer: result.buffer,
    format: options.format,
    bytes: result.bytes,
    providerId: "offline",
    durationMs: Date.now() - started,
    cached: false,
  };
}
