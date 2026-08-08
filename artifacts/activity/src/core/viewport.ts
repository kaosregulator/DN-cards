// ─────────────────────────────────────────────────────────────────────────────
// Viewport awareness. Discord runs the Activity in wildly different frames —
// a wide desktop panel and a narrow phone in portrait or landscape. This module
// is the single source of truth for "how big / what input", and it tags <body>
// with classes the DOM HUD and CSS react to. It never touches game STATE — only
// presentation (camera, HUD sizing, affordances) adapts.
// ─────────────────────────────────────────────────────────────────────────────

export interface Viewport {
  w: number;
  h: number;
  /** Small = phone-ish; drives bigger touch targets + reflow. */
  small: boolean;
  /** Coarse pointer (finger). Not mutually exclusive with a mouse. */
  touch: boolean;
  portrait: boolean;
}

const SMALL_MAX = 820;

export function readViewport(): Viewport {
  const w = window.innerWidth;
  const h = window.innerHeight;
  const touch =
    (window.matchMedia?.("(pointer: coarse)").matches ?? false) ||
    "ontouchstart" in window ||
    navigator.maxTouchPoints > 0;
  return { w, h, small: Math.min(w, h) <= 640 || w <= SMALL_MAX, touch, portrait: h >= w };
}

let current = readViewport();
const listeners = new Set<(v: Viewport) => void>();

function apply(): void {
  current = readViewport();
  const b = document.body;
  b.classList.toggle("is-small", current.small);
  b.classList.toggle("is-touch", current.touch);
  b.classList.toggle("is-portrait", current.portrait);
  b.classList.toggle("is-landscape", !current.portrait);
  for (const fn of listeners) fn(current);
}

/** Call once at startup; wires resize/orientation listeners and stamps <body>. */
export function initViewport(): void {
  apply();
  window.addEventListener("resize", apply, { passive: true });
  window.addEventListener("orientationchange", apply, { passive: true });
}

export function getViewport(): Viewport {
  return current;
}

export function onViewportChange(fn: (v: Viewport) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
