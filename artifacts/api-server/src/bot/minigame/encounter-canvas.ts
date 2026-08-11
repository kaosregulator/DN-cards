// ─────────────────────────────────────────────────────────────────────────────
// Wild-encounter intro — the Pokémon-style "A WILD CARD APPEARED!" opener that
// plays BEFORE any game. Composites the user-supplied pixel-art assets
// (assets/minigame/): a clean sunset Background, two grass platforms, the DN
// trainer figure (holding his special cards) sliding in from the left, the caught
// card (the REAL spawned card's art in its DN frame) sliding in from the right,
// an enemy name/HP box top-left, the wide dialogue box ("A WILD <card>
// APPEARED!"), and the joke menu box listing the shuffled options. Reuses the
// shared animation engine. Best-effort: any missing asset falls back to a drawn
// stand-in; a null render lets the flow fall back to text only.
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
  avatarUrl: string | null;       // kept for compat; the figure sprite is the player
  menuLabels?: string[];          // the shuffled joke options shown in the menu box
}

// ── Bundled pixel-art assets (resolved like animations/arena-bg.ts) ───────────
let _assetsDir: string | null | undefined;
function assetsDir(): string | null {
  if (_assetsDir !== undefined) return _assetsDir;
  const candidates: string[] = [];
  try { candidates.push(fileURLToPath(new URL("../../../assets/minigame/", import.meta.url))); } catch { /* not ESM */ }
  candidates.push(join(process.cwd(), "assets/minigame"), join(process.cwd(), "artifacts/api-server/assets/minigame"));
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

// Cover-fit an image across a rect (crops overflow, like CSS background-size:cover).
function drawCover(ctx: Ctx, img: Img, x: number, y: number, w: number, h: number): void {
  const s = Math.max(w / img.width, h / img.height);
  const dw = img.width * s, dh = img.height * s;
  ctx.drawImage(img, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
}

// Draw an image scaled to a target width, horizontally centered on cx, with its
// BOTTOM at anchorBottomY (feet/base placement).
function drawImgBottom(ctx: Ctx, img: Img, cx: number, anchorBottomY: number, targetW: number): void {
  const s = targetW / img.width;
  const w = targetW, h = img.height * s;
  ctx.drawImage(img, cx - w / 2, anchorBottomY - h, w, h);
}

function drawFallbackPlatform(ctx: Ctx, cx: number, cy: number, rx: number, ry: number): void {
  const e = ctx as unknown as { ellipse(cx: number, cy: number, rx: number, ry: number, r: number, a0: number, a1: number): void };
  ctx.save(); ctx.beginPath(); e.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2); ctx.fillStyle = "#4e8f3a"; ctx.fill();
  ctx.beginPath(); e.ellipse(cx, cy - ry * 0.25, rx * 0.9, ry * 0.7, 0, 0, Math.PI * 2); ctx.fillStyle = "#6ab04c"; ctx.fill(); ctx.restore();
}

async function paint(ctx: Ctx, mod: CanvasMod, input: WildEncounterInput, t: number): Promise<void> {
  const { width, height } = ENCOUNTER_CANVAS;
  const accent = input.rarityColor;
  const [bg, platform, textbox, menubox, trainer] = await Promise.all([
    localImg(mod, "background.png"), localImg(mod, "platform.png"),
    localImg(mod, "textbox.png"), localImg(mod, "menubox.png"), localImg(mod, "trainer.png"),
  ]);

  // Background — the supplied clean sunset, or a matching gradient fallback.
  if (bg) {
    drawCover(ctx, bg, 0, 0, width, height);
  } else {
    const sky = ctx.createLinearGradient(0, 0, 0, height);
    sky.addColorStop(0, "#c15f39"); sky.addColorStop(0.5, "#9c5a2b"); sky.addColorStop(1, "#7b4a24");
    ctx.fillStyle = sky; ctx.fillRect(0, 0, width, height);
  }

  // Slower slide-in (eases over the first ~72% of the timeline).
  const slide = easeInOutCubic(clamp01(t / 0.72));

  // Enemy platform (upper-right) + the wild card sliding in from the right.
  const epx = 700, epy = 288;
  if (platform) drawImgBottom(ctx, platform, epx, epy + 34, 330);
  else drawFallbackPlatform(ctx, epx, epy, 165, 42);
  const cw = 150, ch = 210;
  const cardX = lerp(width + 90, epx - cw / 2, slide);
  const cardY = epy - ch + 12;
  drawRarityGlow(ctx, cardX, cardY, cw, ch, accent, 0.85);
  await drawCardArt(ctx, mod, cardX, cardY, cw, ch, input.cardArtUrl);
  drawCardFrame(ctx, cardX, cardY, cw, ch, accent, 6);

  // Player platform (lower-left) + the trainer figure sliding in from the left.
  const ppx = 252, ppy = 452;
  if (platform) drawImgBottom(ctx, platform, ppx, ppy + 24, 430);
  else drawFallbackPlatform(ctx, ppx, ppy, 165, 40);
  const figX = lerp(-190, ppx, slide);
  if (trainer) drawImgBottom(ctx, trainer, figX, ppy + 4, 286);

  // Enemy name/HP box — top left (fades in with the slide).
  ctx.save();
  ctx.globalAlpha = slide;
  const bx = 30, by = 22, bw = 420, bh = 92;
  roundRectPath(ctx, bx, by, bw, bh, 12);
  ctx.fillStyle = "rgba(20,18,16,0.88)"; ctx.fill();
  ctx.lineWidth = 3; ctx.strokeStyle = hexToRgba(accent, 0.9); ctx.stroke();
  ctx.restore();
  drawTitle(ctx, safe(input.cardName), bx + 18, by + 30, "#ffffff",
    fitText(ctx, safe(input.cardName), bw - 150, 25, 13, TITLE_FONT), "left");
  drawTextWithShadow(ctx, safe(input.rarityLabel).toUpperCase(), bx + bw - 18, by + 30, hexToRgba(accent, 1), 17, "right");
  const hbx = bx + 58, hby = by + 56, hbw = bw - 86, hbh = 15;
  drawTextWithShadow(ctx, "HP", bx + 18, hby + hbh / 2, "#ffcf3f", 15, "left");
  roundRectPath(ctx, hbx, hby, hbw, hbh, 7); ctx.fillStyle = "#2b2b2b"; ctx.fill();
  ctx.save(); roundRectPath(ctx, hbx + 2, hby + 2, hbw - 4, hbh - 4, 5); ctx.clip();
  ctx.fillStyle = "#4caf50"; ctx.fillRect(hbx + 2, hby + 2, hbw - 4, hbh - 4); ctx.restore();

  // Menu box (bottom-right) listing the shuffled joke options, then the wide
  // dialogue box (bottom) — both fade up after the combatants are in.
  const uiAlpha = clamp01((t - 0.62) / 0.3);
  if (uiAlpha > 0) {
    ctx.save();
    ctx.globalAlpha = uiAlpha;
    // Joke menu box.
    const mx = 622, my = 302, mw = 358, mh = 150;
    if (menubox) ctx.drawImage(menubox, mx, my, mw, mh);
    else { roundRectPath(ctx, mx, my, mw, mh, 12); ctx.fillStyle = "rgba(240,238,230,0.96)"; ctx.fill(); ctx.lineWidth = 4; ctx.strokeStyle = "#2b2b33"; ctx.stroke(); }
    const opts = (input.menuLabels ?? []).slice(0, 4);
    const lineH = 30, tx = mx + 46, ty0 = my + 34;
    opts.forEach((label, k) => {
      const y = ty0 + k * lineH;
      if (k === 0) drawTextWithShadow(ctx, "▶", mx + 24, y, "#2b2b33", 16, "left");
      const line = `${k + 1}. ${label}`;
      drawTextWithShadow(ctx, line, tx, y, "#2b2b33", fitText(ctx, line, mw - 66, 16, 11), "left");
    });

    // Wide dialogue box.
    const dx = 20, dw = width - 40, dh = 88, dy = height - dh - 8;
    if (textbox) ctx.drawImage(textbox, dx, dy, dw, dh);
    else { roundRectPath(ctx, dx, dy, dw, dh, 12); ctx.fillStyle = "rgba(245,242,235,0.96)"; ctx.fill(); ctx.lineWidth = 4; ctx.strokeStyle = "#2b2b33"; ctx.stroke(); }
    drawTextWithShadow(ctx, `A WILD ${safe(input.cardName).toUpperCase()} APPEARED!`, dx + 44, dy + 34, "#2b2b33", 24, "left");
    drawTextWithShadow(ctx, "PREPARE FOR BATTLE!  —  Choose your move…", dx + 44, dy + 64, "#7a4a2a", 19, "left");
    ctx.restore();
  }
}

export async function renderWildEncounterIntro(
  input: WildEncounterInput, speed: AnimationSpeed = "normal",
): Promise<Buffer | null> {
  const { width, height } = ENCOUNTER_CANVAS;
  const result = await encodeAnimation({
    // Slower + a touch longer than the game intros so the entrance lands.
    width, height, speed, durationMs: 3400, maxFrames: 30, quality: 18, renderScale: 0.5,
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
