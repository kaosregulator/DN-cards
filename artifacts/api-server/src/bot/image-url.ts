import { publicBaseUrl } from "../lib/runtime-env.js";

/**
 * Convert a stored card imageUrl to an absolute URL suitable for Discord embeds.
 * Object-storage paths (`/objects/...`) are rewritten to the public serve URL.
 * Absolute URLs pass through unchanged.
 */
export function toAbsoluteImageUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  if (/^https?:\/\//i.test(url)) return url;
  if (url.startsWith("/objects/")) {
    const base = publicBaseUrl("");
    if (!base) return null;
    return `${base}/api/storage${url}`;
  }
  return null;
}

/**
 * Cheap, synchronous check: does this image URL look like an animated GIF?
 * True when the path ends in `.gif` (ignoring query/hash). This is the fast
 * fallback used at render time when the DB `isAnimated` flag isn't threaded
 * through a given code path.
 */
export function isGifUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  return /\.gif(\?|#|$)/i.test(url);
}

/**
 * True if a card should be treated as an animated GIF. Prefers the stored
 * `isAnimated` flag (byte-sniffed at create/edit), falling back to the URL
 * extension so existing cards and any un-flagged path still animate.
 */
export function isAnimatedCard(card: { isAnimated?: boolean | null; imageUrl?: string | null }): boolean {
  return card.isAnimated === true || isGifUrl(card.imageUrl);
}

/**
 * Best-effort detection of an animated-GIF image at card create/edit time.
 * Returns true fast on a `.gif` extension; otherwise sniffs the first bytes for
 * the GIF magic header (`GIF87a` / `GIF89a`). Any network/parse failure resolves
 * to the extension result — detection must never block or fail a card save.
 */
export async function detectAnimatedImage(url: string | null | undefined): Promise<boolean> {
  if (!url) return false;
  if (isGifUrl(url)) return true;
  const abs = toAbsoluteImageUrl(url);
  if (!abs) return false;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 4000);
    const res = await fetch(abs, { signal: controller.signal }).catch(() => null);
    clearTimeout(timer);
    if (!res || !res.ok) return false;
    const ct = res.headers.get("content-type")?.toLowerCase() ?? "";
    if (ct.includes("image/gif")) return true;
    const buf = Buffer.from(await res.arrayBuffer());
    const head = buf.subarray(0, 6).toString("ascii");
    return head === "GIF87a" || head === "GIF89a";
  } catch {
    return false;
  }
}
