// ─────────────────────────────────────────────────────────────────────────────
// Deterministic RNG.
//
// Online duels are lockstep: both clients build the SAME duel from the same
// setup and replay the same action stream. That only works if every random
// decision — deck shuffles above all — comes out identical on both machines, so
// the engine draws from this seeded generator instead of Math.random().
//
// mulberry32: tiny, fast, and good enough for shuffling a 40-card deck.
// ─────────────────────────────────────────────────────────────────────────────

export type Rng = () => number;

export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return function next(): number {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// The generator the engine currently draws from. Offline duels use the
// unseeded default (Math.random); createDuel() swaps in a seeded one when a
// seed is supplied, which is what online duels always do.
let current: Rng = Math.random;

export function setRng(rng: Rng): void { current = rng; }
export function setSeed(seed: number): void { current = mulberry32(seed); }
export function resetRng(): void { current = Math.random; }
export function rng(): number { return current(); }

/** Fisher-Yates using the active generator. */
export function shuffle<T>(arr: readonly T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

/** A fresh seed for a new online match. */
export function makeSeed(): number {
  return Math.floor(Math.random() * 0xffffffff) >>> 0;
}
