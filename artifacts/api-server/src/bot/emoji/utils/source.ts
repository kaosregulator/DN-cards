// ─────────────────────────────────────────────────────────────────────────────
// Source acquisition — turning "what the user gave us" into clean image bytes.
//
// Everything that reaches this system comes from outside: a Discord attachment,
// an avatar, or a URL a user typed. So every step here is defensive — the URL is
// validated before it is fetched, the fetch is bounded in both time and bytes,
// and the result is normalised to a predictable PNG before it ever reaches the
// renderer.
// ─────────────────────────────────────────────────────────────────────────────

import sharp from "sharp";
import { EmojiError } from "./errors.js";

/** Hard cap on a source download. Comfortably above any Discord avatar. */
export const MAX_SOURCE_BYTES = 8 * 1024 * 1024;

/** Fetch budget. Generous enough for a slow CDN, short enough to stay snappy. */
const FETCH_TIMEOUT_MS = 8_000;

/**
 * Longest edge the source is reduced to before rendering. Emoji output tops out
 * at 128px, so anything beyond ~2× that is detail the encoder would throw away —
 * downscaling first makes every later per-pixel pass cheaper.
 */
const SOURCE_MAX_EDGE = 320;

/**
 * Reject URLs that aren't public http(s). This is the SSRF guard: without it a
 * user could point the bot at internal infrastructure and use the rendered emoji
 * as a read oracle. Hostname checks are best-effort (DNS can still resolve a
 * public name inward), but they block the direct attempts cheaply.
 */
export function assertPublicHttpUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new EmojiError("bad_url", "That doesn't look like a valid URL.");
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new EmojiError("bad_url", "Image links must start with `http://` or `https://`.");
  }

  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  const isPrivate =
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".internal") ||
    host.endsWith(".local") ||
    host === "::1" ||
    /^127\./.test(host) ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^169\.254\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
    /^f[cd][0-9a-f]{2}:/i.test(host);

  if (isPrivate) {
    throw new EmojiError("bad_url", "That URL isn't reachable. Use a public image link.");
  }

  return url;
}

/** Download image bytes, bounded by both a timeout and a byte cap. */
export async function fetchImageBytes(rawUrl: string): Promise<Buffer> {
  const url = assertPublicHttpUrl(rawUrl);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const res = await fetch(url, { signal: controller.signal, redirect: "follow" });
    if (!res.ok) {
      throw new EmojiError("fetch_failed", `Couldn't download that image (HTTP ${res.status}).`);
    }

    // Trust the advertised length when it's present — this rejects an oversized
    // file before a single byte of it is buffered.
    const declared = Number(res.headers.get("content-length") ?? NaN);
    if (Number.isFinite(declared) && declared > MAX_SOURCE_BYTES) {
      throw new EmojiError("too_large", "That image is too large. Keep it under 8 MB.");
    }

    const buf = Buffer.from(await res.arrayBuffer());
    // Re-check after the fact: content-length is a hint, not a guarantee, and a
    // chunked response doesn't send one at all.
    if (buf.length > MAX_SOURCE_BYTES) {
      throw new EmojiError("too_large", "That image is too large. Keep it under 8 MB.");
    }
    if (buf.length === 0) {
      throw new EmojiError("not_an_image", "That link returned an empty file.");
    }
    return buf;
  } catch (err) {
    if (err instanceof EmojiError) throw err;
    if (err instanceof Error && err.name === "AbortError") {
      throw new EmojiError("fetch_failed", "That image took too long to download.");
    }
    throw new EmojiError("fetch_failed", "Couldn't download that image.");
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Normalise arbitrary image bytes into a predictable RGBA PNG.
 *
 * This is what lets the renderer stay simple: whatever arrives — JPEG without an
 * alpha channel, an animated GIF, a huge PNG, a WebP — the compositor always
 * receives a single still frame with an alpha channel, already scaled down.
 */
export async function normalizeSource(bytes: Buffer): Promise<Buffer> {
  try {
    const pipeline = sharp(bytes, { animated: false });

    // Rotate the image upright from its EXIF orientation tag before anything
    // else, so a phone photo doesn't render sideways. `autoOrient` is one of the
    // members sharp's shipped declarations lose under this project's module
    // resolution (the same lossy-typing gap animations/engine.ts documents for
    // the canvas context); it exists at runtime, so we name it explicitly.
    const oriented = (pipeline as unknown as { autoOrient(): typeof pipeline }).autoOrient();

    return await oriented
      .resize({
        width: SOURCE_MAX_EDGE,
        height: SOURCE_MAX_EDGE,
        fit: "inside",
        withoutEnlargement: true,     // never invent detail that wasn't there
      })
      .ensureAlpha()
      .png()
      .toBuffer();
  } catch {
    throw new EmojiError(
      "not_an_image",
      "That file couldn't be read as an image. Try a PNG, JPG, WebP or GIF.",
    );
  }
}

/** Fetch and normalise in one step. */
export async function loadSource(url: string): Promise<Buffer> {
  return normalizeSource(await fetchImageBytes(url));
}
