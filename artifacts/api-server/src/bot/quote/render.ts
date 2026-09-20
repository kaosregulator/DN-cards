// ─────────────────────────────────────────────────────────────────────────────
// Quote card canvas renderer — faded-avatar MakeItAQuote look + style variants.
// Uses the shared @napi-rs/canvas engine + render queue for snappy throughput.
// ─────────────────────────────────────────────────────────────────────────────

import { getCanvas, type CanvasMod, type Ctx } from "../animations/engine.js";
import { queueRender } from "../animations/render-queue.js";
import { BRAND_NAME } from "../help-banners.js";
import { fitFontSize } from "./text.js";
import type { QuoteTheme } from "./styles.js";
import { logger } from "../../lib/logger.js";

export interface QuoteRenderInput {
  text: string;
  displayName: string;
  handle: string;
  avatarUrl: string | null;
  theme: QuoteTheme;
  watermark?: string;
}

export const QUOTE_FILE = "quote.png";

async function loadAvatar(mod: CanvasMod, url: string | null) {
  if (!url) return null;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(6_000) });
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    return await mod.loadImage(buf);
  } catch (err) {
    logger.debug({ err }, "quote: avatar load failed");
    return null;
  }
}

function toGray(ctx: Ctx, x: number, y: number, w: number, h: number): void {
  const data = ctx.getImageData(x, y, w, h);
  const px = data.data;
  for (let i = 0; i < px.length; i += 4) {
    const g = (px[i]! * 0.299 + px[i + 1]! * 0.587 + px[i + 2]! * 0.114) | 0;
    px[i] = g;
    px[i + 1] = g;
    px[i + 2] = g;
  }
  ctx.putImageData(data, x, y);
}

/** Cover-fit drawImage into a destination rect. */
function drawCover(
  ctx: Ctx,
  img: { width: number; height: number },
  dx: number, dy: number, dw: number, dh: number,
): void {
  const ir = img.width / img.height;
  const dr = dw / dh;
  let sw: number, sh: number, sx: number, sy: number;
  if (ir > dr) {
    sh = img.height;
    sw = img.height * dr;
    sx = (img.width - sw) / 2;
    sy = 0;
  } else {
    sw = img.width;
    sh = img.width / dr;
    sx = 0;
    sy = (img.height - sh) / 2;
  }
  ctx.drawImage(img as any, sx, sy, sw, sh, dx, dy, dw, dh);
}

function fontFamily(tone: QuoteTheme["fontTone"]): string {
  switch (tone) {
    case "display": return '"Orbitron", "Arial Black", Arial, sans-serif';
    case "impact": return '"Arial Black", Impact, Arial, sans-serif';
    case "serif": return 'Georgia, "Times New Roman", serif';
    default: return 'Arial, "Helvetica Neue", Helvetica, sans-serif';
  }
}

function paintBackground(ctx: Ctx, theme: QuoteTheme, w: number, h: number): void {
  ctx.fillStyle = theme.background;
  ctx.fillRect(0, 0, w, h);
  if (theme.backgroundGradient) {
    const g = theme.backgroundGradient;
    const grad = ctx.createLinearGradient(g.x0 * w, g.y0 * h, g.x1 * w, g.y1 * h);
    for (const [color, stop] of g.stops) grad.addColorStop(stop, color);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);
  }
}

/** Draw avatar with an alpha-fade into whatever sits behind it. */
async function drawFadedAvatar(
  mod: CanvasMod,
  ctx: Ctx,
  img: { width: number; height: number } | null,
  theme: QuoteTheme,
  w: number,
  h: number,
): Promise<void> {
  if (!img || theme.avatarLayout === "none") return;

  if (theme.avatarLayout === "corner") {
    const size = Math.round(Math.min(w, h) * theme.avatarShare);
    const pad = Math.round(size * 0.28);
    const x = pad;
    const y = h - size - pad;
    ctx.save();
    ctx.beginPath();
    ctx.arc(x + size / 2, y + size / 2, size / 2, 0, Math.PI * 2);
    ctx.closePath();
    ctx.clip();
    drawCover(ctx, img, x, y, size, size);
    if (theme.grayscale) toGray(ctx, x, y, size, size);
    ctx.restore();
    // Thin ring.
    ctx.save();
    ctx.strokeStyle = theme.accentColor ?? "rgba(255,255,255,0.35)";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(x + size / 2, y + size / 2, size / 2 + 1, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
    return;
  }

  if (theme.avatarLayout === "portrait") {
    const tmp = mod.createCanvas(w, h);
    const tctx = tmp.getContext("2d") as unknown as Ctx;
    drawCover(tctx, img, 0, 0, w, h);
    if (theme.grayscale) toGray(tctx, 0, 0, w, h);
    // Fade downward so the quote zone is readable.
    const fadeStart = 1 - theme.fadeShare;
    const mask = tctx.createLinearGradient(0, h * fadeStart, 0, h);
    mask.addColorStop(0, "rgba(0,0,0,1)");
    mask.addColorStop(0.45, "rgba(0,0,0,0.55)");
    mask.addColorStop(1, "rgba(0,0,0,0)");
    tctx.globalCompositeOperation = "destination-in";
    tctx.fillStyle = mask;
    tctx.fillRect(0, 0, w, h);
    (ctx as unknown as { drawImage(i: unknown, x: number, y: number): void }).drawImage(tmp, 0, 0);
    // Dark wash under the text for contrast.
    const wash = ctx.createLinearGradient(0, h * 0.35, 0, h);
    wash.addColorStop(0, "rgba(0,0,0,0)");
    wash.addColorStop(0.55, "rgba(0,0,0,0.55)");
    wash.addColorStop(1, "rgba(0,0,0,0.88)");
    ctx.fillStyle = wash;
    ctx.fillRect(0, 0, w, h);
    return;
  }

  const avatarW = Math.round(w * theme.avatarShare);
  const onRight = theme.avatarLayout === "right";
  const dx = onRight ? w - avatarW : 0;

  const tmp = mod.createCanvas(avatarW, h);
  const tctx = tmp.getContext("2d") as unknown as Ctx;
  drawCover(tctx, img, 0, 0, avatarW, h);
  if (theme.grayscale) toGray(tctx, 0, 0, avatarW, h);

  // Soft horizontal fade into the text panel — keep most of the face opaque,
  // then feather only the trailing edge (MakeItAQuote classic look).
  const fadePx = Math.max(48, Math.round(avatarW * theme.fadeShare));
  const mask = onRight
    ? tctx.createLinearGradient(0, 0, fadePx, 0)
    : tctx.createLinearGradient(avatarW - fadePx, 0, avatarW, 0);
  if (onRight) {
    mask.addColorStop(0, "rgba(0,0,0,0)");
    mask.addColorStop(0.25, "rgba(0,0,0,0.35)");
    mask.addColorStop(0.7, "rgba(0,0,0,0.85)");
    mask.addColorStop(1, "rgba(0,0,0,1)");
  } else {
    mask.addColorStop(0, "rgba(0,0,0,1)");
    mask.addColorStop(0.3, "rgba(0,0,0,0.9)");
    mask.addColorStop(0.75, "rgba(0,0,0,0.35)");
    mask.addColorStop(1, "rgba(0,0,0,0)");
  }
  tctx.globalCompositeOperation = "destination-in";
  tctx.fillStyle = mask;
  tctx.fillRect(0, 0, avatarW, h);
  (ctx as unknown as { drawImage(i: unknown, x: number, y: number): void }).drawImage(tmp, dx, 0);
}

function drawTextBlock(
  ctx: Ctx,
  theme: QuoteTheme,
  input: QuoteRenderInput,
  textBox: { x: number; y: number; w: number; h: number },
): void {
  const family = fontFamily(theme.fontTone);
  const padX = 8;
  const maxW = textBox.w - padX * 2;

  // Quote marks (portrait / spotlight).
  let quotePrefix = "";
  if (theme.quoteMarks) {
    ctx.fillStyle = theme.accentColor ?? "rgba(255,255,255,0.35)";
    ctx.font = `700 ${Math.round(theme.height * 0.12)}px ${family}`;
    ctx.textAlign = "left";
    ctx.fillText("“", textBox.x, textBox.y + Math.round(theme.height * 0.02));
    quotePrefix = "";
  }

  const text = (quotePrefix + input.text).trim() || "…";
  const maxSize = theme.fontTone === "impact"
    ? Math.round(theme.height * 0.14)
    : theme.avatarLayout === "portrait"
      ? Math.round(theme.height * 0.055)
      : Math.round(theme.height * 0.075);
  const minSize = theme.fontTone === "impact" ? 28 : 22;
  const weight = theme.fontTone === "impact" ? "900" : "600";

  // Reserve room for attribution + handle under the quote.
  const attrBlock = Math.round(theme.height * 0.14);
  const fit = fitFontSize(ctx, text, maxW, textBox.h - attrBlock, maxSize, minSize, family, weight);

  const blockH = fit.lines.length * fit.lineHeight;
  let y = textBox.y + Math.max(0, (textBox.h - attrBlock - blockH) / 2) + fit.size;
  ctx.fillStyle = theme.textColor;
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  const cx = textBox.x + textBox.w / 2;
  for (const line of fit.lines) {
    ctx.font = `${weight} ${fit.size}px ${family}`;
    ctx.fillText(line, cx, y);
    y += fit.lineHeight;
  }

  // Attribution.
  y += Math.round(fit.size * 0.55);
  const attr = `— ${input.displayName || "someone"}`;
  ctx.font = `italic 500 ${Math.max(18, Math.round(fit.size * 0.42))}px ${family}`;
  ctx.fillStyle = theme.attributionColor;
  ctx.fillText(attr, cx, y);

  y += Math.round(fit.size * 0.42);
  const handle = input.handle.startsWith("@") ? input.handle : `@${input.handle}`;
  ctx.font = `400 ${Math.max(14, Math.round(fit.size * 0.32))}px ${family}`;
  ctx.fillStyle = theme.handleColor;
  ctx.fillText(handle, cx, y);
}

function drawWatermark(ctx: Ctx, theme: QuoteTheme, w: number, h: number, label: string): void {
  ctx.save();
  ctx.font = `400 16px Arial, sans-serif`;
  ctx.fillStyle = theme.watermarkColor;
  ctx.textAlign = "right";
  ctx.textBaseline = "bottom";
  ctx.fillText(label, w - 22, h - 16);
  ctx.restore();
}

function drawLetterbox(ctx: Ctx, w: number, h: number): void {
  const bar = Math.round(h * 0.08);
  ctx.fillStyle = "#000000";
  ctx.fillRect(0, 0, w, bar);
  ctx.fillRect(0, h - bar, w, bar);
}

function textBoxFor(theme: QuoteTheme, w: number, h: number): { x: number; y: number; w: number; h: number } {
  const margin = Math.round(Math.min(w, h) * 0.06);
  if (theme.avatarLayout === "portrait") {
    return {
      x: margin,
      y: Math.round(h * 0.52),
      w: w - margin * 2,
      h: Math.round(h * 0.42) - margin,
    };
  }
  if (theme.avatarLayout === "corner" || theme.avatarLayout === "none") {
    const bottomPad = theme.avatarLayout === "corner" ? Math.round(h * 0.22) : margin;
    return {
      x: margin * 1.4,
      y: margin + (theme.letterbox ? Math.round(h * 0.08) : 0),
      w: w - margin * 2.8,
      h: h - margin * 2 - bottomPad - (theme.letterbox ? Math.round(h * 0.08) : 0),
    };
  }
  const avatarW = Math.round(w * theme.avatarShare);
  const fade = Math.round(avatarW * theme.fadeShare * 0.35);
  if (theme.avatarLayout === "right") {
    return {
      x: margin,
      y: margin,
      w: w - avatarW + fade - margin * 1.2,
      h: h - margin * 2,
    };
  }
  // left
  return {
    x: avatarW - fade + margin * 0.4,
    y: margin,
    w: w - (avatarW - fade) - margin * 1.4,
    h: h - margin * 2,
  };
}

export async function renderQuoteCard(input: QuoteRenderInput): Promise<Buffer | null> {
  return queueRender("quote-card", async () => {
    const mod = await getCanvas();
    if (!mod) return null;
    const theme = input.theme;
    const { width: w, height: h } = theme;
    try {
      const canvas = mod.createCanvas(w, h);
      const ctx = canvas.getContext("2d") as unknown as Ctx;

      paintBackground(ctx, theme, w, h);

      const avatar = await loadAvatar(mod, input.avatarUrl);
      await drawFadedAvatar(mod, ctx, avatar, theme, w, h);

      if (theme.letterbox) drawLetterbox(ctx, w, h);

      drawTextBlock(ctx, theme, input, textBoxFor(theme, w, h));
      drawWatermark(ctx, theme, w, h, input.watermark ?? BRAND_NAME);

      return await canvas.encode("png");
    } catch (err) {
      logger.warn({ err }, "quote: render failed");
      return null;
    }
  }, 1);
}
