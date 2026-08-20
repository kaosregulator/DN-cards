// Brightness — a single global overlay that dims or brightens the whole game
// (not a day/night tint, just a dim ↔ bright feel). 0 = darkest, 0.5 = normal,
// 1 = brightest. Persisted to localStorage and applied across every scene.

const KEY = "dn.brightness";
let value = 0.5;
let overlay: HTMLDivElement | null = null;

function ensureOverlay(): HTMLDivElement {
  if (overlay) return overlay;
  const el = document.createElement("div");
  el.id = "dn-brightness";
  // Sits above the game canvas + HUD but below the settings panel (z 60), and
  // never eats input.
  el.style.cssText =
    "position:fixed;inset:0;pointer-events:none;z-index:40;transition:background .12s;";
  document.body.appendChild(el);
  overlay = el;
  return el;
}

function render(): void {
  const el = ensureOverlay();
  if (value < 0.5) {
    // Dim: black veil, up to ~0.6 at the darkest.
    el.style.background = `rgba(0,0,0,${((0.5 - value) * 1.2).toFixed(3)})`;
  } else if (value > 0.5) {
    // Bright: soft white wash, up to ~0.32 at the brightest.
    el.style.background = `rgba(255,255,255,${((value - 0.5) * 0.64).toFixed(3)})`;
  } else {
    el.style.background = "transparent";
  }
}

/** Load the saved brightness and apply it. Call once at startup. */
export function initBrightness(): void {
  const stored = Number(localStorage.getItem(KEY));
  if (!Number.isNaN(stored) && stored >= 0 && stored <= 1) value = stored;
  render();
}

export function getBrightness(): number {
  return value;
}

export function setBrightness(v: number): void {
  value = Math.max(0, Math.min(1, v));
  try { localStorage.setItem(KEY, String(value)); } catch { /* private mode */ }
  render();
}
