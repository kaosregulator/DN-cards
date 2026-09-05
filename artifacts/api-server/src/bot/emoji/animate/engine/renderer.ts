// ─────────────────────────────────────────────────────────────────────────────
// Renderer seam.
//
// A recipe describes motion abstractly; a Renderer turns (target image + recipe)
// into a finished animated GIF. The default is the CPU canvas compositor in this
// package, but the contract is deliberately narrow and swappable so a future
// backend — a GPU service, a Follow-Your-Emoji reenactment worker — can be
// dropped in behind the SAME planner, cache and command without touching any of
// them. That is the "future-proof" part: only this one function changes.
//
// Whatever the backend, the input is the USER'S OWN image plus motion data; the
// output animates that image. No Noto artwork is required at render time.
// ─────────────────────────────────────────────────────────────────────────────

import type { Features, Recipe } from "../types.js";

export interface AnimationRenderer {
  /** Stable id, surfaced in logs and on the result so a fallback is visible. */
  readonly id: string;
  /**
   * Produce the frames for one recipe over one target image. `features` is the
   * target's detected geometry, computed once per target and passed in so it is
   * not re-detected per recipe; a backend may ignore it and detect its own way.
   */
  renderFrames(image: Buffer, recipe: Recipe, size: number, features?: Features): Promise<Uint8ClampedArray[]>;
}

let active: AnimationRenderer | null = null;

/** Install a renderer (e.g. a GPU backend). The default is set lazily below. */
export function setRenderer(renderer: AnimationRenderer): void {
  active = renderer;
}

export function getRenderer(): AnimationRenderer {
  if (!active) throw new Error("animate: no renderer installed");
  return active;
}

export function hasRenderer(): boolean {
  return active !== null;
}
