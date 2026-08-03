// ─────────────────────────────────────────────────────────────────────────────
// DN Cards — Animated spawn reveals
//
// Turns the plain "card appeared" image into a short, looping reveal GIF that is
// generated automatically as part of the normal spawn render. Three modes, each
// mapped to a difficulty tier so rarer cards get a more dramatic reveal:
//
//   • Easy   → Blur Reveal       — starts heavily blurred, sharpens to clear.
//   • Medium → Puzzle Reveal     — puzzle tiles pop in randomly until complete.
//   • Hard   → Silhouette Reveal — starts as a dark, desaturated silhouette and
//                                  gains colour + light.
//
// Reuses the installed libraries: `sharp` for the heavy image processing (blur /
// brightness / saturation stages) and the existing canvas + gifencoder pipeline
// (engine.encodeAnimation) for compositing and encoding. Every path is
// best-effort: any failure returns null and the spawn falls back to the static
// card image, so the reveal can never break a spawn.
// ─────────────────────────────────────────────────────────────────────────────

import type { Rarity } from "../cards-data.js";
import type { AnimationSpeed } from "./types.js";
import {
  getCanvas, encodeAnimation, drawGradientBackground, hexToRgba, roundRectPath,
  clamp01, type Ctx,
} from "./engine.js";
import { queueRender } from "./render-queue.js";
import {
  loadArtBuffer, drawCardArt, drawRarityGlow, drawCardFrame, drawRarityBadge,
  drawFoilOverlay, drawHoloSparkles, drawShineSweep, drawTitle, drawTextWithShadow,
  fitText, TITLE_FONT, getRarityEffectColor,
} from "./effects.js";
import { logger } from "../../lib/logger.js";

export type RevealMode = "blur" | "puzzle" | "silhouette";

// Difficulty mapping: rarer cards earn a harder (more hidden) reveal. This is
// the automatic default; a caller may pass an explicit mode to override it.
export function revealModeForRarity(rarity: Rarity): RevealMode {
  switch (rarity) {
    case "common":
    case "uncommon":
      return "blur";       // Easy
    case "rare":
    case "epic":
      return "puzzle";     // Medium
    case "legendary":
    case "mythic":
      return "silhouette"; // Hard
    default:
      return "blur";
  }
}

export interface SpawnRevealInput {
  artUrl: string | null | undefined;
  rarity: Rarity;
  rarityLabel: string;
  rarityColor?: number | null;
  mode?: RevealMode;      // overrides the rarity-derived default
}

// Canvas geometry — a compact framed portrait. The spawn embed already carries
// the title/rarity/worth/hint text, so the reveal image is deliberately
// art-forward.
const WIDTH = 480;
const HEIGHT = 600;
const PANEL = { x: 34, y: 60, w: 412, h: 486 } as const;

// Puzzle grid — larger, clearer pieces so each one reads as it snaps in.
const PUZZLE_COLS = 4, PUZZLE_ROWS = 5, PUZZLE_TILES = PUZZLE_COLS * PUZZLE_ROWS;

type LoadedImage = import("@napi-rs/canvas").Image;

let _sharp: ((buf: Buffer) => SharpInstance) | null | undefined;
interface SharpInstance {
  resize(w: number, h: number, opts?: { fit?: string; position?: string }): SharpInstance;
  blur(sigma?: number): SharpInstance;
  modulate(opts: { brightness?: number; saturation?: number; hue?: number }): SharpInstance;
  png(): SharpInstance;
  toBuffer(): Promise<Buffer>;
}

async function loadSharp(): Promise<((buf: Buffer) => SharpInstance) | null> {
  if (_sharp !== undefined) return _sharp;
  try {
    const mod = await import("sharp");
    _sharp = (mod.default ?? mod) as unknown as (buf: Buffer) => SharpInstance;
  } catch (err) {
    logger.debug({ err }, "spawn-reveal: sharp not available");
    _sharp = null;
  }
  return _sharp;
}

// Deterministic tile order for the puzzle reveal (stable per card art so a card
// always reveals the same way). Fisher–Yates seeded by a hash of the URL.
function seededTileOrder(count: number, seedStr: string): number[] {
  let h = 2166136261;
  for (let i = 0; i < seedStr.length; i++) { h ^= seedStr.charCodeAt(i); h = Math.imul(h, 16777619); }
  const rand = () => {
    h ^= h << 13; h ^= h >>> 17; h ^= h << 5; h >>>= 0;
    return h / 0xffffffff;
  };
  const order = Array.from({ length: count }, (_, i) => i);
  for (let i = count - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [order[i], order[j]] = [order[j]!, order[i]!];
  }
  return order;
}

// Clip to the rounded art panel and paint a solid backer (so any gaps read as
// dark card stock, never transparent).
function clipPanel(ctx: Ctx): void {
  roundRectPath(ctx, PANEL.x, PANEL.y, PANEL.w, PANEL.h, 16);
  ctx.clip();
  ctx.fillStyle = "#0b0c11";
  ctx.fillRect(PANEL.x, PANEL.y, PANEL.w, PANEL.h);
}

// Allocate a canvas, draw, encode a single PNG. Best-effort → null. Routed
// through the shared render queue so a spawn frame never spikes CPU next to a
// battle/pack render.
async function renderPng(width: number, height: number, draw: (ctx: Ctx) => void): Promise<Buffer | null> {
  return queueRender("reveal", async () => {
    const mod = await getCanvas();
    if (!mod) return null;
    try {
      const canvas = mod.createCanvas(width, height);
      const ctx = canvas.getContext("2d") as unknown as Ctx;
      draw(ctx);
      return await canvas.encode("png");
    } catch (err) {
      logger.debug({ err }, "spawn-reveal: png render failed");
      return null;
    }
  });
}

// A live spawn reveal. Prepares the art once, then renders a single framed PNG
// for any progress in [0,1] — 0 = fully hidden, 1 = fully revealed. The spawn
// manager posts frame 0 and edits the message with rising progress across the
// WHOLE catch window, so the reveal lasts the entire guessing period and stops
// the instant the card is caught or the window ends. All best-effort.
export interface SpawnRevealSession {
  mode: RevealMode;
  maxSteps: number;     // natural number of reveal steps (puzzle = tile count)
  renderFrame(progress: number): Promise<Buffer | null>;
}

export async function createSpawnRevealSession(input: SpawnRevealInput): Promise<SpawnRevealSession | null> {
  const mod = await getCanvas();
  if (!mod) return null;
  const src = await loadArtBuffer(input.artUrl);
  if (!src) return null;
  const sharpFn = await loadSharp();
  if (!sharpFn) return null;

  const mode = input.mode ?? revealModeForRarity(input.rarity);
  const color = input.rarityColor ?? getRarityEffectColor(input.rarity);

  // Cover-fit the art once; per-frame effects run on this buffer.
  let base: Buffer;
  try {
    base = await sharpFn(src).resize(PANEL.w, PANEL.h, { fit: "cover", position: "center" }).png().toBuffer();
  } catch (err) {
    logger.debug({ err }, "spawn-reveal: base resize failed");
    return null;
  }

  // Puzzle draws the clear art clipped to revealed tiles — decode it once.
  const clearImg = mode === "puzzle" ? await mod.loadImage(base).catch(() => null) : null;
  if (mode === "puzzle" && !clearImg) return null;
  const tileOrder = mode === "puzzle" ? seededTileOrder(PUZZLE_TILES, String(input.artUrl)) : [];

  // Draw the framed card at a given progress with an already-prepared art image
  // (blur/silhouette). Puzzle ignores `art` and reveals clear-art tiles instead.
  const drawFrame = (ctx: Ctx, progress: number, art: LoadedImage | null): void => {
    drawGradientBackground(ctx, WIDTH, HEIGHT, [
      [0, hexToRgba(color, 0.3)],
      [0.55, "#0c0e14"],
      [1, "#07080d"],
    ], 0.32);
    drawTextWithShadow(ctx, "A DN CARD APPEARS", WIDTH / 2, 34, "#d7dbe6", 20);
    drawRarityGlow(ctx, PANEL.x, PANEL.y, PANEL.w, PANEL.h, color, 0.35 + 0.5 * progress);

    ctx.save();
    clipPanel(ctx); // dark backer — this IS the "completely hidden" starting state
    if (mode === "puzzle") {
      const revealed = Math.round(progress * PUZZLE_TILES);
      const tw = PANEL.w / PUZZLE_COLS, th = PANEL.h / PUZZLE_ROWS;
      for (let k = 0; k < revealed; k++) {
        const tile = tileOrder[k]!;
        const cx = tile % PUZZLE_COLS, cy = Math.floor(tile / PUZZLE_COLS);
        const dx = PANEL.x + cx * tw, dy = PANEL.y + cy * th;
        ctx.save();
        roundRectPath(ctx, dx, dy, tw, th, 3);
        ctx.clip();
        if (clearImg) ctx.drawImage(clearImg, PANEL.x, PANEL.y, PANEL.w, PANEL.h);
        ctx.restore();
        // Freshly-placed pieces flash a bright white edge — the "snap" pop.
        const fresh = k >= revealed - 2;
        ctx.save();
        ctx.lineWidth = fresh ? 2.5 : 1;
        ctx.strokeStyle = fresh ? "rgba(255,255,255,0.9)" : hexToRgba(color, 0.45);
        roundRectPath(ctx, dx + 0.75, dy + 0.75, tw - 1.5, th - 1.5, 3);
        ctx.stroke();
        ctx.restore();
      }
      // Seams so the un-revealed area reads as a grid of pieces to fill.
      ctx.save();
      ctx.lineWidth = 1;
      ctx.strokeStyle = "rgba(255,255,255,0.12)";
      for (let c = 1; c < PUZZLE_COLS; c++) {
        const gx = PANEL.x + c * tw;
        ctx.beginPath(); ctx.moveTo(gx, PANEL.y); ctx.lineTo(gx, PANEL.y + PANEL.h); ctx.stroke();
      }
      for (let r = 1; r < PUZZLE_ROWS; r++) {
        const gy = PANEL.y + r * th;
        ctx.beginPath(); ctx.moveTo(PANEL.x, gy); ctx.lineTo(PANEL.x + PANEL.w, gy); ctx.stroke();
      }
      ctx.restore();
    } else if (art) {
      ctx.drawImage(art, PANEL.x, PANEL.y, PANEL.w, PANEL.h);
    }
    ctx.restore();

    drawCardFrame(ctx, PANEL.x, PANEL.y, PANEL.w, PANEL.h, color, 6);
    drawRarityBadge(ctx, PANEL.x + PANEL.w - 12, PANEL.y + 12, input.rarityLabel, color);
  };

  const renderFrame = async (progressIn: number): Promise<Buffer | null> => {
    const progress = clamp01(progressIn);
    let art: LoadedImage | null = clearImg;
    try {
      if (mode === "blur") {
        // Heavy blur → clear, in small continuous steps across the window.
        const sigma = (1 - progress) * 26;
        art = sigma > 0.4
          ? await mod.loadImage(await sharpFn(base).blur(sigma).png().toBuffer())
          : await mod.loadImage(base);
      } else if (mode === "silhouette") {
        // Dark, desaturated silhouette → full brightness, colour & detail.
        const brightness = 0.06 + progress * 0.94;
        const saturation = 0.12 + progress * 0.88;
        const sBlur = (1 - progress) * 5;
        let p = sharpFn(base).modulate({ brightness, saturation });
        if (sBlur > 0.4) p = p.blur(sBlur);
        art = await mod.loadImage(await p.png().toBuffer());
      }
    } catch (err) {
      logger.debug({ err }, "spawn-reveal: frame effect failed");
      art = clearImg; // fall back to the clear art for this frame
    }
    return renderPng(WIDTH, HEIGHT, ctx => drawFrame(ctx, progress, art));
  };

  return { mode, maxSteps: mode === "puzzle" ? PUZZLE_TILES : 24, renderFrame };
}

// ── Shiny reveal ─────────────────────────────────────────────────────────────
// A looping sparkle/shine animation played when a SHINY is caught or pulled, so
// a shiny is instantly recognisable. Reuses the same canvas+gifencoder pipeline
// and the existing holo/foil/shine effect helpers. Best-effort → null (caller
// falls back to the static shiny canvas + ✨ badge).
export interface ShinyRevealInput {
  artUrl: string | null | undefined;
  rarity: Rarity;
  rarityLabel: string;
  rarityColor?: number | null;
  name: string;
  speed?: AnimationSpeed;
}

export async function renderShinyReveal(input: ShinyRevealInput): Promise<Buffer | null> {
  const mod = await getCanvas();
  if (!mod) return null;
  // Require the art to be loadable up-front so we don't emit a frame-less card.
  const probe = await loadArtBuffer(input.artUrl);
  if (!probe) return null;

  const color = input.rarityColor ?? getRarityEffectColor(input.rarity);
  const gold = 0xf1c40f;
  try {
    const result = await encodeAnimation({
      width: WIDTH,
      height: HEIGHT,
      speed: input.speed ?? "normal",
      durationMs: 2400,
      maxFrames: 24,
      quality: 20,
      render: async ({ ctx, t, mod: m }) => {
        // Warm, shiny gold-tinted backdrop.
        drawGradientBackground(ctx, WIDTH, HEIGHT, [
          [0, hexToRgba(gold, 0.32)],
          [0.5, "#141007"],
          [1, "#0a0803"],
        ], 0.32);
        drawTitle(ctx, "✨ SHINY! ✨", WIDTH / 2, 36, "#ffe27a", 26);

        // Pulsing glow behind the card.
        const pulse = 0.7 + 0.3 * Math.sin(t * Math.PI * 2);
        drawRarityGlow(ctx, PANEL.x, PANEL.y, PANEL.w, PANEL.h, gold, pulse);

        // Card art + animated holo/foil/shine layered on top.
        ctx.save();
        clipPanel(ctx);
        await drawCardArt(ctx, m, PANEL.x, PANEL.y, PANEL.w, PANEL.h, input.artUrl);
        drawFoilOverlay(ctx, PANEL.x, PANEL.y, PANEL.w, PANEL.h, t);
        drawHoloSparkles(ctx, PANEL.x, PANEL.y, PANEL.w, PANEL.h, t, 28);
        drawShineSweep(ctx, PANEL.x, PANEL.y, PANEL.w, PANEL.h, t, 0xffffff);
        ctx.restore();

        drawCardFrame(ctx, PANEL.x, PANEL.y, PANEL.w, PANEL.h, gold, 6);
        drawRarityBadge(ctx, PANEL.x + PANEL.w - 12, PANEL.y + 12, input.rarityLabel, color);

        // Name below the card.
        const nameY = PANEL.y + PANEL.h + 32;
        drawTitle(ctx, `✨ ${input.name}`, WIDTH / 2, nameY, "#ffffff", fitText(ctx, `✨ ${input.name}`, WIDTH - 60, 28, 14, TITLE_FONT));
      },
    });
    return result?.buffer ?? null;
  } catch (err) {
    logger.debug({ err }, "shiny-reveal: encode failed");
    return null;
  }
}

// ── Shiny showcase ───────────────────────────────────────────────────────────
// A premium, looping "show off" animation for the /show-shiny command. It reuses
// the exact holo/foil/shine effect stack as the shiny catch reveal, but dressed
// as a trophy showcase: the owner's chosen shiny front-and-centre with its
// level, star rank and shiny copy-count called out. Best-effort → null (the
// caller falls back to a plain embed).
export interface ShinyShowcaseInput {
  artUrl: string | null | undefined;
  rarity: Rarity;
  rarityLabel: string;
  rarityColor?: number | null;
  name: string;
  ownerName: string;
  level?: number;
  stars?: number;       // 0–5 filled
  shinyCount?: number;  // shiny copies owned
  shinyLabel?: string;  // the guild's shiny name (default "Shiny")
  speed?: AnimationSpeed;
}

// Compact showcase geometry: a slightly shorter card panel than the catch
// reveal, leaving room below for the card name AND a meta line.
const SHOWCASE_PANEL = { x: 40, y: 66, w: 400, h: 452 } as const;

export async function renderShinyShowcase(input: ShinyShowcaseInput): Promise<Buffer | null> {
  const mod = await getCanvas();
  if (!mod) return null;
  // Require the art to be loadable up-front so we never emit a frame-less card.
  const probe = await loadArtBuffer(input.artUrl);
  if (!probe) return null;

  const color = input.rarityColor ?? getRarityEffectColor(input.rarity);
  const gold = 0xf1c40f;
  const stars = Math.max(0, Math.min(5, Math.round(input.stars ?? 0)));
  const P = SHOWCASE_PANEL;
  try {
    const result = await encodeAnimation({
      width: WIDTH,
      height: HEIGHT,
      speed: input.speed ?? "normal",
      durationMs: 2600,
      maxFrames: 20,
      // GIF encode time scales with encoded pixel count, so the showcase is
      // rendered at ~0.72 scale (346×432 — still comfortably above Discord's
      // inline display size) with a coarser NeuQuant sample factor. Keeps the
      // command feeling instant instead of spending seconds in the encoder.
      quality: 26,
      renderScale: 0.72,
      render: async ({ ctx, t, mod: m }) => {
        // Warm, shiny gold-tinted backdrop.
        drawGradientBackground(ctx, WIDTH, HEIGHT, [
          [0, hexToRgba(gold, 0.30)],
          [0.5, "#141007"],
          [1, "#0a0803"],
        ], 0.30);

        // Owner banner up top.
        const banner = `✨ ${input.ownerName}'s Shiny ✨`;
        drawTitle(ctx, banner, WIDTH / 2, 36, "#ffe27a", fitText(ctx, banner, WIDTH - 48, 24, 14, TITLE_FONT));

        // Pulsing glow behind the card.
        const pulse = 0.7 + 0.3 * Math.sin(t * Math.PI * 2);
        drawRarityGlow(ctx, P.x, P.y, P.w, P.h, gold, pulse);

        // Card art + animated holo/foil/shine layered on top.
        ctx.save();
        roundRectPath(ctx, P.x, P.y, P.w, P.h, 16);
        ctx.clip();
        ctx.fillStyle = "#0b0c11";
        ctx.fillRect(P.x, P.y, P.w, P.h);
        await drawCardArt(ctx, m, P.x, P.y, P.w, P.h, input.artUrl);
        drawFoilOverlay(ctx, P.x, P.y, P.w, P.h, t);
        drawHoloSparkles(ctx, P.x, P.y, P.w, P.h, t, 30);
        drawShineSweep(ctx, P.x, P.y, P.w, P.h, t, 0xffffff);
        ctx.restore();

        drawCardFrame(ctx, P.x, P.y, P.w, P.h, gold, 6);
        drawRarityBadge(ctx, P.x + P.w - 12, P.y + 12, input.rarityLabel, color);

        // Name below the card.
        const nameY = P.y + P.h + 30;
        const nameText = `✨ ${input.name}`;
        drawTitle(ctx, nameText, WIDTH / 2, nameY, "#ffffff", fitText(ctx, nameText, WIDTH - 60, 26, 14, TITLE_FONT));

        // Meta line: level · stars · shiny count.
        const meta: string[] = [];
        if (input.level && input.level > 1) meta.push(`Lv ${input.level}`);
        if (stars > 0) meta.push("★".repeat(stars) + "☆".repeat(5 - stars));
        const count = input.shinyCount ?? 0;
        if (count > 0) meta.push(`${input.shinyLabel ?? "Shiny"} ×${count}`);
        if (meta.length) {
          drawTextWithShadow(ctx, meta.join("   ·   "), WIDTH / 2, nameY + 28, "#ffe27a", 16);
        }
      },
    });
    return result?.buffer ?? null;
  } catch (err) {
    logger.debug({ err }, "shiny-showcase: encode failed");
    return null;
  }
}
