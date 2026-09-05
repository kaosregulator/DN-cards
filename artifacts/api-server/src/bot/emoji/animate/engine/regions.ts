// ─────────────────────────────────────────────────────────────────────────────
// Region anchors and influence envelopes.
//
// The engine has NO face detector, and the target is usually not a face — it's a
// meme, a photo, an animal, a gem. So a "region" is only a default vertical
// anchor plus a smooth falloff: a bump centred at `y` with width `spread`. A
// track's warp is multiplied by this envelope per image row, so "mouth" motion
// concentrates in the lower-middle band and fades out elsewhere instead of
// warping the whole image. A recipe can slide any anchor (see Recipe.anchors),
// which is what lets several candidates try the same motion at different heights
// so at least one lands on a subject whose "face" (if any) isn't where a
// smiley's would be.
// ─────────────────────────────────────────────────────────────────────────────

import type { Region } from "../types.js";

export interface Anchor {
  /** Band centre, 0 = top … 1 = bottom of the subject box. */
  y: number;
  /** Band width as a fraction of height (full-width-ish at ~2σ). */
  spread: number;
}

/** Default anchors. `global`/`effect` cover the whole subject (handled apart). */
export const DEFAULT_ANCHORS: Record<Exclude<Region, "global" | "effect">, Anchor> = {
  brows: { y: 0.32, spread: 0.16 },
  eyes: { y: 0.44, spread: 0.22 },
  cheeks: { y: 0.6, spread: 0.3 },
  mouth: { y: 0.7, spread: 0.26 },
};

/**
 * Envelope weight (0–1) for image row `yFrac` under `anchor`. Gaussian bump; σ is
 * half the spread so the band is ~full-strength across `spread` and tapers out.
 */
export function envelope(yFrac: number, anchor: Anchor): number {
  const sigma = Math.max(0.04, anchor.spread / 2);
  const d = (yFrac - anchor.y) / sigma;
  return Math.exp(-0.5 * d * d);
}
