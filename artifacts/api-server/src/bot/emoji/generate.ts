// ─────────────────────────────────────────────────────────────────────────────
// Generation entry point.
//
// One function the command layer calls. It owns the parts that are true of every
// generation regardless of which provider serves it: cache lookup, provider
// selection, and the size ceiling Discord imposes on an upload.
//
//   generateEmoji()
//     ├─ cache        identical request → stored bytes, no upstream call
//     ├─ provider     MakeEmoji, or an operator-enabled fallback
//     └─ size guard   refuse what Discord would reject
// ─────────────────────────────────────────────────────────────────────────────

import { withCache } from "./cache/index.js";
import { resolveProvider } from "./providers/index.js";
import { EmojiError } from "./utils/errors.js";
import type { GenerateOptions, GenerateResult } from "./types.js";

/** Discord rejects a message attachment above this on a non-boosted server. */
export const MAX_ATTACHMENT_BYTES = 8 * 1024 * 1024;

/** Discord rejects a custom-emoji upload above this. */
export const DISCORD_EMOJI_LIMIT = 256 * 1024;

/**
 * Generate an emoji through whichever provider is available.
 *
 * `options.image` must already be normalised (see utils/source.ts) — this
 * function does not fetch or re-encode the input.
 */
export async function generateEmoji(options: GenerateOptions): Promise<GenerateResult> {
  const result = await withCache(options, async () => {
    const provider = await resolveProvider();
    return provider.generate(options);
  });

  // Checked after the cache too: a stored result is just as unsendable.
  if (result.bytes > MAX_ATTACHMENT_BYTES) {
    throw new EmojiError(
      "too_big_to_send",
      "That emoji came out too large to upload. Try a smaller size or a different format.",
    );
  }

  return result;
}
