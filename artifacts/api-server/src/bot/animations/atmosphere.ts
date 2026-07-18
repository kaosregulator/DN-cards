// ─────────────────────────────────────────────────────────────────────────────
// Atmosphere — reusable animated ARENA BACKGROUND particle system.
//
// A single declarative layer set — smoke, embers, ash, dust, fog, sparks, snow,
// rain, and heat shimmer — that composes ONTO an already-drawn background,
// strictly BEHIND the battle UI and cards. It never clears or reshapes the
// canvas: callers draw their background, call drawAtmosphere(), then draw the
// cards on top.
//
// Every layer is:
//   • SEEDED — same seed → same field, so a static single-frame render is stable
//     and a GIF's frames stay coherent (no popping between frames).
//   • PHASE-DRIVEN — an optional t ∈ [0,1] advances motion; particles WRAP so a
//     GIF loops seamlessly. Static renders pass a fixed t and read as "mid-drift".
//   • ORGANIC — drift/turbulence comes from simplex-noise (fog, smoke, heat,
//     dust) so movement curls instead of marching in straight lines.
//   • DENSITY-SCALABLE — a single `density` multiplier (plus the ARENA_PARTICLE_
//     SCALE env) thins every layer at once. Large raids auto-reduce via
//     densityForParticipants() so a crowded scene never spikes CPU.
//
// Built on the same seeded-RNG + hexToRgba helpers the rest of the animation
// system uses; no new heavy dependency beyond simplex-noise (pure JS).
// ─────────────────────────────────────────────────────────────────────────────

import { createNoise2D, createNoise3D } from "simplex-noise";
import { hexToRgba, type Ctx } from "./engine.js";
import { seededRng } from "./particles.js";

export type AtmosphereKind =
  | "smoke" | "embers" | "ash" | "dust" | "fog"
  | "sparks" | "snow" | "rain" | "heat";

export interface AtmosphereLayer {
  kind: AtmosphereKind;
  /** 0..1 relative strength — scales this layer's particle count + opacity. */
  intensity?: number;
  /** Optional tint override (hex int). Layers that ignore colour skip it. */
  color?: number;
}

export interface AtmosphereOpts {
  /** Stable seed — same seed renders the same field. */
  seed?: string | number;
  /** Animation phase 0..1. Particles wrap on t so GIFs loop. Default 0.32. */
  t?: number;
  /** Global density multiplier (large-raid reduction lives here). Default 1. */
  density?: number;
  /** Scene accent colour used by layers without an explicit per-layer colour. */
  color?: number;
}

// ── Density / performance ────────────────────────────────────────────────────
// One global lever, tunable without a redeploy. Everything a layer would draw is
// multiplied by resolveDensity() and hard-capped, so no scene can runaway.
const ENV_SCALE = (() => {
  const n = Number(process.env["ARENA_PARTICLE_SCALE"] ?? 1);
  return Number.isFinite(n) ? Math.max(0, Math.min(2, n)) : 1;
})();

/** Final density multiplier = env scale × caller density, clamped to [0, 2]. */
export function resolveDensity(density = 1): number {
  return Math.max(0, Math.min(2, ENV_SCALE * density));
}

/**
 * Auto-reduce density as a scene gets crowded (e.g. a big raid party). One or
 * two fighters render at full atmosphere; each extra body past the second thins
 * the field, with a floor so it never disappears entirely.
 *
 * Presentation-only: this scales PARTICLE COUNTS, never anything gameplay.
 */
export function densityForParticipants(participants: number): number {
  if (participants <= 2) return 1;
  // Lose ~12% per extra fighter beyond two, floored at 0.4.
  return Math.max(0.4, 1 - (participants - 2) * 0.12);
}

// A count helper: base × intensity × density, floored to an int, hard-capped.
function scaledCount(base: number, intensity: number, density: number, cap: number): number {
  return Math.min(cap, Math.max(0, Math.round(base * intensity * density)));
}

// Wrap a value into [0, span) — used so drifting particles re-enter the frame
// on the opposite edge instead of vanishing, giving a seamless GIF loop.
function wrap(v: number, span: number): number {
  const m = v % span;
  return m < 0 ? m + span : m;
}

// A seeded simplex field, memoised per seed so a multi-layer atmosphere shares
// one noise source (cheaper, and layers stay visually correlated).
const noiseCache = new Map<string, { n2: ReturnType<typeof createNoise2D>; n3: ReturnType<typeof createNoise3D> }>();
function noiseFor(seed: string) {
  let hit = noiseCache.get(seed);
  if (!hit) {
    const rng = seededRng(seed);
    const rand = () => rng.value();
    hit = { n2: createNoise2D(rand), n3: createNoise3D(rand) };
    if (noiseCache.size > 64) noiseCache.delete(noiseCache.keys().next().value as string);
    noiseCache.set(seed, hit);
  }
  return hit;
}

// ── LAYER DRAWERS ─────────────────────────────────────────────────────────────
// Each takes the ctx, frame size, resolved count/intensity/phase, a seeded RNG,
// the shared noise field, and an accent colour. All draws are additive and
// self-contained (save/restore), so order only affects visual stacking.

type LayerCtx = {
  ctx: Ctx;
  W: number;
  H: number;
  count: number;
  intensity: number;
  t: number;
  rng: ReturnType<typeof seededRng>;
  n2: ReturnType<typeof createNoise2D>;
  n3: ReturnType<typeof createNoise3D>;
  color: number;
};

// Soft dark smoke plumes drifting up and curling on the noise field.
function drawSmoke({ ctx, W, H, count, intensity, t, rng, n3, color }: LayerCtx): void {
  ctx.save();
  ctx.globalCompositeOperation = "source-over";
  for (let i = 0; i < count; i++) {
    const bx = rng.range(0, W);
    const by = rng.range(H * 0.25, H);
    const rise = t * H * 0.7;                       // upward drift over the phase
    const curl = n3(bx * 0.004, by * 0.004, t * 1.5) * 60 * intensity;
    const px = wrap(bx + curl, W);
    const py = wrap(by - rise, H);
    const r = rng.range(40, 110) * (0.7 + intensity * 0.6);
    const alpha = rng.range(0.04, 0.12) * intensity;
    const g = ctx.createRadialGradient(px, py, 0, px, py, r);
    g.addColorStop(0, hexToRgba(color, alpha));
    g.addColorStop(1, hexToRgba(color, 0));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(px, py, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

// Glowing embers rising with a lateral noise wobble — warm-scene staple.
function drawEmbersLayer({ ctx, W, H, count, intensity, t, rng, n2, color }: LayerCtx): void {
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  for (let i = 0; i < count; i++) {
    const seedX = rng.range(0, W);
    const speed = rng.range(0.5, 1.2);
    const py = wrap(H - t * H * speed - rng.range(0, H), H);
    const wobble = n2(seedX * 0.01, t * 2 + i) * 24 * intensity;
    const px = wrap(seedX + wobble, W);
    const r = rng.range(1.2, 3.6);
    const twinkle = 0.5 + 0.5 * Math.sin(t * Math.PI * 2 * speed + i);
    const alpha = rng.range(0.35, 0.85) * intensity * twinkle;
    ctx.fillStyle = hexToRgba(color, alpha);
    ctx.beginPath();
    ctx.arc(px, py, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

// Fine grey ash flakes settling downward, tumbling slowly.
function drawAsh({ ctx, W, H, count, intensity, t, rng, n2, color }: LayerCtx): void {
  ctx.save();
  for (let i = 0; i < count; i++) {
    const seedX = rng.range(0, W);
    const speed = rng.range(0.25, 0.6);
    const py = wrap(t * H * speed + rng.range(0, H), H);
    const sway = n2(seedX * 0.02, t + i) * 26 * intensity;
    const px = wrap(seedX + sway, W);
    const s = rng.range(1, 2.6);
    ctx.fillStyle = hexToRgba(color, rng.range(0.12, 0.34) * intensity);
    ctx.fillRect(px, py, s, s);
  }
  ctx.restore();
}

// Drifting dust motes — very soft, lit specks floating on the noise field.
function drawDust({ ctx, W, H, count, intensity, t, rng, n3, color }: LayerCtx): void {
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  for (let i = 0; i < count; i++) {
    const bx = rng.range(0, W);
    const by = rng.range(0, H);
    const dx = n3(bx * 0.003, by * 0.003, t) * 40 * intensity;
    const dy = n3(bx * 0.003 + 10, by * 0.003 + 10, t) * 24 * intensity;
    const px = wrap(bx + dx, W);
    const py = wrap(by + dy, H);
    const r = rng.range(0.8, 2.2);
    ctx.fillStyle = hexToRgba(color, rng.range(0.06, 0.2) * intensity);
    ctx.beginPath();
    ctx.arc(px, py, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

// Low rolling fog banks — a few big soft blobs sliding across on the noise field.
function drawFog({ ctx, W, H, count, intensity, t, rng, n3, color }: LayerCtx): void {
  ctx.save();
  for (let i = 0; i < count; i++) {
    const band = rng.range(0.45, 1);                 // fog hugs the lower arena
    const by = H * band;
    const drift = n3(i, t * 0.6, 0) * W * 0.4;
    const px = wrap(rng.range(0, W) + drift + t * W * 0.15, W);
    const rw = rng.range(W * 0.25, W * 0.55);
    const rh = rng.range(H * 0.12, H * 0.24);
    const alpha = rng.range(0.05, 0.12) * intensity;
    const g = ctx.createRadialGradient(px, by, 0, px, by, rw);
    g.addColorStop(0, hexToRgba(color, alpha));
    g.addColorStop(1, hexToRgba(color, 0));
    ctx.save();
    ctx.translate(px, by);
    ctx.scale(1, rh / rw);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(0, 0, rw, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
  ctx.restore();
}

// Bright drifting sparks with faint trails — energetic accent.
function drawSparksLayer({ ctx, W, H, count, intensity, t, rng, n2, color }: LayerCtx): void {
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  for (let i = 0; i < count; i++) {
    const seedX = rng.range(0, W);
    const speed = rng.range(0.6, 1.5);
    const py = wrap(H - t * H * speed - rng.range(0, H), H);
    const drift = n2(seedX * 0.01 + 5, t * 3 + i) * 40 * intensity;
    const px = wrap(seedX + drift, W);
    const len = rng.range(4, 12) * intensity;
    const alpha = rng.range(0.4, 0.9) * intensity;
    ctx.strokeStyle = hexToRgba(color, alpha);
    ctx.lineWidth = rng.range(1, 2);
    ctx.beginPath();
    ctx.moveTo(px, py);
    ctx.lineTo(px, py + len);
    ctx.stroke();
  }
  ctx.restore();
}

// Falling snow — soft white flakes with a gentle sideways sway.
function drawSnow({ ctx, W, H, count, intensity, t, rng, n2 }: LayerCtx): void {
  ctx.save();
  for (let i = 0; i < count; i++) {
    const seedX = rng.range(0, W);
    const speed = rng.range(0.3, 0.7);
    const py = wrap(t * H * speed + rng.range(0, H), H);
    const sway = n2(seedX * 0.02, t * 1.5 + i) * 30 * intensity + Math.sin(t * Math.PI * 2 + i) * 8;
    const px = wrap(seedX + sway, W);
    const r = rng.range(1.2, 3.4);
    ctx.fillStyle = hexToRgba(0xffffff, rng.range(0.3, 0.75) * intensity);
    ctx.beginPath();
    ctx.arc(px, py, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

// Rain streaks slanting down — dense thin lines.
function drawRain({ ctx, W, H, count, intensity, t, rng, color }: LayerCtx): void {
  ctx.save();
  const slant = 6;
  for (let i = 0; i < count; i++) {
    const seedX = rng.range(-slant * 10, W);
    const speed = rng.range(1.1, 1.8);
    const py = wrap(t * H * speed * 2 + rng.range(0, H), H);
    const px = wrap(seedX + t * slant * 8, W);
    const len = rng.range(10, 22);
    ctx.strokeStyle = hexToRgba(color, rng.range(0.12, 0.3) * intensity);
    ctx.lineWidth = rng.range(0.8, 1.6);
    ctx.beginPath();
    ctx.moveTo(px, py);
    ctx.lineTo(px - slant, py + len);
    ctx.stroke();
  }
  ctx.restore();
}

// Heat shimmer — horizontal translucent bands that ripple on the noise field,
// suggesting rising warm air low in the frame. Cheap fake of a refraction warp.
function drawHeat({ ctx, W, H, count, intensity, t, n2, color }: LayerCtx): void {
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  const bands = Math.max(3, count);
  for (let i = 0; i < bands; i++) {
    const by = H * (0.55 + (i / bands) * 0.45);
    const amp = (2 + n2(i, t * 4) * 4) * intensity;
    const alpha = 0.04 * intensity;
    ctx.strokeStyle = hexToRgba(color, alpha);
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let x = 0; x <= W; x += 12) {
      const y = by + Math.sin(x * 0.03 + t * Math.PI * 2 + i) * amp + n2(x * 0.01, t * 3 + i) * amp;
      if (x === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  ctx.restore();
}

// Per-kind base particle budgets (before intensity × density) + a hard cap so no
// single layer can spike, plus a sensible default tint when the caller gives none.
const LAYER_SPEC: Record<AtmosphereKind, { base: number; cap: number; tint: number; draw: (l: LayerCtx) => void }> = {
  smoke:  { base: 10, cap: 22,  tint: 0x2b2b2f, draw: drawSmoke },
  embers: { base: 46, cap: 90,  tint: 0xff7a1a, draw: drawEmbersLayer },
  ash:    { base: 70, cap: 140, tint: 0x9aa0aa, draw: drawAsh },
  dust:   { base: 60, cap: 120, tint: 0xd8c9a0, draw: drawDust },
  fog:    { base: 5,  cap: 12,  tint: 0x9fb0c0, draw: drawFog },
  sparks: { base: 34, cap: 72,  tint: 0xffd54a, draw: drawSparksLayer },
  snow:   { base: 80, cap: 160, tint: 0xffffff, draw: drawSnow },
  rain:   { base: 110, cap: 220, tint: 0xaecbff, draw: drawRain },
  heat:   { base: 7,  cap: 14,  tint: 0xffb060, draw: drawHeat },
};

// ── Public API ────────────────────────────────────────────────────────────────
/**
 * Draw a full atmosphere (an ordered list of layers) onto an already-painted
 * background, strictly behind whatever the caller draws next. Additive and
 * best-effort — any per-layer error is swallowed so atmosphere can never break a
 * render. Returns nothing; it only paints.
 */
export function drawAtmosphere(
  ctx: Ctx,
  width: number,
  height: number,
  layers: AtmosphereLayer[],
  opts: AtmosphereOpts = {},
): void {
  const density = resolveDensity(opts.density ?? 1);
  if (density <= 0 || layers.length === 0) return;
  const t = opts.t ?? 0.32;
  const seedBase = String(opts.seed ?? "arena");
  const accent = opts.color ?? 0xffb060;
  const { n2, n3 } = noiseFor(seedBase);

  layers.forEach((layer, idx) => {
    const spec = LAYER_SPEC[layer.kind];
    if (!spec) return;
    const intensity = Math.max(0, Math.min(1.5, layer.intensity ?? 1));
    const count = scaledCount(spec.base, intensity, density, spec.cap);
    if (count <= 0) return;
    // Each layer gets its own RNG stream so adding/removing one doesn't reshuffle
    // the others; the noise field stays shared for correlated drift.
    const rng = seededRng(`${seedBase}:${layer.kind}:${idx}`);
    try {
      spec.draw({
        ctx, W: width, H: height, count, intensity, t, rng, n2, n3,
        color: layer.color ?? (layer.kind === "embers" || layer.kind === "sparks" || layer.kind === "heat" ? accent : spec.tint),
      });
    } catch {
      // best-effort: a broken layer must never break the scene
    }
  });
}

// ── Presets ───────────────────────────────────────────────────────────────────
// Named atmospheres so callers don't hand-assemble layer lists. Tuned to read as
// SUBTLE — low intensities on purpose, so the arena has life without pulling
// focus from the cards in front.
export type AtmospherePreset =
  | "battlefield" | "storm" | "ember" | "snow" | "ash" | "arena" | "none";

const PRESETS: Record<AtmospherePreset, AtmosphereLayer[]> = {
  none: [],
  battlefield: [
    { kind: "fog", intensity: 0.5 },
    { kind: "dust", intensity: 0.6 },
    { kind: "sparks", intensity: 0.25 },
  ],
  storm: [
    { kind: "fog", intensity: 0.7 },
    { kind: "rain", intensity: 0.8 },
  ],
  ember: [
    { kind: "smoke", intensity: 0.6 },
    { kind: "heat", intensity: 0.7 },
    { kind: "embers", intensity: 0.8 },
  ],
  snow: [
    { kind: "fog", intensity: 0.5 },
    { kind: "snow", intensity: 0.9 },
  ],
  ash: [
    { kind: "smoke", intensity: 0.5 },
    { kind: "ash", intensity: 0.8 },
    { kind: "embers", intensity: 0.35 },
  ],
  // Generic "something's happening" wash for co-op boss scenes.
  arena: [
    { kind: "fog", intensity: 0.45 },
    { kind: "dust", intensity: 0.5 },
    { kind: "embers", intensity: 0.5 },
  ],
};

/** Resolve a preset name to its layer list (empty for unknown / "none"). */
export function atmospherePreset(name: AtmospherePreset | string | null | undefined): AtmosphereLayer[] {
  if (!name) return [];
  return PRESETS[name as AtmospherePreset] ?? [];
}

/**
 * Map a battle-image background KEY (see battle/image/theme.ts BACKGROUNDS) to a
 * fitting atmosphere preset, so the static battle renderer can add ambience that
 * matches whichever background is active — no per-call wiring.
 */
export function atmosphereForBackground(key: string | null | undefined): AtmosphereLayer[] {
  switch (key) {
    case "storm": return PRESETS.storm;
    case "ember": return PRESETS.ember;
    case "default":
    default: return PRESETS.battlefield;
  }
}

/** Convenience: draw a named preset in one call. */
export function drawAtmospherePreset(
  ctx: Ctx,
  width: number,
  height: number,
  preset: AtmospherePreset | string | null | undefined,
  opts: AtmosphereOpts = {},
): void {
  drawAtmosphere(ctx, width, height, atmospherePreset(preset), opts);
}
