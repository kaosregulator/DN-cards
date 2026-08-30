// ─────────────────────────────────────────────────────────────────────────────
// Loop-safe motion primitives.
//
// Every helper here takes a phase `t` in [0,1) and is periodic across it, so an
// effect built from them loops seamlessly: frame N-1 hands back to frame 0 with
// no visible jump. That property is what makes these safe as the only building
// blocks effect definitions are allowed to use for motion.
// ─────────────────────────────────────────────────────────────────────────────

export const TAU = Math.PI * 2;

/** Sine wave over one loop. Range [-1, 1], starts and ends at 0. */
export function wave(t: number, cycles = 1): number {
  return Math.sin(t * TAU * cycles);
}

/** Cosine wave over one loop. Range [-1, 1], starts and ends at 1. */
export function cwave(t: number, cycles = 1): number {
  return Math.cos(t * TAU * cycles);
}

/** Triangle wave over one loop. Range [0, 1], peaks at t=0.5. */
export function triangle(t: number, cycles = 1): number {
  const p = (t * cycles) % 1;
  return p < 0.5 ? p * 2 : 2 - p * 2;
}

/** Sawtooth over one loop. Range [0, 1), wraps hard back to 0. */
export function saw(t: number, cycles = 1): number {
  return (t * cycles) % 1;
}

/**
 * Bounce height over one loop: a ball thrown up that lands exactly at the seam.
 * Range [0, 1], 0 at t=0 and t=1.
 */
export function bounce(t: number, cycles = 1): number {
  return Math.abs(Math.sin(t * Math.PI * cycles));
}

/** Smooth 0→1→0 pulse with eased ends. Range [0, 1]. */
export function pulse(t: number, cycles = 1): number {
  return (1 - Math.cos(t * TAU * cycles)) / 2;
}

/** Ease-in-out over a 0..1 input. Not periodic — compose with triangle/saw. */
export function easeInOut(x: number): number {
  return x < 0.5 ? 2 * x * x : 1 - ((-2 * x + 2) ** 2) / 2;
}

/** Linear interpolation. */
export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Clamp to [lo, hi]. */
export function clamp(n: number, lo: number, hi: number): number {
  return n < lo ? lo : n > hi ? hi : n;
}

/**
 * Deterministic pseudo-random in [0,1) from an integer seed. Effects that want
 * jitter (glitch, sparkle) must stay identical across renders of the same
 * options, so they use this rather than Math.random.
 */
export function hashRandom(seed: number): number {
  let x = Math.imul(seed ^ 0x9e3779b9, 0x85ebca6b);
  x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35);
  return ((x ^ (x >>> 16)) >>> 0) / 4294967296;
}

/**
 * Double-thump envelope (lub-dub) over one loop. Range [0, 1].
 * Two decaying beats at t=0 and t≈0.32, flat after.
 */
export function heartbeat(t: number): number {
  const beat = (phase: number, width: number) => {
    const d = (t - phase + 1) % 1;
    return d < width ? Math.sin((d / width) * Math.PI) : 0;
  };
  return clamp(beat(0, 0.18) + beat(0.32, 0.14) * 0.7, 0, 1);
}
