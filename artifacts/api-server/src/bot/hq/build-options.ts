// ─────────────────────────────────────────────────────────────────────────────
// HQ — /hqbuild slash-command option data.
//
// A LEAF module: it reads only the HQ registries, never the hub or the
// renderers. commands/register.ts runs at bot startup and is imported eagerly,
// so pulling the choices from here keeps the whole HQ command surface out of
// the startup path (and out of any import cycle with the hub).
//
// Adding a material or a wallpaper is therefore still a one-file data edit —
// the slash-command choices follow automatically.
// ─────────────────────────────────────────────────────────────────────────────

import { surfacesFor } from "./defs/surfaces.js";
import { HQ_WALLPAPERS } from "./defs/wallpapers.js";
import { HQ_ROOMS } from "./defs/rooms.js";
import { MAX_RECT_SPAN, MAX_ELEVATION, BASE_CANVAS_ID } from "./terrain.js";
import { HQ_GRID, HQ_BASE_GRID } from "./grid.js";

// Discord caps an option at 25 choices, so every list below is truncated.
const CHOICE_CAP = 25;

/** Materials offered as `material:` choices, outdoor first then indoor-only. */
export function buildMaterialChoices(): { name: string; value: string }[] {
  const seen = new Set<string>();
  const out: { name: string; value: string }[] = [];
  for (const s of [...surfacesFor("outdoor"), ...surfacesFor("indoor")]) {
    if (seen.has(s.id)) continue;
    seen.add(s.id);
    out.push({ name: `${s.name} (${s.kind})`.slice(0, 100), value: s.id });
  }
  return out.slice(0, CHOICE_CAP);
}

/** Wallpaper styles offered as `style:` choices. */
export function buildWallpaperChoices(): { name: string; value: string }[] {
  return HQ_WALLPAPERS.slice(0, CHOICE_CAP).map(w => ({ name: w.name.slice(0, 100), value: w.id }));
}

/** Canvases offered as `where:` choices — the grounds plus every room. */
export function buildCanvasChoices(): { name: string; value: string }[] {
  return [
    { name: "Base grounds (outdoor)", value: BASE_CANVAS_ID },
    ...HQ_ROOMS.slice(0, CHOICE_CAP - 1).map(r => ({ name: r.name.slice(0, 100), value: r.id })),
  ];
}

/** Option ranges. The real per-canvas bounds are enforced by placeTerrain; these
 * only shape the slider Discord shows. */
export const BUILD_LIMITS = {
  maxSpan: MAX_RECT_SPAN,
  maxLift: MAX_ELEVATION,
  maxCoord: Math.max(HQ_GRID, HQ_BASE_GRID) - 1,
} as const;
