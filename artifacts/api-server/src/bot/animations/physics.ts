// ─────────────────────────────────────────────────────────────────────────────
// Physics — matter-js VISUAL physics for canvas scenes.
//
// matter-js is used ONLY for visuals: debris scatter, explosions, card-impact
// shards, pack-wrapper tears, and physics-driven screen shake. It never touches
// battle logic — every function here just simulates a short burst and returns
// drawable transforms (or draws them), so the fight's outcome is decided
// elsewhere and this layer is pure presentation.
//
// How it stays deterministic (the whole animation system values stable, seeded
// renders): every body's initial position/velocity comes from a SEEDED RNG, the
// world is stepped with a FIXED timestep, gravity is constant, and body sleeping
// is disabled. matter-js's integrator is deterministic given identical initial
// state and no random forces, so the same seed → the same debris pose every
// time (a static frame is reproducible; a GIF advances smoothly by stepping to
// the frame's phase).
//
// Lazy-loaded like @napi-rs/canvas: if matter-js isn't installed the helpers
// no-op / return empty, and callers simply skip the physics accent — a scene is
// never broken by a missing dep.
// ─────────────────────────────────────────────────────────────────────────────

import type { Engine, Body } from "matter-js";
import { hexToRgba, type Ctx } from "./engine.js";
import { seededRng } from "./particles.js";
import { logger } from "../../lib/logger.js";

// ── Lazy matter-js module (cached) ────────────────────────────────────────────
type MatterMod = typeof import("matter-js");
let _matter: MatterMod | null | undefined;

async function getMatter(): Promise<MatterMod | null> {
  if (_matter !== undefined) return _matter;
  try {
    const mod = await import("matter-js");
    // matter-js ships as CJS with a default export; the named re-exports are not
    // reliable across bundlers, so always go through `.default`.
    _matter = (mod as unknown as { default?: MatterMod }).default ?? (mod as unknown as MatterMod);
  } catch (err) {
    logger.debug({ err }, "physics: matter-js not available — skipping physics accents");
    _matter = null;
  }
  return _matter;
}

/** Whether physics accents can render in this runtime (matter-js installed). */
export async function physicsAvailable(): Promise<boolean> {
  return (await getMatter()) !== null;
}

// A settled debris piece the caller draws however it likes.
export interface DebrisPiece {
  x: number;
  y: number;
  angle: number;
  size: number;
  color: number;
  alpha: number;
}

// Build a fresh, isolated engine. Sleeping off (keeps stepping deterministic and
// avoids bodies freezing mid-flight); gravity tunable per effect.
function makeEngine(M: MatterMod, gravityY: number): Engine {
  const engine = M.Engine.create();
  engine.gravity.y = gravityY;
  engine.gravity.x = 0;
  (engine as unknown as { enableSleeping: boolean }).enableSleeping = false;
  return engine;
}

// Step a world forward `steps` fixed ticks. 16.666ms ≈ 60Hz — matches matter's
// default and keeps integration stable.
function advance(M: MatterMod, engine: Engine, steps: number): void {
  for (let i = 0; i < steps; i++) M.Engine.update(engine, 1000 / 60);
}

// Clear a one-shot engine so its bodies/constraints are released promptly.
function disposeEngine(M: MatterMod, engine: Engine): void {
  try {
    M.World.clear(engine.world, false);
    M.Engine.clear(engine);
  } catch { /* best-effort */ }
}

export interface DebrisOpts {
  count?: number;         // bodies to launch (hard-capped for perf)
  color?: number;
  power?: number;         // initial outward speed
  spread?: number;        // upward bias (negative vy)
  gravity?: number;
  steps?: number;         // how far to advance (static pose vs mid-flight)
  seed?: string | number;
  size?: [number, number];
}

// Hard cap so a scene can never spawn an unbounded number of bodies.
const MAX_BODIES = 48;

/**
 * Simulate an outward debris burst from (x, y) and return the settled pieces.
 * Deterministic per seed. Returns [] if matter-js is unavailable.
 */
export async function simulateDebris(x: number, y: number, opts: DebrisOpts = {}): Promise<DebrisPiece[]> {
  const M = await getMatter();
  if (!M) return [];
  const {
    count = 18, color = 0xffaa33, power = 12, spread = 0.6,
    gravity = 1, steps = 14, seed = "debris", size = [3, 9],
  } = opts;
  const n = Math.min(MAX_BODIES, Math.max(0, count));
  if (n === 0) return [];
  const rng = seededRng(seed);
  const engine = makeEngine(M, gravity);
  const bodies: Body[] = [];
  try {
    for (let i = 0; i < n; i++) {
      const s = rng.range(size[0], size[1]);
      const body = M.Bodies.rectangle(x, y, s, s, {
        frictionAir: rng.range(0.01, 0.04),
        restitution: rng.range(0.2, 0.5),
        angle: rng.range(0, Math.PI),
      });
      // Radial launch with an upward bias so debris arcs like a real burst.
      const a = (i / n) * Math.PI * 2 + rng.range(-0.3, 0.3);
      const speed = power * rng.range(0.5, 1.2);
      M.Body.setVelocity(body, {
        x: Math.cos(a) * speed,
        y: Math.sin(a) * speed - spread * power,
      });
      M.Body.setAngularVelocity(body, rng.range(-0.3, 0.3));
      (body as unknown as { _dbgSize: number })._dbgSize = s;
      bodies.push(body);
    }
    M.Composite.add(engine.world, bodies);
    advance(M, engine, steps);
    return bodies.map((b) => ({
      x: b.position.x,
      y: b.position.y,
      angle: b.angle,
      size: (b as unknown as { _dbgSize: number })._dbgSize,
      color,
      alpha: 1,
    }));
  } catch (err) {
    logger.debug({ err }, "physics: simulateDebris failed");
    return [];
  } finally {
    disposeEngine(M, engine);
  }
}

/** Draw debris pieces as rotated shards. Additive, self-contained. */
export function drawDebris(ctx: Ctx, pieces: DebrisPiece[]): void {
  ctx.save();
  for (const p of pieces) {
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(p.angle);
    ctx.fillStyle = hexToRgba(p.color, p.alpha);
    ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size);
    ctx.restore();
  }
  ctx.restore();
}

/**
 * Convenience: simulate + draw a debris burst in one call (e.g. a crit impact or
 * a boss stomp). No-op when matter-js is unavailable.
 */
export async function drawImpactDebris(ctx: Ctx, x: number, y: number, opts: DebrisOpts = {}): Promise<void> {
  const pieces = await simulateDebris(x, y, opts);
  drawDebris(ctx, pieces);
}

// ── Screen shake (physics-driven) ─────────────────────────────────────────────
// A damped spring body kicked by an impulse, read back per frame. This gives an
// impact a real overshoot-and-settle wobble instead of a hand-tuned sine. Static
// callers pass a single phase; GIF callers pass the frame's t.
export interface ShakeOffset { dx: number; dy: number }

/**
 * Physics screen-shake displacement at phase `t` ∈ [0,1] for an impact of the
 * given `intensity` (pixels). Deterministic per seed. Falls back to a decaying
 * sine (still smooth) if matter-js is unavailable, so callers get an offset
 * either way.
 */
export async function physicsShake(intensity: number, t: number, seed: string | number = "shake"): Promise<ShakeOffset> {
  const M = await getMatter();
  const rng = seededRng(seed);
  const dir = rng.range(0, Math.PI * 2);
  if (!M) {
    // Graceful fallback: damped oscillation, no engine needed.
    const decay = Math.exp(-3.2 * t);
    const osc = Math.sin(t * Math.PI * 6);
    return { dx: Math.cos(dir) * intensity * decay * osc, dy: Math.sin(dir) * intensity * decay * osc };
  }
  // Spring a body back to origin after an initial impulse; step to phase t and
  // read its displacement. Bounded steps keep this cheap.
  const engine = makeEngine(M, 0);
  try {
    const body = M.Bodies.circle(0, 0, 4, { frictionAir: 0.18 });
    const anchor = M.Bodies.circle(0, 0, 2, { isStatic: true });
    const spring = M.Constraint.create({
      bodyA: anchor, bodyB: body, stiffness: 0.08, damping: 0.06, length: 0,
    });
    M.Composite.add(engine.world, [body, anchor, spring]);
    M.Body.setVelocity(body, { x: Math.cos(dir) * intensity, y: Math.sin(dir) * intensity });
    const steps = Math.max(1, Math.round(t * 30));
    advance(M, engine, steps);
    return { dx: body.position.x, dy: body.position.y };
  } catch (err) {
    logger.debug({ err }, "physics: physicsShake failed");
    return { dx: 0, dy: 0 };
  } finally {
    disposeEngine(M, engine);
  }
}

// ── Pack wrapper tear ─────────────────────────────────────────────────────────
// A torn wrapper fragment: a small quad that flies off and tumbles when the pack
// bursts open. Returned as transforms for the caller to fill (so the wrapper can
// match the pack's tier colour / texture).
export interface WrapperShard {
  x: number;
  y: number;
  angle: number;
  w: number;
  h: number;
  color: number;
  alpha: number;
}

export interface WrapperTearOpts {
  count?: number;
  color?: number;
  power?: number;
  gravity?: number;
  steps?: number;         // advance amount → how far the tear has flown
  seed?: string | number;
}

/**
 * Simulate a pack wrapper tearing apart into fragments that fly outward and fall.
 * `steps` (or the caller passing a phase-scaled value) controls how far along the
 * tear is. Deterministic per seed; [] when matter-js is unavailable.
 */
export async function simulateWrapperTear(
  cx: number, cy: number, w: number, h: number, opts: WrapperTearOpts = {},
): Promise<WrapperShard[]> {
  const M = await getMatter();
  if (!M) return [];
  const { count = 14, color = 0xd9a441, power = 9, gravity = 1.1, steps = 12, seed = "tear" } = opts;
  const n = Math.min(MAX_BODIES, Math.max(0, count));
  if (n === 0) return [];
  const rng = seededRng(seed);
  const engine = makeEngine(M, gravity);
  const bodies: Body[] = [];
  const dims: { w: number; h: number }[] = [];
  try {
    for (let i = 0; i < n; i++) {
      // Fragments start along the pack's outline so the tear reads as the wrapper
      // splitting, not a generic puff.
      const edge = rng.value();
      const px = cx + (edge < 0.5 ? rng.range(-w / 2, w / 2) : (rng.value() < 0.5 ? -w / 2 : w / 2));
      const py = cy + (edge < 0.5 ? (rng.value() < 0.5 ? -h / 2 : h / 2) : rng.range(-h / 2, h / 2));
      const fw = rng.range(w * 0.08, w * 0.2);
      const fh = rng.range(h * 0.05, h * 0.14);
      const body = M.Bodies.rectangle(px, py, fw, fh, {
        frictionAir: rng.range(0.01, 0.03),
        restitution: 0.3,
        angle: rng.range(0, Math.PI),
      });
      // Launch away from centre (outward + a little up).
      const a = Math.atan2(py - cy, px - cx) + rng.range(-0.4, 0.4);
      const speed = power * rng.range(0.6, 1.2);
      M.Body.setVelocity(body, { x: Math.cos(a) * speed, y: Math.sin(a) * speed - power * 0.35 });
      M.Body.setAngularVelocity(body, rng.range(-0.4, 0.4));
      bodies.push(body);
      dims.push({ w: fw, h: fh });
    }
    M.Composite.add(engine.world, bodies);
    advance(M, engine, steps);
    return bodies.map((b, i) => ({
      x: b.position.x,
      y: b.position.y,
      angle: b.angle,
      w: dims[i]!.w,
      h: dims[i]!.h,
      color,
      alpha: 1,
    }));
  } catch (err) {
    logger.debug({ err }, "physics: simulateWrapperTear failed");
    return [];
  } finally {
    disposeEngine(M, engine);
  }
}

/** Draw wrapper shards as rotated rectangles with a subtle inner highlight. */
export function drawWrapperShards(ctx: Ctx, shards: WrapperShard[]): void {
  ctx.save();
  for (const s of shards) {
    ctx.save();
    ctx.translate(s.x, s.y);
    ctx.rotate(s.angle);
    ctx.fillStyle = hexToRgba(s.color, s.alpha);
    ctx.fillRect(-s.w / 2, -s.h / 2, s.w, s.h);
    ctx.fillStyle = hexToRgba(0xffffff, s.alpha * 0.25);
    ctx.fillRect(-s.w / 2, -s.h / 2, s.w, s.h * 0.3);
    ctx.restore();
  }
  ctx.restore();
}
