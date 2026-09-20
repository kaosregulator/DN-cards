// ─────────────────────────────────────────────────────────────────────────────
// Dual-quote renderer — fuse two Discord messages into one funny card.
// ─────────────────────────────────────────────────────────────────────────────

import { getCanvas, type CanvasMod, type Ctx } from "../animations/engine.js";
import { queueRender } from "../animations/render-queue.js";
import { BRAND_NAME } from "../help-banners.js";
import { fitFontSize, wrapLines } from "./text.js";
import type { DualQuoteTheme } from "./dual-styles.js";
import { logger } from "../../lib/logger.js";

export interface DualLine {
  text: string;
  displayName: string;
  handle: string;
  avatarUrl: string | null;
  createdAt?: Date;
}

export interface DualQuoteRenderInput {
  a: DualLine;
  b: DualLine;
  theme: DualQuoteTheme;
  watermark?: string;
}

export const DUAL_QUOTE_FILE = "duo-quote.png";

type Img = { width: number; height: number };

async function loadAvatar(mod: CanvasMod, url: string | null): Promise<Img | null> {
  if (!url) return null;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(6_000) });
    if (!res.ok) return null;
    return await mod.loadImage(Buffer.from(await res.arrayBuffer()));
  } catch (err) {
    logger.debug({ err }, "duo-quote: avatar load failed");
    return null;
  }
}

function drawCover(ctx: Ctx, img: Img, dx: number, dy: number, dw: number, dh: number): void {
  const ir = img.width / img.height;
  const dr = dw / dh;
  let sw: number, sh: number, sx: number, sy: number;
  if (ir > dr) {
    sh = img.height; sw = img.height * dr;
    sx = (img.width - sw) / 2; sy = 0;
  } else {
    sw = img.width; sh = img.width / dr;
    sx = 0; sy = (img.height - sh) / 2;
  }
  ctx.drawImage(img as any, sx, sy, sw, sh, dx, dy, dw, dh);
}

function drawCircleAvatar(
  ctx: Ctx, img: Img | null, cx: number, cy: number, r: number,
  grayscale = false,
): void {
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.closePath();
  ctx.clip();
  if (img) {
    drawCover(ctx, img, cx - r, cy - r, r * 2, r * 2);
    if (grayscale) {
      const data = ctx.getImageData(cx - r, cy - r, r * 2, r * 2);
      const px = data.data;
      for (let i = 0; i < px.length; i += 4) {
        const g = (px[i]! * 0.299 + px[i + 1]! * 0.587 + px[i + 2]! * 0.114) | 0;
        px[i] = g; px[i + 1] = g; px[i + 2] = g;
      }
      ctx.putImageData(data, cx - r, cy - r);
    }
  } else {
    ctx.fillStyle = "#444";
    ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
  }
  ctx.restore();
}

function roundRect(ctx: Ctx, x: number, y: number, w: number, h: number, r: number): void {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

function handleOf(line: DualLine): string {
  return line.handle.startsWith("@") ? line.handle : `@${line.handle}`;
}

function formatDiscordTime(d: Date): string {
  const h = d.getHours();
  const m = d.getMinutes().toString().padStart(2, "0");
  const ap = h >= 12 ? "PM" : "AM";
  const hr = ((h + 11) % 12) + 1;
  return `Today at ${hr}:${m} ${ap}`;
}

// ── Discord Chat Screenshot ───────────────────────────────────────────────────
function paintDuoChat(
  ctx: Ctx, theme: DualQuoteTheme, a: DualLine, b: DualLine,
  imgA: Img | null, imgB: Img | null,
): void {
  const { width: w, height: h } = theme;
  ctx.fillStyle = "#1E1F22";
  ctx.fillRect(0, 0, w, h);

  // Channel header strip
  ctx.fillStyle = "#2B2D31";
  ctx.fillRect(0, 0, w, 48);
  ctx.fillStyle = "#F2F3F5";
  ctx.font = `700 16px Arial, sans-serif`;
  ctx.textAlign = "left";
  ctx.fillText("#  receipts", 20, 30);
  ctx.fillStyle = theme.mutedColor;
  ctx.font = `400 12px Arial, sans-serif`;
  ctx.fillText("2 messages · quote fuse", 120, 30);

  const cardX = 16, cardY = 60, cardW = w - 32, cardH = h - 76;
  roundRect(ctx, cardX, cardY, cardW, cardH, 12);
  ctx.fillStyle = theme.background;
  ctx.fill();

  drawChatMessage(ctx, theme, a, imgA, cardX + 20, cardY + 24, cardW - 40);
  // Divider
  ctx.strokeStyle = "rgba(255,255,255,0.06)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(cardX + 70, cardY + cardH / 2);
  ctx.lineTo(cardX + cardW - 20, cardY + cardH / 2);
  ctx.stroke();
  drawChatMessage(ctx, theme, b, imgB, cardX + 20, cardY + cardH / 2 + 16, cardW - 40);

  // Footer watermark
  ctx.fillStyle = "rgba(255,255,255,0.25)";
  ctx.font = `400 11px Arial, sans-serif`;
  ctx.textAlign = "right";
  ctx.fillText(BRAND_NAME, w - 24, h - 12);
}

function drawChatMessage(
  ctx: Ctx, theme: DualQuoteTheme, line: DualLine, img: Img | null,
  x: number, y: number, maxW: number,
): void {
  const av = 44;
  drawCircleAvatar(ctx, img, x + av / 2, y + av / 2, av / 2);

  const tx = x + av + 14;
  ctx.textAlign = "left";
  ctx.fillStyle = "#FFFFFF";
  ctx.font = `700 16px Arial, sans-serif`;
  ctx.fillText(line.displayName || "User", tx, y + 16);
  const nameW = ctx.measureText(line.displayName || "User").width;
  ctx.fillStyle = theme.mutedColor;
  ctx.font = `400 12px Arial, sans-serif`;
  ctx.fillText(formatDiscordTime(line.createdAt ?? new Date()), tx + nameW + 10, y + 16);

  ctx.fillStyle = theme.textColor;
  ctx.font = `400 16px Arial, sans-serif`;
  const lines = wrapLines(ctx, line.text || "…", maxW - av - 20);
  let ly = y + 40;
  for (const l of lines.slice(0, 4)) {
    ctx.fillText(l, tx, ly);
    ly += 22;
  }
}

// ── Versus split ──────────────────────────────────────────────────────────────
function paintDuoVersus(
  ctx: Ctx, theme: DualQuoteTheme, a: DualLine, b: DualLine,
  imgA: Img | null, imgB: Img | null,
): void {
  const { width: w, height: h } = theme;
  ctx.fillStyle = theme.background;
  ctx.fillRect(0, 0, w, h);

  // Left / right panels
  ctx.fillStyle = "#0E0E12";
  ctx.fillRect(0, 0, w / 2 - 2, h);
  ctx.fillStyle = "#141018";
  ctx.fillRect(w / 2 + 2, 0, w / 2 - 2, h);

  // VS badge
  ctx.fillStyle = theme.accentColor ?? "#FF4D6D";
  ctx.beginPath();
  ctx.arc(w / 2, h / 2, 36, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#FFFFFF";
  ctx.font = `900 22px Arial Black, Arial, sans-serif`;
  ctx.textAlign = "center";
  ctx.fillText("VS", w / 2, h / 2 + 8);

  paintVersusSide(ctx, theme, a, imgA, 0, w / 2 - 8, h, false);
  paintVersusSide(ctx, theme, b, imgB, w / 2 + 8, w / 2 - 8, h, true);
}

function paintVersusSide(
  ctx: Ctx, theme: DualQuoteTheme, line: DualLine, img: Img | null,
  x: number, panelW: number, h: number, reply: boolean,
): void {
  const cx = x + panelW / 2;
  drawCircleAvatar(ctx, img, cx, 110, 56, true);

  ctx.fillStyle = theme.mutedColor;
  ctx.font = `700 13px Arial, sans-serif`;
  ctx.textAlign = "center";
  ctx.fillText(reply ? "THE REPLY" : "THEY SAID", cx, 190);

  ctx.fillStyle = "#FFFFFF";
  ctx.font = `700 18px Arial, sans-serif`;
  ctx.fillText(line.displayName || "someone", cx, 218);

  const fit = fitFontSize(ctx, line.text || "…", panelW - 48, h - 320, 36, 18, "Arial, sans-serif", "600");
  let y = 270;
  ctx.fillStyle = theme.textColor;
  for (const l of fit.lines) {
    ctx.font = `600 ${fit.size}px Arial, sans-serif`;
    ctx.fillText(l, cx, y);
    y += fit.lineHeight;
  }

  ctx.fillStyle = theme.mutedColor;
  ctx.font = `400 13px Arial, sans-serif`;
  ctx.fillText(handleOf(line), cx, h - 36);
}

// ── Thread literary ───────────────────────────────────────────────────────────
function paintDuoThread(
  ctx: Ctx, theme: DualQuoteTheme, a: DualLine, b: DualLine,
  imgA: Img | null, imgB: Img | null,
): void {
  const { width: w, height: h } = theme;
  ctx.fillStyle = theme.background;
  ctx.fillRect(0, 0, w, h);

  // Accent bar
  ctx.fillStyle = theme.accentColor ?? "#E8C547";
  ctx.fillRect(0, 0, 8, h);

  ctx.fillStyle = theme.mutedColor;
  ctx.font = `700 14px Arial, sans-serif`;
  ctx.textAlign = "left";
  ctx.fillText("THE THREAD", 40, 48);

  // Block A
  drawCircleAvatar(ctx, imgA, 64, 110, 28, true);
  ctx.fillStyle = theme.mutedColor;
  ctx.font = `italic 400 15px Georgia, serif`;
  ctx.fillText(`${a.displayName} said…`, 110, 100);
  const fitA = fitFontSize(ctx, `"${a.text}"`, w - 140, 140, 34, 18, "Georgia, serif", "500");
  let y = 140;
  ctx.fillStyle = theme.textColor;
  ctx.textAlign = "left";
  for (const l of fitA.lines) {
    ctx.font = `500 ${fitA.size}px Georgia, serif`;
    ctx.fillText(l, 110, y);
    y += fitA.lineHeight;
  }

  // Connector
  y += 28;
  ctx.strokeStyle = "rgba(255,255,255,0.2)";
  ctx.setLineDash([6, 6]);
  ctx.beginPath();
  ctx.moveTo(110, y);
  ctx.lineTo(w - 60, y);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = theme.accentColor ?? "#E8C547";
  ctx.font = `700 13px Arial, sans-serif`;
  ctx.textAlign = "center";
  ctx.fillText("YEAH BUT THEN", w / 2, y + 5);

  // Block B
  y += 50;
  drawCircleAvatar(ctx, imgB, 64, y + 10, 28, true);
  ctx.textAlign = "left";
  ctx.fillStyle = theme.mutedColor;
  ctx.font = `italic 400 15px Georgia, serif`;
  ctx.fillText(`${b.displayName} came back with…`, 110, y);
  const fitB = fitFontSize(ctx, `"${b.text}"`, w - 140, 160, 38, 18, "Georgia, serif", "600");
  y += 40;
  ctx.fillStyle = "#FFFFFF";
  for (const l of fitB.lines) {
    ctx.font = `600 ${fitB.size}px Georgia, serif`;
    ctx.fillText(l, 110, y);
    y += fitB.lineHeight;
  }

  ctx.fillStyle = theme.mutedColor;
  ctx.font = `400 12px Arial, sans-serif`;
  ctx.textAlign = "right";
  ctx.fillText(`${handleOf(a)}  →  ${handleOf(b)}`, w - 40, h - 28);
}

// ── Ayoo punchline ────────────────────────────────────────────────────────────
function paintDuoAyoo(
  ctx: Ctx, theme: DualQuoteTheme, a: DualLine, b: DualLine,
  imgA: Img | null, imgB: Img | null,
): void {
  const { width: w, height: h } = theme;
  ctx.fillStyle = theme.background;
  ctx.fillRect(0, 0, w, h);

  // Setup — quiet, small
  drawCircleAvatar(ctx, imgA, 70, 70, 28, true);
  ctx.textAlign = "left";
  ctx.fillStyle = theme.mutedColor;
  ctx.font = `400 14px Arial, sans-serif`;
  ctx.fillText(`${a.displayName} · setup`, 110, 55);
  ctx.fillStyle = "rgba(255,255,255,0.55)";
  ctx.font = `400 22px Arial, sans-serif`;
  const setupLines = wrapLines(ctx, a.text || "…", w - 160);
  let y = 90;
  for (const l of setupLines.slice(0, 3)) {
    ctx.fillText(l, 110, y);
    y += 28;
  }

  // Divider
  y += 20;
  ctx.fillStyle = theme.accentColor ?? "#FEE75C";
  ctx.font = `900 18px Arial Black, Arial, sans-serif`;
  ctx.fillText("AYOO  ↓", 110, y);

  // Punchline — huge
  y += 50;
  drawCircleAvatar(ctx, imgB, 80, y + 20, 36, false);
  ctx.fillStyle = theme.accentColor ?? "#FEE75C";
  ctx.font = `700 14px Arial, sans-serif`;
  ctx.fillText(b.displayName || "reply", 130, y);

  const fit = fitFontSize(
    ctx, (b.text || "…").toUpperCase(), w - 160, h - y - 100,
    64, 28, '"Arial Black", Impact, Arial, sans-serif', "900",
  );
  y += 50;
  ctx.fillStyle = "#FFFFFF";
  ctx.textAlign = "left";
  for (const l of fit.lines) {
    ctx.font = `900 ${fit.size}px "Arial Black", Impact, Arial, sans-serif`;
    ctx.fillText(l, 130, y);
    y += fit.lineHeight;
  }

  ctx.fillStyle = theme.mutedColor;
  ctx.font = `400 13px Arial, sans-serif`;
  ctx.textAlign = "right";
  ctx.fillText(`${handleOf(b)} cooked the chat`, w - 36, h - 28);
}

// ── Double receipts (4K board) ────────────────────────────────────────────────
function paintDuoReceipts(
  ctx: Ctx, theme: DualQuoteTheme, a: DualLine, b: DualLine,
  imgA: Img | null, imgB: Img | null,
): void {
  const { width: w, height: h } = theme;
  ctx.fillStyle = theme.background;
  ctx.fillRect(0, 0, w, h);

  // Grain (sparse)
  const grain = ctx.getImageData(0, 0, w, h);
  const px = grain.data;
  for (let yi = 0; yi < h; yi += 3) {
    for (let xi = 0; xi < w; xi += 3) {
      const i = (yi * w + xi) * 4;
      const n = (Math.random() * 45) | 0;
      px[i] = Math.min(255, (px[i]! || 8) + n);
      px[i + 1] = Math.min(255, (px[i + 1]! || 8) + n);
      px[i + 2] = Math.min(255, (px[i + 2]! || 8) + n);
    }
  }
  ctx.putImageData(grain, 0, 0);

  ctx.strokeStyle = "rgba(255,255,255,0.7)";
  ctx.lineWidth = 2;
  ctx.strokeRect(20, 20, w - 40, h - 40);

  // REC
  ctx.fillStyle = theme.accentColor ?? "#FF2A2A";
  ctx.beginPath();
  ctx.arc(56, 52, 7, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#FFF";
  ctx.font = `700 18px "Courier New", monospace`;
  ctx.textAlign = "left";
  ctx.fillText("REC  ·  DOUBLE RECEIPTS", 74, 58);

  paintReceiptRow(ctx, theme, a, imgA, 56, 120, w - 112, "01");
  paintReceiptRow(ctx, theme, b, imgB, 56, 360, w - 112, "02");

  ctx.fillStyle = "#FFF";
  ctx.font = `700 18px "Courier New", monospace`;
  ctx.textAlign = "right";
  ctx.fillText("BOTH CAUGHT IN 4K", w - 48, h - 40);
}

function paintReceiptRow(
  ctx: Ctx, theme: DualQuoteTheme, line: DualLine, img: Img | null,
  x: number, y: number, maxW: number, tag: string,
): void {
  ctx.fillStyle = theme.accentColor ?? "#FF2A2A";
  ctx.font = `700 14px "Courier New", monospace`;
  ctx.textAlign = "left";
  ctx.fillText(`EVIDENCE ${tag}`, x, y);

  drawCircleAvatar(ctx, img, x + 28, y + 50, 28, true);
  ctx.fillStyle = "#FFF";
  ctx.font = `700 22px "Courier New", monospace`;
  ctx.fillText((line.displayName || "USER").toUpperCase(), x + 70, y + 42);
  ctx.fillStyle = theme.mutedColor;
  ctx.font = `400 14px "Courier New", monospace`;
  ctx.fillText(handleOf(line), x + 70, y + 66);

  ctx.fillStyle = theme.textColor;
  ctx.font = `400 22px "Courier New", monospace`;
  const lines = wrapLines(ctx, line.text || "…", maxW - 20);
  let ly = y + 110;
  for (const l of lines.slice(0, 3)) {
    ctx.fillText(l, x, ly);
    ly += 28;
  }
}

export async function renderDualQuoteCard(input: DualQuoteRenderInput): Promise<Buffer | null> {
  return queueRender("duo-quote", async () => {
    const mod = await getCanvas();
    if (!mod) return null;
    const theme = input.theme;
    const { width: w, height: h } = theme;
    try {
      const canvas = mod.createCanvas(w, h);
      const ctx = canvas.getContext("2d") as unknown as Ctx;
      const [imgA, imgB] = await Promise.all([
        loadAvatar(mod, input.a.avatarUrl),
        loadAvatar(mod, input.b.avatarUrl),
      ]);

      switch (theme.layout) {
        case "duo-chat":
          paintDuoChat(ctx, theme, input.a, input.b, imgA, imgB);
          break;
        case "duo-versus":
          paintDuoVersus(ctx, theme, input.a, input.b, imgA, imgB);
          break;
        case "duo-thread":
          paintDuoThread(ctx, theme, input.a, input.b, imgA, imgB);
          break;
        case "duo-ayoo":
          paintDuoAyoo(ctx, theme, input.a, input.b, imgA, imgB);
          break;
        case "duo-receipts":
          paintDuoReceipts(ctx, theme, input.a, input.b, imgA, imgB);
          break;
      }

      return await canvas.encode("png");
    } catch (err) {
      logger.warn({ err }, "duo-quote: render failed");
      return null;
    }
  }, 1);
}
