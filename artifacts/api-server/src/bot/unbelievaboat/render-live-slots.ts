// Las Vegas–style live slot machine renderer.
// Modes: idle · insert (coins drop into slot) · spin · win · lose
// Reel faces use Twemoji PNGs (canvas emoji glyphs are tofu). Jackpot uses a
// hopper fountain — coins spray UP then fall, never a shatter or a flat row.

import {
  encodeAnimation, clamp01, lerp, easeOutBack, easeInOutCubic, getCanvas,
  hexToRgba, roundRectPath, type Ctx, type CanvasMod,
} from "../animations/engine.js";
import type { AnimationResult } from "../animations/types.js";
import { drawSparks, shakeOffset } from "../animations/particles.js";

const W = 560;
const H = 440;

export const SLOT_POOL_BASE = ["🍒", "🍋", "🔔", "⭐", "💎", "🃏"] as const;

/** `<:name:id>` or `<a:name:id>` — Discord custom emoji markup. */
const CUSTOM_EMOJI_RE = /^<(a)?:([\w~]+):(\d+)>$/;

export function parseDiscordEmoji(symbol: string): {
  animated: boolean;
  name: string;
  id: string;
} | null {
  const m = symbol.trim().match(CUSTOM_EMOJI_RE);
  if (!m) return null;
  return { animated: Boolean(m[1]), name: m[2]!, id: m[3]! };
}

/** Short label for canvas text (never dump raw `<:name:id>`). */
export function symbolDisplayName(symbol: string): string {
  const custom = parseDiscordEmoji(symbol);
  if (custom) return custom.name;
  if (symbol.length <= 4) return symbol;
  return "★";
}

/** Reel pool with server economy symbol as the jackpot face (replaces 7️⃣). */
export function slotPool(economySymbol: string): string[] {
  const sym = economySymbol?.trim() || "💵";
  // Avoid duplicating if the server symbol is already a base face
  if ((SLOT_POOL_BASE as readonly string[]).includes(sym)) return [...SLOT_POOL_BASE];
  return [...SLOT_POOL_BASE, sym];
}

export type SlotsMachineMode = "idle" | "insert" | "spin" | "win" | "lose";

export type SlotsMachineOpts = {
  mode: SlotsMachineMode;
  reels?: string[];
  /** Server economy symbol — jackpot banner + coin faces. */
  symbol: string;
  payoutLabel?: string;
  tier?: "jackpot" | "line" | "pair" | "lose";
  /** How many coins being inserted (insert mode). */
  insertCount?: number;
  /** Credits currently on the machine (shown on LED). */
  credits?: number;
  /** Coin denomination label. */
  coinValueLabel?: string;
  /** Active bet multiplier (1–5). */
  betMult?: number;
};

type Img = { width: number; height: number };

const SYMBOL_IMG_CACHE = new Map<string, Img | null>();

/** Convert unicode emoji to Twemoji hex filename (drops VS16). */
function emojiToCode(emoji: string): string {
  const known: Record<string, string> = {
    "🍒": "1f352",
    "🍋": "1f34b",
    "🔔": "1f514",
    "⭐": "2b50",
    "💎": "1f48e",
    "🃏": "1f0cf",
    "7️⃣": "37-20e3",
    "💵": "1f4b5",
    "💰": "1f4b0",
    "🪙": "1fa99",
  };
  if (known[emoji]) return known[emoji]!;
  const cps: number[] = [];
  for (const ch of emoji) {
    const cp = ch.codePointAt(0);
    if (cp == null || cp === 0xfe0f) continue;
    cps.push(cp);
  }
  return cps.map((c) => c.toString(16)).join("-");
}

/**
 * Load a reel/face image: Discord custom emoji from CDN, otherwise Twemoji.
 * Custom: `<:bob:123>` → `cdn.discordapp.com/emojis/123.png`
 */
async function loadSymbolImage(mod: CanvasMod, symbol: string): Promise<Img | null> {
  const key = symbol.trim();
  if (!key) return null;
  if (SYMBOL_IMG_CACHE.has(key)) return SYMBOL_IMG_CACHE.get(key) ?? null;

  const custom = parseDiscordEmoji(key);
  try {
    let url: string;
    if (custom) {
      // PNG works for animated emojis as a static frame (canvas-friendly)
      url = `https://cdn.discordapp.com/emojis/${custom.id}.png?size=128&quality=lossless`;
    } else {
      const code = emojiToCode(key);
      if (!code) {
        SYMBOL_IMG_CACHE.set(key, null);
        return null;
      }
      url = `https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/72x72/${code}.png`;
    }
    const res = await fetch(url, { signal: AbortSignal.timeout(6_000) });
    if (!res.ok) {
      SYMBOL_IMG_CACHE.set(key, null);
      return null;
    }
    const img = await mod.loadImage(Buffer.from(await res.arrayBuffer()));
    SYMBOL_IMG_CACHE.set(key, img);
    return img;
  } catch {
    SYMBOL_IMG_CACHE.set(key, null);
    return null;
  }
}

async function preloadSymbols(mod: CanvasMod, symbols: string[]): Promise<Map<string, Img | null>> {
  const map = new Map<string, Img | null>();
  await Promise.all(symbols.map(async (s) => {
    map.set(s, await loadSymbolImage(mod, s));
  }));
  return map;
}

function drawSymbolImg(
  ctx: Ctx,
  imgMap: Map<string, Img | null>,
  face: string,
  x: number, y: number, size: number,
) {
  const img = imgMap.get(face) ?? imgMap.get(face.trim());
  if (img) {
    ctx.drawImage(img as never, x - size / 2, y - size / 2, size, size);
    return;
  }
  // Painted fallbacks so tofu / raw <:name:id> never shows on the reels
  ctx.save();
  ctx.translate(x, y);
  if (face === "🍒" || face.includes("cherry")) {
    ctx.fillStyle = "#dc2626";
    ctx.beginPath(); ctx.arc(-6, 4, 10, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(8, 2, 9, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = "#16a34a"; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(-6, -6); ctx.quadraticCurveTo(0, -18, 8, -8); ctx.stroke();
  } else if (face === "🍋") {
    ctx.fillStyle = "#facc15";
    ctx.beginPath(); ctx.ellipse(0, 0, 16, 11, 0.3, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#a3e635";
    ctx.fillRect(-2, -14, 4, 6);
  } else if (face === "🔔") {
    ctx.fillStyle = "#fbbf24";
    ctx.beginPath(); ctx.moveTo(-12, 8); ctx.quadraticCurveTo(-12, -14, 0, -16);
    ctx.quadraticCurveTo(12, -14, 12, 8); ctx.closePath(); ctx.fill();
    ctx.fillStyle = "#f59e0b";
    ctx.fillRect(-14, 8, 28, 5);
    ctx.beginPath(); ctx.arc(0, 16, 4, 0, Math.PI * 2); ctx.fill();
  } else if (face === "⭐") {
    ctx.fillStyle = "#fde047";
    ctx.beginPath();
    for (let i = 0; i < 5; i++) {
      const a = -Math.PI / 2 + i * (Math.PI * 2) / 5;
      const a2 = a + Math.PI / 5;
      ctx.lineTo(Math.cos(a) * 16, Math.sin(a) * 16);
      ctx.lineTo(Math.cos(a2) * 7, Math.sin(a2) * 7);
    }
    ctx.closePath(); ctx.fill();
  } else if (face === "💎") {
    ctx.fillStyle = "#67e8f9";
    ctx.beginPath();
    ctx.moveTo(0, -16); ctx.lineTo(14, -4); ctx.lineTo(8, 16);
    ctx.lineTo(-8, 16); ctx.lineTo(-14, -4); ctx.closePath(); ctx.fill();
    ctx.fillStyle = "#a5f3fc";
    ctx.beginPath(); ctx.moveTo(0, -16); ctx.lineTo(6, -4); ctx.lineTo(-6, -4); ctx.closePath(); ctx.fill();
  } else if (face === "🃏") {
    ctx.fillStyle = "#1e293b";
    roundRectPath(ctx, -14, -18, 28, 36, 4); ctx.fill();
    ctx.fillStyle = "#f8fafc";
    ctx.font = "bold 18px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("J", 0, 0);
  } else {
    // Economy symbol fallback — gold chip with short name (never raw <:id:>)
    const label = symbolDisplayName(face);
    ctx.fillStyle = "#f5c84c";
    ctx.beginPath(); ctx.arc(0, 0, Math.max(14, size * 0.38), 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = "#a16207";
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = "#7c4a12";
    const fontSize = label.length > 4
      ? Math.max(8, Math.floor(size * 0.22))
      : Math.max(10, Math.floor(size * 0.36));
    ctx.font = `bold ${fontSize}px sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(label.slice(0, 8), 0, 1);
  }
  ctx.restore();
}

function machineChrome(
  ctx: Ctx,
  t: number,
  leverDown: number,
  economySymbol = "💵",
  imgMap?: Map<string, Img | null>,
) {
  const bg = ctx.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, "#120818");
  bg.addColorStop(1, "#06040a");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  const bx = 70, by = 20, bw = 360, bh = 380;
  roundRectPath(ctx, bx, by, bw, bh, 28);
  const bronze = ctx.createLinearGradient(bx, by, bx + bw, by + bh);
  bronze.addColorStop(0, "#d4b07a");
  bronze.addColorStop(0.4, "#8b5e34");
  bronze.addColorStop(0.75, "#c9a06a");
  bronze.addColorStop(1, "#5c3a1e");
  ctx.fillStyle = bronze;
  ctx.fill();

  roundRectPath(ctx, bx + 14, by + 14, bw - 28, bh - 28, 20);
  ctx.fillStyle = "#140810";
  ctx.fill();

  // Marquee — "Vegas · [economy symbol image]"
  roundRectPath(ctx, bx + 28, by + 22, bw - 56, 50, 10);
  ctx.fillStyle = "#1a0a22";
  ctx.fill();
  const pulse = 0.55 + Math.sin(t * Math.PI * 3) * 0.2;
  ctx.fillStyle = hexToRgba(0xff2244, pulse);
  ctx.font = "italic bold 22px Georgia, serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const mx = bx + bw / 2;
  const my = by + 47;
  if (imgMap) {
    ctx.fillText("Vegas", mx - 28, my);
    drawSymbolImg(ctx, imgMap, economySymbol, mx + 42, my, 28);
  } else {
    ctx.fillText(`Vegas · ${symbolDisplayName(economySymbol)}`, mx, my);
  }

  // Coin slot (left of body)
  const slotX = bx - 22;
  const slotY = by + 160;
  ctx.fillStyle = "#2a1a10";
  roundRectPath(ctx, slotX, slotY, 18, 48, 4);
  ctx.fill();
  ctx.fillStyle = "#0a0a0c";
  ctx.fillRect(slotX + 5, slotY + 8, 8, 32);
  ctx.fillStyle = "#fbbf24";
  ctx.font = "9px sans-serif";
  ctx.textAlign = "center";
  ctx.fillText("COIN", slotX + 9, slotY + 62);

  // Lever
  const lx = bx + bw + 18;
  const ly = by + 120;
  ctx.save();
  ctx.translate(lx + 10, ly);
  ctx.rotate(lerp(-0.12, 0.9, leverDown));
  ctx.strokeStyle = "#c0c0c8";
  ctx.lineWidth = 10;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(0, -88);
  ctx.stroke();
  ctx.fillStyle = "#e11d2e";
  ctx.beginPath();
  ctx.arc(0, -98, 15, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  ctx.fillStyle = "#6b4226";
  ctx.beginPath();
  ctx.arc(lx + 10, ly, 16, 0, Math.PI * 2);
  ctx.fill();

  // Hopper tray under reels (where coins erupt from)
  const hopperY = by + 250;
  roundRectPath(ctx, bx + 70, hopperY, bw - 140, 22, 6);
  ctx.fillStyle = "#1a1008";
  ctx.fill();
  ctx.fillStyle = "#3a2818";
  ctx.fillRect(bx + 90, hopperY + 4, bw - 180, 8);

  return { bx, by, bw, bh, slotX, slotY, hopperY };
}

function drawLed(
  ctx: Ctx, x: number, y: number, w: number, h: number,
  label: string, value: string,
) {
  roundRectPath(ctx, x, y, w, h, 6);
  ctx.fillStyle = "#061018";
  ctx.fill();
  ctx.strokeStyle = "#1e3a4a";
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.fillStyle = "#4a7080";
  ctx.font = "10px monospace";
  ctx.textAlign = "left";
  ctx.fillText(label, x + 6, y + 12);
  ctx.fillStyle = "#4ade80";
  ctx.font = "bold 14px monospace";
  ctx.textAlign = "right";
  ctx.fillText(value, x + w - 6, y + h - 8);
}

function drawReelWindow(
  ctx: Ctx,
  imgMap: Map<string, Img | null>,
  x: number, y: number, w: number, h: number,
  face: string,
  scrollSyms: string[],
  scrollT: number,
  spinning: boolean,
  glow: boolean,
) {
  roundRectPath(ctx, x, y, w, h, 8);
  ctx.fillStyle = "#f8f8fa";
  ctx.fill();
  if (glow) {
    ctx.strokeStyle = "#fbbf24";
    ctx.lineWidth = 4;
    ctx.stroke();
  } else {
    ctx.strokeStyle = "#222";
    ctx.lineWidth = 3;
    ctx.stroke();
  }

  ctx.save();
  ctx.beginPath();
  roundRectPath(ctx, x + 2, y + 2, w - 4, h - 4, 6);
  ctx.clip();

  const iconSize = Math.floor(w * 0.62);

  if (spinning) {
    const cell = h / 3;
    const offset = (scrollT % 1) * cell;
    for (let k = -1; k < 4; k++) {
      const sym = scrollSyms[(Math.floor(scrollT) + k + 80) % scrollSyms.length]!;
      drawSymbolImg(ctx, imgMap, sym, x + w / 2, y + h / 2 + k * cell - offset, iconSize * 0.85);
    }
    ctx.fillStyle = "rgba(255,255,255,0.12)";
    ctx.fillRect(x, y, w, h);
  } else {
    ctx.globalAlpha = 0.35;
    drawSymbolImg(ctx, imgMap, scrollSyms[0]!, x + w / 2, y + h * 0.16, iconSize * 0.45);
    drawSymbolImg(ctx, imgMap, scrollSyms[2]!, x + w / 2, y + h * 0.84, iconSize * 0.45);
    ctx.globalAlpha = 1;
    drawSymbolImg(ctx, imgMap, face, x + w / 2, y + h / 2, iconSize);
  }
  ctx.restore();
}

/** Single coin disc — draws economy symbol image when available. */
function drawCoin(
  ctx: Ctx,
  x: number, y: number, r: number,
  symbol: string,
  squash = 1,
  imgMap?: Map<string, Img | null>,
) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(Math.max(0.35, squash), 1);
  const g = ctx.createRadialGradient(-r * 0.3, -r * 0.3, 1, 0, 0, r);
  g.addColorStop(0, "#ffe9a0");
  g.addColorStop(0.55, "#f5c84c");
  g.addColorStop(1, "#c9922a");
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = "#a16207";
  ctx.lineWidth = 1.5;
  ctx.stroke();
  const img = imgMap?.get(symbol) ?? imgMap?.get(symbol.trim());
  if (img && r >= 6) {
    const s = r * 1.15;
    ctx.drawImage(img as never, -s / 2, -s / 2, s, s);
  } else {
    ctx.fillStyle = "#fff6c8";
    ctx.font = `bold ${Math.max(8, Math.floor(r * 0.85))}px sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(symbolDisplayName(symbol).slice(0, 2), 0, 1);
  }
  ctx.restore();
}

/** Coins dropping into the side coin slot — one after another. */
function drawInsertCoins(
  ctx: Ctx,
  slotX: number, slotY: number,
  count: number, t: number, symbol: string,
  imgMap?: Map<string, Img | null>,
) {
  const n = Math.max(1, Math.min(5, count));
  for (let i = 0; i < n; i++) {
    const start = i / (n + 0.5);
    const local = clamp01((t - start) / 0.35);
    if (local <= 0) continue;
    const x = lerp(slotX - 40, slotX + 9, easeInOutCubic(local));
    const y = lerp(slotY - 80, slotY + 24, easeOutBack(Math.min(1, local * 1.1)));
    const squash = local < 0.85 ? 0.7 + Math.sin(local * Math.PI * 6) * 0.25 : 0.2;
    const alpha = local > 0.9 ? 1 - (local - 0.9) / 0.1 : 1;
    ctx.globalAlpha = alpha;
    drawCoin(ctx, x, y, 11, symbol, squash, imgMap);
    ctx.globalAlpha = 1;
  }
}

/**
 * Vegas hopper payout: coins pour DOWN from the tray mouth into a catch
 * basin and bounce/pile — not a shatter crack and not a flat flying row.
 */
function drawHopperCascade(
  ctx: Ctx, t: number, symbol: string, intensity: number, hopperY: number,
  imgMap?: Map<string, Img | null>,
) {
  const count = Math.floor(22 + intensity * 30);
  const mouthL = W / 2 - 90;
  const mouthR = W / 2 + 50;
  const mouthY = hopperY + 4;
  const trayY = H - 28;
  const g = 680;

  for (let i = 0; i < count; i++) {
    const seed = Math.sin((i + 1) * 12.9898) * 43758.5453;
    const u = seed - Math.floor(seed);
    const seed2 = Math.sin((i + 1) * 78.233) * 43758.5453;
    const v = seed2 - Math.floor(seed2);
    const seed3 = Math.sin((i + 1) * 39.417) * 43758.5453;
    const w = seed3 - Math.floor(seed3);

    const local = clamp01((t - u * 0.55) / 0.7);
    if (local <= 0) continue;

    const ox = lerp(mouthL, mouthR, w);
    const drift = (u - 0.5) * 90;
    const x = ox + drift * local + Math.sin(local * Math.PI * 2 + i) * 6;
    const fall = 40 * local + 0.5 * g * local * local;
    let y = mouthY + fall;
    let squash = 0.85 + Math.sin(local * Math.PI * 3) * 0.15;
    if (y > trayY) {
      const over = y - trayY;
      const bounce = Math.abs(Math.sin(over * 0.08 + v * 4)) * Math.max(0, 18 - over * 0.15);
      y = trayY - bounce;
      squash = 0.45 + bounce / 30;
    }
    const r = 7 + v * 5;
    const alpha =
      local < 0.06 ? local / 0.06
        : local > 0.88 ? Math.max(0, (1 - local) / 0.12)
          : 1;
    if (alpha <= 0) continue;
    ctx.globalAlpha = alpha;
    drawCoin(ctx, x, y, r, symbol, squash, imgMap);
    ctx.globalAlpha = 1;
  }
}

function consoleLeds(
  ctx: Ctx, bx: number, by: number, bw: number, bh: number,
  credits: number, betMult: number, coinLabel: string,
) {
  const cy = by + bh - 70;
  roundRectPath(ctx, bx + 22, cy, bw - 44, 42, 8);
  ctx.fillStyle = "#2a1810";
  ctx.fill();
  drawLed(ctx, bx + 30, cy + 6, 100, 30, "CREDITS", String(credits));
  drawLed(ctx, bx + 140, cy + 6, 90, 30, "BET", `${betMult}×`);
  // Never append raw <:name:id> into the LED — denomination only
  drawLed(ctx, bx + 240, cy + 6, 120, 30, "COIN", coinLabel || "—");
}

/** Draw three reel faces as images in a row (never raw <:name:id> text). */
function drawFaceRow(
  ctx: Ctx,
  imgMap: Map<string, Img | null>,
  faces: string[],
  cx: number, y: number, size: number,
) {
  const gap = size + 10;
  const start = cx - ((faces.length - 1) * gap) / 2;
  faces.forEach((f, i) => drawSymbolImg(ctx, imgMap, f, start + i * gap, y, size));
}

export async function renderLiveSlotsMachine(opts: SlotsMachineOpts): Promise<AnimationResult | null> {
  const faces = opts.reels ?? ["🍒", "🍋", "🔔"];
  const mode = opts.mode;
  const symbol = opts.symbol || "💵";
  const pool = slotPool(symbol);
  const credits = opts.credits ?? 0;
  const betMult = opts.betMult ?? 1;
  const coinLabel = opts.coinValueLabel ?? "";
  const insertCount = opts.insertCount ?? 1;
  // One GIF: normal-speed spin → land → long hold so you can read the line.
  const spinShowsResult = mode === "spin" && !!opts.tier;

  const mod = await getCanvas();
  if (!mod) return null;

  const needSyms = [...new Set([...pool, ...faces, symbol, "💵"])];
  const imgMap = await preloadSymbols(mod, needSyms);

  const durationMs =
    mode === "insert" ? 2400
      : mode === "idle" ? 1400
        // ~9s with result: reels lock early, rest of GIF holds what you hit
        : mode === "spin" ? (spinShowsResult ? 9200 : 5200)
          : mode === "win" ? 4000
            : 1800;
  const maxFrames =
    mode === "spin" ? (spinShowsResult ? 56 : 36)
      : mode === "win" ? 28
        : mode === "insert" ? 20
          : 10;

  const neighbors = faces.map((f) => {
    const idx = pool.indexOf(f);
    if (idx < 0) {
      return [pool[0]!, f, pool[1]!] as string[];
    }
    return [
      pool[(idx - 1 + pool.length) % pool.length]!,
      f,
      pool[(idx + 1) % pool.length]!,
    ] as string[];
  });

  return encodeAnimation({
    width: W, height: H, durationMs, speed: "normal", maxFrames, quality: 14, renderScale: 0.82,
    render: async ({ ctx, t }) => {
      const leverDown =
        mode === "spin" ? clamp01(t / 0.1)
          : mode === "idle" || mode === "insert" ? 0.04 + Math.sin(t * Math.PI * 2) * 0.02
            : 0.85;

      const shake =
        mode === "spin" && t > 0.06 && t < 0.42
          ? shakeOffset(`sp-${Math.floor(t * 30)}`, 1.6 * (1 - t))
          : { dx: 0, dy: 0 };

      ctx.save();
      ctx.translate(shake.dx, shake.dy);
      const { bx, by, bw, bh, slotX, slotY, hopperY } = machineChrome(ctx, t, leverDown, symbol, imgMap);

      const reelY = by + 90;
      const reelH = 148;
      const reelW = 90;
      const gap = 10;
      const total = 3 * reelW + 2 * gap;
      const startX = bx + (bw - total) / 2;
      // Regular spin speed — lock by ~halfway so the rest holds the landed line.
      const stopAt = spinShowsResult ? [0.22, 0.32, 0.42] : [0.4, 0.58, 0.76];
      const lastStop = stopAt[2] ?? 0.42;
      const landed = mode === "spin" ? t >= lastStop : mode === "win" || mode === "lose";
      const winGlow =
        (mode === "win" || (spinShowsResult && opts.tier !== "lose" && landed))
        && t > lastStop + 0.04;

      for (let i = 0; i < 3; i++) {
        const spinning = mode === "spin" && t < (stopAt[i] ?? 0.8);
        drawReelWindow(
          ctx,
          imgMap,
          startX + i * (reelW + gap),
          reelY,
          reelW,
          reelH,
          faces[i]!,
          neighbors[i] ?? [pool[0]!, faces[i]!, pool[1]!],
          t * 26 + i * 4,
          spinning,
          winGlow,
        );
      }

      ctx.strokeStyle = "rgba(255, 68, 102, 0.55)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(startX - 4, reelY + reelH / 2);
      ctx.lineTo(startX + total + 4, reelY + reelH / 2);
      ctx.stroke();

      consoleLeds(ctx, bx, by, bw, bh, credits, betMult, coinLabel);

      // Footer plate — draw symbol image, never raw <:name:id>
      roundRectPath(ctx, bx + 40, by + bh - 24, bw - 80, 18, 5);
      ctx.fillStyle = "#1a0820";
      ctx.fill();
      ctx.fillStyle = "#ff5577";
      ctx.font = "italic bold 11px Georgia, serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      const footY = by + bh - 12;
      ctx.fillText("LIVE ·", bx + bw / 2 - 70, footY);
      drawSymbolImg(ctx, imgMap, symbol, bx + bw / 2 - 28, footY, 14);
      ctx.fillStyle = "#ff5577";
      ctx.fillText("JACKPOT · INSERT", bx + bw / 2 + 55, footY);

      if (mode === "insert") {
        drawInsertCoins(ctx, slotX, slotY, insertCount, t, symbol, imgMap);
        ctx.fillStyle = "#fde68a";
        ctx.font = "bold 15px sans-serif";
        ctx.textAlign = "center";
        ctx.fillText(`Inserting ${insertCount} coin${insertCount === 1 ? "" : "s"}…`, W / 2 + 30, H - 14);
      }

      if (mode === "idle") {
        ctx.fillStyle = hexToRgba(0xffe4a0, 0.65 + Math.sin(t * Math.PI * 4) * 0.25);
        ctx.font = "bold 14px sans-serif";
        ctx.textAlign = "center";
        ctx.fillText(credits > 0 ? "Ready — hit SPIN" : "Insert coins to play", W / 2 + 30, H - 14);
      }

      if (mode === "spin" && t < lastStop) {
        ctx.fillStyle = "#94a3b8";
        ctx.font = "13px sans-serif";
        ctx.textAlign = "center";
        ctx.fillText("spinning…", W / 2 + 30, H - 14);
      } else if (mode === "spin" && landed && t < lastStop + 0.1) {
        drawFaceRow(ctx, imgMap, faces, W / 2 + 20, H - 16, 18);
      }

      ctx.restore();

      const resultStart = spinShowsResult ? lastStop + 0.06 : 0.82;
      const showWin =
        mode === "win"
        || (spinShowsResult && opts.tier && opts.tier !== "lose" && t > resultStart);
      const showLose =
        mode === "lose"
        || (spinShowsResult && opts.tier === "lose" && t > resultStart);

      if (showWin) {
        const localT = mode === "win" ? t : clamp01((t - resultStart) / Math.max(0.01, 1 - resultStart));
        const intensity = opts.tier === "jackpot" ? 1 : opts.tier === "line" ? 0.65 : 0.4;
        drawHopperCascade(ctx, localT, symbol, intensity, hopperY, imgMap);
        if (localT > 0.08) {
          const glow = ctx.createRadialGradient(W / 2 - 20, hopperY + 20, 4, W / 2 - 20, hopperY + 20, 120);
          glow.addColorStop(0, hexToRgba(0xffd54a, 0.35 * (1 - localT * 0.3)));
          glow.addColorStop(1, "rgba(0,0,0,0)");
          ctx.fillStyle = glow;
          ctx.fillRect(0, hopperY - 40, W, H - hopperY + 40);
        }
        if (opts.tier === "jackpot" && localT > 0.15) {
          drawSparks(ctx, W / 2 - 20, hopperY + 8, {
            count: 6, color: 0xffd54a, seed: `jp-${Math.floor(localT * 5)}`, maxLen: 22,
          });
        }
        const fade = easeOutBack(clamp01((localT - 0.05) / 0.2));
        ctx.globalAlpha = Math.min(1, fade);
        roundRectPath(ctx, W / 2 - 150, 10, 260, 34, 10);
        ctx.fillStyle = "rgba(20, 8, 28, 0.88)";
        ctx.fill();
        ctx.strokeStyle = opts.tier === "jackpot" ? "#ffd54a" : "#4ade80";
        ctx.lineWidth = 2;
        ctx.stroke();
        // Banner: ★ JACKPOT [emoji] ★ — image, not raw token
        ctx.fillStyle = opts.tier === "jackpot" ? "#ffd54a" : "#4ade80";
        ctx.font = "bold 18px sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        if (opts.tier === "jackpot") {
          ctx.fillText("★ JACKPOT", W / 2 - 50, 27);
          drawSymbolImg(ctx, imgMap, symbol, W / 2 + 30, 27, 22);
          ctx.fillStyle = "#ffd54a";
          ctx.fillText("★", W / 2 + 55, 27);
        } else {
          ctx.fillText(opts.tier === "pair" ? "PAIR PAY" : "LINE WIN", W / 2 - 20, 27);
        }
        if (opts.payoutLabel) {
          // Strip raw custom-emoji tokens from payout label for canvas
          const cleanPay = opts.payoutLabel.replace(/<a?:[\w~]+:\d+>/g, symbolDisplayName(symbol));
          ctx.fillStyle = "#fff6c8";
          ctx.font = "bold 16px sans-serif";
          ctx.fillText(cleanPay, W / 2 - 20, H - 16);
        }
        drawFaceRow(ctx, imgMap, faces, W / 2 - 20, H - 38, 20);
        ctx.globalAlpha = 1;
      }

      if (showLose) {
        drawFaceRow(ctx, imgMap, faces, W / 2 + 20, H - 34, 18);
        ctx.fillStyle = "rgba(148,163,184,0.9)";
        ctx.font = "bold 13px sans-serif";
        ctx.textAlign = "center";
        ctx.fillText("No line — insert more or spin again", W / 2 + 20, H - 14);
      }
    },
  });
}

export function scoreSlotsReels(
  reels: string[],
  economySymbol?: string,
): {
  mult: number;
  tier: "jackpot" | "line" | "pair" | "lose";
} {
  const [a, b, c] = reels;
  if (a && a === b && b === c) {
    // Three economy symbols = top jackpot (replaces classic 777)
    if (economySymbol && a === economySymbol) return { mult: 50, tier: "jackpot" };
    if (a === "💎") return { mult: 25, tier: "jackpot" };
    if (a === "⭐") return { mult: 12, tier: "line" };
    if (a === "🔔") return { mult: 8, tier: "line" };
    return { mult: 5, tier: "line" };
  }
  if ((a && a === b) || (b && b === c) || (a && a === c)) {
    return { mult: 2, tier: "pair" };
  }
  return { mult: 0, tier: "lose" };
}

/** Weighted reel roll — economy symbol is the rare jackpot face. */
export function rollSlotsReels(economySymbol?: string): string[] {
  const jackpot = economySymbol || "💵";
  const weightPick = () => {
    const roll = Math.random();
    if (roll < 0.05) return jackpot;
    if (roll < 0.12) return "💎";
    if (roll < 0.24) return "⭐";
    if (roll < 0.38) return "🔔";
    if (roll < 0.52) return "🃏";
    if (roll < 0.72) return "🍋";
    return "🍒";
  };
  return [weightPick(), weightPick(), weightPick()];
}
