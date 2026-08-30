// ─────────────────────────────────────────────────────────────────────────────
// Typed failures.
//
// Every way this system can fail maps to one `EmojiError` with a `code` and a
// message that is already safe (and useful) to show a Discord user. The command
// layer never has to guess how to phrase a failure, and an unexpected throw is
// still caught and reported as `internal` rather than crashing the bot.
// ─────────────────────────────────────────────────────────────────────────────

export type EmojiErrorCode =
  | "no_source"        // nothing to render — no attachment, user or url
  | "bad_url"          // url wasn't http(s) or pointed somewhere non-public
  | "fetch_failed"     // network error or non-2xx fetching the source
  | "too_large"        // source exceeded the byte cap
  | "not_an_image"     // bytes weren't a decodable image
  | "unknown_effect"   // effect id not in the registry
  | "canvas_missing"   // @napi-rs/canvas failed to load
  | "encode_failed"    // frames rendered but encoding produced nothing
  | "too_big_to_send"  // encoded output exceeded Discord's attachment limit
  | "timeout"          // render exceeded its budget
  | "internal";        // anything unclassified

/** An error whose `message` is safe to show a user verbatim. */
export class EmojiError extends Error {
  readonly code: EmojiErrorCode;

  constructor(code: EmojiErrorCode, message: string) {
    super(message);
    this.name = "EmojiError";
    this.code = code;
  }
}

/** Narrow an unknown throw into an EmojiError, defaulting to `internal`. */
export function toEmojiError(err: unknown): EmojiError {
  if (err instanceof EmojiError) return err;
  return new EmojiError(
    "internal",
    "Something went wrong while building that emoji. Please try again.",
  );
}
