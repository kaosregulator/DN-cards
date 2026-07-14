// Operations Center — extract a dominant embed color from a thumbnail/banner URL.
// Uses node-vibrant (Node build). Results are cached per URL so repeated board
// refreshes don't re-download the same image.

import { Vibrant } from "node-vibrant/node";
import { logger } from "../../lib/logger.js";

const colorCache = new Map<string, number>();

function hexToDecimal(hex: string): number | null {
  const cleaned = hex.replace("#", "").trim();
  if (!/^[0-9a-fA-F]{6}$/.test(cleaned)) return null;
  const parsed = parseInt(cleaned, 16);
  return Number.isNaN(parsed) ? null : parsed;
}

/** Extract a dominant color from an image URL. Returns null on failure. */
export async function extractVibrantColor(imageUrl: string | null | undefined): Promise<number | null> {
  if (!imageUrl) return null;
  const cached = colorCache.get(imageUrl);
  if (cached != null) return cached;

  try {
    const palette = await Vibrant.from(imageUrl).getPalette();
    const swatch = palette.Vibrant ?? palette.Dominant ?? palette.Muted;
    if (!swatch) return null;
    const color = hexToDecimal(swatch.hex);
    if (color == null) return null;
    colorCache.set(imageUrl, color);
    return color;
  } catch (err) {
    logger.debug({ err, imageUrl }, "ops: vibrant color extraction failed");
    return null;
  }
}

/** Clear the cached color for a URL (useful when the image is changed). */
export function clearVibrantColorCache(imageUrl: string): void {
  colorCache.delete(imageUrl);
}
