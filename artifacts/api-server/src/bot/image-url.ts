/**
 * Convert a stored card imageUrl to an absolute URL suitable for Discord embeds.
 * Object-storage paths (`/objects/...`) are rewritten to the public serve URL on
 * the first REPLIT_DOMAINS host. Absolute URLs pass through unchanged.
 */
export function toAbsoluteImageUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  if (/^https?:\/\//i.test(url)) return url;
  if (url.startsWith("/objects/")) {
    const domain = process.env["REPLIT_DOMAINS"]?.split(",")[0]?.trim();
    if (!domain) return null;
    return `https://${domain}/api/storage${url}`;
  }
  return null;
}
