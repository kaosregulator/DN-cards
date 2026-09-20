// ─────────────────────────────────────────────────────────────────────────────
// Dual-quote vibe layouts — Chat Bubble / Terminal / Polaroid / Sticky /
// Text Message / Newspaper / Receipt / Chat Log / Comic.
// ─────────────────────────────────────────────────────────────────────────────

import type { Ctx } from "../animations/engine.js";
import { wrapLines } from "./text.js";
import type { DualQuoteTheme } from "./dual-styles.js";

export interface DualLine {
  text: string;
  displayName: string;
  handle: string;
  avatarUrl: string | null;
  createdAt?: Date;
}

type Img = { width: number; height: number };

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

function drawCircleAvatar(ctx: Ctx, img: Img | null, cx: number, cy: number, r: number): void {
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.closePath();
  ctx.clip();
  if (img) {
    drawCover(ctx, img, cx - r, cy - r, r * 2, r * 2);
  } else {
    ctx.fillStyle = "#5865F2";
    ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
    ctx.fillStyle = "#FFF";
    ctx.font = `700 ${Math.max(12, r * 0.7)}px Arial, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("D", cx, cy + 1);
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

function formatDiscordTime(d: Date): string {
  const h = d.getHours();
  const m = d.getMinutes().toString().padStart(2, "0");
  const ap = h >= 12 ? "PM" : "AM";
  const hr = ((h + 11) % 12) + 1;
  return `Today at ${hr}:${m} ${ap}`;
}

function hhmmss(d: Date): string {
  return [
    d.getHours().toString().padStart(2, "0"),
    d.getMinutes().toString().padStart(2, "0"),
    d.getSeconds().toString().padStart(2, "0"),
  ].join(":");
}

function hhmm(d: Date): string {
  return `${d.getHours().toString().padStart(2, "0")}:${d.getMinutes().toString().padStart(2, "0")}`;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ── 1. Chat Bubble ────────────────────────────────────────────────────────────
export function paintDuoBubble(
  ctx: Ctx, theme: DualQuoteTheme, a: DualLine, b: DualLine,
  imgA: Img | null, imgB: Img | null,
): void {
  const { width: w, height: h } = theme;
  ctx.fillStyle = theme.background;
  ctx.fillRect(0, 0, w, h);

  // Soft neon wash
  const wash = ctx.createRadialGradient(w * 0.7, h * 0.55, 20, w * 0.7, h * 0.55, w * 0.55);
  wash.addColorStop(0, "rgba(77,163,255,0.22)");
  wash.addColorStop(1, "rgba(77,163,255,0)");
  ctx.fillStyle = wash;
  ctx.fillRect(0, 0, w, h);

  const cardW = w - 160;
  const cardX = 80;
  paintGlassBubble(ctx, theme, a, imgA, cardX, 70, cardW, "light");
  paintGlassBubble(ctx, theme, b, imgB, cardX, 280, cardW, "glow");

  // Blue spark accent near first bubble
  drawSpark(ctx, cardX + cardW - 10, 78, theme.accentColor ?? "#4DA3FF");
}

function paintGlassBubble(
  ctx: Ctx, theme: DualQuoteTheme, line: DualLine, img: Img | null,
  x: number, y: number, w: number, variant: "light" | "glow",
): void {
  const h = 160;
  if (variant === "glow") {
    ctx.save();
    ctx.shadowColor = theme.accentColor ?? "#4DA3FF";
    ctx.shadowBlur = 32;
    roundRect(ctx, x, y, w, h, 22);
    ctx.fillStyle = "rgba(20,28,44,0.95)";
    ctx.fill();
    ctx.restore();
  }
  roundRect(ctx, x, y, w, h, 22);
  if (variant === "light") {
    ctx.fillStyle = "#F4F6FA";
    ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,0.35)";
    ctx.lineWidth = 1;
    ctx.stroke();
  } else {
    ctx.fillStyle = "rgba(16,24,40,0.95)";
    ctx.fill();
    ctx.strokeStyle = "rgba(77,163,255,0.65)";
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  const nameCol = variant === "light" ? "#1E6BB8" : theme.nameColor;
  const mutedCol = variant === "light" ? "#6B7280" : theme.mutedColor;
  const textCol = variant === "light" ? "#111827" : "#FFFFFF";

  const avR = 22;
  drawCircleAvatar(ctx, img, x + 28 + avR, y + 28 + avR, avR);
  const tx = x + 28 + avR * 2 + 14;
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = nameCol;
  ctx.font = `700 16px Arial, sans-serif`;
  ctx.fillText(line.displayName || "User", tx, y + 42);
  const nw = ctx.measureText(line.displayName || "User").width;
  ctx.fillStyle = mutedCol;
  ctx.font = `400 12px Arial, sans-serif`;
  ctx.fillText(formatDiscordTime(line.createdAt ?? new Date()), tx + nw + 10, y + 42);

  ctx.fillStyle = textCol;
  ctx.font = `400 16px Arial, sans-serif`;
  const lines = wrapLines(ctx, line.text || "…", w - 90);
  let ly = y + 72;
  for (const l of lines.slice(0, 3)) {
    ctx.fillText(l, tx, ly);
    ly += 24;
  }
}

function drawSpark(ctx: Ctx, x: number, y: number, color: string): void {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = 2.5;
  ctx.lineCap = "round";
  ctx.shadowColor = color;
  ctx.shadowBlur = 8;
  for (const [dx, dy, len] of [[0, -1, 14], [0.9, -0.4, 12], [0.7, 0.7, 10]] as const) {
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + dx * len, y + dy * len);
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.arc(x, y, 3, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

// ── 2. Terminal ───────────────────────────────────────────────────────────────
export function paintDuoTerminal(
  ctx: Ctx, theme: DualQuoteTheme, a: DualLine, b: DualLine,
  _imgA: Img | null, _imgB: Img | null,
): void {
  const { width: w, height: h } = theme;
  const green = theme.textColor;
  ctx.fillStyle = "#020402";
  ctx.fillRect(0, 0, w, h);

  const pad = 24;
  const winX = pad, winY = pad, winW = w - pad * 2, winH = h - pad * 2;

  // Window chrome
  roundRect(ctx, winX, winY, winW, winH, 10);
  ctx.fillStyle = "#0A0F0A";
  ctx.fill();
  ctx.strokeStyle = green;
  ctx.lineWidth = 2;
  ctx.stroke();

  // Title bar
  ctx.fillStyle = "#121A12";
  roundRect(ctx, winX, winY, winW, 36, 10);
  ctx.fill();
  ctx.fillRect(winX, winY + 18, winW, 18);

  // Traffic lights
  for (const [i, c] of [["#FF5F56", 0], ["#FFBD2E", 1], ["#27C93F", 2]] as const) {
    ctx.fillStyle = i;
    ctx.beginPath();
    ctx.arc(winX + 22 + Number(c) * 18, winY + 18, 6, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = green;
  ctx.font = `600 13px "Courier New", monospace`;
  ctx.textAlign = "right";
  ctx.fillText("DN QUOTES v1.0", winX + winW - 16, winY + 23);

  // Scanline tint
  ctx.fillStyle = "rgba(0,255,80,0.03)";
  for (let y = winY + 40; y < winY + winH; y += 3) {
    ctx.fillRect(winX + 2, y, winW - 4, 1);
  }

  const mono = `"Courier New", Courier, monospace`;
  let y = winY + 70;
  const x = winX + 28;
  const entries: Array<[DualLine, string]> = [
    [a, hhmmss(a.createdAt ?? new Date())],
    [b, hhmmss(b.createdAt ?? new Date(Date.now() + 60_000))],
  ];
  ctx.textAlign = "left";
  for (const [line, ts] of entries) {
    ctx.fillStyle = green;
    ctx.font = `700 16px ${mono}`;
    ctx.fillText(`[${ts}] <${line.displayName || "user"}>`, x, y);
    y += 28;
    ctx.font = `400 16px ${mono}`;
    const lines = wrapLines(ctx, line.text || "…", winW - 60);
    for (const l of lines.slice(0, 3)) {
      ctx.fillText(l, x, y);
      y += 24;
    }
    y += 28;
  }

  // Cursor
  ctx.fillStyle = green;
  ctx.fillRect(x, y - 14, 12, 18);
}

// ── 3. Polaroid ───────────────────────────────────────────────────────────────
export function paintDuoPolaroid(
  ctx: Ctx, theme: DualQuoteTheme, a: DualLine, b: DualLine,
  imgA: Img | null, imgB: Img | null,
): void {
  const { width: w, height: h } = theme;
  paintWoodGrain(ctx, w, h);

  drawPolaroid(ctx, theme, a, imgA, 90, 70, -6, "#3B82F6");
  drawPolaroid(ctx, theme, b, imgB, 520, 90, 5, "#EF4444");
}

function paintWoodGrain(ctx: Ctx, w: number, h: number): void {
  ctx.fillStyle = "#3A2618";
  ctx.fillRect(0, 0, w, h);
  const rnd = mulberry32(42);
  for (let i = 0; i < 40; i++) {
    const y = (i / 40) * h + (rnd() - 0.5) * 8;
    ctx.strokeStyle = `rgba(${60 + rnd() * 40 | 0},${35 + rnd() * 25 | 0},${18 + rnd() * 15 | 0},${0.35 + rnd() * 0.3})`;
    ctx.lineWidth = 2 + rnd() * 4;
    ctx.beginPath();
    ctx.moveTo(0, y);
    for (let x = 0; x <= w; x += 40) {
      ctx.quadraticCurveTo(x + 20, y + Math.sin(x * 0.02 + i) * 6, x + 40, y);
    }
    ctx.stroke();
  }
  // subtle noise
  const img = ctx.getImageData(0, 0, w, h);
  const px = img.data;
  for (let i = 0; i < px.length; i += 32) {
    const n = ((rnd() * 20) | 0) - 8;
    px[i] = Math.max(0, Math.min(255, (px[i] ?? 50) + n));
    px[i + 1] = Math.max(0, Math.min(255, (px[i + 1] ?? 35) + n));
    px[i + 2] = Math.max(0, Math.min(255, (px[i + 2] ?? 20) + n));
  }
  ctx.putImageData(img, 0, 0);
}

function drawPolaroid(
  ctx: Ctx, theme: DualQuoteTheme, line: DualLine, img: Img | null,
  x: number, y: number, angleDeg: number, pinColor: string,
): void {
  const pw = 360, ph = 400;
  ctx.save();
  ctx.translate(x + pw / 2, y + ph / 2);
  ctx.rotate((angleDeg * Math.PI) / 180);

  // Shadow
  ctx.shadowColor = "rgba(0,0,0,0.45)";
  ctx.shadowBlur = 18;
  ctx.shadowOffsetY = 8;
  ctx.fillStyle = "#F7F4EE";
  ctx.fillRect(-pw / 2, -ph / 2, pw, ph);
  ctx.shadowColor = "transparent";

  // Photo well
  const inset = 18;
  const wellH = 250;
  ctx.fillStyle = "#1A1A1A";
  ctx.fillRect(-pw / 2 + inset, -ph / 2 + inset, pw - inset * 2, wellH);

  // Content inside photo
  const cx = 0;
  const top = -ph / 2 + inset + 24;
  drawCircleAvatar(ctx, img, cx - 110, top + 22, 22);
  ctx.textAlign = "left";
  ctx.fillStyle = "#FFFFFF";
  ctx.font = `700 15px Arial, sans-serif`;
  ctx.fillText(line.displayName || "User", cx - 78, top + 18);
  ctx.fillStyle = "rgba(255,255,255,0.65)";
  ctx.font = `400 11px Arial, sans-serif`;
  ctx.fillText(formatDiscordTime(line.createdAt ?? new Date()), cx - 78, top + 36);

  ctx.fillStyle = "#FFFFFF";
  ctx.font = `400 14px Arial, sans-serif`;
  const lines = wrapLines(ctx, line.text || "…", pw - inset * 2 - 28);
  let ly = top + 70;
  for (const l of lines.slice(0, 5)) {
    ctx.fillText(l, -pw / 2 + inset + 14, ly);
    ly += 20;
  }

  // Caption strip name
  ctx.fillStyle = theme.textColor;
  ctx.font = `600 15px Georgia, serif`;
  ctx.textAlign = "center";
  ctx.fillText(line.displayName || "User", 0, ph / 2 - 48);
  ctx.fillStyle = theme.mutedColor;
  ctx.font = `italic 400 12px Georgia, serif`;
  ctx.fillText(formatDiscordTime(line.createdAt ?? new Date()), 0, ph / 2 - 28);

  // Push pin
  ctx.beginPath();
  ctx.arc(0, -ph / 2 + 8, 12, 0, Math.PI * 2);
  ctx.fillStyle = pinColor;
  ctx.fill();
  ctx.beginPath();
  ctx.arc(0, -ph / 2 + 8, 4, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(255,255,255,0.55)";
  ctx.fill();
  // pin stem shadow
  ctx.strokeStyle = "rgba(0,0,0,0.35)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(0, -ph / 2 + 20);
  ctx.lineTo(3, -ph / 2 + 36);
  ctx.stroke();

  ctx.restore();
}

// ── 4. Sticky Note ────────────────────────────────────────────────────────────
export function paintDuoSticky(
  ctx: Ctx, theme: DualQuoteTheme, a: DualLine, b: DualLine,
  imgA: Img | null, imgB: Img | null,
): void {
  const { width: w, height: h } = theme;
  paintCork(ctx, w, h);
  drawSticky(ctx, theme, a, imgA, 80, 90, -4, "#FFE566");
  drawSticky(ctx, theme, b, imgB, 520, 110, 5, "#FFB3C7");
}

function paintCork(ctx: Ctx, w: number, h: number): void {
  ctx.fillStyle = "#8B6B45";
  ctx.fillRect(0, 0, w, h);
  const rnd = mulberry32(99);
  for (let i = 0; i < 1800; i++) {
    const x = rnd() * w;
    const y = rnd() * h;
    const r = 1 + rnd() * 2.5;
    ctx.fillStyle = `rgba(${90 + rnd() * 60 | 0},${60 + rnd() * 40 | 0},${30 + rnd() * 25 | 0},${0.25 + rnd() * 0.4})`;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawSticky(
  ctx: Ctx, theme: DualQuoteTheme, line: DualLine, img: Img | null,
  x: number, y: number, angleDeg: number, color: string,
): void {
  const s = 360;
  ctx.save();
  ctx.translate(x + s / 2, y + s / 2);
  ctx.rotate((angleDeg * Math.PI) / 180);

  ctx.shadowColor = "rgba(0,0,0,0.35)";
  ctx.shadowBlur = 14;
  ctx.shadowOffsetY = 6;
  ctx.fillStyle = color;
  ctx.fillRect(-s / 2, -s / 2, s, s);
  ctx.shadowColor = "transparent";

  // Curl shade bottom-right
  const shade = ctx.createLinearGradient(s / 2 - 40, s / 2 - 40, s / 2, s / 2);
  shade.addColorStop(0, "rgba(0,0,0,0)");
  shade.addColorStop(1, "rgba(0,0,0,0.12)");
  ctx.fillStyle = shade;
  ctx.fillRect(-s / 2, -s / 2, s, s);

  // Tape
  ctx.save();
  ctx.rotate((-8 * Math.PI) / 180);
  ctx.globalAlpha = 0.55;
  ctx.fillStyle = "rgba(255,255,255,0.7)";
  ctx.fillRect(-50, -s / 2 - 14, 100, 32);
  ctx.restore();

  drawCircleAvatar(ctx, img, -s / 2 + 44, -s / 2 + 50, 20);
  ctx.textAlign = "left";
  ctx.fillStyle = theme.nameColor;
  ctx.font = `700 16px "Comic Sans MS", "Segoe Print", Arial, sans-serif`;
  ctx.fillText(line.displayName || "User", -s / 2 + 76, -s / 2 + 44);
  ctx.fillStyle = theme.mutedColor;
  ctx.font = `400 12px "Comic Sans MS", "Segoe Print", Arial, sans-serif`;
  ctx.fillText(formatDiscordTime(line.createdAt ?? new Date()), -s / 2 + 76, -s / 2 + 64);

  ctx.fillStyle = theme.textColor;
  ctx.font = `400 17px "Comic Sans MS", "Segoe Print", Arial, sans-serif`;
  const lines = wrapLines(ctx, line.text || "…", s - 48);
  let ly = -s / 2 + 110;
  for (const l of lines.slice(0, 6)) {
    ctx.fillText(l, -s / 2 + 24, ly);
    ly += 26;
  }
  ctx.restore();
}

// ── 5. Text Message (iOS) ─────────────────────────────────────────────────────
export function paintDuoImessage(
  ctx: Ctx, theme: DualQuoteTheme, a: DualLine, b: DualLine,
  imgA: Img | null, imgB: Img | null,
): void {
  const { width: w, height: h } = theme;
  // Phone body
  ctx.fillStyle = "#111111";
  ctx.fillRect(0, 0, w, h);
  const mx = 12, my = 12, mw = w - 24, mh = h - 24;
  roundRect(ctx, mx, my, mw, mh, 36);
  ctx.fillStyle = "#FFFFFF";
  ctx.fill();

  // Status bar
  ctx.fillStyle = "#000000";
  ctx.font = `600 14px Arial, sans-serif`;
  ctx.textAlign = "left";
  ctx.fillText(hhmm(a.createdAt ?? new Date()), mx + 28, my + 32);
  // Cellular bars
  for (let i = 0; i < 4; i++) {
    ctx.fillRect(mx + mw - 88 + i * 7, my + 22 - i * 2, 5, 10 + i * 2);
  }
  // Wifi arcs
  ctx.strokeStyle = "#000";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(mx + mw - 52, my + 34, 8, Math.PI * 1.15, Math.PI * 1.85);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(mx + mw - 52, my + 34, 4, Math.PI * 1.15, Math.PI * 1.85);
  ctx.stroke();
  // Battery
  roundRect(ctx, mx + mw - 38, my + 20, 26, 13, 3);
  ctx.strokeStyle = "#000";
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.fillStyle = "#000";
  ctx.fillRect(mx + mw - 36, my + 22, 18, 9);
  ctx.fillRect(mx + mw - 10, my + 24, 3, 5);

  // Nav
  ctx.fillStyle = theme.accentColor ?? "#007AFF";
  ctx.font = `500 22px Arial, sans-serif`;
  ctx.fillText("‹", mx + 22, my + 68);
  ctx.fillStyle = "#000";
  ctx.font = `600 17px Arial, sans-serif`;
  ctx.textAlign = "center";
  ctx.fillText("DN Quotes", mx + mw / 2, my + 66);

  // Thin separator
  ctx.strokeStyle = "rgba(0,0,0,0.08)";
  ctx.beginPath();
  ctx.moveTo(mx + 8, my + 84);
  ctx.lineTo(mx + mw - 8, my + 84);
  ctx.stroke();

  let y = my + 120;
  y = drawIosBubble(ctx, a, imgA, mx + 16, y, mw - 32, true);
  y += 18;
  drawIosBubble(ctx, b, imgB, mx + 16, y, mw - 32, false);

  // Home indicator
  roundRect(ctx, mx + mw / 2 - 50, my + mh - 18, 100, 5, 3);
  ctx.fillStyle = "#000";
  ctx.fill();
}

function drawIosBubble(
  ctx: Ctx, line: DualLine, img: Img | null,
  x: number, y: number, maxW: number, blue: boolean,
): number {
  const avR = 16;
  drawCircleAvatar(ctx, img, x + avR, y + avR + 8, avR);

  ctx.font = `400 15px Arial, sans-serif`;
  const lines = wrapLines(ctx, line.text || "…", maxW - 90);
  const textH = Math.max(1, lines.length) * 20;
  const bw = Math.min(maxW - 56, Math.max(120, ...lines.map(l => ctx.measureText(l).width)) + 28);
  const bh = textH + 24;
  const bx = x + avR * 2 + 10;
  const by = y;

  roundRect(ctx, bx, by, bw, bh, 18);
  ctx.fillStyle = blue ? "#007AFF" : "#E9E9EB";
  ctx.fill();

  ctx.fillStyle = blue ? "#FFFFFF" : "#000000";
  ctx.textAlign = "left";
  let ly = by + 22;
  for (const l of lines.slice(0, 6)) {
    ctx.fillText(l, bx + 14, ly);
    ly += 20;
  }

  ctx.fillStyle = "#8E8E93";
  ctx.font = `400 11px Arial, sans-serif`;
  ctx.fillText(formatDiscordTime(line.createdAt ?? new Date()), bx, by + bh + 16);

  return by + bh + 16;
}

// ── 6. Newspaper ──────────────────────────────────────────────────────────────
export function paintDuoNewspaper(
  ctx: Ctx, theme: DualQuoteTheme, a: DualLine, b: DualLine,
  imgA: Img | null, imgB: Img | null,
): void {
  const { width: w, height: h } = theme;
  ctx.fillStyle = theme.background;
  ctx.fillRect(0, 0, w, h);

  // Paper aging / wrinkles
  const rnd = mulberry32(7);
  const data = ctx.getImageData(0, 0, w, h);
  const px = data.data;
  for (let i = 0; i < px.length; i += 12) {
    const n = ((rnd() * 24) | 0) - 10;
    px[i] = Math.max(0, Math.min(255, (px[i] ?? 230) + n));
    px[i + 1] = Math.max(0, Math.min(255, (px[i + 1] ?? 220) + n - 2));
    px[i + 2] = Math.max(0, Math.min(255, (px[i + 2] ?? 200) + n - 6));
  }
  ctx.putImageData(data, 0, 0);

  // Masthead
  ctx.fillStyle = "#111";
  ctx.font = `900 42px Georgia, "Times New Roman", serif`;
  ctx.textAlign = "center";
  ctx.fillText("THE DISCORD TIMES", w / 2, 64);

  ctx.strokeStyle = "#111";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(40, 82);
  ctx.lineTo(w - 40, 82);
  ctx.stroke();
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(40, 88);
  ctx.lineTo(w - 40, 88);
  ctx.stroke();

  ctx.font = `600 12px Georgia, serif`;
  ctx.textAlign = "left";
  ctx.fillText("COMMUNITY  •  QUOTES  •  GOOD VIBES", 48, 108);
  ctx.textAlign = "right";
  ctx.fillText("VOL. 1", w - 48, 108);

  ctx.beginPath();
  ctx.moveTo(40, 118);
  ctx.lineTo(w - 40, 118);
  ctx.stroke();

  // Columns
  const mid = w / 2;
  ctx.beginPath();
  ctx.moveTo(mid, 130);
  ctx.lineTo(mid, h - 36);
  ctx.stroke();

  paintNewsColumn(ctx, theme, a, imgA, 48, 150, mid - 70);
  paintNewsColumn(ctx, theme, b, imgB, mid + 28, 150, mid - 70);
}

function paintNewsColumn(
  ctx: Ctx, theme: DualQuoteTheme, line: DualLine, img: Img | null,
  x: number, y: number, maxW: number,
): void {
  drawCircleAvatar(ctx, img, x + 22, y + 22, 22);
  ctx.textAlign = "left";
  ctx.fillStyle = "#111";
  ctx.font = `700 16px Georgia, serif`;
  ctx.fillText(line.displayName || "User", x + 56, y + 18);
  ctx.fillStyle = "#555";
  ctx.font = `italic 400 12px Georgia, serif`;
  ctx.fillText(formatDiscordTime(line.createdAt ?? new Date()), x + 56, y + 38);

  ctx.fillStyle = theme.textColor;
  ctx.font = `400 16px Georgia, "Times New Roman", serif`;
  const lines = wrapLines(ctx, line.text || "…", maxW);
  let ly = y + 76;
  for (const l of lines.slice(0, 8)) {
    ctx.fillText(l, x, ly);
    ly += 24;
  }
}

// ── 7. Receipt ────────────────────────────────────────────────────────────────
export function paintDuoReceipt(
  ctx: Ctx, theme: DualQuoteTheme, a: DualLine, b: DualLine,
  imgA: Img | null, imgB: Img | null,
): void {
  const { width: w, height: h } = theme;
  ctx.fillStyle = theme.background;
  ctx.fillRect(0, 0, w, h);

  const rx = 70, rw = w - 140;
  // Jagged top/bottom receipt
  drawReceiptPaper(ctx, rx, 30, rw, h - 60);

  const mono = `"Courier New", Courier, monospace`;
  let y = 70;
  ctx.fillStyle = "#111";
  ctx.textAlign = "center";
  ctx.font = `900 26px ${mono}`;
  ctx.fillText("DN QUOTES", w / 2, y);
  y += 28;
  ctx.font = `400 11px ${mono}`;
  ctx.fillText("SAME CONVERSATION. A DIFFERENT VIBE.", w / 2, y);
  y += 18;
  drawDottedLine(ctx, rx + 24, y, rw - 48);
  y += 28;

  y = paintReceiptEntry(ctx, a, imgA, rx + 28, y, rw - 56, mono);
  y += 18;
  drawDottedLine(ctx, rx + 24, y, rw - 48);
  y += 24;
  y = paintReceiptEntry(ctx, b, imgB, rx + 28, y, rw - 56, mono);
  y += 24;
  drawDottedLine(ctx, rx + 24, y, rw - 48);
  y += 36;

  ctx.textAlign = "center";
  ctx.font = `700 14px ${mono}`;
  ctx.fillStyle = "#111";
  ctx.fillText("THANK YOU FOR CHATTING!", w / 2, y);
  y += 28;
  drawBarcode(ctx, w / 2 - 110, y, 220, 56);
}

function drawReceiptPaper(ctx: Ctx, x: number, y: number, w: number, h: number): void {
  const buildPath = () => {
    ctx.beginPath();
    ctx.moveTo(x, y + 8);
    for (let i = 0; i < 16; i++) {
      const px = x + (w * (i + 1)) / 16;
      ctx.lineTo(px, y + ((i % 2 === 0) ? 0 : 10));
    }
    ctx.lineTo(x + w, y + h - 8);
    for (let i = 0; i < 16; i++) {
      const px = x + w - (w * (i + 1)) / 16;
      ctx.lineTo(px, y + h - ((i % 2 === 0) ? 0 : 10));
    }
    ctx.closePath();
  };

  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,0.35)";
  ctx.shadowBlur = 20;
  buildPath();
  ctx.fillStyle = "#F4F1EA";
  ctx.fill();
  ctx.restore();

  ctx.save();
  buildPath();
  ctx.clip();
  const rnd = mulberry32(3);
  for (let i = 0; i < 200; i++) {
    ctx.fillStyle = `rgba(0,0,0,${0.02 + rnd() * 0.04})`;
    ctx.fillRect(x + rnd() * w, y + rnd() * h, 1 + rnd() * 2, 8 + rnd() * 20);
  }
  ctx.restore();
}

function drawDottedLine(ctx: Ctx, x: number, y: number, w: number): void {
  ctx.strokeStyle = "#333";
  ctx.lineWidth = 1;
  ctx.setLineDash([3, 4]);
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x + w, y);
  ctx.stroke();
  ctx.setLineDash([]);
}

function paintReceiptEntry(
  ctx: Ctx, line: DualLine, img: Img | null,
  x: number, y: number, maxW: number, mono: string,
): number {
  drawCircleAvatar(ctx, img, x + 16, y + 16, 16);
  ctx.textAlign = "left";
  ctx.fillStyle = "#111";
  ctx.font = `700 14px ${mono}`;
  ctx.fillText((line.displayName || "USER").toUpperCase(), x + 42, y + 12);
  ctx.font = `400 11px ${mono}`;
  ctx.fillStyle = "#555";
  ctx.fillText(formatDiscordTime(line.createdAt ?? new Date()), x + 42, y + 30);

  ctx.fillStyle = "#111";
  ctx.font = `400 14px ${mono}`;
  const lines = wrapLines(ctx, line.text || "…", maxW);
  let ly = y + 56;
  for (const l of lines.slice(0, 5)) {
    ctx.fillText(l, x, ly);
    ly += 20;
  }
  return ly;
}

function drawBarcode(ctx: Ctx, x: number, y: number, w: number, h: number): void {
  const rnd = mulberry32(55);
  let cx = x;
  ctx.fillStyle = "#111";
  while (cx < x + w) {
    const bw = 1 + (rnd() * 3 | 0);
    if (rnd() > 0.35) ctx.fillRect(cx, y, bw, h);
    cx += bw + 1;
  }
}

// ── 8. Chat Log ───────────────────────────────────────────────────────────────
export function paintDuoChatlog(
  ctx: Ctx, theme: DualQuoteTheme, a: DualLine, b: DualLine,
  imgA: Img | null, imgB: Img | null,
): void {
  const { width: w, height: h } = theme;
  // Moody backdrop
  const bg = ctx.createLinearGradient(0, 0, w, h);
  bg.addColorStop(0, "#0A1528");
  bg.addColorStop(0.5, "#152038");
  bg.addColorStop(1, "#0C1828");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);

  // Soft landscape blobs
  ctx.fillStyle = "rgba(60,100,160,0.18)";
  ctx.beginPath();
  ctx.ellipse(w * 0.7, h * 0.75, 280, 90, -0.2, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "rgba(100,70,180,0.12)";
  ctx.beginPath();
  ctx.ellipse(w * 0.25, h * 0.8, 220, 70, 0.15, 0, Math.PI * 2);
  ctx.fill();
  // stars
  const rnd = mulberry32(12);
  for (let i = 0; i < 60; i++) {
    ctx.fillStyle = `rgba(255,255,255,${0.2 + rnd() * 0.6})`;
    ctx.fillRect(rnd() * w, rnd() * h * 0.55, 1.5, 1.5);
  }

  const px = 80, py = 70, pw = w - 160, ph = h - 140;
  roundRect(ctx, px, py, pw, ph, 12);
  ctx.fillStyle = "rgba(8,12,20,0.72)";
  ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,0.12)";
  ctx.lineWidth = 1;
  ctx.stroke();

  ctx.font = `700 14px Arial, sans-serif`;
  ctx.textAlign = "left";
  ctx.fillStyle = "#A5B4C8";
  ctx.fillText("# general", px + 20, py + 28);
  ctx.textAlign = "right";
  ctx.fillStyle = "#7DD3FC";
  ctx.fillText("DN SERVER", px + pw - 20, py + 28);

  ctx.strokeStyle = "rgba(255,255,255,0.08)";
  ctx.beginPath();
  ctx.moveTo(px + 16, py + 42);
  ctx.lineTo(px + pw - 16, py + 42);
  ctx.stroke();

  paintLogLine(ctx, a, imgA, px + 24, py + 70, pw - 48, theme.accentColor ?? "#60A5FA");
  paintLogLine(ctx, b, imgB, px + 24, py + 200, pw - 48, theme.nameColor);
}

function paintLogLine(
  ctx: Ctx, line: DualLine, img: Img | null,
  x: number, y: number, maxW: number, nameColor: string,
): void {
  drawCircleAvatar(ctx, img, x + 16, y + 16, 16);
  const ts = hhmm(line.createdAt ?? new Date());
  ctx.textAlign = "left";
  ctx.font = `600 15px Arial, sans-serif`;
  ctx.fillStyle = "#94A3B8";
  ctx.fillText(`[${ts}]`, x + 44, y + 14);
  const tw = ctx.measureText(`[${ts}]`).width;
  ctx.fillStyle = nameColor;
  ctx.fillText(`${line.displayName || "User"}:`, x + 44 + tw + 8, y + 14);

  ctx.fillStyle = "#FFFFFF";
  ctx.font = `400 15px Arial, sans-serif`;
  const lines = wrapLines(ctx, line.text || "…", maxW - 50);
  let ly = y + 42;
  for (const l of lines.slice(0, 3)) {
    ctx.fillText(l, x + 44, ly);
    ly += 22;
  }
}

// ── 9. Comic ──────────────────────────────────────────────────────────────────
export function paintDuoComic(
  ctx: Ctx, theme: DualQuoteTheme, a: DualLine, b: DualLine,
  imgA: Img | null, imgB: Img | null,
): void {
  const { width: w, height: h } = theme;
  const mid = h / 2;

  // Top panel — blue speed lines + halftone
  ctx.fillStyle = "#3BA3FF";
  ctx.fillRect(0, 0, w, mid);
  drawSpeedLines(ctx, 0, 0, w, mid, "rgba(255,255,255,0.25)");
  drawHalftone(ctx, 0, 0, w, mid, "rgba(0,40,100,0.2)", 8);

  // Bottom panel — red burst
  ctx.fillStyle = "#FF2D2D";
  ctx.fillRect(0, mid, w, mid);
  drawBurst(ctx, w * 0.75, mid + mid * 0.55, 220, "rgba(255,200,0,0.35)");
  drawHalftone(ctx, 0, mid, w, mid, "rgba(80,0,0,0.18)", 9);

  // Thick split
  ctx.strokeStyle = "#111";
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.moveTo(0, mid);
  ctx.lineTo(w, mid);
  ctx.stroke();

  // Outer comic border
  ctx.strokeStyle = "#111";
  ctx.lineWidth = 8;
  ctx.strokeRect(4, 4, w - 8, h - 8);

  drawSpeechBubble(ctx, a, imgA, 40, 36, w * 0.62, mid - 70, true);
  drawSpeechBubble(ctx, b, imgB, w * 0.32, mid + 36, w * 0.62, mid - 70, false);
}

function drawSpeedLines(ctx: Ctx, x: number, y: number, w: number, h: number, color: string): void {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 3;
  for (let i = 0; i < 18; i++) {
    const yy = y + 20 + i * (h / 18);
    ctx.beginPath();
    ctx.moveTo(x + 20, yy);
    ctx.lineTo(x + w - 20, yy - 30);
    ctx.stroke();
  }
  ctx.restore();
}

function drawHalftone(
  ctx: Ctx, x: number, y: number, w: number, h: number, color: string, step: number,
): void {
  ctx.fillStyle = color;
  for (let yy = y; yy < y + h; yy += step) {
    for (let xx = x; xx < x + w; xx += step) {
      const r = ((xx + yy) % (step * 2) === 0) ? 1.6 : 1.1;
      ctx.beginPath();
      ctx.arc(xx, yy, r, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

function drawBurst(ctx: Ctx, cx: number, cy: number, r: number, color: string): void {
  ctx.save();
  ctx.fillStyle = color;
  ctx.beginPath();
  const spikes = 16;
  for (let i = 0; i < spikes; i++) {
    const ang = (i / spikes) * Math.PI * 2;
    const rr = i % 2 === 0 ? r : r * 0.55;
    const px = cx + Math.cos(ang) * rr;
    const py = cy + Math.sin(ang) * rr;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function drawSpeechBubble(
  ctx: Ctx, line: DualLine, img: Img | null,
  x: number, y: number, bw: number, bh: number, top: boolean,
): void {
  // Avatar
  const avX = top ? x + bw + 36 : x - 36;
  const avY = y + bh * 0.55;
  ctx.save();
  ctx.lineWidth = 4;
  ctx.strokeStyle = "#111";
  ctx.beginPath();
  ctx.arc(avX, avY, 28, 0, Math.PI * 2);
  ctx.fillStyle = "#FFF";
  ctx.fill();
  ctx.stroke();
  ctx.restore();
  drawCircleAvatar(ctx, img, avX, avY, 24);

  // Bubble
  ctx.save();
  ctx.lineWidth = 4;
  ctx.strokeStyle = "#111";
  ctx.fillStyle = "#FFFFFF";
  roundRect(ctx, x, y, bw, bh, 18);
  ctx.fill();
  ctx.stroke();

  // Tail
  ctx.beginPath();
  if (top) {
    ctx.moveTo(x + bw - 10, y + bh * 0.55);
    ctx.lineTo(avX - 28, avY);
    ctx.lineTo(x + bw - 10, y + bh * 0.7);
  } else {
    ctx.moveTo(x + 10, y + bh * 0.55);
    ctx.lineTo(avX + 28, avY);
    ctx.lineTo(x + 10, y + bh * 0.7);
  }
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.restore();

  ctx.textAlign = "left";
  ctx.fillStyle = "#111";
  ctx.font = `900 15px "Arial Black", Impact, Arial, sans-serif`;
  ctx.fillText((line.displayName || "USER").toUpperCase(), x + 20, y + 32);
  const nw = ctx.measureText((line.displayName || "USER").toUpperCase()).width;
  ctx.fillStyle = "#666";
  ctx.font = `400 12px Arial, sans-serif`;
  ctx.fillText(formatDiscordTime(line.createdAt ?? new Date()), x + 28 + nw, y + 32);

  ctx.fillStyle = "#111";
  ctx.font = `700 18px "Arial Black", Impact, Arial, sans-serif`;
  const lines = wrapLines(ctx, line.text || "…", bw - 40);
  let ly = y + 64;
  for (const l of lines.slice(0, 4)) {
    ctx.fillText(l, x + 20, ly);
    ly += 26;
  }
}

/** Dispatch a vibe layout painter. Returns true if handled. */
export function paintDuoVibeLayout(
  layout: DualQuoteTheme["layout"],
  ctx: Ctx,
  theme: DualQuoteTheme,
  a: DualLine,
  b: DualLine,
  imgA: Img | null,
  imgB: Img | null,
): boolean {
  switch (layout) {
    case "duo-bubble":
      paintDuoBubble(ctx, theme, a, b, imgA, imgB); return true;
    case "duo-terminal":
      paintDuoTerminal(ctx, theme, a, b, imgA, imgB); return true;
    case "duo-polaroid":
      paintDuoPolaroid(ctx, theme, a, b, imgA, imgB); return true;
    case "duo-sticky":
      paintDuoSticky(ctx, theme, a, b, imgA, imgB); return true;
    case "duo-imessage":
      paintDuoImessage(ctx, theme, a, b, imgA, imgB); return true;
    case "duo-newspaper":
      paintDuoNewspaper(ctx, theme, a, b, imgA, imgB); return true;
    case "duo-receipt":
      paintDuoReceipt(ctx, theme, a, b, imgA, imgB); return true;
    case "duo-chatlog":
      paintDuoChatlog(ctx, theme, a, b, imgA, imgB); return true;
    case "duo-comic":
      paintDuoComic(ctx, theme, a, b, imgA, imgB); return true;
    default:
      return false;
  }
}
