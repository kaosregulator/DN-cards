// ─────────────────────────────────────────────────────────────────────────────
// Wild-encounter intro — the Pokémon-style "A WILD CARD APPEARED!" opener that
// plays BEFORE any game. Composites the user-supplied pixel-art assets
// (assets/minigame/): the DN trainer figure (holding his special cards) slides in
// from the left onto a grass platform, the caught card (the real wild card art in
// its DN frame) slides in from the right onto the enemy platform, an enemy
// name/HP box sits top-left, and the supplied dialogue box reads
// "A WILD <card> APPEARED!". Reuses the shared animation engine.
//
// Best-effort: any missing asset falls back to a drawn stand-in, and a null
// render lets the flow fall back to text only.
// ─────────────────────────────────────────────────────────────────────────────

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  getCanvas, hexToRgba, roundRectPath, encodeAnimation, clamp01, easeInOutCubic, lerp,
  type Ctx, type CanvasMod,
} from "../animations/engine.js";
import { queueRender } from "../animations/render-queue.js";
import { drawCardArt, drawCardFrame, drawRarityGlow, drawTextWithShadow, drawTitle, fitText, TITLE_FONT } from "../animations/effects.js";
import type { AnimationSpeed } from "../animations/types.js";
import { logger } from "../../lib/logger.js";

type Img = import("@napi-rs/canvas").Image;

export const ENCOUNTER_CANVAS = { width: 1000, height: 560 } as const;
export const ENCOUNTER_GIF_FILE = "wild-encounter.gif";
export const ENCOUNTER_PNG_FILE = "wild-encounter.png";

export interface WildEncounterInput {
  cardArtUrl: string | null;
  cardName: string;
  rarityLabel: string;
  rarityColor: number;
  avatarUrl: string | null; // kept for compat; the figure sprite is the player now
}

// ── Bundled pixel-art assets (resolved like animations/arena-bg.ts) ───────────
let _assetsDir: string | null | undefined;
function assetsDir(): string | null {
  if (_assetsDir !== undefined) return _assetsDir;
  const candidates: string[] = [];
  try { candidates.push(fileURLToPath(new URL("../../../assets/minigame/", import.meta.url))); } catch { /* not ESM */ }
  candidates.push(
    join(process.cwd(), "assets/minigame"),
    join(process.cwd(), "artifacts/api-server/assets/minigame"),
  );
  _assetsDir = candidates.find(d => existsSync(d)) ?? null;
  return _assetsDir;
}
const imgCache = new Map<string, Promise<Img | null>>();
function localImg(mod: CanvasMod, name: string): Promise<Img | null> {
  const cached = imgCache.get(name);
  if (cached) return cached;
  const p = (async () => {
    const dir = assetsDir();
    if (!dir) return null;
    const file = join(dir, name);
    if (!existsSync(file)) return null;
    try { return await mod.loadImage(readFileSync(file)); }
    catch (err) { logger.debug({ err, file }, "minigame asset load failed"); return null; }
  })();
  imgCache.set(name, p);
  return p;
}

function safe(s: string): string {
  return s.replace(/[\u{1F000}-\u{1FAFF}\u{FE00}-\u{FE0F}\u{2190}-\u{27BF}\u{2B00}-\u{2BFF}]/gu, "").replace(/\s{2,}/g, " ").trim();
}

// Draw an image scaled to a target width, anchored at a point. anchorY: 0 = top,
// 0.5 = middle, 1 = bottom (feet). anchorX 0.5 = horizontal center.
function drawImg(ctx: Ctx, img: Img, cx: number, anchorBottomY: number, targetW: number, anchorX = 0.5, anchorYBottom = true): void {
  const s = targetW / img.width;
  const w = targetW, h = img.height * s;
  const x = cx - w * anchorX;
  const y = anchorYBottom ? anchorBottomY - h : anchorBottomY;
  ctx.drawImage(img, x, y, w, h);
}

// Fallback grass platform if the sprite is missing.
function drawFallbackPlatform(ctx: Ctx, cx: number, cy: number, rx: number, ry: number): void {
  const e = ctx as unknown as { ellipse(cx: number, cy: number, rx: number, ry: number, r: number, a0: number, a1: number): void };
  ctx.save(); ctx.beginPath(); e.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2); ctx.fillStyle = "#4e8f3a"; ctx.fill();
  ctx.beginPath(); e.ellipse(cx, cy - ry * 0.25, rx * 0.9, ry * 0.7, 0, 0, Math.PI * 2); ctx.fillStyle = "#6ab04c"; ctx.fill(); ctx.restore();
}

async function paint(ctx: Ctx, mod: CanvasMod, input: WildEncounterInput, t: number): Promise<void> {
  const { width, height } = ENCOUNTER_CANVAS;
  const accent = input.rarityColor;
  const [platform, textbox, trainer] = await Promise.all([
    localImg(mod, "platform.png"), localImg(mod, "textbox.png"), localImg(mod, "trainer.png"),
  ]);

  // Orange sunset battlefield sky (matches the supplied scene).
  const sky = ctx.createLinearGradient(0, 0, 0, height);
  sky.addColorStop(0, "#c15f39");
  sky.addColorStop(0.42, "#b6572f");
  sky.addColorStop(0.52, "#9c5a2b");
  sky.addColorStop(1, "#7b4a24");
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, width, height);

  const slide = easeInOutCubic(clamp01(t / 0.55));

  // Enemy platform (upper-right) + the wild card sliding in from the right.
  const epx = 700, epy = 372;
  if (platform) drawImg(ctx, platform, epx, epy + 40, 360, 0.5, true);
  else drawFallbackPlatform(ctx, epx, epy, 180, 44);
  const cw = 168, ch = 236;
  const cardX = lerp(width + 80, epx - cw / 2, slide);
  const cardY = epy - ch + 26;
  drawRarityGlow(ctx, cardX, cardY, cw, ch, accent, 0.85);
  await drawCardArt(ctx, mod, cardX, cardY, cw, ch, input.cardArtUrl);
  drawCardFrame(ctx, cardX, cardY, cw, ch, accent, 7);

  // Player platform (lower-left) + the trainer figure sliding in from the left.
  const ppx = 288, ppy = 496;
  if (platform) drawImg(ctx, platform, ppx, ppy + 30, 440, 0.5, true);
  else drawFallbackPlatform(ctx, ppx, ppy, 168, 40);
  const figX = lerp(-180, ppx + 6, slide);
  if (trainer) drawImg(ctx, trainer, figX, ppy + 8, 300, 0.5, true);

  // Enemy name/HP box — top left (fades in with the slide).
  ctx.save();
  ctx.globalAlpha = slide;
  const bx = 34, by = 30, bw = 430, bh = 96;
  roundRectPath(ctx, bx, by, bw, bh, 12);
  ctx.fillStyle = "rgba(20,18,16,0.88)"; ctx.fill();
  ctx.lineWidth = 3; ctx.strokeStyle = hexToRgba(accent, 0.9); ctx.stroke();
  ctx.restore();
  drawTitle(ctx, safe(input.cardName), bx + 18, by + 30, "#ffffff",
    fitText(ctx, safe(input.cardName), bw - 140, 26, 14, TITLE_FONT), "left");
  drawTextWithShadow(ctx, safe(input.rarityLabel).toUpperCase(), bx + bw - 18, by + 30, hexToRgba(accent, 1), 18, "right");
  const hbx = bx + 60, hby = by + 58, hbw = bw - 90, hbh = 16;
  drawTextWithShadow(ctx, "HP", bx + 18, hby + hbh / 2, "#ffcf3f", 16, "left");
  roundRectPath(ctx, hbx, hby, hbw, hbh, 8); ctx.fillStyle = "#2b2b2b"; ctx.fill();
  ctx.save(); roundRectPath(ctx, hbx + 2, hby + 2, hbw - 4, hbh - 4, 6); ctx.clip();
  ctx.fillStyle = "#4caf50"; ctx.fillRect(hbx + 2, hby + 2, hbw - 4, hbh - 4); ctx.restore();

  // Dialogue box (supplied sprite, stretched into a bottom ribbon) with the
  // encounter text, fading up last. The sprite is near-square, so we stretch it
  // to a fixed short band rather than preserve aspect (would run off-canvas).
  const textAlpha = clamp01((t - 0.5) / 0.35);
  if (textAlpha > 0) {
    ctx.save();
    ctx.globalAlpha = textAlpha;
    const tbX = 18, tbW = width - 36, tbH = 104, tbY = height - tbH - 8;
    if (textbox) {
      ctx.drawImage(textbox, tbX, tbY, tbW, tbH);
    } else {
      roundRectPath(ctx, tbX, tbY, tbW, tbH, 14); ctx.fillStyle = "rgba(245,242,235,0.96)"; ctx.fill();
      ctx.lineWidth = 4; ctx.strokeStyle = "#2b2b33"; ctx.stroke();
    }
    drawTextWithShadow(ctx, `A WILD ${safe(input.cardName).toUpperCase()} APPEARED!`, tbX + 46, tbY + 40, "#2b2b33", 25, "left");
    drawTextWithShadow(ctx, "PREPARE FOR BATTLE!", tbX + 46, tbY + 72, "#7a4a2a", 21, "left");
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
