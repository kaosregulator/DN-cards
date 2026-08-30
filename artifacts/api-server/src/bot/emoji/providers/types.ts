// ─────────────────────────────────────────────────────────────────────────────
// Provider interface.
//
// A provider turns an image plus a set of options into a generated emoji. The
// /emoji command talks only to this interface, so where the generation actually
// happens — MakeEmoji's backend, a headless browser driving their editor, or a
// local renderer — is a deployment decision rather than something baked into the
// command.
//
// Providers must not throw raw errors: everything a caller sees is an EmojiError
// with a user-safe message, so the command layer never has to interpret a
// provider's internals.
// ─────────────────────────────────────────────────────────────────────────────

import type { GenerateOptions, GenerateResult } from "../types.js";

/** Why a provider can't currently serve requests. */
export interface ProviderUnavailable {
  available: false;
  /** Operator-facing explanation — what is missing and how to fix it. */
  reason: string;
}

export interface ProviderAvailable {
  available: true;
}

export type ProviderStatus = ProviderAvailable | ProviderUnavailable;

export interface EmojiProvider {
  /** Stable identifier, used in logs, cache keys and operator config. */
  readonly id: string;

  /** Human-readable name for status output. */
  readonly name: string;

  /**
   * Whether this provider can run right now.
   *
   * Checked before a generate attempt so an unconfigured provider is skipped
   * with a logged reason rather than failing mid-request. Cheap and side-effect
   * free — no network calls.
   */
  status(): Promise<ProviderStatus>;

  /** Generate an emoji. Throws EmojiError on failure. */
  generate(options: GenerateOptions): Promise<GenerateResult>;

  /**
   * Release anything long-lived (a browser, a pool). Called on shutdown; must be
   * safe to call when nothing was ever started.
   */
  dispose?(): Promise<void>;
}
