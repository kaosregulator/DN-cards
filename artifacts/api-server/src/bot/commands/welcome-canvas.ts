// ─────────────────────────────────────────────────────────────────────────────
// Welcome banner — the clean canvas hero at the top of /welcome.
//
// A single static PNG drawn with the SAME animation engine seam every other DN
// Cards visual uses (getCanvas + the Orbitron display font + the shared draw
// helpers), so it matches the leaderboard / battle look instead of being a
// one-off. Best-effort: a missing native canvas or a failed decode returns null
// and /welcome silently falls back to its text embeds + divider GIF.
//
// It draws nothing server-specific beyond the guild name it is handed, so it is
// safe to render for any guild without a per-guild asset.
// ─────────────────────────────────────────────────────────────────────────────

import { getCanvas, hexToRgba, roundRectPath, drawGradientBackground, clamp01, type Ctx } from "../animations/engine.js";
import { drawTitle, drawTextWithShadow, fitText, TITLE_FONT } from "../animations/effects.js";
import { queueRender } from "../animations/render-queue.js";
import { logger } from "../../lib/logger.js";

export const WELCOME_BANNER_FILE = "welcome-banner.png";

const BRAND = 0xe63946;   // DarkNight red
const GOLD  = 0xe8c15a;

export interface WelcomeBannerInput {
  guildName: string;
  /** The guild's display name for the rare tier (e.g. "Shiny"), for the accent line. */
  shinyName?: string;
}

/**
 * Render the /welcome hero banner. 1000x420, a dark battlefield-red wash with a
 * fanned deck of cards on the right, the DN CARDS wordmark, and a one-line
 * tagline naming the server. Returns a PNG buffer, or null on any failure.
 */
export async function renderWelcomeBanner(input: WelcomeBannerInput): Promise<Buffer | null> {
  return queueRender("welcome-banner", async () => {
    const mod = await getCanvas();
    if (!mod) return null;
    const W = 1000, H = 420;
    try {
      const canvas = mod.createCanvas(W, H);
      const ctx = canvas.getContext("2d") as unknown as Ctx;

      // ── Ground: a diagonal red→ink wash with a soft vignette. ──────────────
      drawGradientBackground(ctx, W, H, [
        [0, hexToRgba(BRAND, 0.55)],
        [0.45, "#161019"],
        [1, "#08070b"],
      ], 0.5);
      // Faint pip lattice so the field doesn't read as flat.
      drawPipField(ctx, W, H);
      // Warm rim glow off the right where the deck sits.
      const glow = ctx.createRadialGradient(W - 250, H / 2, 40, W - 250, H / 2, 460);
      glow.addColorStop(0, hexToRgba(BRAND, 0.42));
      glow.addColorStop(1, hexToRgba(BRAND, 0));
      ctx.fillStyle = glow; ctx.fillRect(0, 0, W, H);

      // ── The fanned deck, right third. ──────────────────────────────────────
      drawCardFan(ctx, W - 250, H / 2 + 6);

      // ── Wordmark + tagline, left two-thirds. ───────────────────────────────
      const leftX = 60;
      // Eyebrow.
      drawTextWithShadow(ctx, "DARKNIGHT PRESENTS", leftX, 92, hexToRgba(GOLD, 0.95), 20, "left", TITLE_FONT);
      // The wordmark, auto-fit so a long build name never overflows the panel.
      const markSize = fitText(ctx, "DN CARDS", 560, 108, 56, TITLE_FONT);
      drawTitle(ctx, "DN CARDS", leftX, 168, "#ffffff", markSize, "left");
      // Accent underline sweeping under the mark.
      ctx.fillStyle = hexToRgba(BRAND, 0.95);
      roundRectPath(ctx, leftX + 2, 210, 360, 6, 3); ctx.fill();

      // Tagline.
      drawTextWithShadow(ctx, "Military Collectible Card Game", leftX, 250, "#e7ecf5", 26, "left");

      // Server line — name the guild so the banner greets THIS server.
      const serverLine = trimTo(ctx, `Welcome to ${input.guildName}`, 600, 24);
      drawTextWithShadow(ctx, serverLine, leftX, 292, hexToRgba(GOLD, 0.98), 24, "left", TITLE_FONT);

      // A one-line "how to play" hook so the banner alone teaches the core loop.
      drawTextWithShadow(ctx, "See a card in chat? Type its name to catch it.", leftX, 340, "#aeb6c6", 20, "left");

      return await canvas.encode("png");
    } catch (err) {
      logger.warn({ err }, "welcome banner render failed");
      return null;
    }
  });
}

// ── Pieces ───────────────────────────────────────────────────────────────────

/** A faint scatter of card-suit-style pips, low alpha, as background texture. */
function drawPipField(ctx: Ctx, w: number, h: number): void {
  ctx.save();
  ctx.globalAlpha = 0.05;
  ctx.fillStyle = "#ffffff";
  for (let i = 0; i < 44; i++) {
    // Deterministic scatter (a cheap hash), so the field is stable frame to frame.
    const x = ((i * 197) % w);
    const y = ((i * 313) % h);
    const r = 2 + ((i * 7) % 4);
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  }
  ctx.restore();
}

/** Three cards fanned like a hand, tinted to the brand — the visual anchor. */
function drawCardFan(ctx: Ctx, cx: number, cy: number): void {
  const cards: { angle: number; tint: number; dx: number }[] = [
    { angle: -0.28, tint: 0x2b57b8, dx: -96 },   // blue
    { angle: 0.0, tint: BRAND, dx: 0 },           // red (front)
    { angle: 0.28, tint: 0x49c17a, dx: 96 },      // green
  ];
  // Back-to-front so the centre card sits on top.
  for (const c of [cards[0]!, cards[2]!, cards[1]!]) {
    ctx.save();
    ctx.translate(cx + c.dx * 0.6, cy);
    ctx.rotate(c.angle);
    const w = 150, h = 214;
    // Drop shadow.
    ctx.shadowColor = "rgba(0,0,0,0.55)"; ctx.shadowBlur = 24; ctx.shadowOffsetY = 10;
    roundRectPath(ctx, -w / 2, -h / 2, w, h, 14);
    ctx.fillStyle = "#0e1017"; ctx.fill();
    ctx.shadowColor = "transparent"; ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;
    // Tinted face.
    const g = ctx.createLinearGradient(0, -h / 2, 0, h / 2);
    g.addColorStop(0, hexToRgba(c.tint, 0.85));
    g.addColorStop(1, hexToRgba(c.tint, 0.35));
    roundRectPath(ctx, -w / 2 + 8, -h / 2 + 8, w - 16, h - 16, 10);
    ctx.fillStyle = g; ctx.fill();
    // Frame.
    roundRectPath(ctx, -w / 2, -h / 2, w, h, 14);
    ctx.lineWidth = 3; ctx.strokeStyle = hexToRgba(GOLD, 0.9); ctx.stroke();
    // A star pip centred, like a rarity mark.
    drawStar(ctx, 0, -14, 5, 14, 30, hexToRgba(GOLD, 0.95));
    ctx.restore();
  }
}

function drawStar(ctx: Ctx, x: number, y: number, pts: number, inner: number, outer: number, fill: string): void {
  ctx.save();
  ctx.fillStyle = fill;
  ctx.beginPath();
  const step = Math.PI / pts;
  for (let i = 0; i < pts * 2; i++) {
    const r = i % 2 === 0 ? outer : inner;
    const a = i * step - Math.PI / 2;
    const sx = x + Math.cos(a) * r, sy = y + Math.sin(a) * r;
    if (i === 0) ctx.moveTo(sx, sy); else ctx.lineTo(sx, sy);
  }
  ctx.closePath(); ctx.fill();
  ctx.restore();
}

/** Ellipsise `text` to fit `maxWidth` at `px` in the display font. */
function trimTo(ctx: Ctx, text: string, maxWidth: number, px: number): string {
  ctx.save();
  ctx.font = `bold ${px}px "${TITLE_FONT}", "DejaVu Sans", Arial, sans-serif`;
  let out = text;
  if (ctx.measureText(out).width > maxWidth) {
    while (out.length > 1 && ctx.measureText(`${out}…`).width > maxWidth) out = out.slice(0, -1);
    out = `${out}…`;
  }
  ctx.restore();
  void clamp01;
  return out;
}
