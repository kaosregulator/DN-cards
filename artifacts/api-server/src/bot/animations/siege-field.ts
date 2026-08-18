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

// One card in a side's full battle line — every card is drawn on its own stand,
// so both teams show all four plaques at once (a mini "Raids of Legends" board),
// not just the active pair.
export interface SiegeFieldLineupCard {
  name: string;
  artUrl: string | null;
  rarity: string;
  rarityColor: number | null;
  hp: number;                   // AFTER the move
  maxHp: number;
  hpBefore?: number;            // BEFORE the move — only set on the struck FOCUS card
  energy?: number;
  fallen: boolean;              // KO'd — dim + broken
  active: boolean;              // the front rank of this side (drives the slide)
  struck?: boolean;             // took this turn's blow (white flash + knockback)
}

export interface SiegeFieldInput {
  attacker: SiegeFieldFighter;   // side 0 — stands on the LEFT (the acting/target pair)
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
  // fallen — rendered as small standees behind the active fighter (legacy).
  attackerBench?: SiegeFieldBenchCard[];
  defenderBench?: SiegeFieldBenchCard[];
  // Full battle line for each side, ordered ACTIVE-first then the rest. When
  // present, the renderer draws every card on its own stand (up to 4/side) and
  // the active card slides forward to strike; the single attacker/defender above
  // are still used for the HUD life-plates. Absent → legacy single-stand look.
  attackerLineup?: SiegeFieldLineupCard[];
  defenderLineup?: SiegeFieldLineupCard[];
  aoe?: boolean;                 // team ultimate — the whole enemy line is struck
}

const FIELD = { width: 900, height: 470 } as const;
const MAX_BYTES = 8_000_000;
// Physical pixels per logical unit at encode time. GIF encoding (NeuQuant) costs
// scale with pixel COUNT, and it dominates a turn's render time — drawing stays
// at the full logical resolution (crisp art + text) while the encoded frame is
// shrunk to keep a turn snappy. 0.6 matches /battle turn GIFs so Discord inline
// display and encode cost stay in the same ballpark.
const RENDER_SCALE = 0.6;

// ── "Raids of Legends" arena config ──────────────────────────────────────────
// The siege battlefield is themed after a mini raid arena: a stone lists with a
// mountain skybox, two ornate card STANDS (blue = raider on the left, red =
// garrison on the right) that hold each active card's art in their plaque, and a
// HUD of PLAYER / OPPONENT life-plates. All three scene sprites live in the HQ
// art pack under `siege-scene/` and are resolved through the same asset seam as
// every other HQ visual — if the pack is missing, the renderer falls back to the
// procedural stage below so a siege never breaks on a missing file.
const SCENE_PREFIX = "siege-scene";
// Plaque face of each stand as a parallelogram, in the stand sprite's own
// normalised space (0..1). The card art is drawn BEHIND the stand and clipped to
// this quad; the sprite's gold frame + base rail then occlude it exactly like a
// real card seated in the stand. Corners: top-left, top-right, bottom-left
// (bottom-right is derived — an iso rectangle projects to a parallelogram).
const PLAQUE_QUAD = {
  blue: { tl: [0.268, 0.101], tr: [0.577, 0.216], bl: [0.341, 0.640] },
  red:  { tl: [0.428, 0.190], tr: [0.742, 0.077], bl: [0.428, 0.642] },
} as const;
// Drawn stand size + where each stand's base rests on the floor.
const STAND_W = 234, STAND_H = 318;
const STAND_GROUND_Y = 372;        // stand base contact line on the arena floor
const STAND_DX = 236;              // horizontal offset of each stand from centre

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
  // The raid arena + two card stands. A missing pack leaves these null and the
  // renderer draws the procedural stage instead (see drawArena / drawStand).
  const arenaPath = sprite(SCENE_PREFIX, "arena");
  const standBluePath = sprite(SCENE_PREFIX, "stand-blue");
  const standRedPath = sprite(SCENE_PREFIX, "stand-red");
  // Legacy stage fallbacks (used only when the raid-arena pack is absent).
  const backdropPath = sprite("backdrop", input.backdropKey || "castles") ?? sprite("backdrop", "grass");
  const floorPath = sprite("floor", input.floorKey || "stone") ?? sprite("floor", "blue-stone");
  const flashPath = sprite("fx", "flash01") ?? sprite("fx", "flash00");
  const smokePath = sprite("fx", "smoke00") ?? sprite("fx", "white-puff00");

  // Every card art on the board: both full lineups (up to 4/side) plus the
  // legacy bench + active fighters — de-duped so a re-render never re-fetches.
  const allCards = [
    ...(input.attackerLineup ?? []), ...(input.defenderLineup ?? []),
    ...(input.attackerBench ?? []), ...(input.defenderBench ?? []),
  ];
  const artUrls = [...new Set([
    input.attacker.artUrl, input.defender.artUrl, ...allCards.map(c => c.artUrl),
  ].filter((u): u is string => !!u))];

  const [arena, standBlue, standRed, backdrop, floor, flash, smoke, ...artLoaded] = await Promise.all([
    arenaPath ? loadSpritePath(cmod, arenaPath) : null,
    standBluePath ? loadSpritePath(cmod, standBluePath) : null,
    standRedPath ? loadSpritePath(cmod, standRedPath) : null,
    backdropPath ? loadSpritePath(cmod, backdropPath) : null,
    floorPath ? loadSpritePath(cmod, floorPath) : null,
    flashPath ? loadSpritePath(cmod, flashPath) : null,
    smokePath ? loadSpritePath(cmod, smokePath) : null,
    ...artUrls.map(u => loadArt(cmod, u)),
  ]);
  const artByUrl = new Map<string, CanvasImage | null>();
  artUrls.forEach((u, i) => artByUrl.set(u, artLoaded[i] ?? null));
  const artFor = (url: string | null): CanvasImage | null => (url ? artByUrl.get(url) ?? null : null);
  const atkArt = artFor(input.attacker.artUrl);
  const defArt = artFor(input.defender.artUrl);

  // Theme each active fighter's accent to its card art (see resolveFieldColor).
  const [atkColor, defColor] = await Promise.all([
    resolveFieldColor(input.attacker),
    resolveFieldColor(input.defender),
  ]);
  return { arena, standBlue, standRed, backdrop, floor, flash, smoke, atkArt, defArt, artByUrl, atkColor, defColor };
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
  arena: CanvasImage | null;             // raid-arena skybox + floor plate
  standBlue: CanvasImage | null;         // raider (left) card stand
  standRed: CanvasImage | null;          // garrison (right) card stand
  backdrop: CanvasImage | null; floor: CanvasImage | null; // legacy stage fallback
  flash: CanvasImage | null; smoke: CanvasImage | null;
  atkArt: CanvasImage | null; defArt: CanvasImage | null;   // active fighters (for HUD plates)
  artByUrl: Map<string, CanvasImage | null>;                // every board card's art, by url
  atkColor: number; defColor: number;   // art-themed accent per active fighter
}

// Battle-line geometry. Each side shows up to 4 stands receding OUTWARD from the
// centre: the front (active) card sits nearest the middle, largest and lowest;
// the rest step back toward the flank, smaller and higher — the mini raid board.
const GROUND_Y = STAND_GROUND_Y;   // front stand contact line on the arena floor
const STATION_DX = STAND_DX;        // (legacy) horizontal offset of a stand from centre
const PORTRAIT_W = 150, PORTRAIT_H = 150;
const LINE_MAX = 4;                 // stands drawn per side
const STAND_FRONT_DX = 120;         // front stand centre offset from mid
const STAND_GAP = 76;               // extra outward offset per rank
const STAND_RISE = 16;              // how much each deeper rank lifts (perspective)
const STAND_SCALES = [0.46, 0.415, 0.37, 0.335] as const; // front→back size
// Front-plaque vertical centre — where impact FX / damage numbers land so they
// read as hitting the CARD, not the stand base.
const PLAQUE_CY = STAND_GROUND_Y - STAND_H * STAND_SCALES[0] * 0.52;

// Where a given rank's stand centre sits, before any slide.
function standCentre(side: 0 | 1, depth: number): { cx: number; baseY: number; scale: number } {
  const dir = side === 0 ? -1 : 1;
  return {
    cx: FIELD.width / 2 + dir * (STAND_FRONT_DX + depth * STAND_GAP),
    baseY: STAND_GROUND_Y - depth * STAND_RISE,
    scale: STAND_SCALES[Math.min(depth, STAND_SCALES.length - 1)]!,
  };
}

// Plaque-centre Y for a given rank (where its impact FX / damage number land).
function plaqueCyAt(depth: number): number {
  const scale = STAND_SCALES[Math.min(depth, STAND_SCALES.length - 1)]!;
  return (STAND_GROUND_Y - depth * STAND_RISE) - STAND_H * scale * 0.52;
}

function lineupFromFighter(f: SiegeFieldFighter): SiegeFieldLineupCard {
  return { name: f.name, artUrl: f.artUrl, rarity: f.rarity, rarityColor: f.rarityColor,
    hp: f.hp, maxHp: f.maxHp, hpBefore: f.hpBefore, energy: f.energy, fallen: false, active: true };
}

interface Anim { t: number; advance: number; connected: boolean; impact: number; acting: 0 | 1; reach: number; }

// Paint the whole scene at `t`. Everything is drawn in logical (900×470)
// coordinates; callers apply any physical `scale` themselves (still PNG) or via
// encodeAnimation's renderScale (GIF).
function paintFrame(ctx: Ctx, input: SiegeFieldInput, a: Assets, t: number, scale: number): void {
  ctx.save();
  ctx.scale(scale, scale);
  ctx.textBaseline = "top";

  drawArena(ctx, a, input.accent);

  // Impact timing. The acting card slides into the middle, connects around
  // t≈0.5, then eases home. The target reacts on connect.
  const LUNGE_IN_END = 0.46, CONNECT = 0.5, LUNGE_OUT_END = 0.9;
  const lungeIn = clamp01((t - 0.12) / (LUNGE_IN_END - 0.12));
  const lungeOut = clamp01((t - CONNECT) / (LUNGE_OUT_END - CONNECT));
  const advance = easeInOut(lungeIn) * (1 - easeOut(lungeOut)); // 0→1→0
  const connected = t >= CONNECT && input.isHit;
  const impact = pulse(t, CONNECT - 0.02, CONNECT + 0.22);      // flash / shake window
  const acting = input.actingSide;
  const targetSide: 0 | 1 = acting === 0 ? 1 : 0;
  const anim: Anim = { t, advance, connected, impact, acting, reach: 150 };

  const atkLine = (input.attackerLineup && input.attackerLineup.length ? input.attackerLineup : [lineupFromFighter(input.attacker)]);
  const defLine = (input.defenderLineup && input.defenderLineup.length ? input.defenderLineup : [lineupFromFighter(input.defender)]);

  // Speed streaks stream off the charging front card while it closes the gap.
  const streakK = advance * clamp01(1 - lungeOut * 2.2);
  if (streakK > 0.02) {
    const s = standCentre(acting, 0);
    const actingDir = acting === 0 ? 1 : -1;
    drawDashStreak(ctx, s.cx + actingDir * anim.advance * anim.reach, actingDir, streakK, acting === 0 ? a.atkColor : a.defColor);
  }

  // Both battle lines (deepest rank first so the front card overlaps its rank).
  drawLine(ctx, 0, atkLine, a, anim);
  drawLine(ctx, 1, defLine, a, anim);

  // Strike FX + damage number over the struck FOCUS card (the chosen target,
  // which may be any rank — not always the front), on connect.
  const foeLine = targetSide === 0 ? atkLine : defLine;
  let focusDepth = foeLine.findIndex(c => c.hpBefore != null);
  if (focusDepth < 0) focusDepth = foeLine.findIndex(c => c.struck);
  if (focusDepth < 0) focusDepth = 0;
  const foePos = standCentre(targetSide, focusDepth);
  const foeDir = targetSide === 0 ? -1 : 1;
  const targetX = foePos.cx + foeDir * impact * 16;
  const targetY = plaqueCyAt(focusDepth);
  if (connected) {
    drawImpact(ctx, a, targetX, targetY, impact, input);
  } else if (t >= CONNECT && !input.isHit) {
    drawFloatingText(ctx, targetX, targetY - 56, "MISS", 0x9aa7b4, clamp01((t - CONNECT) / 0.4));
  }

  // HUD: the two life-plates + the VS crest, then the play-by-play + turn call.
  drawLifePlate(ctx, 0, input.attacker, a.atkArt, a.atkColor);
  drawLifePlate(ctx, 1, input.defender, a.defArt, a.defColor);
  drawVsCrest(ctx);
  drawMoveBanner(ctx, input);
  drawTurnBar(ctx, input);
  if (input.ko && t > 0.72) drawKoStamp(ctx, targetX, clamp01((t - 0.72) / 0.28));

  ctx.restore();
}

// Draw one side's whole battle line, deepest rank first.
function drawLine(ctx: Ctx, side: 0 | 1, cards: SiegeFieldLineupCard[], a: Assets, anim: Anim): void {
  const stand = side === 0 ? a.standBlue : a.standRed;
  const color = side === 0 ? a.atkColor : a.defColor;
  const dir = side === 0 ? -1 : 1;
  const n = Math.min(cards.length, LINE_MAX);
  const struckThisTurn = anim.acting !== side && anim.connected;
  for (let d = n - 1; d >= 0; d--) {
    const card = cards[d]!;
    const pos = standCentre(side, d);
    let slideX = 0, flash = 0, bob = 0;
    if (card.active) {
      bob = Math.sin(anim.t * Math.PI * 2 + (side === 1 ? Math.PI : 0)) * 3;
      if (anim.acting === side) slideX = -dir * anim.advance * anim.reach;   // charge toward the foe
    }
    // Any struck card (the focus, or every card on an AoE) flashes white and is
    // knocked back on connect.
    if (struckThisTurn && card.struck && !card.fallen) { flash = anim.impact; slideX += dir * anim.impact * 14; }
    const art = card.artUrl ? a.artByUrl.get(card.artUrl) ?? null : null;
    drawStand(ctx, { cx: pos.cx + slideX, baseY: pos.baseY + bob, scale: pos.scale, side, stand, art, color, card, flashWhite: flash });
  }
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

function drawArena(ctx: Ctx, a: Assets, accent: number): void {
  // Base wash — always drawn, so a missing arena still looks deliberate.
  ctx.fillStyle = vGradient(ctx, 0, 0, FIELD.height, [[0, "#101827"], [0.5, "#182236"], [1, "#0a0e16"]]);
  ctx.fillRect(0, 0, FIELD.width, FIELD.height);

  if (a.arena) {
    // The raid arena plate (mountain skybox + stone lists) fills the frame.
    const { dw, dh, dx, dy } = cover(a.arena.width, a.arena.height, FIELD.width, FIELD.height);
    ctx.drawImage(a.arena as never, dx, dy, dw, dh);
  } else {
    // Legacy procedural stage (backdrop strip + tiled floor band).
    if (a.backdrop) {
      const { dw, dh, dx, dy } = cover(a.backdrop.width, a.backdrop.height, FIELD.width, FIELD.height * 0.82);
      ctx.save(); ctx.globalAlpha = 0.9; ctx.drawImage(a.backdrop as never, dx, dy, dw, dh); ctx.restore();
    }
    const bandTop = GROUND_Y - 44;
    if (a.floor) {
      const tile = 84;
      ctx.save(); ctx.globalAlpha = 0.96;
      for (let x = 0; x < FIELD.width; x += tile) ctx.drawImage(a.floor as never, x, bandTop, tile, FIELD.height - bandTop);
      ctx.restore();
    }
  }

  // Warm/cool split glow along the centre line — sells the "your side vs theirs"
  // divide and ties the stage to the siege accent.
  ctx.save();
  ctx.globalAlpha = 0.20;
  const split = ctx.createLinearGradient(0, 0, FIELD.width, 0);
  split.addColorStop(0, "rgba(56,120,220,0.9)");
  split.addColorStop(0.5, "rgba(0,0,0,0)");
  split.addColorStop(1, "rgba(214,64,64,0.9)");
  ctx.fillStyle = split;
  ctx.fillRect(0, 0, FIELD.width, FIELD.height);
  ctx.restore();

  // Accent haze low on the floor.
  ctx.save();
  ctx.globalAlpha = 0.28;
  ctx.fillStyle = vGradient(ctx, 0, GROUND_Y - 40, GROUND_Y + 40, [[0, "rgba(0,0,0,0)"], [1, hex(accent)]]);
  ctx.fillRect(0, GROUND_Y - 40, FIELD.width, 80);
  ctx.restore();

  // Cinematic vignette + top scrim so the HUD reads over any sky.
  const vg = ctx.createRadialGradient(FIELD.width / 2, FIELD.height * 0.52, 280, FIELD.width / 2, FIELD.height * 0.52, 620);
  vg.addColorStop(0, "rgba(0,0,0,0)");
  vg.addColorStop(1, "rgba(0,0,0,0.52)");
  ctx.fillStyle = vg;
  ctx.fillRect(0, 0, FIELD.width, FIELD.height);
  ctx.fillStyle = vGradient(ctx, 0, 0, 96, [[0, "rgba(6,9,16,0.66)"], [1, "rgba(6,9,16,0)"]]);
  ctx.fillRect(0, 0, FIELD.width, 96);
}

interface StandOpts {
  cx: number; baseY: number; scale: number; side: 0 | 1;
  stand: CanvasImage | null; art: CanvasImage | null;
  color: number; card: SiegeFieldLineupCard; flashWhite: number;
}

// Draw one card stand: the card art is laid into the plaque FIRST (clipped to the
// plaque parallelogram), then the ornate stand sprite is drawn over it — the
// sprite's gold frame + base rail occlude the art exactly like a seated card. A
// missing stand sprite falls back to a framed floating portrait (legacy look).
// Active cards get an accent ring; fallen cards are dimmed and marked broken.
function drawStand(ctx: Ctx, o: StandOpts): void {
  const color = o.color;
  const dw = STAND_W * o.scale, dh = STAND_H * o.scale;
  const sx = o.cx - dw / 2;
  const sy = o.baseY - dh;
  const fallen = o.card.fallen;

  // Contact shadow on the floor.
  ellipse(ctx, o.cx, o.baseY - 6 * o.scale, dw * 0.40, 15 * o.scale, "rgba(0,0,0,0.42)");

  if (!o.stand) { drawLegacyPortrait(ctx, o, dw, dh, sx, sy); return; }

  const quad = o.side === 0 ? PLAQUE_QUAD.blue : PLAQUE_QUAD.red;
  const TL = { x: sx + quad.tl[0] * dw, y: sy + quad.tl[1] * dh };
  const TR = { x: sx + quad.tr[0] * dw, y: sy + quad.tr[1] * dh };
  const BL = { x: sx + quad.bl[0] * dw, y: sy + quad.bl[1] * dh };
  const BR = { x: TR.x + (BL.x - TL.x), y: TR.y + (BL.y - TL.y) };
  const quadPath = () => { ctx.beginPath(); ctx.moveTo(TL.x, TL.y); ctx.lineTo(TR.x, TR.y); ctx.lineTo(BR.x, BR.y); ctx.lineTo(BL.x, BL.y); ctx.closePath(); };

  // Active card: a soft accent aura behind the whole stand so the current
  // fighter reads at a glance.
  if (o.card.active) {
    ctx.save(); ctx.globalAlpha = 0.55; ctx.shadowColor = rgba(color, 0.95); ctx.shadowBlur = 26;
    quadPath(); ctx.strokeStyle = rgba(color, 0.35); ctx.lineWidth = 3; ctx.stroke(); ctx.restore();
  }

  // Card art laid into the plaque parallelogram, behind the stand.
  ctx.save();
  quadPath(); ctx.clip();
  ctx.fillStyle = "#0b1220"; ctx.fill();                        // backing while art loads
  if (o.art) drawArtInQuad(ctx, o.art, TL, TR, BL);
  else drawText(ctx, { x: (TL.x + BR.x) / 2 - 40, y: (TL.y + BR.y) / 2 - 24 * o.scale, w: 80, align: "center",
    text: (o.card.name[0] || "?").toUpperCase(), weight: 900, size: 46 * o.scale, fill: rgba(color, 0.9) });
  if (fallen) { ctx.globalAlpha = 0.62; ctx.fillStyle = "#05070c"; ctx.fill(); }   // dim the dead
  if (o.flashWhite > 0.01) { ctx.globalAlpha = 0.6 * o.flashWhite; ctx.fillStyle = "#ffffff"; ctx.fill(); }
  ctx.restore();

  // The ornate stand over the art (desaturated a touch when fallen).
  if (fallen) ctx.save(), ctx.globalAlpha = 0.72;
  ctx.drawImage(o.stand as never, sx, sy, dw, dh);
  if (fallen) ctx.restore();

  // Broken-rank cross on the fallen.
  if (fallen) {
    const mx = (TL.x + BR.x) / 2, my = (TL.y + BR.y) / 2, r = 20 * o.scale;
    ctx.save(); ctx.globalAlpha = 0.9; ctx.strokeStyle = "#ff5a5a"; ctx.lineWidth = 4 * o.scale; ctx.lineCap = "round";
    ctx.beginPath(); ctx.moveTo(mx - r, my - r); ctx.lineTo(mx + r, my + r); ctx.moveTo(mx + r, my - r); ctx.lineTo(mx - r, my + r); ctx.stroke(); ctx.restore();
  }

  // Per-stand HP bar under the base, so every card on the board shows its life.
  drawStandHp(ctx, o.cx, o.baseY + 6 * o.scale, dw * 0.82, o.card, color, fallen);
}

// A slim HP bar beneath a stand (pre-hit ghost + live fill + name-less).
function drawStandHp(ctx: Ctx, cx: number, y: number, w: number, card: SiegeFieldLineupCard, color: number, fallen: boolean): void {
  const x = cx - w / 2, h = 7;
  const now = clamp01(card.hp / Math.max(1, card.maxHp));
  const ghost = clamp01((card.hpBefore ?? card.hp) / Math.max(1, card.maxHp));
  fillRoundRect(ctx, x, y, w, h, 3.5, "rgba(8,11,18,0.9)");
  if (!fallen) {
    fillRoundRect(ctx, x + 1, y + 1, (w - 2) * ghost, h - 2, 2.5, "rgba(220,60,60,0.4)");
    const c = now > 0.5 ? hex(color) : now > 0.22 ? "#f1c40f" : "#e74c3c";
    fillRoundRect(ctx, x + 1, y + 1, Math.max(0, (w - 2) * now), h - 2, 2.5, c);
  }
  strokeRoundRect(ctx, x, y, w, h, 3.5, "rgba(0,0,0,0.6)", 1);
}

// Legacy fallback used only when a stand sprite is absent: a framed floating
// portrait, so a pack-less deploy still renders a clean face-off.
function drawLegacyPortrait(ctx: Ctx, o: StandOpts, dw: number, dh: number, sx: number, sy: number): void {
  const cstr = hex(o.color);
  const pw = dw * 0.9, ph = dh * 0.62, px = o.cx - pw / 2, py = sy + dh * 0.12;
  ctx.save(); roundRectPath(ctx, px, py, pw, ph, 12); ctx.clip();
  if (o.art) { const c = cover(o.art.width, o.art.height, pw, ph); ctx.drawImage(o.art as never, px + c.dx, py + c.dy, c.dw, c.dh); }
  else { ctx.globalAlpha = 0.5; ctx.fillStyle = cstr; ctx.fillRect(px, py, pw, ph); }
  if (o.flashWhite > 0.01) { ctx.globalAlpha = 0.6 * o.flashWhite; ctx.fillStyle = "#ffffff"; ctx.fillRect(px, py, pw, ph); }
  ctx.restore();
  strokeRoundRect(ctx, px, py, pw, ph, 12, "#0b0e13", 4);
  strokeRoundRect(ctx, px, py, pw, ph, 12, cstr, 2);
  drawStandHp(ctx, o.cx, py + ph + 5, pw * 0.9, o.card, o.color, o.card.fallen);
}

// Map a card image onto the plaque parallelogram defined by TL, TR, BL (object-
// fit: cover). An iso rectangle projects to a parallelogram, so an affine
// transform is exact — set the basis (TR−TL, BL−TL) and blit a cover-cropped
// source region into the unit square.
function drawArtInQuad(
  ctx: Ctx, art: CanvasImage,
  TL: { x: number; y: number }, TR: { x: number; y: number }, BL: { x: number; y: number },
): void {
  const ex = TR.x - TL.x, ey = TR.y - TL.y;   // top edge vector (→ unit x)
  const fx = BL.x - TL.x, fy = BL.y - TL.y;   // left edge vector (→ unit y)
  const eLen = Math.max(1, Math.hypot(ex, ey)), fLen = Math.max(1, Math.hypot(fx, fy));
  const iw = art.width, ih = art.height;
  // Under the transform, a unit of x scales by eLen and a unit of y by fLen. To
  // keep the art undistorted we draw it into a unit-space rect whose aspect
  // compensates, then cover the unit square (overflow is clipped to the quad by
  // the caller). This uses only the 3/5-arg drawImage the Ctx type exposes.
  const R = (iw / ih) * (fLen / eLen);          // desired unit-space w/h ratio
  let uw: number, uh: number, ux: number, uy: number;
  if (R >= 1) { uh = 1; uw = R; uy = 0; ux = (1 - uw) / 2; }
  else { uw = 1; uh = 1 / R; ux = 0; uy = (1 - uh) / 2; }
  ctx.save();
  ctx.transform(ex, ey, fx, fy, TL.x, TL.y);    // unit square → plaque parallelogram
  ctx.drawImage(art as never, ux, uy, uw, uh);
  ctx.restore();
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

// ── Raid HUD: corner life-plates, VS crest, turn bar ─────────────────────────
// Side identity colours — the raider is always blue, the garrison red, matching
// the two stands. The card's art accent (`color`) is used only as a soft glow.
const BLUE = 0x2f6fd0, RED = 0xd6404a, GOLD = 0xe8c15a, INK = "#0c1220";

// One corner life-plate (side 0 = top-left / blue "raider", side 1 = top-right /
// red "garrison"): a beveled panel with a portrait chip on the outer edge, the
// card name, a big HP readout and an HP bar that drains from its pre-hit ghost.
function drawLifePlate(ctx: Ctx, side: 0 | 1, f: SiegeFieldFighter, art: CanvasImage | null, accent: number): void {
  const theme = side === 0 ? BLUE : RED;
  const W = 296, H = 66, M = 12;
  const x = side === 0 ? M : FIELD.width - M - W;
  const y = 12;
  const chip = H;                                  // square portrait chip
  const chipX = side === 0 ? x : x + W - chip;     // chip on the OUTER edge
  const panelX = side === 0 ? x + chip - 6 : x - 6 + 0; // panel overlaps chip inner edge
  const bodyX = side === 0 ? x + chip + 6 : x;
  const bodyW = W - chip - 6;

  // Panel body.
  ctx.save(); ctx.shadowColor = "rgba(0,0,0,0.55)"; ctx.shadowBlur = 8;
  fillRoundRect(ctx, bodyX, y, bodyW, H, 10, "rgba(10,14,22,0.92)");
  ctx.restore();
  // Accent header strip.
  ctx.save(); roundRectPath(ctx, bodyX, y, bodyW, H, 10); ctx.clip();
  ctx.fillStyle = vGradient(ctx, 0, y, y + 22, [[0, rgba(theme, 0.55)], [1, "rgba(0,0,0,0)"]]);
  ctx.fillRect(bodyX, y, bodyW, 24);
  ctx.restore();
  strokeRoundRect(ctx, bodyX, y, bodyW, H, 10, hex(GOLD), 2);
  strokeRoundRect(ctx, bodyX, y, bodyW, H, 10, "rgba(0,0,0,0.6)", 0.6);

  // Portrait chip.
  ctx.save(); ctx.shadowColor = rgba(accent, 0.8); ctx.shadowBlur = 12;
  fillRoundRect(ctx, chipX, y, chip, H, 10, hex(theme)); ctx.restore();
  ctx.save(); roundRectPath(ctx, chipX + 3, y + 3, chip - 6, H - 6, 8); ctx.clip();
  if (art) { const c = cover(art.width, art.height, chip - 6, H - 6); ctx.drawImage(art as never, chipX + 3 + c.dx, y + 3 + c.dy, c.dw, c.dh); }
  else { ctx.fillStyle = rgba(theme, 0.6); ctx.fillRect(chipX + 3, y + 3, chip - 6, H - 6); }
  ctx.restore();
  strokeRoundRect(ctx, chipX, y, chip, H, 10, hex(GOLD), 2);

  // Name + LP number + bar inside the body.
  const pad = 12;
  const nameX = bodyX + pad, nameW = bodyW - pad * 2;
  drawText(ctx, { x: nameX, y: y + 7, w: nameW, align: side === 0 ? "left" : "right",
    text: f.name.toUpperCase(), weight: 800, size: 15, fill: "#f2f6fb", shadow: "rgba(0,0,0,0.9)", shadowBlur: 3, maxWidth: nameW });

  const hpNow = clamp01(f.hp / Math.max(1, f.maxHp));
  const hpGhost = clamp01((f.hpBefore ?? f.hp) / Math.max(1, f.maxHp));
  drawText(ctx, { x: nameX, y: y + 27, w: nameW, align: side === 0 ? "left" : "right",
    text: `LP ${Math.max(0, Math.round(f.hp))}`, weight: 900, size: 20, fill: "#ffffff", shadow: "rgba(0,0,0,0.9)", shadowBlur: 3 });

  const barY = y + H - 13, barH = 8;
  fillRoundRect(ctx, nameX, barY, nameW, barH, 4, INK);
  fillRoundRect(ctx, nameX + 1, barY + 1, (nameW - 2) * hpGhost, barH - 2, 3, "rgba(220,60,60,0.4)");
  fillRoundRect(ctx, nameX + 1, barY + 1, Math.max(0, (nameW - 2) * hpNow), barH - 2, 3, hex(theme));
  // Energy pip under the bar.
  const energy = clamp01((f.energy ?? 0) / 100);
  if (energy > 0) { fillRoundRect(ctx, nameX, barY + barH + 1, nameW, 3, 1.5, "#0a0f18"); fillRoundRect(ctx, nameX, barY + barH + 1, nameW * energy, 3, 1.5, "#38bdf8"); }
}

// The central VS crest — a gold-rimmed shield with "VS", sitting between the two
// life-plates like the mockup's medallion.
function drawVsCrest(ctx: Ctx): void {
  const cx = FIELD.width / 2, cy = 40, r = 30;
  ctx.save();
  // outer shield glow
  ctx.shadowColor = rgba(GOLD, 0.7); ctx.shadowBlur = 16;
  drawStar(ctx, cx, cy, 6, r * 0.62, r + 6, hex(GOLD), 0.95);
  ctx.restore();
  ctx.save();
  ctx.beginPath(); ctx.arc(cx, cy, r - 3, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(12,16,24,0.95)"; ctx.fill();
  ctx.lineWidth = 3; ctx.strokeStyle = hex(GOLD); ctx.stroke();
  ctx.restore();
  drawText(ctx, { x: cx - 40, y: cy - 13, w: 80, align: "center", text: "VS", weight: 900, size: 26, fill: hex(GOLD), shadow: "rgba(0,0,0,0.9)", shadowBlur: 3 });
}

// The bottom turn bar — "PLAYER TURN" (blue, left) / "TURN N" plate (centre) /
// "OPPONENT TURN" (red, right). Whoever is acting this frame lights up.
function drawTurnBar(ctx: Ctx, input: SiegeFieldInput): void {
  const y = FIELD.height - 38, h = 28;
  const raiderActive = input.actingSide === 0;
  const tag = (side: 0 | 1, label: string) => {
    const theme = side === 0 ? BLUE : RED;
    const w = 150; const x = side === 0 ? 14 : FIELD.width - 14 - w;
    const on = input.actingSide === side;
    fillRoundRect(ctx, x, y, w, h, 8, on ? rgba(theme, 0.9) : "rgba(12,16,24,0.8)");
    strokeRoundRect(ctx, x, y, w, h, 8, hex(on ? GOLD : theme), on ? 2 : 1.4);
    drawText(ctx, { x, y: y + 7, w, align: "center", text: label, weight: 800, size: 13, fill: on ? "#ffffff" : rgba(theme, 0.95), shadow: "rgba(0,0,0,0.8)", shadowBlur: 2 });
  };
  tag(0, "RAIDER TURN");
  tag(1, "GARRISON TURN");
  // Centre turn plate.
  const label = (input.turnLabel || "TURN 1").toUpperCase();
  const cw = 118, cx = FIELD.width / 2 - cw / 2;
  fillRoundRect(ctx, cx, y, cw, h, 8, "rgba(12,16,24,0.88)");
  strokeRoundRect(ctx, cx, y, cw, h, 8, hex(GOLD), 1.6);
  drawText(ctx, { x: cx, y: y + 7, w: cw, align: "center", text: label, weight: 800, size: 13, fill: "#f2e4b8", shadow: "rgba(0,0,0,0.8)", shadowBlur: 2 });
  void raiderActive;
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
  const w = Math.min(540, 64 + text.length * 12);
  // The move caption floats above the turn bar, between the two stand bases.
  const x = FIELD.width / 2 - w / 2, y = FIELD.height - 78;
  const side = input.actingSide === 0 ? BLUE : RED;
  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,0.6)";
  ctx.shadowBlur = 10;
  fillRoundRect(ctx, x, y, w, 34, 17, "rgba(10,14,20,0.82)");
  ctx.restore();
  ctx.save(); roundRectPath(ctx, x, y, w, 34, 17); ctx.clip();
  ctx.fillStyle = vGradient(ctx, 0, y, y + 34, [[0, rgba(side, 0.45)], [1, "rgba(0,0,0,0)"]]);
  ctx.fillRect(x, y, w, 34); ctx.restore();
  strokeRoundRect(ctx, x, y, w, 34, 17, hex(GOLD), 1.6);
  drawText(ctx, { x, y: y + 9, w, align: "center", text, weight: 700, size: 16, fill: "#f5f7fa", maxWidth: w - 24 });
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
