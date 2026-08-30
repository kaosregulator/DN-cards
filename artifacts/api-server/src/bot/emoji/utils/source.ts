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

  if (isBlockedHost(host)) {
    throw new EmojiError("bad_url", "That URL isn't reachable. Use a public image link.");
  }

  return url;
}

/**
 * Hostnames that name a cloud instance-metadata service.
 *
 * These are the highest-value SSRF targets on a hosted bot: a single successful
 * fetch can return the instance's credentials. The link-local address ranges
 * below already cover the usual IPs, but the DNS names resolve there too and
 * would otherwise sail past an address-shaped check.
 */
const METADATA_HOSTS = new Set([
  "metadata.google.internal",
  "metadata.goog",
  "metadata",
  "instance-data",
  "169.254.169.254",
  "100.100.100.200",        // Alibaba Cloud
  "fd00:ec2::254",          // AWS IMDSv2 over IPv6
]);

/** True when a hostname is loopback, private, link-local or cloud metadata. */
export function isBlockedHost(rawHost: string): boolean {
  const host = rawHost.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");

  if (METADATA_HOSTS.has(host)) return true;

  // Internal-only namespaces, and bare single-label names that can only resolve
  // through a local search domain.
  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".internal") ||
    host.endsWith(".local") ||
    host.endsWith(".home.arpa") ||
    !host.includes(".") && !host.includes(":")
  ) return true;

  // IPv6 loopback, unspecified, and the unique-local / link-local ranges.
  if (host === "::1" || host === "::" || host === "0:0:0:0:0:0:0:1") return true;
  if (/^f[cd][0-9a-f]{2}:/i.test(host)) return true;   // fc00::/7 unique-local
  if (/^fe[89ab][0-9a-f]:/i.test(host)) return true;   // fe80::/10 link-local
  // IPv4-mapped IPv6 re-checked as IPv4. The WHATWG URL parser normalises
  // `::ffff:127.0.0.1` to the hex form `::ffff:7f00:1`, so the dotted spelling
  // never actually reaches here — both forms are decoded to be safe.
  const mappedDotted = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(host);
  if (mappedDotted?.[1]) return isBlockedHost(mappedDotted[1]);

  const mappedHex = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i.exec(host);
  if (mappedHex) {
    const high = parseInt(mappedHex[1]!, 16);
    const low = parseInt(mappedHex[2]!, 16);
    return isBlockedHost(
      `${high >> 8}.${high & 0xff}.${low >> 8}.${low & 0xff}`,
    );
  }

  // IPv4 ranges that are not publicly routable.
  const ipv4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (ipv4) {
    const [a, b] = [Number(ipv4[1]), Number(ipv4[2])];
    return (
      a === 0 ||                              // "this network"
      a === 127 ||                            // loopback
      a === 10 ||                             // RFC1918
      (a === 172 && b >= 16 && b <= 31) ||    // RFC1918
      (a === 192 && b === 168) ||             // RFC1918
      (a === 169 && b === 254) ||             // link-local, incl. metadata
      (a === 100 && b >= 64 && b <= 127) ||   // RFC6598 carrier-grade NAT
      (a === 192 && b === 0) ||               // IETF protocol assignments
      a >= 224                                // multicast and reserved
    );
  }

  return false;
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
