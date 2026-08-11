// ─────────────────────────────────────────────────────────────────────────────
// Wild-encounter intro — the Pokémon-style "A WILD CARD APPEARED!" opener that
// plays BEFORE any game. Classic battle entrance: an orange battlefield with two
// grass platforms; the caught card slides in from the right onto its platform,
// the catcher (their Discord avatar, holding a fan of cards) slides in from the
// left, then a text ribbon reads "A WILD <card> APPEARED!". Reuses the shared
// animation engine — same getCanvas/gradient/card/effects helpers as everything
// else. Best-effort: null → the flow falls back to text only.
// ─────────────────────────────────────────────────────────────────────────────

import {
  getCanvas, hexToRgba, roundRectPath, encodeAnimation, clamp01, easeInOutCubic, lerp,
  type Ctx, type CanvasMod,
} from "../animations/engine.js";
import { queueRender } from "../animations/render-queue.js";
import { drawCardArt, drawCardFrame, drawRarityGlow, drawTextWithShadow, drawTitle, fitText, loadArt, TITLE_FONT } from "../animations/effects.js";
import type { AnimationSpeed } from "../animations/types.js";
import { logger } from "../../lib/logger.js";

export const ENCOUNTER_CANVAS = { width: 1000, height: 560 } as const;
export const ENCOUNTER_GIF_FILE = "wild-encounter.gif";
export const ENCOUNTER_PNG_FILE = "wild-encounter.png";

export interface WildEncounterInput {
  cardArtUrl: string | null;
  cardName: string;
  rarityLabel: string;
  rarityColor: number;
  avatarUrl: string | null;
}

// Only render color emoji-free text on the canvas (no emoji font registered).
function safe(s: string): string {
  return s.replace(/[\u{1F000}-\u{1FAFF}\u{FE00}-\u{FE0F}\u{2190}-\u{27BF}\u{2B00}-\u{2BFF}]/gu, "").replace(/\s{2,}/g, " ").trim();
}

// The spec-complete Skia context has `ellipse`; the project's Ctx type under-
// declares it (like scale/transform), so cast for these calls.
type EllipseCtx = { ellipse(cx: number, cy: number, rx: number, ry: number, rot: number, a0: number, a1: number): void };

function drawPlatform(ctx: Ctx, cx: number, cy: number, rx: number, ry: number): void {
  const e = ctx as unknown as EllipseCtx;
  ctx.save();
  ctx.beginPath();
  e.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
  ctx.fillStyle = "#4e8f3a";
  ctx.fill();
  ctx.beginPath();
  e.ellipse(cx, cy - ry * 0.25, rx * 0.92, ry * 0.7, 0, 0, Math.PI * 2);
  ctx.fillStyle = "#6ab04c";
  ctx.fill();
  ctx.restore();
}

// A small fan of facedown cards in the catcher's hand.
function drawCardFan(ctx: Ctx, x: number, y: number, accent: number): void {
  const angles = [-0.32, -0.11, 0.11, 0.32];
  angles.forEach((a, i) => {
    ctx.save();
    ctx.translate(x + i * 4, y);
    ctx.rotate(a);
    roundRectPath(ctx, -22, -34, 44, 64, 6);
    const g = ctx.createLinearGradient(-22, -34, 22, 30);
    g.addColorStop(0, hexToRgba(accent, 0.9));
    g.addColorStop(1, "#0c0c12");
    ctx.fillStyle = g;
    ctx.fill();
    ctx.lineWidth = 2; ctx.strokeStyle = "rgba(255,255,255,0.35)";
    ctx.stroke();
    ctx.restore();
  });
}

// Circular avatar (the catcher). Falls back to a DN monogram disc.
async function drawAvatar(ctx: Ctx, mod: CanvasMod, url: string | null, cx: number, cy: number, r: number, accent: number): Promise<void> {
  const img = await loadArt(mod, url);
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.closePath();
  ctx.clip();
  if (img) {
    const s = Math.max((r * 2) / img.width, (r * 2) / img.height);
    const w = img.width * s, h = img.height * s;
    ctx.drawImage(img, cx - w / 2, cy - h / 2, w, h);
  } else {
    ctx.fillStyle = "#1a1a22";
    ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
  }
  ctx.restore();
  if (!img) drawTitle(ctx, "DN", cx, cy, "#ffffff", Math.round(r * 0.9));
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.lineWidth = 5;
  ctx.strokeStyle = hexToRgba(accent, 1);
  ctx.stroke();
  ctx.restore();
}

// Draw the whole encounter at animation time t (0→1). Sides slide in over the
// first ~55%, then the text ribbon fades up.
async function paint(ctx: Ctx, mod: CanvasMod, input: WildEncounterInput, t: number): Promise<void> {
  const { width, height } = ENCOUNTER_CANVAS;
  const accent = input.rarityColor;

  // Orange battlefield sky.
  const sky = ctx.createLinearGradient(0, 0, 0, height);
  sky.addColorStop(0, "#c66a3a");
  sky.addColorStop(0.55, "#9a5330");
  sky.addColorStop(1, "#5c3320");
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, width, height);

  const slide = easeInOutCubic(clamp01(t / 0.55));

  // Enemy (card) platform — upper right.
  const epx = 700, epy = 360;
  drawPlatform(ctx, epx, epy, 190, 46);
  // Card, sliding in from the right.
  const cw = 190, ch = 266;
  const cardRestX = epx - cw / 2;
  const cardX = lerp(width + 60, cardRestX, slide);
  const cardY = epy - ch + 30;
  drawRarityGlow(ctx, cardX, cardY, cw, ch, accent, 0.85);
  await drawCardArt(ctx, mod, cardX, cardY, cw, ch, input.cardArtUrl);
  drawCardFrame(ctx, cardX, cardY, cw, ch, accent, 7);

  // Player (avatar) platform — lower left.
  const ppx = 250, ppy = 486;
  drawPlatform(ctx, ppx, ppy, 168, 40);
  // Avatar + card fan, sliding in from the left.
  const avRestX = 250;
  const avX = lerp(-260, avRestX, slide);
  drawCardFan(ctx, avX + 96, ppy - 96, accent);
  await drawAvatar(ctx, mod, input.avatarUrl, avX, ppy - 96, 70, accent);

  // Enemy name/HP box — top left (fades in with the slide).
  ctx.save();
  ctx.globalAlpha = slide;
  const bx = 40, by = 40, bw = 430, bh = 96;
  roundRectPath(ctx, bx, by, bw, bh, 12);
  ctx.fillStyle = "rgba(20,18,16,0.86)";
  ctx.fill();
  ctx.lineWidth = 3; ctx.strokeStyle = hexToRgba(accent, 0.9);
  ctx.stroke();
  ctx.restore();
  drawTitle(ctx, safe(input.cardName), bx + 18, by + 30,
    "#ffffff", fitText(ctx, safe(input.cardName), bw - 130, 26, 14, TITLE_FONT), "left");
  drawTextWithShadow(ctx, safe(input.rarityLabel).toUpperCase(), bx + bw - 18, by + 30, hexToRgba(accent, 1), 18, "right");
  // Full HP bar (cosmetic — the card is at full health as it appears).
  const hbx = bx + 60, hby = by + 58, hbw = bw - 90, hbh = 16;
  drawTextWithShadow(ctx, "HP", bx + 18, hby + hbh / 2, "#ffcf3f", 16, "left");
  roundRectPath(ctx, hbx, hby, hbw, hbh, 8); ctx.fillStyle = "#2b2b2b"; ctx.fill();
  ctx.save(); roundRectPath(ctx, hbx + 2, hby + 2, (hbw - 4), hbh - 4, 6); ctx.clip();
  ctx.fillStyle = "#4caf50"; ctx.fillRect(hbx + 2, hby + 2, hbw - 4, hbh - 4); ctx.restore();

  // Text ribbon — appears once the combatants are in.
  const textAlpha = clamp01((t - 0.5) / 0.35);
  if (textAlpha > 0) {
    ctx.save();
    ctx.globalAlpha = textAlpha;
    const tx = 30, ty = height - 118, tw = width - 60, th = 92;
    roundRectPath(ctx, tx, ty, tw, th, 14);
    ctx.fillStyle = "rgba(245,242,235,0.96)";
    ctx.fill();
    ctx.lineWidth = 4; ctx.strokeStyle = "#2b2b33";
    ctx.stroke();
    ctx.restore();
    ctx.save();
    ctx.globalAlpha = textAlpha;
    drawTextWithShadow(ctx, `A WILD ${safe(input.cardName).toUpperCase()} APPEARED!`, tx + 28, ty + 34, "#2b2b33", 26, "left");
    drawTextWithShadow(ctx, "PREPARE FOR BATTLE!", tx + 28, ty + 66, "#7a4a2a", 22, "left");
    ctx.restore();
  }
}

export async function renderWildEncounterIntro(
  input: WildEncounterInput, speed: AnimationSpeed = "normal",
): Promise<Buffer | null> {
  const { width, height } = ENCOUNTER_CANVAS;
  const result = await encodeAnimation({
    width, height, speed, durationMs: 2200, maxFrames: 26, quality: 18, renderScale: 0.5,
    render: async ({ ctx, mod, t }) => { await paint(ctx as unknown as Ctx, mod, input, t); },
  });
  return result?.buffer ?? null;
}

export async function renderWildEncounterStill(input: WildEncounterInput): Promise<Buffer | null> {
  return queueRender("wild-encounter-still", async () => {
    const mod = await getCanvas();
    if (!mod) return null;
    try {
      const { width, height } = ENCOUNTER_CANVAS;
      const canvas = mod.createCanvas(width, height);
      const ctx = canvas.getContext("2d") as unknown as Ctx;
      await paint(ctx, mod, input, 1);
      return await canvas.encode("png");
    } catch (err) {
      logger.debug({ err }, "wild-encounter still: render failed");
      return null;
    }
  });
}
