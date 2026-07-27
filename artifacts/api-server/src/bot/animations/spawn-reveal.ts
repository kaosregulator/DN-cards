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
  clamp01, easeInOutCubic, type Ctx, type CanvasMod,
} from "./engine.js";
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
  shiny?: boolean;
  mode?: RevealMode;      // overrides the rarity-derived default
  speed?: AnimationSpeed; // reuses the guild's animation speed setting
}

// Canvas geometry — a compact framed portrait. The spawn embed already carries
// the title/rarity/worth/hint text, so the GIF is deliberately art-forward.
const WIDTH = 480;
const HEIGHT = 600;
const PANEL = { x: 34, y: 60, w: 412, h: 486 } as const;

// Reveal completes at this fraction of the timeline, then holds on the clear
// card for the remainder. The engine coalesces the identical held frames, so the
// loop rests on the readable card most of the time while staying small.
const REVEAL_FRACTION = 0.72;

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

// Cover-fit the source art to the art panel, apply an effect, and decode to a
// canvas Image ready to draw 1:1 into the panel. Best-effort → null.
async function processStage(
  sharpFn: (buf: Buffer) => SharpInstance,
  mod: CanvasMod,
  src: Buffer,
  effect: (s: SharpInstance) => SharpInstance,
): Promise<LoadedImage | null> {
  try {
    const pipeline = sharpFn(src).resize(PANEL.w, PANEL.h, { fit: "cover", position: "center" });
    const out = await effect(pipeline).png().toBuffer();
    return await mod.loadImage(out);
  } catch (err) {
    logger.debug({ err }, "spawn-reveal: stage processing failed");
    return null;
  }
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

export async function renderSpawnReveal(input: SpawnRevealInput): Promise<Buffer | null> {
  const mod = await getCanvas();
  if (!mod) return null;
  const src = await loadArtBuffer(input.artUrl);
  if (!src) return null;
  const sharpFn = await loadSharp();
  if (!sharpFn) return null;

  const mode = input.mode ?? revealModeForRarity(input.rarity);
  const color = input.rarityColor ?? getRarityEffectColor(input.rarity);
  const shiny = !!input.shiny;

  // ── Pre-process the effect stages once (heavy work off the frame loop) ───────
  let stages: (LoadedImage | null)[] = [];
  let hiddenBase: LoadedImage | null = null; // puzzle only
  let clearImg: LoadedImage | null = null;

  if (mode === "blur") {
    const sigmas = [24, 15, 9, 4.5, 1.5, 0];
    stages = await Promise.all(sigmas.map(sig =>
      processStage(sharpFn, mod, src, s => (sig > 0 ? s.blur(sig) : s)),
    ));
    clearImg = stages[stages.length - 1];
  } else if (mode === "silhouette") {
    const steps: Array<{ b: number; sat: number; blur: number }> = [
      { b: 0.04, sat: 0.1, blur: 6 },
      { b: 0.16, sat: 0.28, blur: 3 },
      { b: 0.38, sat: 0.5, blur: 1.2 },
      { b: 0.64, sat: 0.75, blur: 0 },
      { b: 1, sat: 1, blur: 0 },
    ];
    stages = await Promise.all(steps.map(st =>
      processStage(sharpFn, mod, src, s => {
        let p = s.modulate({ brightness: st.b, saturation: st.sat });
        if (st.blur > 0) p = p.blur(st.blur);
        return p;
      }),
    ));
    clearImg = stages[stages.length - 1];
  } else {
    // puzzle — clear image + a blurred/darkened hidden base beneath the tiles.
    [clearImg, hiddenBase] = await Promise.all([
      processStage(sharpFn, mod, src, s => s),
      processStage(sharpFn, mod, src, s => s.blur(16).modulate({ brightness: 0.4, saturation: 0.5 })),
    ]);
  }
  if (!clearImg) return null; // nothing usable to draw

  const puzzleCols = 5, puzzleRows = 6, puzzleTotal = puzzleCols * puzzleRows;
  const tileOrder = mode === "puzzle" ? seededTileOrder(puzzleTotal, String(input.artUrl)) : [];

  try {
    const result = await encodeAnimation({
      width: WIDTH,
      height: HEIGHT,
      speed: input.speed ?? "normal",
      durationMs: 2600,
      maxFrames: 24,
      quality: 18,
      render: ({ ctx, t }) => {
        const reveal = clamp01(t / REVEAL_FRACTION);
        const eased = easeInOutCubic(reveal);

        // Backdrop.
        drawGradientBackground(ctx, WIDTH, HEIGHT, [
          [0, hexToRgba(color, 0.3)],
          [0.55, "#0c0e14"],
          [1, "#07080d"],
        ], 0.32);
        drawTextWithShadow(ctx, "A DN CARD APPEARS", WIDTH / 2, 34, "#d7dbe6", 20);

        // Glow behind the panel intensifies as the card emerges.
        drawRarityGlow(ctx, PANEL.x, PANEL.y, PANEL.w, PANEL.h, color, 0.35 + 0.5 * eased);

        // ── Art reveal ───────────────────────────────────────────────────────
        ctx.save();
        clipPanel(ctx);
        if (mode === "puzzle") {
          if (hiddenBase) ctx.drawImage(hiddenBase, PANEL.x, PANEL.y, PANEL.w, PANEL.h);
          const revealed = Math.round(reveal * puzzleTotal);
          const tw = PANEL.w / puzzleCols, th = PANEL.h / puzzleRows;
          // Reveal each piece by clipping the clear art to its cell, then trace
          // the piece edge so the puzzle structure reads clearly (freshly-placed
          // pieces flash a bright white edge — the "snap into place" pop).
          for (let k = 0; k < revealed; k++) {
            const tile = tileOrder[k]!;
            const cx = tile % puzzleCols, cy = Math.floor(tile / puzzleCols);
            const dx = PANEL.x + cx * tw, dy = PANEL.y + cy * th;
            ctx.save();
            roundRectPath(ctx, dx, dy, tw, th, 3);
            ctx.clip();
            ctx.drawImage(clearImg!, PANEL.x, PANEL.y, PANEL.w, PANEL.h);
            ctx.restore();
            const fresh = k >= revealed - 2;
            ctx.save();
            ctx.lineWidth = fresh ? 2.5 : 1;
            ctx.strokeStyle = fresh ? "rgba(255,255,255,0.9)" : hexToRgba(color, 0.45);
            roundRectPath(ctx, dx + 0.75, dy + 0.75, tw - 1.5, th - 1.5, 3);
            ctx.stroke();
            ctx.restore();
          }
          // Faint seams across the whole panel so even the un-revealed area reads
          // as a grid of puzzle pieces waiting to be filled.
          ctx.save();
          ctx.lineWidth = 1;
          ctx.strokeStyle = "rgba(255,255,255,0.12)";
          for (let c = 1; c < puzzleCols; c++) {
            const gx = PANEL.x + c * tw;
            ctx.beginPath(); ctx.moveTo(gx, PANEL.y); ctx.lineTo(gx, PANEL.y + PANEL.h); ctx.stroke();
          }
          for (let r = 1; r < puzzleRows; r++) {
            const gy = PANEL.y + r * th;
            ctx.beginPath(); ctx.moveTo(PANEL.x, gy); ctx.lineTo(PANEL.x + PANEL.w, gy); ctx.stroke();
          }
          ctx.restore();
        } else {
          // blur / silhouette — pick the stage nearest this progress.
          const usable = stages.filter((s): s is LoadedImage => !!s);
          const draw = usable.length > 0
            ? usable[Math.min(usable.length - 1, Math.floor(eased * (usable.length - 1) + 0.001))]!
            : clearImg!;
          ctx.drawImage(draw, PANEL.x, PANEL.y, PANEL.w, PANEL.h);
        }

        // Shiny flourish, ramping in as the reveal finishes.
        if (shiny && reveal > 0.45) {
          const a = clamp01((reveal - 0.45) / 0.55);
          drawFoilOverlay(ctx, PANEL.x, PANEL.y, PANEL.w, PANEL.h, 0.45 * a);
          drawHoloSparkles(ctx, PANEL.x, PANEL.y, PANEL.w, PANEL.h, 0.5 * a, 20);
        }
        ctx.restore();

        // Frame + rarity badge on top (drawn every frame so it stays crisp).
        drawCardFrame(ctx, PANEL.x, PANEL.y, PANEL.w, PANEL.h, color, 6);
        drawRarityBadge(ctx, PANEL.x + PANEL.w - 12, PANEL.y + 12, input.rarityLabel, color);
        if (shiny) drawTextWithShadow(ctx, "✨ SHINY", PANEL.x + 60, PANEL.y + 26, "#ffe27a", 18);
      },
    });
    return result?.buffer ?? null;
  } catch (err) {
    logger.debug({ err }, "spawn-reveal: encode failed");
    return null;
  }
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
