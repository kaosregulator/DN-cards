// ─────────────────────────────────────────────────────────────────────────────
// Direct-HTTP path.
//
// Preferred over the browser when it works: one request instead of a Chromium
// launch. But it exists ONLY as a replay of a request discovery actually
// observed — the endpoint, its method, its field names and its response shape
// all come from the manifest's `api` block, which is written from recorded
// traffic and is null until then.
//
// There is deliberately no fallback endpoint, no "probable" path and no guessed
// parameter naming. If the manifest has no api block, this path reports itself
// unavailable and the browser path runs instead.
// ─────────────────────────────────────────────────────────────────────────────

import { logger } from "../../../../lib/logger.js";
import { EmojiError } from "../../utils/errors.js";
import type { GenerateOptions, GenerateResult } from "../../types.js";
import type { ApiSpec, Manifest, OptionKey } from "./types.js";
import { resolveValue } from "./manifest.js";

/**
 * Body shapes fetch accepts. Declared locally because this project compiles
 * without the DOM lib, where `BodyInit` would normally come from.
 */
type RequestBody = string | FormData | URLSearchParams | Uint8Array;

/** Budget for the whole upload+generate exchange. */
const REQUEST_TIMEOUT_MS = 45_000;

/** Cap on a downloaded result, mirroring the source cap. */
const MAX_RESULT_BYTES = 16 * 1024 * 1024;

/** Why the direct path can't run against this manifest, or null when it can. */
export function apiProblem(manifest: Manifest | null): string | null {
  if (!manifest?.api) {
    return "no generation endpoint has been confirmed from recorded traffic yet";
  }
  if (manifest.api.requiresBrowserSession) {
    return "the observed endpoint needed a browser-established session; using the browser path instead";
  }
  return null;
}

/** Read a dotted path out of a JSON response. */
function readPath(value: unknown, path: string): string | null {
  let current: unknown = value;
  for (const segment of path.split(".")) {
    if (current === null || typeof current !== "object") return null;
    current = (current as Record<string, unknown>)[segment];
  }
  return typeof current === "string" ? current : null;
}

/** Map our options onto the field names discovery recorded. */
function buildFields(spec: ApiSpec, manifest: Manifest, options: GenerateOptions): Map<string, string> {
  const fields = new Map<string, string>(Object.entries(spec.staticFields));

  const wanted: [OptionKey, string | undefined][] = [
    ["animation", options.animation],
    ["speed", options.speed],
    ["direction", options.direction],
    ["size", options.size],
    ["color", options.color],
    ["format", options.format],
    ["quality", options.quality],
    ["platform", options.platform],
  ];

  for (const [key, raw] of wanted) {
    const field = spec.fieldMap[key];
    // No recorded field name means the site never sent that option in the
    // request we saw. Skipping it leaves MakeEmoji's own default in place,
    // which is safer than inventing a parameter name it may reject.
    if (!field || raw === undefined) continue;
    fields.set(field, resolveValue(manifest, key, raw) ?? raw);
  }

  return fields;
}

export async function generateViaApi(
  manifest: Manifest, options: GenerateOptions,
): Promise<GenerateResult> {
  const spec = manifest.api;
  if (!spec) {
    throw new EmojiError("provider_unavailable", "The emoji generator isn't configured yet.");
  }

  const started = Date.now();
  const fields = buildFields(spec, manifest, options);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  // A caller-supplied signal (an interaction that went away) also cancels.
  const onAbort = () => controller.abort();
  options.signal?.addEventListener("abort", onAbort, { once: true });

  try {
    let body: RequestBody;
    const headers: Record<string, string> = { ...spec.headers };

    if (spec.kind === "multipart") {
      const form = new FormData();
      for (const [name, value] of fields) form.append(name, value);
      if (spec.imageField) {
        form.append(
          spec.imageField,
          // Uint8Array view rather than the Buffer itself: Blob copies the
          // exact byte range, and a pooled Buffer can otherwise contribute
          // neighbouring bytes from the allocator's slab.
          new Blob([new Uint8Array(options.image)], { type: "image/png" }),
          "source.png",
        );
      }
      body = form;
      // fetch sets the multipart boundary itself; a copied content-type header
      // from the recording would carry the wrong one and the server would
      // reject the body.
      delete headers["content-type"];
      delete headers["Content-Type"];
    } else if (spec.kind === "json") {
      const payload: Record<string, unknown> = Object.fromEntries(fields);
      if (spec.imageField) payload[spec.imageField] = options.image.toString("base64");
      body = JSON.stringify(payload);
      headers["content-type"] = "application/json";
    } else {
      const form = new URLSearchParams();
      for (const [name, value] of fields) form.set(name, value);
      if (spec.imageField) form.set(spec.imageField, options.image.toString("base64"));
      body = form.toString();
      headers["content-type"] = "application/x-www-form-urlencoded";
    }

    const response = await fetch(spec.url, {
      method: spec.method, headers, body, signal: controller.signal, redirect: "follow",
    });

    if (response.status === 429) {
      throw new EmojiError("rate_limited", "The emoji service is busy. Try again in a moment.");
    }
    if (!response.ok) {
      logger.warn({ status: response.status, url: spec.url }, "MakeEmoji API returned an error");
      throw new EmojiError("generation_failed", "The emoji service couldn't build that. Please try again.");
    }

    // Either the response IS the file, or it points at one.
    let buffer: Buffer;
    let sourceUrl: string | undefined;

    if (spec.resultPath === null) {
      buffer = Buffer.from(await response.arrayBuffer());
    } else {
      const json: unknown = await response.json();
      const url = readPath(json, spec.resultPath);
      if (!url) {
        logger.warn({ resultPath: spec.resultPath }, "MakeEmoji response had no result URL at the recorded path");
        throw new EmojiError("site_changed", "The emoji service replied in an unexpected way.");
      }
      sourceUrl = url;
      const file = await fetch(new URL(url, spec.url), { signal: controller.signal });
      if (!file.ok) {
        throw new EmojiError("generation_failed", "The finished emoji couldn't be downloaded.");
      }
      buffer = Buffer.from(await file.arrayBuffer());
    }

    if (buffer.length === 0) {
      throw new EmojiError("generation_failed", "The emoji service returned an empty file.");
    }
    if (buffer.length > MAX_RESULT_BYTES) {
      throw new EmojiError("too_big_to_send", "That emoji came out too large to upload.");
    }

    return {
      buffer,
      format: options.format,
      bytes: buffer.length,
      providerId: "makeemoji-api",
      durationMs: Date.now() - started,
      ...(sourceUrl ? { sourceUrl } : {}),
      cached: false,
    };
  } catch (err) {
    if (err instanceof EmojiError) throw err;
    if (err instanceof Error && err.name === "AbortError") {
      throw new EmojiError("timeout", "The emoji service took too long. Please try again.");
    }
    logger.warn({ err: (err as Error).message }, "MakeEmoji API request failed");
    throw new EmojiError("generation_failed", "Couldn't reach the emoji service. Please try again.");
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", onAbort);
  }
}
