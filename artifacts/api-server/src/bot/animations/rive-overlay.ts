// ─────────────────────────────────────────────────────────────────────────────
// Rive overlay seam (server-side) — a future-proofing extension point.
//
// Rive (.riv state machines) is a REAL-TIME, GPU/DOM runtime: `@rive-app/canvas`
// needs a browser `document` + canvas, and `@rive-app/canvas-advanced` needs a
// WebGL/WASM surface. Neither renders inside a headless Node GIF pipeline as-is
// (it throws "document is not defined"), so the siege battlefield ships as pure
// Konva + sprite animation — which DOES run headless — and Rive lives where it
// belongs: the web Activity (see artifacts/activity/src/scenes/play/riveOverlay).
//
// This module is the SEAM that lets a `.riv`-powered flourish (a signature-move
// burst, an ultimate cut-in) drop into the server-rendered battlefield later,
// without touching siege-field.ts, once either:
//   • a headless GL runner (e.g. `@rive-app/canvas-advanced` + a `gl` context)
//     is wired up to rasterise `.riv` frames, or
//   • the pack ships pre-baked `.riv → PNG-sequence/GIF` overlays.
//
// Today it resolves nothing (no `.riv` assets exist — the HQ pack is all PNG
// sprite sheets), so callers get `null` and skip the overlay. That is deliberate:
// the seam exists, the wiring is documented, and turning it on is a drop-in.
// ─────────────────────────────────────────────────────────────────────────────

import { spriteForPrefix } from "../hq/assets.js";

/** A move/outcome that could trigger a signature `.riv` overlay. */
export type RiveOverlayCue = "attack" | "crit" | "special" | "ultimate" | "ko";

export interface RiveOverlayRequest {
  cue: RiveOverlayCue;
  /** Where the burst should centre, in battlefield logical coordinates. */
  x: number;
  y: number;
  /** Tint hint (rarity/accent colour) for a themed state machine input. */
  color: number;
}

/**
 * Resolve a baked `.riv` overlay asset for a cue, if the art pack provides one.
 * Convention: `assets/hq/riv/<cue>.riv`. Returns an absolute path or null.
 *
 * A server-side rasteriser is NOT wired yet, so `renderSiegeField` does not call
 * this on the hot path — it is the published contract a future headless-Rive (or
 * pre-baked-sequence) implementation fills in. Kept tiny and dependency-free so
 * it never affects the shipping render.
 */
export function resolveRivOverlay(cue: RiveOverlayCue): string | null {
  return spriteForPrefix("riv", cue);
}

/** True once any `.riv` overlay art is present — gates future overlay features. */
export function hasRivOverlays(): boolean {
  return (["attack", "crit", "special", "ultimate", "ko"] as RiveOverlayCue[])
    .some((c) => resolveRivOverlay(c) !== null);
}
