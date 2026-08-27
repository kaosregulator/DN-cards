// ─────────────────────────────────────────────────────────────────────────────
// Giphy search client for the /postmojidashboard command.
//
// The API key is read from GIPHY_API_KEY (deployment secret) — never hardcoded.
// The URL builder and the response parser are pure so they can be unit-tested
// without a network call; searchGifs() is the thin fetch wrapper on top.
// ─────────────────────────────────────────────────────────────────────────────

import { resolvedEnv } from "../../lib/runtime-env.js";

export interface GiphyGif {
  id: string;
  title: string;
  /** Small looping preview (downsized) — used for board thumbnails. */
  previewUrl: string;
  /** Full-size original GIF — used as the render source / green-screen input. */
  originalUrl: string;
  /** The gif's page on giphy.com (attribution / "source link"). */
  sourceUrl: string;
  width: number;
  height: number;
}

const GIPHY_SEARCH = "https://api.giphy.com/v1/gifs/search";

/** True when a Giphy key is configured for this deployment. */
export function giphyConfigured(): boolean {
  return !!resolvedEnv("GIPHY_API_KEY");
}

/** Clamp a requested result count into Giphy's sane range (and our board cap). */
export function clampLimit(n: number): number {
  if (!Number.isFinite(n)) return 5;
  return Math.max(1, Math.min(10, Math.floor(n)));
}

/**
 * Build a Giphy search URL. When `greenScreen` is set, the query is scoped to
 * green-screen / chroma-key content so results are actually keyable.
 */
export function buildSearchUrl(
  apiKey: string,
  query: string,
  opts: { limit?: number; greenScreen?: boolean; rating?: string } = {},
): string {
  const q = opts.greenScreen ? `${query} green screen` : query;
  const params = new URLSearchParams({
    api_key: apiKey,
    q: q.trim(),
    limit: String(clampLimit(opts.limit ?? 5)),
    rating: opts.rating ?? "pg-13",
    bundle: "messaging_non_clips",
  });
  return `${GIPHY_SEARCH}?${params.toString()}`;
}

interface GiphyImageVariant { url?: string; width?: string; height?: string }
interface GiphyRaw {
  id?: string;
  title?: string;
  url?: string;
  images?: {
    original?: GiphyImageVariant;
    downsized?: GiphyImageVariant;
    fixed_width?: GiphyImageVariant;
    fixed_height_small?: GiphyImageVariant;
  };
}

/** Parse a Giphy `/search` JSON body into our lightweight gif descriptors. */
export function parseGiphySearch(body: unknown): GiphyGif[] {
  const data = (body as { data?: unknown })?.data;
  if (!Array.isArray(data)) return [];
  const out: GiphyGif[] = [];
  for (const raw of data as GiphyRaw[]) {
    const imgs = raw.images ?? {};
    const original = imgs.original;
    const preview = imgs.fixed_width ?? imgs.downsized ?? imgs.fixed_height_small ?? original;
    const originalUrl = original?.url;
    if (!raw.id || !originalUrl) continue;
    out.push({
      id: raw.id,
      title: (raw.title || "GIF").trim() || "GIF",
      previewUrl: preview?.url ?? originalUrl,
      originalUrl,
      sourceUrl: raw.url ?? originalUrl,
      width: Number(original?.width ?? 0) || 0,
      height: Number(original?.height ?? 0) || 0,
    });
  }
  return out;
}

/**
 * Search Giphy. Returns [] when no key is configured or the request fails, so
 * callers can degrade gracefully with a "search unavailable" message.
 */
export async function searchGifs(
  query: string,
  opts: { limit?: number; greenScreen?: boolean } = {},
): Promise<GiphyGif[]> {
  const apiKey = resolvedEnv("GIPHY_API_KEY");
  if (!apiKey || !query.trim()) return [];
  try {
    const res = await fetch(buildSearchUrl(apiKey, query, opts), {
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return [];
    return parseGiphySearch(await res.json());
  } catch {
    return [];
  }
}
