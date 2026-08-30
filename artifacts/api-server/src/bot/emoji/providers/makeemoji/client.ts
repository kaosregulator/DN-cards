// ─────────────────────────────────────────────────────────────────────────────
// MakeEmoji provider.
//
// The single object the rest of the bot talks to. It owns the routing decision —
// direct HTTP when discovery confirmed an endpoint, the browser otherwise — plus
// the retry policy and the option validation that keeps bad requests from ever
// reaching the site.
//
//   generate()
//     ├─ validate options against the manifest   (reject unknown values here)
//     ├─ api path      if manifest.api is confirmed
//     └─ browser path  otherwise
//
// The provider refuses to run at all against an unverified manifest. That is the
// design's whole point: rather than sending guessed requests at a live site, it
// says exactly what is missing and how to produce it.
// ─────────────────────────────────────────────────────────────────────────────

import { logger } from "../../../../lib/logger.js";
import { EmojiError, isRetryable } from "../../utils/errors.js";
import type { GenerateOptions, GenerateResult } from "../../types.js";
import type { EmojiProvider, ProviderStatus } from "../types.js";
import { generateViaApi, apiProblem } from "./api.js";
import { browserPathProblem, generateViaBrowser } from "./browser.js";
import { getManifest, manifestProblem, resolveValue, valuesFor } from "./manifest.js";
import { browserProblem } from "./runtime.js";
import type { Manifest, OptionKey } from "./types.js";

/** One retry: a transient hiccup is worth a second go, a broken request isn't. */
const MAX_ATTEMPTS = 2;
const RETRY_DELAY_MS = 1200;

/**
 * Reject option values MakeEmoji doesn't offer, before any request is made.
 *
 * Catching it here means the user gets a precise message naming the valid
 * values, instead of the site silently ignoring the setting and returning
 * something that isn't what they asked for.
 */
function validate(manifest: Manifest, options: GenerateOptions): void {
  const checks: [OptionKey, string | undefined][] = [
    ["animation", options.animation],
    ["speed", options.speed],
    ["direction", options.direction],
    ["color", options.color],
    ["format", options.format],
    ["quality", options.quality],
    ["platform", options.platform],
  ];

  for (const [key, raw] of checks) {
    if (raw === undefined) continue;
    const control = manifest.controls[key];
    // An option this manifest knows nothing about is passed through untouched:
    // the browser path simply won't set it, and MakeEmoji's default applies.
    if (!control || control.values.length === 0) continue;
    // Free-text and slider controls accept values outside any enumerated list.
    if (control.kind === "text" || control.kind === "range") continue;

    if (resolveValue(manifest, key, raw) === null) {
      const valid = valuesFor(manifest, key).slice(0, 25).join(", ");
      throw new EmojiError(
        "unknown_option",
        `\`${raw}\` isn't a ${key} the emoji service offers. Try: ${valid}`,
      );
    }
  }
}

export class MakeEmojiProvider implements EmojiProvider {
  readonly id = "makeemoji";
  readonly name = "MakeEmoji.com";

  async status(): Promise<ProviderStatus> {
    const { manifest, problem } = getManifest();
    if (problem) return { available: false, reason: problem };

    const usability = manifestProblem(manifest);
    if (usability) return { available: false, reason: usability };

    // A confirmed endpoint needs nothing else installed.
    if (!apiProblem(manifest)) return { available: true };

    // Otherwise the browser stack has to be present and configured.
    const browserMissing = await browserProblem();
    if (browserMissing) return { available: false, reason: browserMissing };

    const pathProblem = browserPathProblem(manifest);
    if (pathProblem) return { available: false, reason: pathProblem };

    return { available: true };
  }

  async generate(options: GenerateOptions): Promise<GenerateResult> {
    const { manifest, problem } = getManifest();

    if (problem || !manifest) {
      logger.error({ problem }, "MakeEmoji provider has no usable manifest");
      throw new EmojiError(
        "provider_unavailable",
        "The emoji generator isn't set up on this server yet. An admin needs to run discovery first.",
      );
    }

    const usability = manifestProblem(manifest);
    if (usability) {
      logger.error({ problem: usability }, "MakeEmoji manifest is not usable");
      throw new EmojiError(
        "provider_unavailable",
        "The emoji generator isn't set up on this server yet. An admin needs to run discovery first.",
      );
    }

    validate(manifest, options);

    const useApi = apiProblem(manifest) === null;
    let lastError: unknown;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        const result = useApi
          ? await generateViaApi(manifest, options)
          : await generateViaBrowser(manifest, options);
        logger.info(
          { provider: result.providerId, animation: options.animation, format: options.format,
            bytes: result.bytes, durationMs: result.durationMs, attempt },
          "emoji generated",
        );
        return result;
      } catch (err) {
        lastError = err;
        // Only transient failures are worth repeating; a rejected option or a
        // changed site will fail identically however many times we ask.
        if (attempt >= MAX_ATTEMPTS || !isRetryable(err)) break;
        logger.warn(
          { attempt, err: err instanceof Error ? err.message : String(err) },
          "emoji generation failed, retrying",
        );
        await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS));
      }
    }

    throw lastError instanceof EmojiError
      ? lastError
      : new EmojiError("generation_failed", "Couldn't build that emoji. Please try again.");
  }
}

export const makeEmojiProvider = new MakeEmojiProvider();
