// ─────────────────────────────────────────────────────────────────────────────
// HQ siege — the zoomed-in "Clash" battlefield.
//
// This is the bottom embed of a live siege: a real, move-for-move arena where
// the two active cards stand on peg podiums with their art floating above them,
// and the acting side DASHES forward and strikes while the target recoils. It's
// the siege analogue of a `/battle` turn frame, but staged as a face-off on a
// dedicated battlefield instead of over the castle.
//
// The scene is drawn straight onto a 2D context with `@napi-rs/canvas` — the
// SAME renderer the `/battle` animation layer uses — and GIFs go through the
// shared `encodeAnimation` helper (frame planning + coalescing) so /hq turn
// GIFs encode like /battle. It deliberately does NOT use Konva or the cairo
// `canvas` package. Everything is best-effort: a missing native lib, a stalled
// card image or an oversized encode all resolve to `null`, and the caller
// silently keeps the old static frame. A siege must never break because a
// picture failed.
//
// Assets come from the SAME HQ art pack the base renderer uses (Kenney iso
// packs, extracted under assets/hq/…): a backdrop, a floor tile and the podium
// bases. `.riv` overlays can be layered on later via rive-overlay.ts — see that
// module — but the shipped battle is pure sprite + 2D canvas so it runs headless.
// ─────────────────────────────────────────────────────────────────────────────

import { readFileSync } from "node:fs";
import { spriteForPrefix } from "../hq/assets.js";
import { queueRender } from "./render-queue.js";
import { getRarityEffectColor, loadArt as loadArtShared } from "./effects.js";
import { extractArtColor } from "../battle/image/vibrant-color.js";
import { encodeAnimation, getCanvas, TITLE_FONT_FAMILY, type CanvasMod, type Ctx } from "./engine.js";
import type { Rarity } from "../cards-data.js";
import type { AnimationSpeed, AnimationResult } from "./types.js";
import { logger } from "../../lib/logger.js";

type CanvasImage = Awaited<ReturnType<CanvasMod["loadImage"]>>;

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
// shrunk to keep a turn snappy. 0.6 matches /battle turn GIFs so Discord inline
// display and encode cost stay in the same ballpark.
const RENDER_SCALE = 0.6;

// Target play-through length by guild speed — same ballpark as renderBattleTurn
// (~1800ms) so /hq and /battle feel like one system. encodeAnimation plans fps
// + coalesces identical hold frames.
function speedDurationMs(speed: AnimationSpeed): number {
  switch (speed) {
    case "fast": return 1400;
    case "slow": return 2200;
    default: return 1800;
  }
}

function speedMaxFrames(speed: AnimationSpeed): number {
  switch (speed) {
    case "fast": return 16;
    case "slow": return 22;
    default: return 18;
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
// A colour with alpha, from a packed int — for glows/shadows where Konva used a
// separate shadowOpacity.
function rgba(n: number, a: number): string {
  const r = (n >> 16) & 0xff, g = (n >> 8) & 0xff, b = n & 0xff;
  return `rgba(${r},${g},${b},${clamp01(a)})`;
}
function fighterColor(f: SiegeFighterLike): number {
  return f.rarityColor ?? getRarityEffectColor(f.rarity as Rarity);
}
type SiegeFighterLike = { rarity: string; rarityColor: number | null };
const FONT = TITLE_FONT_FAMILY; // "Orbitron", registered by the engine loader

// The active fighter's accent, themed to its actual card art. Mirrors the
// `/battle` turn renderer: the dominant colour pulled from the artwork wins, so
// the frame, glow and nameplate all read as "this specific card"; a custom
// rarity-tier colour, then the rarity effect colour, are the fallbacks. Only the
// two active fighters get this (extraction loads + quantises the art); bench
// standees stay on their rarity colour.
// Extraction loads + quantises the artwork, so remember the dominant colour per
// URL for the process — a siege re-renders the same two cards every turn, and
// without this each turn would re-fetch and re-quantise their art just for the
// accent.
const colorCache = new Map<string, number>();
async function resolveFieldColor(f: SiegeFieldFighter): Promise<number> {
  const fallback = f.rarityColor ?? getRarityEffectColor(f.rarity as Rarity);
  if (!f.artUrl) return fallback;
  const cached = colorCache.get(f.artUrl);
  if (cached !== undefined) return cached;
  const art = await extractArtColor(f.artUrl).catch(() => null);
  const color = art ?? fallback;
  colorCache.set(f.artUrl, color);
  if (colorCache.size > 256) { const k = colorCache.keys().next().value; if (k !== undefined) colorCache.delete(k); }
  return color;
}

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

// Card art loads through the SAME shared loader `/battle` and `/raid` use
// (effects.ts `loadArt`). That path knows how to pull a card straight from
// object storage / GCS instead of round-tripping the app's own public URL — the
// server-side fetch of its own `…/api/storage/objects/…` link is exactly what
// failed on the old siege-only loader, leaving every fighter as a blank
// placeholder box (the "missing images" a siege showed). It also owns its own
// cache + decode-from-disk workaround, so a siege that re-renders the same two
// cards every turn never re-fetches them.
function loadArt(mod: CanvasMod, url: string | null): Promise<CanvasImage | null> {
  return loadArtShared(mod, url) as Promise<CanvasImage | null>;
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

  // Theme each active fighter's accent to its card art (see resolveFieldColor).
  const [atkColor, defColor] = await Promise.all([
    resolveFieldColor(input.attacker),
    resolveFieldColor(input.defender),
  ]);
  return { backdrop, floor, atkBase, defBase, flash, smoke, atkArt, defArt, benchImgs, atkColor, defColor };
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
  // Shared encode path with /battle: frame planning, NeuQuant quality, and
  // consecutive-frame coalescing. One queue slot via encodeAnimation("gif").
  const cmod = await getCanvas();
  if (!cmod) return null;

  let assets: Assets;
  try {
    assets = await loadFieldAssets(cmod, input);
  } catch (err) {
    logger.error({ err }, "siege-field: asset load failed");
    return null;
  }

  const result = await encodeAnimation({
    width: FIELD.width,
    height: FIELD.height,
    speed,
    durationMs: speedDurationMs(speed),
    maxFrames: speedMaxFrames(speed),
    quality: 26,
    renderScale: RENDER_SCALE,
    render: ({ ctx, t }) => {
      // encodeAnimation already applied renderScale on the context; paint in
      // logical coords (paintFrame scales again — pass 1 so we don't double).
      paintFrame(ctx, input, assets, t, 1);
    },
  });

  if (!result) return null;
  if (result.buffer.length > MAX_BYTES) {
    logger.debug({ bytes: result.buffer.length }, "siege-field: encoded GIF too large, dropping");
    return null;
  }
  return result;
}

// A single frozen frame of the same battlefield, as a PNG — for guilds that run
// battles on static frames (no GIF). It captures the strike at its peak so the
// move still reads clearly: the acting card lunged in, the impact + damage
// number are up, the target is recoiling. Same scene, one moment.
export async function renderSiegeFieldStill(input: SiegeFieldInput): Promise<Buffer | null> {
  return queueRender("siege-field-still", async () => {
    const cmod = await getCanvas();
    if (!cmod) return null;
    try {
      const assets = await loadFieldAssets(cmod, input);
      const physW = Math.round(FIELD.width * STILL_SCALE);
      const physH = Math.round(FIELD.height * STILL_SCALE);
      const canvas = cmod.createCanvas(physW, physH);
      const ctx = canvas.getContext("2d") as unknown as Ctx;
      paintFrame(ctx, input, assets, STILL_T, STILL_SCALE);
      return await canvas.encode("png");
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
  atkColor: number; defColor: number;   // art-themed accent per active fighter
}

// Station geometry: where each fighter's podium + portrait live at rest.
const GROUND_Y = 356;              // podium contact line
const STATION_DX = 232;            // horizontal offset of each station from centre
const PORTRAIT_W = 150, PORTRAIT_H = 150;

// Paint the whole scene at `t`. Everything is drawn in logical (900×470)
// coordinates; callers apply any physical `scale` themselves (still PNG) or via
// encodeAnimation's renderScale (GIF).
function paintFrame(ctx: Ctx, input: SiegeFieldInput, a: Assets, t: number, scale: number): void {
  ctx.save();
  ctx.scale(scale, scale);
  ctx.textBaseline = "top";

  drawBackground(ctx, a, input.accent);

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
  // Anticipation coil: the acting fighter pulls a touch AWAY from the foe just
  // before it springs in, so the lunge lands with weight instead of sliding. A
  // quick 0→1→0 pulse over the wind-up window, opposite the dash direction.
  const windup = pulse(t, 0.0, 0.16) * 16;
  const atkWindup = acting === 0 ? -windup : 0;
  const defWindup = acting === 1 ? windup : 0;
  // The struck fighter is knocked back a touch and flashes white on connect.
  const targetIsDef = acting === 0;
  const atkKnock = (!targetIsDef && connected) ? impact * 22 : 0;
  const defKnock = (targetIsDef && connected) ? impact * 22 : 0;

  const cx = FIELD.width / 2;
  const bobA = Math.sin(t * Math.PI * 2) * 5;
  const bobB = Math.sin(t * Math.PI * 2 + Math.PI) * 5;

  const atkX = cx - STATION_DX + atkDash + atkWindup + atkKnock + (shake * 0.4);
  const defX = cx + STATION_DX + defDash + defWindup - defKnock - (shake * 0.4);

  // White strike flash overlay on connect, on the struck side.
  const atkFlashWhite = targetIsDef ? 0 : impact;
  const defFlashWhite = targetIsDef ? impact : 0;

  // Bench standees line up behind each active fighter — drawn first so the
  // active podium + portrait always sit in front of the roster.
  drawBench(ctx, 0, input.attackerBench ?? [], a.benchImgs);
  drawBench(ctx, 1, input.defenderBench ?? [], a.benchImgs);

  // Speed streaks stream off the charging fighter while it closes the gap — the
  // motion-blur that sells the dash. Strongest mid-lunge, gone by the recoil.
  const streakK = advance * clamp01(1 - lungeOut * 2.2);
  if (streakK > 0.02) {
    const actingX = acting === 0 ? atkX : defX;
    const actingDir = acting === 0 ? 1 : -1;
    const actingColor = acting === 0 ? a.atkColor : a.defColor;
    drawDashStreak(ctx, actingX, actingDir, streakK, actingColor);
  }

  drawStation(ctx, {
    x: atkX, side: 0, base: a.atkBase, art: a.atkArt, fighter: input.attacker, color: a.atkColor,
    bob: bobA, flashWhite: atkFlashWhite, t,
  });
  drawStation(ctx, {
    x: defX, side: 1, base: a.defBase, art: a.defArt, fighter: input.defender, color: a.defColor,
    bob: bobB, flashWhite: defFlashWhite, t,
  });

  // Strike FX + damage number over the target, on connect.
  if (connected) {
    const targetX = targetIsDef ? defX : atkX;
    const targetY = GROUND_Y - PORTRAIT_H * 0.55;
    drawImpact(ctx, a, targetX, targetY, impact, input);
  } else if (t >= CONNECT && !input.isHit) {
    const targetX = targetIsDef ? defX : atkX;
    drawFloatingText(ctx, targetX, GROUND_Y - PORTRAIT_H - 14, "MISS", 0x9aa7b4, clamp01((t - CONNECT) / 0.4));
  }

  drawMoveBanner(ctx, input);
  if (input.turnLabel) drawTurnChip(ctx, input.turnLabel, input.accent);
  if (input.ko && t > 0.72) drawKoStamp(ctx, targetIsDef ? defX : atkX, clamp01((t - 0.72) / 0.28));

  ctx.restore();
}

// ── 2D drawing primitives ─────────────────────────────────────────────────────

function roundRectPath(ctx: Ctx, x: number, y: number, w: number, h: number, r: number): void {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

function fillRoundRect(ctx: Ctx, x: number, y: number, w: number, h: number, r: number, fill: string): void {
  roundRectPath(ctx, x, y, w, h, r);
  ctx.fillStyle = fill;
  ctx.fill();
}

function strokeRoundRect(ctx: Ctx, x: number, y: number, w: number, h: number, r: number, stroke: string, lineWidth: number): void {
  roundRectPath(ctx, x, y, w, h, r);
  ctx.strokeStyle = stroke;
  ctx.lineWidth = lineWidth;
  ctx.stroke();
}

// The napi 2D context exposes arc() (circles only), so an oval is a scaled
// circle drawn under a temporary transform.
function ellipse(ctx: Ctx, x: number, y: number, rx: number, ry: number, fill: string): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(1, ry / rx);
  ctx.beginPath();
  ctx.arc(0, 0, rx, 0, Math.PI * 2);
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.restore();
}

interface TextOpts {
  x: number; y: number; w?: number; align?: "left" | "center" | "right";
  text: string; size: number; weight?: number | string; fill: string;
  shadow?: string; shadowBlur?: number; alpha?: number; maxWidth?: number;
}
// Konva Text drew top-anchored inside a box [x, x+width] with an align. We mirror
// that: textBaseline is "top", and centre/right alignment resolves against the box.
function drawText(ctx: Ctx, o: TextOpts): void {
  ctx.save();
  ctx.globalAlpha = o.alpha ?? 1;
  ctx.fillStyle = o.fill;
  ctx.font = `${o.weight ?? 700} ${o.size}px "${FONT}"`;
  ctx.textBaseline = "top";
  const align = o.align ?? "left";
  ctx.textAlign = align;
  if (o.shadow) { ctx.shadowColor = o.shadow; ctx.shadowBlur = o.shadowBlur ?? 0; }
  let text = o.text;
  const limit = o.maxWidth ?? o.w;
  if (limit) text = ellipsize(ctx, text, limit);
  let x = o.x;
  if (o.w != null) {
    if (align === "center") x = o.x + o.w / 2;
    else if (align === "right") x = o.x + o.w;
  }
  ctx.fillText(text, x, o.y);
  ctx.restore();
}

// Trim to fit `w`, appending an ellipsis — the napi context has measureText.
function ellipsize(ctx: Ctx, text: string, w: number): string {
  if (ctx.measureText(text).width <= w) return text;
  let s = text;
  while (s.length > 1 && ctx.measureText(s + "…").width > w) s = s.slice(0, -1);
  return s + "…";
}

// A linear vertical gradient from an array of [stop, colour] pairs.
function vGradient(ctx: Ctx, x0: number, y0: number, y1: number, stops: [number, string][]): ReturnType<Ctx["createLinearGradient"]> {
  const g = ctx.createLinearGradient(x0, y0, x0, y1);
  for (const [at, col] of stops) g.addColorStop(at, col);
  return g;
}

function drawBackground(ctx: Ctx, a: Assets, accent: number): void {
  // Base wash — always drawn, so a missing backdrop still looks deliberate.
  ctx.fillStyle = vGradient(ctx, 0, 0, FIELD.height, [[0, "#141a24"], [0.55, "#1b2430"], [1, "#0c1016"]]);
  ctx.fillRect(0, 0, FIELD.width, FIELD.height);

  if (a.backdrop) {
    const { dw, dh, dx, dy } = cover(a.backdrop.width, a.backdrop.height, FIELD.width, FIELD.height * 0.82);
    ctx.save();
    ctx.globalAlpha = 0.9;
    ctx.drawImage(a.backdrop as never, dx, dy, dw, dh);
    ctx.restore();
    // Darken toward the floor so the fighters pop against it.
    ctx.fillStyle = vGradient(ctx, 0, 0, FIELD.height, [
      [0, "rgba(8,10,14,0.28)"], [0.6, "rgba(8,10,14,0.12)"], [1, "rgba(6,8,12,0.72)"],
    ]);
    ctx.fillRect(0, 0, FIELD.width, FIELD.height);
  }

  // Ground band: a tiled floor strip along the lower third with a soft top edge.
  const bandTop = GROUND_Y - 44;
  if (a.floor) {
    const tile = 84;
    ctx.save();
    ctx.globalAlpha = 0.96;
    for (let x = 0; x < FIELD.width; x += tile) {
      ctx.drawImage(a.floor as never, x, bandTop, tile, FIELD.height - bandTop);
    }
    ctx.restore();
    ctx.fillStyle = vGradient(ctx, 0, bandTop, FIELD.height, [
      [0, "rgba(10,12,18,0.5)"], [0.4, "rgba(10,12,18,0.05)"], [1, "rgba(6,8,12,0.55)"],
    ]);
    ctx.fillRect(0, bandTop, FIELD.width, FIELD.height - bandTop);
  }

  // Accent glow along the horizon — ties the field to the siege's colour.
  ctx.save();
  ctx.globalAlpha = 0.5;
  ctx.fillStyle = vGradient(ctx, 0, bandTop - 10, bandTop + 12, [[0, "rgba(0,0,0,0)"], [1, hex(accent)]]);
  ctx.fillRect(0, bandTop - 10, FIELD.width, 22);
  ctx.restore();

  // Vignette.
  const vg = ctx.createRadialGradient(FIELD.width / 2, FIELD.height / 2, 260, FIELD.width / 2, FIELD.height / 2, 560);
  vg.addColorStop(0, "rgba(0,0,0,0)");
  vg.addColorStop(1, "rgba(0,0,0,0.5)");
  ctx.fillStyle = vg;
  ctx.fillRect(0, 0, FIELD.width, FIELD.height);
}

interface StationOpts {
  x: number; side: 0 | 1; base: CanvasImage | null; art: CanvasImage | null;
  fighter: SiegeFieldFighter; color: number; bob: number; flashWhite: number; t: number;
}

function drawStation(ctx: Ctx, o: StationOpts): void {
  const color = o.color;
  const cstr = hex(color);
  const baseW = 148, baseH = 74;
  const baseX = o.x - baseW / 2, baseY = GROUND_Y - baseH * 0.5;

  // Contact shadow.
  ellipse(ctx, o.x, GROUND_Y + 12, baseW * 0.42, 13, "rgba(0,0,0,0.42)");
  // Peg podium.
  if (o.base) {
    ctx.drawImage(o.base as never, baseX, baseY, baseW, baseH);
  } else {
    ellipse(ctx, o.x, GROUND_Y, baseW * 0.42, 20, "#2c3644");
    ctx.save();
    ctx.translate(o.x, GROUND_Y);
    ctx.scale(1, 20 / (baseW * 0.42));
    ctx.beginPath();
    ctx.arc(0, 0, baseW * 0.42, 0, Math.PI * 2);
    ctx.strokeStyle = cstr; ctx.lineWidth = 3; ctx.stroke();
    ctx.restore();
  }

  // Floating portrait: bobs above the podium, tethered by a soft glow beam.
  const pw = PORTRAIT_W, ph = PORTRAIT_H;
  const px = o.x - pw / 2;
  const py = GROUND_Y - baseH * 0.35 - ph - 8 + o.bob;

  // Glow beam from podium to portrait.
  const beamTop = py + ph * 0.5;
  const beamH = GROUND_Y - beamTop;
  ctx.save();
  ctx.globalAlpha = 0.22;
  ctx.fillStyle = vGradient(ctx, 0, beamTop, beamTop + beamH, [[0, cstr], [1, "rgba(0,0,0,0)"]]);
  ctx.fillRect(o.x - 26, beamTop, 52, beamH);
  ctx.restore();

  // Outer glow (a soft accent halo behind the frame).
  ctx.save();
  ctx.shadowColor = rgba(color, 0.85);
  ctx.shadowBlur = 26;
  strokeRoundRect(ctx, px, py, pw, ph, 18, cstr, 2);
  ctx.restore();

  // Clipped art (object-fit: cover) or a coloured placeholder.
  ctx.save();
  roundRectPath(ctx, px, py, pw, ph, 16);
  ctx.clip();
  if (o.art) {
    const { dw, dh, dx, dy } = cover(o.art.width, o.art.height, pw, ph);
    ctx.drawImage(o.art as never, px + dx, py + dy, dw, dh);
  } else {
    ctx.save();
    ctx.globalAlpha = 0.5;
    ctx.fillStyle = cstr;
    ctx.fillRect(px, py, pw, ph);
    ctx.restore();
    drawText(ctx, {
      x: px, y: py + ph / 2 - 24, w: pw, align: "center",
      text: (o.fighter.name[0] || "?").toUpperCase(), weight: 900, size: 52, fill: "#f5f7fa",
    });
  }
  // White strike flash overlay on connect.
  if (o.flashWhite > 0.01) {
    ctx.save();
    ctx.globalAlpha = 0.6 * o.flashWhite;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(px, py, pw, ph);
    ctx.restore();
  }
  ctx.restore();

  // Frame border (dark outline, then accent).
  strokeRoundRect(ctx, px, py, pw, ph, 16, "#0b0e13", 5);
  strokeRoundRect(ctx, px, py, pw, ph, 16, cstr, 2.5);

  drawNameplate(ctx, o.x, GROUND_Y + 24, o.fighter, color);
}

// The roster behind an active fighter: small standees receding toward the
// side's back edge. Upcoming cards read bright and framed; fallen cards are
// dimmed with a ✗ so a broken rank stays legible.
const BENCH_MAX = 3;
function drawBench(ctx: Ctx, side: 0 | 1, cards: SiegeFieldBenchCard[], imgs: Map<string, CanvasImage | null>): void {
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
    ellipse(ctx, x, y + 4, sz * 0.48, 6, "rgba(0,0,0,0.34)");
    // Clipped portrait (or coloured chip).
    ctx.save();
    ctx.globalAlpha = c.fallen ? 0.5 : 0.92;
    roundRectPath(ctx, px, py, sz, sz, 8);
    ctx.clip();
    const img = c.artUrl ? imgs.get(c.artUrl) : null;
    if (img) {
      const { dw, dh, dx, dy } = cover(img.width, img.height, sz, sz);
      ctx.drawImage(img as never, px + dx, py + dy, dw, dh);
    } else {
      ctx.globalAlpha = (c.fallen ? 0.5 : 0.92) * 0.5;
      ctx.fillStyle = hex(color);
      ctx.fillRect(px, py, sz, sz);
    }
    if (c.fallen) {
      ctx.globalAlpha = 0.55;
      ctx.fillStyle = "#05070a";
      ctx.fillRect(px, py, sz, sz);
    }
    ctx.restore();
    // Frame.
    ctx.save();
    ctx.globalAlpha = c.fallen ? 0.7 : 1;
    strokeRoundRect(ctx, px, py, sz, sz, 8, c.fallen ? "#3a4048" : hex(color), 2);
    ctx.restore();
    if (c.fallen) {
      // A drawn cross, not a "✗" glyph — Orbitron lacks U+2717 and the napi
      // renderer would draw a tofu box for it.
      const m = sz * 0.28;
      ctx.save();
      ctx.globalAlpha = 0.92;
      ctx.strokeStyle = "#ff5a5a";
      ctx.lineWidth = 3.5;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(px + m, py + m); ctx.lineTo(px + sz - m, py + sz - m);
      ctx.moveTo(px + sz - m, py + m); ctx.lineTo(px + m, py + sz - m);
      ctx.stroke();
      ctx.restore();
    }
  });
  // Overflow marker.
  if (cards.length > BENCH_MAX) {
    const x = startX + dir * BENCH_MAX * gap;
    drawText(ctx, { x: x - 22, y: y - sz + 8, w: 44, align: "center", text: `+${cards.length - BENCH_MAX}`, weight: 700, size: 16, fill: "#cfd8e3", shadow: "#000", shadowBlur: 3 });
  }
}

function drawNameplate(ctx: Ctx, cx: number, top: number, f: SiegeFieldFighter, color: number): void {
  const w = 176, x = cx - w / 2;
  // HP bar.
  const hpFrac = clamp01((f.hpBefore ?? f.hp) / Math.max(1, f.maxHp)); // shown pre-drain; the frame's damage number carries the loss
  const hpNow = clamp01(f.hp / Math.max(1, f.maxHp));
  const barY = top;
  fillRoundRect(ctx, x, barY, w, 15, 7, "#10151d");
  strokeRoundRect(ctx, x, barY, w, 15, 7, "#2a333f", 1);
  // ghost (pre-hit) then live fill.
  fillRoundRect(ctx, x + 2, barY + 2, (w - 4) * hpFrac, 11, 5, "rgba(220,60,60,0.35)");
  const hpColor = hpNow > 0.5 ? "#4fd06a" : hpNow > 0.22 ? "#f1c40f" : "#e74c3c";
  fillRoundRect(ctx, x + 2, barY + 2, Math.max(0, (w - 4) * hpNow), 11, 5, hpColor);
  drawText(ctx, {
    x, y: barY + 2, w, align: "center", text: `${Math.max(0, Math.round(f.hp))}/${f.maxHp}`,
    weight: 700, size: 10, fill: "#eaf0f6", shadow: "rgba(0,0,0,0.9)", shadowBlur: 2,
  });

  // Energy sliver.
  const energy = clamp01((f.energy ?? 0) / 100);
  fillRoundRect(ctx, x, barY + 18, w, 6, 3, "#10151d");
  fillRoundRect(ctx, x + 1, barY + 19, (w - 2) * energy, 4, 2, "#38bdf8");

  // Name.
  drawText(ctx, {
    x, y: barY + 27, w, align: "center", text: f.name.toUpperCase(),
    weight: 700, size: 13, fill: "#f5f7fa", shadow: rgba(color, 0.8), shadowBlur: 8, maxWidth: w,
  });
}

function drawStar(ctx: Ctx, x: number, y: number, points: number, inner: number, outer: number, fill: string, alpha: number): void {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = fill;
  ctx.beginPath();
  const step = Math.PI / points;
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 === 0 ? outer : inner;
    const ang = i * step - Math.PI / 2;
    const sx = x + Math.cos(ang) * r, sy = y + Math.sin(ang) * r;
    if (i === 0) ctx.moveTo(sx, sy); else ctx.lineTo(sx, sy);
  }
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

// Motion-blur speed lines trailing the charging fighter. `dir` is +1 when it
// moves right (attacker) / −1 when it moves left (defender); the streaks stream
// out BEHIND it. Cheap: a handful of tapered accent lines, no image work.
function drawDashStreak(ctx: Ctx, x: number, dir: number, k: number, color: number): void {
  const bandTop = GROUND_Y - 165, bandBot = GROUND_Y - 55;
  const tailX = x - dir * (PORTRAIT_W * 0.34);
  const lines = 5;
  ctx.save();
  ctx.lineCap = "round";
  for (let i = 0; i < lines; i++) {
    const f = i / (lines - 1);                       // 0..1 top→bottom
    const y = lerp(bandTop, bandBot, f);
    // Longer, brighter near the vertical centre of the portrait.
    const centre = 1 - Math.abs(f - 0.5) * 2;         // 0 at edges, 1 in middle
    const len = (36 + centre * 64) * k;
    if (len < 4) continue;
    const x0 = tailX - dir * (6 + f * 10);            // slight rake
    const x1 = x0 - dir * len;
    const alpha = k * (0.22 + centre * 0.4);
    // Accent body.
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = hex(color);
    ctx.lineWidth = 2 + centre * 3;
    ctx.beginPath();
    ctx.moveTo(x0, y);
    ctx.lineTo(x1, y);
    ctx.stroke();
    // White hot core on the strongest lines.
    if (centre > 0.5) {
      ctx.globalAlpha = alpha * 0.9;
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(x0, y);
      ctx.lineTo(lerp(x0, x1, 0.7), y);
      ctx.stroke();
    }
  }
  ctx.restore();
}

function drawImpact(ctx: Ctx, a: Assets, x: number, y: number, k: number, input: SiegeFieldInput): void {
  const color = input.isCrit ? 0xffd54a : 0xffffff;
  const scale = (input.isCrit ? 1.35 : 1.0) * (0.6 + k * 0.9);
  if (a.flash) {
    const sz = 150 * scale;
    ctx.save();
    ctx.globalAlpha = k;
    ctx.shadowColor = rgba(color, k);
    ctx.shadowBlur = 30;
    ctx.drawImage(a.flash as never, x - sz / 2, y - sz / 2, sz, sz);
    ctx.restore();
  } else {
    drawStar(ctx, x, y, 8, 18 * scale, 52 * scale, hex(color), k);
  }
  // Shockwave ring — an expanding hoop that reads as the force of the blow
  // landing, brightest at the moment of contact.
  ctx.save();
  ctx.globalAlpha = k * 0.85;
  ctx.strokeStyle = hex(color);
  ctx.lineWidth = (5 * scale) * (0.4 + k * 0.6);
  ctx.shadowColor = rgba(color, k);
  ctx.shadowBlur = 18;
  ctx.beginPath();
  ctx.arc(x, y, (26 + (1 - k) * 62) * scale, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
  // Radial spark burst from the point of contact.
  const sparks = input.isCrit ? 9 : 6;
  ctx.save();
  ctx.globalAlpha = k * 0.8;
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 2.4 * scale;
  ctx.lineCap = "round";
  ctx.shadowColor = rgba(color, k);
  ctx.shadowBlur = 10;
  for (let i = 0; i < sparks; i++) {
    const ang = (i / sparks) * Math.PI * 2 + k * 0.6;
    const r0 = 18 * scale, r1 = (46 + k * 40) * scale;
    ctx.beginPath();
    ctx.moveTo(x + Math.cos(ang) * r0, y + Math.sin(ang) * r0);
    ctx.lineTo(x + Math.cos(ang) * r1, y + Math.sin(ang) * r1);
    ctx.stroke();
  }
  ctx.restore();
  // Slash streak.
  ctx.save();
  ctx.globalAlpha = k * 0.85;
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 6 * scale;
  ctx.lineCap = "round";
  ctx.shadowColor = rgba(color, k);
  ctx.shadowBlur = 16;
  ctx.beginPath();
  ctx.moveTo(x - 60 * scale, y + 34 * scale);
  ctx.lineTo(x + 60 * scale, y - 34 * scale);
  ctx.stroke();
  ctx.restore();
  if (a.smoke) {
    const sz = 120 * scale;
    ctx.save();
    ctx.globalAlpha = k * 0.7;
    ctx.drawImage(a.smoke as never, x - sz / 2, y - sz / 2, sz, sz);
    ctx.restore();
  }
  // Damage number, rising as the strike settles.
  if (input.damage > 0) {
    const rise = (1 - k) * 26;
    const dmgColor = input.isCrit ? 0xffd54a : 0xff5a5a;
    drawText(ctx, {
      x: x - 100, y: y - 62 - rise, w: 200, align: "center",
      text: `${input.isCrit ? "CRIT " : ""}-${input.damage}`,
      weight: 900, size: input.isCrit ? 40 : 34, fill: hex(dmgColor),
      shadow: "rgba(0,0,0,1)", shadowBlur: 5, alpha: clamp01(k + 0.3),
    });
  }
}

function drawFloatingText(ctx: Ctx, cx: number, y: number, text: string, color: number, k: number): void {
  drawText(ctx, {
    x: cx - 100, y: y - k * 20, w: 200, align: "center", text,
    weight: 900, size: 30, fill: hex(color), shadow: "rgba(0,0,0,1)", shadowBlur: 4, alpha: 1 - k,
  });
}

function drawMoveBanner(ctx: Ctx, input: SiegeFieldInput): void {
  const actor = input.actingSide === 0 ? input.attacker : input.defender;
  // Bullet (U+2022) not middle-dot (U+00B7): Orbitron ships the former, and
  // @napi-rs/canvas renders a missing glyph as a tofu box rather than falling
  // back per-glyph the way the old cairo backend did.
  const text = `${actor.name} • ${input.moveName}`;
  const w = Math.min(560, 60 + text.length * 12);
  const x = FIELD.width / 2 - w / 2, y = 18;
  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,0.6)";
  ctx.shadowBlur = 10;
  fillRoundRect(ctx, x, y, w, 40, 20, "rgba(10,14,20,0.72)");
  ctx.restore();
  strokeRoundRect(ctx, x, y, w, 40, 20, hex(input.accent), 2);
  drawText(ctx, { x, y: y + 12, w, align: "center", text, weight: 700, size: 17, fill: "#f5f7fa", maxWidth: w - 24 });
}

function drawTurnChip(ctx: Ctx, label: string, accent: number): void {
  const w = 30 + label.length * 9;
  fillRoundRect(ctx, 16, 16, w, 28, 14, "rgba(10,14,20,0.7)");
  strokeRoundRect(ctx, 16, 16, w, 28, 14, hex(accent), 1.5);
  drawText(ctx, { x: 16, y: 24, w, align: "center", text: label, weight: 700, size: 13, fill: "#cfe3ff" });
}

function drawKoStamp(ctx: Ctx, x: number, k: number): void {
  const s = lerp(1.6, 1.0, easeOut(k));
  const cyStamp = GROUND_Y - 150 + 32;
  ctx.save();
  ctx.translate(x, cyStamp);
  ctx.rotate((-8 * Math.PI) / 180);
  ctx.globalAlpha = clamp01(k * 1.4);
  ctx.fillStyle = "#ff3b3b";
  ctx.font = `900 ${64 * s}px "${FONT}"`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.shadowColor = "rgba(0,0,0,1)";
  ctx.shadowBlur = 8;
  ctx.fillText("K.O.", 0, 0);
  ctx.restore();
}

// object-fit: cover — returns the draw dims + offset to fill wxh with the image.
function cover(iw: number, ih: number, w: number, h: number): { dw: number; dh: number; dx: number; dy: number } {
  if (!iw || !ih) return { dw: w, dh: h, dx: 0, dy: 0 };
  const scale = Math.max(w / iw, h / ih);
  const dw = iw * scale, dh = ih * scale;
  return { dw, dh, dx: (w - dw) / 2, dy: (h - dh) / 2 };
}
