// ─────────────────────────────────────────────────────────────────────────────
// Wild Mini-Game canvases — the animated intro/menu + per-step gameplay frames.
//
// Reuses the SHARED animation/battle/raid engine (no second renderer): the same
// getCanvas + drawGradientBackground + drawCardArt/Frame/Glow + drawTitle helpers
// the raid canvases (raid/canvas.ts) use, so a mini-game screen carries the same
// card art, DN frame, theme, and sizes as battles and raids. Layout matches the
// uploaded mockups: a dark panel with an accent left-edge bar, a big Orbitron
// banner + star divider on the left, prompt lines and a status box below it, and
// the caught card glowing on the right over an atmospheric, theme-tinted field.
//
// Best-effort like every other canvas: null on failure → the embed renders text
// only, exactly as the rest of the bot degrades.
// ─────────────────────────────────────────────────────────────────────────────

import {
  getCanvas, hexToRgba, roundRectPath, drawGradientBackground,
  encodeAnimation, clamp01, type Ctx, type CanvasMod,
} from "../animations/engine.js";
import { queueRender } from "../animations/render-queue.js";
import { drawAtmosphere, atmospherePreset } from "../animations/atmosphere.js";
import { drawEmbers } from "../animations/particles.js";
import {
  drawCardArt, drawCardFrame, drawRarityGlow, drawRarityBadge,
  drawTextWithShadow, drawTitle, fitText, TITLE_FONT,
} from "../animations/effects.js";
import type { AnimationSpeed } from "../animations/types.js";
import { logger } from "../../lib/logger.js";

export const MG_CANVAS = { width: 1000, height: 560 } as const;
export const MG_FILE = "minigame.png";
export const MG_GIF_FILE = "minigame.gif";

export interface MiniGameScreenSpec {
  // Accent/theme color for banner + glow + left bar (hex int).
  theme: number;
  // Emoji drawn before the title (best-effort — falls back to nothing).
  icon?: string;
  // Big banner. `title` renders in the theme color, `titleTail` (optional) in
  // white on the same line — mirrors "WILD CARD | DETECTED" in the mockups.
  title: string;
  titleTail?: string;
  // Small line under the title, e.g. "(Difficulty: LEGENDARY)".
  subtitle?: string;
  // Prompt body lines.
  lines: string[];
  // Status box, e.g. label "TIMERS:" value "8.2 seconds remaining…".
  statusLabel?: string;
  statusValue?: string;
  // The caught card.
  cardArtUrl: string | null;
  cardName: string;
  rarityLabel: string;
  rarityColor: number;
  // Hide the real art (Choose-a-Card / Code Break) — show a facedown DN back
  // with a badge instead.
  hideCardArt?: boolean;
  cardBadge?: string;
}

// The canvas only has the Orbitron + DejaVu fonts registered (no color-emoji
// font), so color emoji render as tofu. Strip them from anything drawn on the
// canvas — the Discord embed text keeps its emoji and renders them natively.
// ★/☆ (U+2605/2606) and punctuation stay; they render fine in DejaVu.
function drawSafe(s: string): string {
  return s
    .replace(/[\u{1F000}-\u{1FAFF}\u{FE00}-\u{FE0F}\u{200D}\u{20E3}\u{2190}-\u{21FF}\u{2300}-\u{23FF}\u{2460}-\u{24FF}\u{2600}-\u{2604}\u{2607}-\u{26FF}\u{2700}-\u{27BF}\u{2B00}-\u{2BFF}]/gu, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

// Draw the whole scene once. `pulse` (0→1) drives the glow/scan animation so the
// same paint routine serves both the still PNG and the animated GIF frames.
async function paint(ctx: Ctx, mod: CanvasMod, spec: MiniGameScreenSpec, pulse: number): Promise<void> {
  const { width, height } = MG_CANVAS;
  const accent = spec.theme;

  // Background: theme-tinted gradient + arena atmosphere (fog/dust/embers).
  drawGradientBackground(ctx, width, height, [
    [0, hexToRgba(accent, 0.32)],
    [0.55, "#0b0d12"],
    [1, "#050507"],
  ], 0.3);
  drawAtmosphere(ctx, width, height, atmospherePreset("arena"), {
    seed: `${spec.cardName}-mg`, color: accent, density: 0.5,
  });

  // Dark inner panel with an accent left-edge bar (the mockup "embed" body).
  const px = 26, py = 26, pw = width - 52, ph = height - 52;
  ctx.save();
  roundRectPath(ctx, px, py, pw, ph, 20);
  ctx.fillStyle = "rgba(10,11,15,0.82)";
  ctx.fill();
  ctx.restore();
  ctx.save();
  roundRectPath(ctx, px, py, 8, ph, 4);
  ctx.fillStyle = hexToRgba(accent, 0.95);
  ctx.fill();
  ctx.restore();

  // ── Card on the right ──────────────────────────────────────────────────────
  const cw = 300, ch = 420, cx = width - cw - 70, cy = (height - ch) / 2;
  const glow = 0.55 + 0.4 * pulse;
  drawRarityGlow(ctx, cx, cy, cw, ch, spec.rarityColor, glow);
  if (spec.hideCardArt) {
    // Facedown DN back — dark card with the DN monogram.
    ctx.save();
    roundRectPath(ctx, cx, cy, cw, ch, 14);
    ctx.clip();
    drawGradientBackground(ctx, width, height, [
      [0, hexToRgba(accent, 0.4)], [1, "#0a0a10"],
    ], 0.2);
    ctx.restore();
    drawTitle(ctx, "DN", cx + cw / 2, cy + ch / 2 - 8, "#ffffff", 64);
    drawTextWithShadow(ctx, "CARDS", cx + cw / 2, cy + ch / 2 + 34, hexToRgba(accent, 1), 22);
  } else {
    await drawCardArt(ctx, mod, cx, cy, cw, ch, spec.cardArtUrl);
  }
  drawCardFrame(ctx, cx, cy, cw, ch, spec.rarityColor, 8);
  if (spec.cardBadge) drawRarityBadge(ctx, cx + cw - 14, cy + 16, drawSafe(spec.cardBadge), spec.rarityColor);
  drawEmbers(ctx, cx - 16, cy, cw + 32, ch, { color: accent, count: 22, seed: `${spec.cardName}-aura` });
  drawTextWithShadow(ctx, drawSafe(spec.cardName), cx + cw / 2, cy + ch + 20, "#ffffff",
    fitText(ctx, drawSafe(spec.cardName), cw + 40, 22, 12, TITLE_FONT), "center", TITLE_FONT);

  // ── Left column ────────────────────────────────────────────────────────────
  const lx = 62;
  let ly = 96;
  // Title (accent word + white tail), scaled to fit the left half.
  const titleText = drawSafe(spec.title);
  const titleTail = spec.titleTail ? drawSafe(spec.titleTail) : "";
  const titleSize = fitText(ctx, `${titleText} ${titleTail}`, 500, 52, 24, TITLE_FONT);
  drawTitle(ctx, titleText, lx, ly, hexToRgba(accent, 1), titleSize, "left");
  if (titleTail) {
    ctx.save();
    ctx.font = `bold ${titleSize}px "${TITLE_FONT}", "DejaVu Sans", Arial, sans-serif`;
    const tw = ctx.measureText(titleText + " ").width;
    ctx.restore();
    drawTitle(ctx, titleTail, lx + tw, ly, "#ffffff", titleSize, "left");
  }
  ly += 30;
  if (spec.subtitle) {
    drawTextWithShadow(ctx, drawSafe(spec.subtitle), lx, ly, hexToRgba(accent, 1), 20, "left");
    ly += 24;
  }
  // Star divider.
  ly += 8;
  ctx.save();
  ctx.strokeStyle = hexToRgba(accent, 0.6);
  ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(lx, ly); ctx.lineTo(lx + 380, ly); ctx.stroke();
  ctx.restore();
  drawTitle(ctx, "★", lx + 190, ly, hexToRgba(accent, 1), 20);
  ly += 40;

  // Prompt lines.
  for (const line of spec.lines.slice(0, 5)) {
    drawTextWithShadow(ctx, drawSafe(line), lx, ly, "#e8ebf0", 22, "left");
    ly += 34;
  }

  // Status box.
  if (spec.statusLabel || spec.statusValue) {
    ly += 12;
    if (spec.statusLabel) {
      drawTextWithShadow(ctx, drawSafe(spec.statusLabel), lx, ly, hexToRgba(accent, 1), 20, "left");
      ly += 30;
    }
    const boxW = 400, boxH = 46;
    ctx.save();
    roundRectPath(ctx, lx, ly, boxW, boxH, 8);
    ctx.strokeStyle = hexToRgba(accent, 0.8);
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.restore();
    if (spec.statusValue) {
      drawTextWithShadow(ctx, drawSafe(spec.statusValue), lx + 16, ly + boxH / 2, hexToRgba(accent, 1), 22, "left");
    }
  }

  // Subtle scan line sweeping down the card for the animated version.
  if (pulse > 0) {
    const scanY = cy + ch * clamp01(pulse);
    ctx.save();
    ctx.strokeStyle = hexToRgba(accent, 0.5 * (1 - pulse));
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(cx, scanY); ctx.lineTo(cx + cw, scanY); ctx.stroke();
    ctx.restore();
  }
}

// Single still frame (per-step gameplay screens).
export async function renderMiniGameStill(spec: MiniGameScreenSpec): Promise<Buffer | null> {
  return queueRender("minigame-still", async () => {
    const mod = await getCanvas();
    if (!mod) return null;
    try {
      const { width, height } = MG_CANVAS;
      const canvas = mod.createCanvas(width, height);
      const ctx = canvas.getContext("2d") as unknown as Ctx;
      await paint(ctx, mod, spec, 0.35);
      return await canvas.encode("png");
    } catch (err) {
      logger.debug({ err }, "minigame still canvas: render failed");
      return null;
    }
  });
}

// Animated intro GIF — a pulsing glow + downward scan over ~1.4s. Renders at half
// scale to stay well under the attachment ceiling.
export async function renderMiniGameIntro(
  spec: MiniGameScreenSpec, speed: AnimationSpeed = "normal",
): Promise<Buffer | null> {
  const { width, height } = MG_CANVAS;
  const result = await encodeAnimation({
    width, height, speed, durationMs: 1400, maxFrames: 16, quality: 18, renderScale: 0.5,
    render: async ({ ctx, mod, t }) => {
      // Ping-pong the pulse so the loop breathes rather than jumping.
      const pulse = t < 0.5 ? t * 2 : (1 - t) * 2;
      await paint(ctx as unknown as Ctx, mod, spec, pulse);
    },
  });
  return result?.buffer ?? null;
}
