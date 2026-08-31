// ─────────────────────────────────────────────────────────────────────────────
// Typed failures.
//
// Every way this system can fail maps to one `EmojiError` with a `code` and a
// message that is already safe (and useful) to show a Discord user. The command
// layer never has to guess how to phrase a failure, and an unexpected throw is
// still caught and reported as `internal` rather than crashing the bot.
// ─────────────────────────────────────────────────────────────────────────────

export type EmojiErrorCode =
  // ── input ──────────────────────────────────────────────────────────────────
  | "no_source"           // nothing to render — no attachment, user or url
  | "bad_url"             // url wasn't http(s) or pointed somewhere non-public
  | "fetch_failed"        // network error or non-2xx fetching the source
  | "too_large"           // source exceeded the byte cap
  | "not_an_image"        // bytes weren't a decodable image
  | "unknown_option"      // an option value MakeEmoji doesn't offer
  | "unsupported_format"  // the chosen provider can't emit that container
  // ── provider ───────────────────────────────────────────────────────────────
  | "provider_unavailable" // no provider is configured/usable right now
  | "browser_failed"       // Chromium wouldn't start, or crashed mid-run
  | "site_changed"         // the page no longer matches the discovery manifest
  | "generation_failed"    // the site accepted the job but produced nothing
  | "rate_limited"         // upstream asked us to back off
  // ── local renderer ─────────────────────────────────────────────────────────
  | "unknown_effect"      // effect id not in the registry
  | "canvas_missing"      // @napi-rs/canvas failed to load
  | "encode_failed"       // frames rendered but encoding produced nothing
  // ── output ─────────────────────────────────────────────────────────────────
  | "too_big_to_send"     // encoded output exceeded Discord's attachment limit
  | "timeout"             // generation exceeded its budget
  | "internal";           // anything unclassified

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

/**
 * Codes worth another attempt. Everything else is a settled answer — a bad image
 * or an unknown animation will fail identically however many times we retry, and
 * retrying a live site for those just wastes its capacity and the user's time.
 */
const RETRYABLE = new Set<EmojiErrorCode>([
  "fetch_failed", "timeout", "browser_failed", "generation_failed", "rate_limited",
]);

export function isRetryable(err: unknown): boolean {
  return err instanceof EmojiError && RETRYABLE.has(err.code);
}

/**
 * Codes that mean "this server isn't configured", as opposed to "that attempt
 * didn't work".
 *
 * The distinction is what a user should DO. A setup gap will fail identically
 * forever, so telling someone to try again wastes their time; a transient fault
 * usually clears on its own. Everything else is about their input.
 */
const SETUP = new Set<EmojiErrorCode>(["provider_unavailable", "site_changed"]);

export type FailureKind = "setup" | "transient" | "input";

export function failureKind(err: unknown): FailureKind {
  const code = err instanceof EmojiError ? err.code : "internal";
  if (SETUP.has(code)) return "setup";
  if (RETRYABLE.has(code)) return "transient";
  return "input";
}
