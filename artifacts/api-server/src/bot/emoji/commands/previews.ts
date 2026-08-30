// ─────────────────────────────────────────────────────────────────────────────
// MakeEmoji prerendered style previews.
//
// MakeEmoji ships a default-cat preview per style on their CDN. Discord embeds
// can show those URLs directly, so the style browser can preview all ~473
// styles without regenerating the user's image for every page turn.
//
// Preview slug = the style's label with any direction suffix stripped
// (`orbit-three:➡️` → `orbit-three`). Some styles are GIF, some WebP only.
// ─────────────────────────────────────────────────────────────────────────────

const PREVIEW_BASE = "https://assets.makeemoji.com/prerendered/default-cat-preview";

/** In-process cache: slug → working URL, or null when neither extension exists. */
const cache = new Map<string, string | null>();

/** Strip a direction/emoji suffix (`name:➡️`) to the CDN asset slug. */
export function previewSlug(label: string): string {
  const colon = label.indexOf(":");
  return (colon >= 0 ? label.slice(0, colon) : label).trim();
}

function previewUrl(slug: string, ext: "gif" | "webp"): string {
  return `${PREVIEW_BASE}/${encodeURIComponent(slug)}.${ext}`;
}

/** Probe one URL with a real GET (CDN often rejects HEAD / bare clients). */
async function exists(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, {
      method: "GET",
      headers: {
        "User-Agent": "DN-Cards-EmojiPreview/1.0",
        Range: "bytes=0-0",
      },
      signal: AbortSignal.timeout(4_000),
    });
    return res.ok || res.status === 206;
  } catch {
    return false;
  }
}

/**
 * Resolve a Discord-embeddable preview URL for a style label, or null when the
 * CDN has no asset for it.
 */
export async function resolveStylePreviewUrl(label: string): Promise<string | null> {
  const slug = previewSlug(label);
  if (!slug) return null;

  if (cache.has(slug)) return cache.get(slug) ?? null;

  // GIF first — Discord animates it in embeds. Fall back to WebP (static styles).
  for (const ext of ["gif", "webp"] as const) {
    const url = previewUrl(slug, ext);
    if (await exists(url)) {
      cache.set(slug, url);
      return url;
    }
  }

  cache.set(slug, null);
  return null;
}

/** Best-effort synchronous guess used before the async probe returns. */
export function guessStylePreviewUrl(label: string): string {
  const slug = previewSlug(label) || "none";
  if (cache.has(slug) && cache.get(slug)) return cache.get(slug)!;
  // Most styles are GIF; `none` and a few static ones are WebP-only — the async
  // resolver corrects that on first focus.
  if (slug === "none") return previewUrl(slug, "webp");
  return previewUrl(slug, "gif");
}

/** Test helper — drop the probe cache. */
export function clearPreviewCache(): void {
  cache.clear();
}

/** Test helper — seed a known URL without probing. */
export function setPreviewCacheForTesting(label: string, url: string | null): void {
  cache.set(previewSlug(label), url);
}
