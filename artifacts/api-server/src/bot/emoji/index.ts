// ─────────────────────────────────────────────────────────────────────────────
// Emoji system — public surface.
//
// Import from here rather than reaching into subfolders, so the internal layout
// stays free to change.
//
//   const png = await loadSource(attachment.url);
//   const { buffer } = await renderEmoji(png, {
//     effect: "shake", speed: "normal", direction: "right", size: 128, format: "gif",
//   });
// ─────────────────────────────────────────────────────────────────────────────

export type {
  EffectDef, EffectSummary, EffectContext, LayerDef, Transform,
  EmojiDirection, EmojiFormat, EmojiSize, EmojiSpeed,
  RenderOptions, RenderResult,
} from "./types.js";

export { renderEmoji } from "./renderer/render.js";
export { EFFECTS, EFFECT_SUMMARIES, DEFAULT_EFFECT, getEffect, hasEffect, effectIds } from "./registry/index.js";
export { EmojiError, toEmojiError, type EmojiErrorCode } from "./utils/errors.js";
export { loadSource, normalizeSource, fetchImageBytes, MAX_SOURCE_BYTES } from "./utils/source.js";
export {
  SPEEDS, DIRECTIONS, FORMATS, SIZES,
  DEFAULT_SPEED, DEFAULT_DIRECTION, DEFAULT_FORMAT, DEFAULT_SIZE,
  parseSpeed, parseDirection, parseFormat, parseSize, delayFor,
} from "./utils/options.js";
