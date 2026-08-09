// ─────────────────────────────────────────────────────────────────────────────
// HQ siege — the zoomed-in "Clash" battlefield.
//
// This is the bottom embed of a live siege: a real, move-for-move arena where
// the two active cards stand on peg podiums with their art floating above them,
// and the acting side DASHES forward and strikes while the target recoils. It's
// the siege analogue of a `/battle` turn frame, but staged as a face-off on a
// dedicated battlefield instead of over the castle.
//
// Rendering is a Konva scene-graph composited per frame and encoded to a GIF —
// Konva is the leaf renderer here (uses the `canvas`/cairo backend), so it is
// funnelled through the shared render queue like every other heavy canvas job.
// Everything is best-effort: a missing native lib, a stalled card image or an
// oversized encode all resolve to `null`, and the caller silently keeps the old
// static frame. A siege must never break because a picture failed.
//
// Assets come from the SAME HQ art pack the base renderer uses (Kenney iso
// packs, extracted under assets/hq/…): a backdrop, a floor tile and the podium
// bases. `.riv` overlays can be layered on later via rive-overlay.ts — see that
// module — but the shipped battle is pure sprite + Konva so it runs headless.
// ─────────────────────────────────────────────────────────────────────────────

import { readFileSync } from "node:fs";
import GIFEncoder from "gifencoder";
import { spriteForPrefix } from "../hq/assets.js";
import { queueRender } from "./render-queue.js";
import { getRarityEffectColor } from "./effects.js";
import type { Rarity } from "../cards-data.js";
import type { AnimationSpeed, AnimationResult } from "./types.js";
import { logger } from "../../lib/logger.js";

// Lazily-typed module handles. Konva + canvas are native/externalised, so they
// are imported at call time and typed loosely — we only touch a small, stable
// slice of each API.
type KonvaMod = (typeof import("konva"))["default"];
type CanvasMod = typeof import("canvas");
type CanvasImage = Awaited<ReturnType<CanvasMod["loadImage"]>>;

let _konva: Promise<KonvaMod | null> | null = null;
let _canvasMod: Promise<CanvasMod | null> | null = null;
let _fontsReady = false;

async function loadKonva(): Promise<KonvaMod | null> {
  if (!_konva) {
    _konva = (async () => {
      try {
        // The backend side-effect import must run before the namespace is used;
        // it teaches Konva to draw onto a `canvas` (cairo) surface in Node.
        await import("konva/canvas-backend");
        const mod = await import("konva");
        return mod.default;
      } catch (err) {
        logger.debug({ err }, "siege-field: konva not available");
        return null;
      }
    })();
  }
  return _konva;
}

async function loadCanvasMod(): Promise<CanvasMod | null> {
  if (!_canvasMod) {
    _canvasMod = (async () => {
      try {
        return await import("canvas");
      } catch (err) {
        logger.debug({ err }, "siege-field: canvas backend not available");
        return null;
      }
    })();
  }
  return _canvasMod;
}

// Register the same display font the rest of the animation layer uses, once, so
// nameplates and damage numbers match the battle look. Best-effort — falls back
// to the platform sans if the files are missing.
function ensureFonts(mod: CanvasMod): void {
  if (_fontsReady) return;
  _fontsReady = true;
  try {
    const dir = new URL("../../../assets/fonts/", import.meta.url);
    mod.registerFont(new URL("Orbitron-Bold.ttf", dir).pathname, { family: "Orbitron" });
    mod.registerFont(new URL("Orbitron-Black.ttf", dir).pathname, { family: "Orbitron", weight: "900" });
  } catch (err) {
    logger.debug({ err }, "siege-field: font registration skipped");
  }
}

// ── Public input ─────────────────────────────────────────────────────────────

export interface SiegeFieldFighter {
  name: string;
  artUrl: string | null;
  rarity: string;
  rarityColor: number | null;   // custom tier colour override
  hp: number;                   // AFTER the move resolves
  maxHp: number;
  hpBefore?: number;            // BEFORE the move (drives the HP-drain animation)
  energy?: number;              // 0..100
  ultimate?: number;            // 0..100
}

// A non-active card in a side's column — drawn as a small standee lining up
// behind the active fighter, so the 1-v-1 gauntlet reads as a full roster.
export interface SiegeFieldBenchCard {
  artUrl: string | null;
  rarity: string;
  rarityColor: number | null;
  fallen: boolean;              // already KO'd (dim + ✗) vs still to step up
}

export interface SiegeFieldInput {
  attacker: SiegeFieldFighter;   // side 0 — stands on the LEFT
  defender: SiegeFieldFighter;   // side 1 — stands on the RIGHT
  actingSide: 0 | 1;             // who dashes and strikes this turn
  moveName: string;
  damage: number;
  isHit: boolean;
  isCrit: boolean;
  ko: boolean;                   // did the target fall?
  accent: number;                // siege accent colour
  turnLabel?: string | null;     // e.g. "Turn 4"
  backdropKey?: string | null;   // backdrop art key (castles/forest/desert/…)
  floorKey?: string | null;      // floor tile key (stone/marble/dirt/…)
  // The rest of each side's column, ordered "next to step up" first, then the
  // fallen — rendered as small standees behind the active fighter.
  attackerBench?: SiegeFieldBenchCard[];
  defenderBench?: SiegeFieldBenchCard[];
}

const FIELD = { width: 900, height: 470 } as const;
const MAX_BYTES = 8_000_000;
// Physical pixels per logical unit at encode time. GIF encoding (NeuQuant) costs
// scale with pixel COUNT, and it dominates a turn's render time — drawing stays
// at the full logical resolution (crisp art + text) while the encoded frame is
// shrunk to keep a turn snappy. 0.62 keeps the field comfortably above Discord's
// inline display width.
const RENDER_SCALE = 0.62;

function speedPlan(speed: AnimationSpeed): { frames: number; delay: number } {
  switch (speed) {
    case "fast": return { frames: 16, delay: 60 };
    case "slow": return { frames: 26, delay: 82 };
    default: return { frames: 22, delay: 70 };
  }
}

// ── Small maths helpers ──────────────────────────────────────────────────────
const clamp01 = (n: number) => (n < 0 ? 0 : n > 1 ? 1 : n);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
function easeInOut(x: number): number {
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
}
function easeOut(x: number): number { return 1 - Math.pow(1 - x, 3); }
// A 0→1→0 pulse peaking at `mid`, used for the lunge and impact windows.
function pulse(t: number, start: number, end: number): number {
  if (t <= start || t >= end) return 0;
  const p = (t - start) / (end - start);
  return Math.sin(p * Math.PI);
}
function hex(n: number): string {
  return `#${(n & 0xffffff).toString(16).padStart(6, "0")}`;
}
function fighterColor(f: SiegeFighterLike): number {
  return f.rarityColor ?? getRarityEffectColor(f.rarity as Rarity);
}
type SiegeFighterLike = { rarity: string; rarityColor: number | null };

// ── Image loading (shared, cached, timeout-guarded) ──────────────────────────
const imgCache = new Map<string, Promise<CanvasImage | null>>();

function loadSpritePath(mod: CanvasMod, path: string): Promise<CanvasImage | null> {
  const key = `f:${path}`;
  let p = imgCache.get(key);
  if (!p) {
    p = (async () => {
      try { return await mod.loadImage(readFileSync(path)); }
      catch (err) { logger.debug({ err, path }, "siege-field: sprite decode failed"); return null; }
    })();
    imgCache.set(key, p);
  }
  return p;
}

function loadArt(mod: CanvasMod, url: string | null): Promise<CanvasImage | null> {
  if (!url) return Promise.resolve(null);
  const key = `u:${url}`;
  let p = imgCache.get(key);
  if (!p) {
    p = (async () => {
      try {
        // Local paths / data URIs decode directly; remote art is fetched with a
        // hard timeout so a stalled CDN can never hang a render.
        if (!/^https?:/i.test(url)) return await mod.loadImage(url);
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 6000);
        try {
          const res = await fetch(url, { signal: ctrl.signal });
          if (!res.ok) return null;
          const buf = Buffer.from(await res.arrayBuffer());
          return await mod.loadImage(buf);
        } finally { clearTimeout(timer); }
      } catch (err) { logger.debug({ err, url }, "siege-field: art fetch failed"); return null; }
    })();
    imgCache.set(key, p);
    if (imgCache.size > 96) { const k = imgCache.keys().next().value; if (k !== undefined) imgCache.delete(k); }
  }
  return p;
}

function sprite(prefix: string, key: string): string | null {
  try { return spriteForPrefix(prefix, key); } catch { return null; }
}

// ── The renderer ─────────────────────────────────────────────────────────────

// Preload every image the scene needs once, up-front, so per-frame drawing is
// pure CPU. Shared by the animated GIF and the static still.
async function loadFieldAssets(cmod: CanvasMod, input: SiegeFieldInput): Promise<Assets> {
  const backdropPath = sprite("backdrop", input.backdropKey || "castles") ?? sprite("backdrop", "grass");
  const floorPath = sprite("floor", input.floorKey || "stone") ?? sprite("floor", "blue-stone");
  const atkBasePath = sprite("base", "round-stone-high") ?? sprite("base", "round-stone");
  const defBasePath = sprite("base", "round-wood-high") ?? sprite("base", "round-stone");
  const flashPath = sprite("fx", "flash01") ?? sprite("fx", "flash00");
  const smokePath = sprite("fx", "smoke00") ?? sprite("fx", "white-puff00");

  const benchCards = [...(input.attackerBench ?? []), ...(input.defenderBench ?? [])];
  const benchUrls = [...new Set(benchCards.map(c => c.artUrl).filter((u): u is string => !!u))];

  const [backdrop, floor, atkBase, defBase, flash, smoke, atkArt, defArt, ...benchLoaded] = await Promise.all([
    backdropPath ? loadSpritePath(cmod, backdropPath) : null,
    floorPath ? loadSpritePath(cmod, floorPath) : null,
    atkBasePath ? loadSpritePath(cmod, atkBasePath) : null,
    defBasePath ? loadSpritePath(cmod, defBasePath) : null,
    flashPath ? loadSpritePath(cmod, flashPath) : null,
    smokePath ? loadSpritePath(cmod, smokePath) : null,
    loadArt(cmod, input.attacker.artUrl),
    loadArt(cmod, input.defender.artUrl),
    ...benchUrls.map(u => loadArt(cmod, u)),
  ]);
  const benchImgs = new Map<string, CanvasImage | null>();
  benchUrls.forEach((u, i) => benchImgs.set(u, benchLoaded[i] ?? null));
  return { backdrop, floor, atkBase, defBase, flash, smoke, atkArt, defArt, benchImgs };
}

// The instant the still freezes on: just past the connect, so the strike flash,
// the slash and the damage number are all up — the move is unmistakable.
const STILL_T = 0.54;
// Stills are cheap (no encode), so render them larger/crisper than a GIF frame.
const STILL_SCALE = 0.85;

export async function renderSiegeField(
  input: SiegeFieldInput,
  speed: AnimationSpeed,
): Promise<AnimationResult | null> {
  return queueRender("siege-field", async () => {
    const Konva = await loadKonva();
    const cmod = await loadCanvasMod();
    if (!Konva || !cmod) return null;
    ensureFonts(cmod);

    try {
      const assets = await loadFieldAssets(cmod, input);
      const { frames, delay } = speedPlan(speed);

      const physW = Math.round(FIELD.width * RENDER_SCALE);
      const physH = Math.round(FIELD.height * RENDER_SCALE);
      const enc = new GIFEncoder(physW, physH);
      enc.start();
      enc.setRepeat(0);
      enc.setQuality(26);

      for (let i = 0; i < frames; i++) {
        const t = frames <= 1 ? 1 : i / (frames - 1);
        const canvas = drawFrame(Konva, input, assets, t, RENDER_SCALE);
        // Hold a beat on the settled final frame so the loop reads as a clean
        // "strike, then rest" rather than a frantic ping-pong.
        enc.setDelay(i === frames - 1 ? delay * 6 : delay);
        // The cairo 2D context is structurally what gifencoder reads pixels from;
        // its ambient type names the DOM CanvasRenderingContext2D (not in scope
        // for Node source), so bridge with a cast.
        enc.addFrame(canvas.getContext("2d") as never);
      }
      enc.finish();

      const buffer: Buffer = enc.out.getData();
      if (buffer.length > MAX_BYTES) {
        logger.debug({ bytes: buffer.length }, "siege-field: encoded GIF too large, dropping");
        return null;
      }
      return { buffer, width: physW, height: physH, frameCount: frames, durationMs: frames * delay };
    } catch (err) {
      logger.error({ err }, "siege-field: render failed");
      return null;
    }
  });
}

// A single frozen frame of the same battlefield, as a PNG — for guilds that run
// battles on static frames (no GIF). It captures the strike at its peak so the
// move still reads clearly: the acting card lunged in, the impact + damage
// number are up, the target is recoiling. Same scene, one moment.
export async function renderSiegeFieldStill(input: SiegeFieldInput): Promise<Buffer | null> {
  return queueRender("siege-field-still", async () => {
    const Konva = await loadKonva();
    const cmod = await loadCanvasMod();
    if (!Konva || !cmod) return null;
    ensureFonts(cmod);
    try {
      const assets = await loadFieldAssets(cmod, input);
      const canvas = drawFrame(Konva, input, assets, STILL_T, STILL_SCALE);
      return canvas.toBuffer("image/png");
    } catch (err) {
      logger.error({ err }, "siege-field: still render failed");
      return null;
    }
  });
}

// ── Scene composition ────────────────────────────────────────────────────────

interface Assets {
  backdrop: CanvasImage | null; floor: CanvasImage | null;
  atkBase: CanvasImage | null; defBase: CanvasImage | null;
  flash: CanvasImage | null; smoke: CanvasImage | null;
  atkArt: CanvasImage | null; defArt: CanvasImage | null;
  benchImgs: Map<string, CanvasImage | null>;
}

// Station geometry: where each fighter's podium + portrait live at rest.
const GROUND_Y = 356;              // podium contact line
const STATION_DX = 232;            // horizontal offset of each station from centre
const PORTRAIT_W = 150, PORTRAIT_H = 150;

// Returns the composited stage canvas (a `canvas`-package Canvas) — the caller
// pulls a 2D context for gifencoder or a PNG buffer for a still.
function drawFrame(
  Konva: KonvaMod, input: SiegeFieldInput, a: Assets, t: number, scale: number,
): { getContext: (id: "2d") => unknown; toBuffer: (mime: "image/png") => Buffer } {
  const stage = new Konva.Stage({ width: Math.round(FIELD.width * scale), height: Math.round(FIELD.height * scale) });
  // Draw everything in logical (900×470) coordinates; the layer scale shrinks the
  // whole scene to the physical output size in one step.
  const layer = new Konva.Layer({ listening: false, scaleX: scale, scaleY: scale });
  stage.add(layer);

  drawBackground(Konva, layer, a, input.accent);

  // Impact timing. The acting side lunges into the middle, connects around
  // t≈0.5, then eases home. The target reacts on connect.
  const LUNGE_IN_END = 0.46, CONNECT = 0.5, LUNGE_OUT_END = 0.9;
  const lungeIn = clamp01((t - 0.12) / (LUNGE_IN_END - 0.12));
  const lungeOut = clamp01((t - CONNECT) / (LUNGE_OUT_END - CONNECT));
  const advance = easeInOut(lungeIn) * (1 - easeOut(lungeOut)); // 0→1→0
  const connected = t >= CONNECT && input.isHit;
  const impact = pulse(t, CONNECT - 0.02, CONNECT + 0.22);      // flash / shake window
  const shake = connected ? impact * 12 : 0;

  const acting = input.actingSide;
  // Dash distance toward the foe; attacker moves right (+), defender left (−).
  const reach = 170;
  const atkDash = acting === 0 ? advance * reach : 0;
  const defDash = acting === 1 ? -advance * reach : 0;
  // The struck fighter is knocked back a touch and flashes white on connect.
  const targetIsDef = acting === 0;
  const atkKnock = (!targetIsDef && connected) ? impact * 22 : 0;
  const defKnock = (targetIsDef && connected) ? impact * 22 : 0;

  const cx = FIELD.width / 2;
  const bobA = Math.sin(t * Math.PI * 2) * 5;
  const bobB = Math.sin(t * Math.PI * 2 + Math.PI) * 5;

  const atkX = cx - STATION_DX + atkDash + atkKnock + (shake * 0.4);
  const defX = cx + STATION_DX + defDash - defKnock - (shake * 0.4);

  // Draw the standing (non-acting first) so the lunging fighter overlaps on top.
  const atkFlashWhite = targetIsDef ? 0 : impact;
  const defFlashWhite = targetIsDef ? impact : 0;

  // Bench standees line up behind each active fighter — drawn first so the
  // active podium + portrait always sit in front of the roster.
  drawBench(Konva, layer, 0, input.attackerBench ?? [], a.benchImgs);
  drawBench(Konva, layer, 1, input.defenderBench ?? [], a.benchImgs);

  drawStation(Konva, layer, {
    x: atkX, side: 0, base: a.atkBase, art: a.atkArt, fighter: input.attacker,
    bob: bobA, flashWhite: atkFlashWhite, t,
  });
  drawStation(Konva, layer, {
    x: defX, side: 1, base: a.defBase, art: a.defArt, fighter: input.defender,
    bob: bobB, flashWhite: defFlashWhite, t,
  });

  // Strike FX + damage number over the target, on connect.
  if (connected) {
    const targetX = targetIsDef ? defX : atkX;
    const targetY = GROUND_Y - PORTRAIT_H * 0.55;
    drawImpact(Konva, layer, a, targetX, targetY, impact, input, t);
  } else if (t >= CONNECT && !input.isHit) {
    const targetX = targetIsDef ? defX : atkX;
    drawFloatingText(Konva, layer, targetX, GROUND_Y - PORTRAIT_H - 14, "MISS", 0x9aa7b4, clamp01((t - CONNECT) / 0.4));
  }

  drawMoveBanner(Konva, layer, input);
  if (input.turnLabel) drawTurnChip(Konva, layer, input.turnLabel, input.accent);
  if (input.ko && t > 0.72) drawKoStamp(Konva, layer, targetIsDef ? defX : atkX, clamp01((t - 0.72) / 0.28));

  layer.draw();
  return stage.toCanvas() as unknown as { getContext: (id: "2d") => unknown; toBuffer: (mime: "image/png") => Buffer };
}

function roundRectPath(ctx: { beginPath: () => void; moveTo: (x: number, y: number) => void; arcTo: (x1: number, y1: number, x2: number, y2: number, r: number) => void; closePath: () => void }, x: number, y: number, w: number, h: number, r: number): void {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

function drawBackground(Konva: KonvaMod, layer: any, a: Assets, accent: number): void {
  // Base wash — always drawn, so a missing backdrop still looks deliberate.
  layer.add(new Konva.Rect({
    x: 0, y: 0, width: FIELD.width, height: FIELD.height,
    fillLinearGradientStartPoint: { x: 0, y: 0 },
    fillLinearGradientEndPoint: { x: 0, y: FIELD.height },
    fillLinearGradientColorStops: [0, "#141a24", 0.55, "#1b2430", 1, "#0c1016"],
  }));

  if (a.backdrop) {
    const { dw, dh, dx, dy } = cover(a.backdrop.width, a.backdrop.height, FIELD.width, FIELD.height * 0.82);
    layer.add(new Konva.Image({ image: a.backdrop, x: dx, y: dy, width: dw, height: dh, opacity: 0.9 }));
    // Darken toward the floor so the fighters pop against it.
    layer.add(new Konva.Rect({
      x: 0, y: 0, width: FIELD.width, height: FIELD.height,
      fillLinearGradientStartPoint: { x: 0, y: 0 },
      fillLinearGradientEndPoint: { x: 0, y: FIELD.height },
      fillLinearGradientColorStops: [0, "rgba(8,10,14,0.28)", 0.6, "rgba(8,10,14,0.12)", 1, "rgba(6,8,12,0.72)"],
    }));
  }

  // Ground band: a tiled floor strip along the lower third with a soft top edge.
  const bandTop = GROUND_Y - 44;
  if (a.floor) {
    const tile = 84;
    for (let x = 0; x < FIELD.width; x += tile) {
      layer.add(new Konva.Image({ image: a.floor, x, y: bandTop, width: tile, height: FIELD.height - bandTop, opacity: 0.96 }));
    }
    layer.add(new Konva.Rect({
      x: 0, y: bandTop, width: FIELD.width, height: FIELD.height - bandTop,
      fillLinearGradientStartPoint: { x: 0, y: bandTop },
      fillLinearGradientEndPoint: { x: 0, y: FIELD.height },
      fillLinearGradientColorStops: [0, "rgba(10,12,18,0.5)", 0.4, "rgba(10,12,18,0.05)", 1, "rgba(6,8,12,0.55)"],
    }));
  }

  // Accent glow along the horizon — ties the field to the siege's colour.
  layer.add(new Konva.Rect({
    x: 0, y: bandTop - 10, width: FIELD.width, height: 22, opacity: 0.5,
    fillLinearGradientStartPoint: { x: 0, y: 0 },
    fillLinearGradientEndPoint: { x: 0, y: 22 },
    fillLinearGradientColorStops: [0, "rgba(0,0,0,0)", 1, hex(accent)],
  }));
  // Vignette.
  layer.add(new Konva.Rect({
    x: 0, y: 0, width: FIELD.width, height: FIELD.height,
    fillRadialGradientStartPoint: { x: FIELD.width / 2, y: FIELD.height / 2 },
    fillRadialGradientEndPoint: { x: FIELD.width / 2, y: FIELD.height / 2 },
    fillRadialGradientStartRadius: 260, fillRadialGradientEndRadius: 560,
    fillRadialGradientColorStops: [0, "rgba(0,0,0,0)", 1, "rgba(0,0,0,0.5)"],
  }));
}

interface StationOpts {
  x: number; side: 0 | 1; base: CanvasImage | null; art: CanvasImage | null;
  fighter: SiegeFieldFighter; bob: number; flashWhite: number; t: number;
}

function drawStation(Konva: KonvaMod, layer: any, o: StationOpts): void {
  const color = fighterColor(o.fighter);
  const cstr = hex(color);
  const baseW = 148, baseH = 74;
  const baseX = o.x - baseW / 2, baseY = GROUND_Y - baseH * 0.5;

  // Contact shadow.
  layer.add(new Konva.Ellipse({
    x: o.x, y: GROUND_Y + 12, radiusX: baseW * 0.42, radiusY: 13, fill: "rgba(0,0,0,0.42)",
  }));
  // Peg podium.
  if (o.base) {
    layer.add(new Konva.Image({ image: o.base, x: baseX, y: baseY, width: baseW, height: baseH }));
  } else {
    layer.add(new Konva.Ellipse({ x: o.x, y: GROUND_Y, radiusX: baseW * 0.42, radiusY: 20, fill: "#2c3644", stroke: cstr, strokeWidth: 3 }));
  }

  // Floating portrait: bobs above the podium, tethered by a soft glow beam.
  const pw = PORTRAIT_W, ph = PORTRAIT_H;
  const px = o.x - pw / 2;
  const py = GROUND_Y - baseH * 0.35 - ph - 8 + o.bob;

  // Glow beam from podium to portrait.
  layer.add(new Konva.Rect({
    x: o.x - 26, y: py + ph * 0.5, width: 52, height: (GROUND_Y - (py + ph * 0.5)), opacity: 0.22,
    fillLinearGradientStartPoint: { x: 0, y: 0 },
    fillLinearGradientEndPoint: { x: 0, y: (GROUND_Y - (py + ph * 0.5)) },
    fillLinearGradientColorStops: [0, cstr, 1, "rgba(0,0,0,0)"],
  }));

  // Outer glow.
  layer.add(new Konva.Rect({
    x: px, y: py, width: pw, height: ph, cornerRadius: 18, fillEnabled: false,
    stroke: cstr, strokeWidth: 2, shadowColor: cstr, shadowBlur: 26, shadowOpacity: 0.85,
  }));

  // Clipped art (object-fit: cover) or a coloured placeholder.
  const g = new Konva.Group({
    clipFunc: (ctx: any) => roundRectPath(ctx, px, py, pw, ph, 16),
  });
  if (o.art) {
    const { dw, dh, dx, dy } = cover(o.art.width, o.art.height, pw, ph);
    g.add(new Konva.Image({ image: o.art, x: px + dx, y: py + dy, width: dw, height: dh }));
  } else {
    g.add(new Konva.Rect({ x: px, y: py, width: pw, height: ph, fill: cstr, opacity: 0.5 }));
    g.add(new Konva.Text({
      x: px, y: py + ph / 2 - 24, width: pw, align: "center",
      text: (o.fighter.name[0] || "?").toUpperCase(), fontFamily: "Orbitron", fontStyle: "900",
      fontSize: 52, fill: "#f5f7fa",
    }));
  }
  // White strike flash overlay on connect.
  if (o.flashWhite > 0.01) {
    g.add(new Konva.Rect({ x: px, y: py, width: pw, height: ph, fill: "#ffffff", opacity: 0.6 * o.flashWhite }));
  }
  layer.add(g);

  // Frame border.
  layer.add(new Konva.Rect({ x: px, y: py, width: pw, height: ph, cornerRadius: 16, fillEnabled: false, stroke: "#0b0e13", strokeWidth: 5 }));
  layer.add(new Konva.Rect({ x: px, y: py, width: pw, height: ph, cornerRadius: 16, fillEnabled: false, stroke: cstr, strokeWidth: 2.5 }));

  drawNameplate(Konva, layer, o.x, GROUND_Y + 24, o.fighter, color);
}

// The roster behind an active fighter: small standees receding toward the
// side's back edge. Upcoming cards read bright and framed; fallen cards are
// dimmed with a ✗ so a broken rank stays legible.
const BENCH_MAX = 3;
function drawBench(Konva: KonvaMod, layer: any, side: 0 | 1, cards: SiegeFieldBenchCard[], imgs: Map<string, CanvasImage | null>): void {
  if (cards.length === 0) return;
  const dir = side === 0 ? -1 : 1;
  const startX = FIELD.width / 2 + dir * (STATION_DX + 66); // just outside the podium
  const gap = 46;
  const y = GROUND_Y - 30;          // stand a touch behind the podium contact line
  const sz = 42;
  const shown = cards.slice(0, BENCH_MAX);
  shown.forEach((c, i) => {
    const x = startX + dir * i * gap;
    const color = fighterColor(c);
    const px = x - sz / 2, py = y - sz;
    // Contact shadow.
    layer.add(new Konva.Ellipse({ x, y: y + 4, radiusX: sz * 0.48, radiusY: 6, fill: "rgba(0,0,0,0.34)" }));
    // Clipped portrait (or coloured chip).
    const g = new Konva.Group({ clipFunc: (ctx: any) => roundRectPath(ctx, px, py, sz, sz, 8), opacity: c.fallen ? 0.5 : 0.92 });
    const img = c.artUrl ? imgs.get(c.artUrl) : null;
    if (img) {
      const { dw, dh, dx, dy } = cover(img.width, img.height, sz, sz);
      g.add(new Konva.Image({ image: img, x: px + dx, y: py + dy, width: dw, height: dh }));
    } else {
      g.add(new Konva.Rect({ x: px, y: py, width: sz, height: sz, fill: hex(color), opacity: 0.5 }));
    }
    if (c.fallen) g.add(new Konva.Rect({ x: px, y: py, width: sz, height: sz, fill: "#05070a", opacity: 0.55 }));
    layer.add(g);
    // Frame.
    layer.add(new Konva.Rect({
      x: px, y: py, width: sz, height: sz, cornerRadius: 8, fillEnabled: false,
      stroke: c.fallen ? "#3a4048" : hex(color), strokeWidth: 2, opacity: c.fallen ? 0.7 : 1,
    }));
    if (c.fallen) {
      layer.add(new Konva.Text({ x: px, y: py + sz / 2 - 13, width: sz, align: "center", text: "✗", fontFamily: "Orbitron", fontStyle: "900", fontSize: 26, fill: "#ff5a5a", opacity: 0.92 }));
    }
  });
  // Overflow marker.
  if (cards.length > BENCH_MAX) {
    const x = startX + dir * BENCH_MAX * gap;
    layer.add(new Konva.Text({ x: x - 22, y: y - sz + 8, width: 44, align: "center", text: `+${cards.length - BENCH_MAX}`, fontFamily: "Orbitron", fontStyle: "700", fontSize: 16, fill: "#cfd8e3", shadowColor: "#000", shadowBlur: 3, shadowOpacity: 1 }));
  }
}

function drawNameplate(Konva: KonvaMod, layer: any, cx: number, top: number, f: SiegeFieldFighter, color: number): void {
  const w = 176, x = cx - w / 2;
  // HP bar.
  const hpFrac = clamp01((f.hpBefore ?? f.hp) / Math.max(1, f.maxHp)); // shown pre-drain; the frame's damage number carries the loss
  const hpNow = clamp01(f.hp / Math.max(1, f.maxHp));
  const barY = top;
  layer.add(new Konva.Rect({ x, y: barY, width: w, height: 15, cornerRadius: 7, fill: "#10151d", stroke: "#2a333f", strokeWidth: 1 }));
  // ghost (pre-hit) then live fill.
  layer.add(new Konva.Rect({ x: x + 2, y: barY + 2, width: (w - 4) * hpFrac, height: 11, cornerRadius: 5, fill: "rgba(220,60,60,0.35)" }));
  const hpColor = hpNow > 0.5 ? "#4fd06a" : hpNow > 0.22 ? "#f1c40f" : "#e74c3c";
  layer.add(new Konva.Rect({ x: x + 2, y: barY + 2, width: Math.max(0, (w - 4) * hpNow), height: 11, cornerRadius: 5, fill: hpColor }));
  layer.add(new Konva.Text({
    x, y: barY + 1, width: w, align: "center", text: `${Math.max(0, Math.round(f.hp))}/${f.maxHp}`,
    fontFamily: "Orbitron", fontStyle: "700", fontSize: 10, fill: "#eaf0f6",
    shadowColor: "#000", shadowBlur: 2, shadowOpacity: 0.9,
  }));

  // Energy sliver.
  const energy = clamp01((f.energy ?? 0) / 100);
  layer.add(new Konva.Rect({ x, y: barY + 18, width: w, height: 6, cornerRadius: 3, fill: "#10151d" }));
  layer.add(new Konva.Rect({ x: x + 1, y: barY + 19, width: (w - 2) * energy, height: 4, cornerRadius: 2, fill: "#38bdf8" }));

  // Name.
  layer.add(new Konva.Text({
    x, y: barY + 27, width: w, align: "center", text: f.name.toUpperCase(),
    fontFamily: "Orbitron", fontStyle: "700", fontSize: 13, fill: "#f5f7fa",
    shadowColor: hex(color), shadowBlur: 8, shadowOpacity: 0.8, ellipsis: true, wrap: "none",
  }));
}

function drawImpact(Konva: KonvaMod, layer: any, a: Assets, x: number, y: number, k: number, input: SiegeFieldInput, t: number): void {
  const color = input.isCrit ? 0xffd54a : 0xffffff;
  const scale = (input.isCrit ? 1.35 : 1.0) * (0.6 + k * 0.9);
  if (a.flash) {
    const sz = 150 * scale;
    layer.add(new Konva.Image({ image: a.flash, x: x - sz / 2, y: y - sz / 2, width: sz, height: sz, opacity: k, shadowColor: hex(color), shadowBlur: 30, shadowOpacity: k }));
  } else {
    layer.add(new Konva.Star({ x, y, numPoints: 8, innerRadius: 18 * scale, outerRadius: 52 * scale, fill: hex(color), opacity: k }));
  }
  // Slash streak.
  layer.add(new Konva.Line({
    points: [x - 60 * scale, y + 34 * scale, x + 60 * scale, y - 34 * scale],
    stroke: "#ffffff", strokeWidth: 6 * scale, opacity: k * 0.85, lineCap: "round",
    shadowColor: hex(color), shadowBlur: 16, shadowOpacity: k,
  }));
  if (a.smoke) {
    const sz = 120 * scale;
    layer.add(new Konva.Image({ image: a.smoke, x: x - sz / 2, y: y - sz / 2, width: sz, height: sz, opacity: k * 0.7 }));
  }
  // Damage number, rising as the strike settles.
  if (input.damage > 0) {
    const rise = (1 - k) * 26;
    const dmgColor = input.isCrit ? 0xffd54a : 0xff5a5a;
    layer.add(new Konva.Text({
      x: x - 100, y: y - 62 - rise, width: 200, align: "center",
      text: `${input.isCrit ? "CRIT " : ""}-${input.damage}`,
      fontFamily: "Orbitron", fontStyle: "900", fontSize: input.isCrit ? 40 : 34, fill: hex(dmgColor),
      shadowColor: "#000", shadowBlur: 5, shadowOpacity: 1, opacity: clamp01(k + 0.3),
    }));
  }
}

function drawFloatingText(Konva: KonvaMod, layer: any, cx: number, y: number, text: string, color: number, k: number): void {
  layer.add(new Konva.Text({
    x: cx - 100, y: y - k * 20, width: 200, align: "center", text,
    fontFamily: "Orbitron", fontStyle: "900", fontSize: 30, fill: hex(color),
    shadowColor: "#000", shadowBlur: 4, shadowOpacity: 1, opacity: 1 - k,
  }));
}

function drawMoveBanner(Konva: KonvaMod, layer: any, input: SiegeFieldInput): void {
  const actor = input.actingSide === 0 ? input.attacker : input.defender;
  const text = `${actor.name} · ${input.moveName}`;
  const w = Math.min(560, 60 + text.length * 12);
  const x = FIELD.width / 2 - w / 2, y = 18;
  layer.add(new Konva.Rect({
    x, y, width: w, height: 40, cornerRadius: 20, fill: "rgba(10,14,20,0.72)",
    stroke: hex(input.accent), strokeWidth: 2, shadowColor: "#000", shadowBlur: 10, shadowOpacity: 0.6,
  }));
  layer.add(new Konva.Text({
    x, y: y + 11, width: w, align: "center", text, fontFamily: "Orbitron", fontStyle: "700",
    fontSize: 17, fill: "#f5f7fa", ellipsis: true, wrap: "none",
  }));
}

function drawTurnChip(Konva: KonvaMod, layer: any, label: string, accent: number): void {
  const w = 30 + label.length * 9;
  layer.add(new Konva.Rect({ x: 16, y: 16, width: w, height: 28, cornerRadius: 14, fill: "rgba(10,14,20,0.7)", stroke: hex(accent), strokeWidth: 1.5 }));
  layer.add(new Konva.Text({ x: 16, y: 23, width: w, align: "center", text: label, fontFamily: "Orbitron", fontStyle: "700", fontSize: 13, fill: "#cfe3ff" }));
}

function drawKoStamp(Konva: KonvaMod, layer: any, x: number, k: number): void {
  const s = lerp(1.6, 1.0, easeOut(k));
  layer.add(new Konva.Text({
    x: x - 120, y: GROUND_Y - 150, width: 240, align: "center", text: "K.O.",
    fontFamily: "Orbitron", fontStyle: "900", fontSize: 64 * s, fill: "#ff3b3b",
    shadowColor: "#000", shadowBlur: 8, shadowOpacity: 1, opacity: clamp01(k * 1.4), rotation: -8,
  }));
}

// object-fit: cover — returns the draw dims + offset to fill wxh with the image.
function cover(iw: number, ih: number, w: number, h: number): { dw: number; dh: number; dx: number; dy: number } {
  if (!iw || !ih) return { dw: w, dh: h, dx: 0, dy: 0 };
  const scale = Math.max(w / iw, h / ih);
  const dw = iw * scale, dh = ih * scale;
  return { dw, dh, dx: (w - dw) / 2, dy: (h - dh) / 2 };
}
