// ─────────────────────────────────────────────────────────────────────────────
// Emoji system — public surface.
//
// Generation is performed by MakeEmoji.com through a provider. Import from here
// rather than reaching into subfolders, so the internal layout stays free to
// change.
//
//   const image = await loadSource(attachment.url);
//   const { buffer } = await generateEmoji({
//     image, animation: "shake", speed: "normal", size: 128, format: "gif",
//   });
// ─────────────────────────────────────────────────────────────────────────────

// ── generation ───────────────────────────────────────────────────────────────
export { generateEmoji, DISCORD_EMOJI_LIMIT, MAX_ATTACHMENT_BYTES } from "./generate.js";
export type {
  GenerateOptions, GenerateResult, EmojiDirection, EmojiFormat, EmojiSize, EmojiSpeed,
} from "./types.js";

// ── providers ────────────────────────────────────────────────────────────────
export {
  PROVIDERS, resolveProvider, providerReport, makeEmojiProvider, localProvider,
} from "./providers/index.js";
export type { EmojiProvider, ProviderStatus, ProviderReport } from "./providers/index.js";

// ── MakeEmoji discovery ──────────────────────────────────────────────────────
export {
  getManifest, reloadManifest, manifestProblem, valuesFor, resolveValue,
} from "./providers/makeemoji/manifest.js";
export { Manifest, OPTION_KEYS } from "./providers/makeemoji/types.js";
export type { OptionKey, ControlSpec, ApiSpec } from "./providers/makeemoji/types.js";
export { discover, DEFAULT_SITE_URL, DEFAULT_OUTPUT_DIR } from "./providers/makeemoji/discovery/discover.js";

// ── cache ────────────────────────────────────────────────────────────────────
export { cacheKey, cacheStats, clearCache, withCache } from "./cache/index.js";

// ── input handling ───────────────────────────────────────────────────────────
export { loadSource, normalizeSource, fetchImageBytes, MAX_SOURCE_BYTES } from "./utils/source.js";
export { EmojiError, toEmojiError, isRetryable, type EmojiErrorCode } from "./utils/errors.js";
export { FORMATS, LOCAL_FORMATS, parseFormat, isLocalFormat } from "./utils/options.js";

// ── local fallback renderer ──────────────────────────────────────────────────
// Only reachable when an operator sets EMOJI_ALLOW_LOCAL_FALLBACK=1. MakeEmoji
// is the generator; this is a degraded stand-in, never a silent substitute.
export { renderEmoji } from "./renderer/render.js";
export { EFFECTS, EFFECT_SUMMARIES, getEffect, hasEffect, effectIds } from "./registry/index.js";
export type { EffectDef, EffectSummary, Transform, RenderOptions, RenderResult } from "./types.js";
