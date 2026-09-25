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

export const SLOT_POOL = ["🍒", "🍋", "🔔", "⭐", "💎", "🃏", "7️⃣"] as const;

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

const TWEMOJI_CACHE = new Map<string, Img | null>();

/** Convert emoji to Twemoji hex filename (drops VS16). */
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

async function loadTwemoji(mod: CanvasMod, emoji: string): Promise<Img | null> {
  const code = emojiToCode(emoji);
  if (!code) return null;
  if (TWEMOJI_CACHE.has(code)) return TWEMOJI_CACHE.get(code) ?? null;
  try {
    const url = `https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/72x72/${code}.png`;
    const res = await fetch(url, { signal: AbortSignal.timeout(5_000) });
    if (!res.ok) {
      TWEMOJI_CACHE.set(code, null);
      return null;
    }
    const img = await mod.loadImage(Buffer.from(await res.arrayBuffer()));
    TWEMOJI_CACHE.set(code, img);
    return img;
  } catch {
    TWEMOJI_CACHE.set(code, null);
    return null;
  }
}

async function preloadSymbols(mod: CanvasMod, symbols: string[]): Promise<Map<string, Img | null>> {
  const map = new Map<string, Img | null>();
  await Promise.all(symbols.map(async (s) => {
    map.set(s, await loadTwemoji(mod, s));
  }));
  return map;
}

function drawSymbolImg(
  ctx: Ctx,
  imgMap: Map<string, Img | null>,
  face: string,
  x: number, y: number, size: number,
) {
  const img = imgMap.get(face);
  if (img) {
    ctx.drawImage(img as never, x - size / 2, y - size / 2, size, size);
    return;
  }
  // Painted fallbacks so tofu never shows on the reels
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
  } else if (face === "7️⃣") {
    ctx.fillStyle = "#111";
    ctx.font = "bold 36px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("7", 0, 2);
  } else if (face === "🃏") {
    ctx.fillStyle = "#1e293b";
    roundRectPath(ctx, -14, -18, 28, 36, 4); ctx.fill();
    ctx.fillStyle = "#f8fafc";
    ctx.font = "bold 18px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("J", 0, 0);
  } else {
    ctx.fillStyle = "#111";
    ctx.font = `bold ${Math.floor(size * 0.55)}px sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(face.length <= 3 ? face : "★", 0, 1);
  }
  ctx.restore();
}

function machineChrome(ctx: Ctx, t: number, leverDown: number) {
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

  // Marquee
  roundRectPath(ctx, bx + 28, by + 22, bw - 56, 50, 10);
  ctx.fillStyle = "#1a0a22";
  ctx.fill();
  const pulse = 0.55 + Math.sin(t * Math.PI * 3) * 0.2;
  ctx.fillStyle = hexToRgba(0xff2244, pulse);
  ctx.font = "italic bold 26px Georgia, serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("Vegas Slots", bx + bw / 2, by + 47);

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

/** Single coin disc with economy symbol (or $). */
function drawCoin(ctx: Ctx, x: number, y: number, r: number, symbol: string, squash = 1) {
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
  ctx.fillStyle = "#7c4a12";
  ctx.beginPath(); ctx.arc(0, 0, r * 0.58, 0, Math.PI * 2); ctx.stroke();
  ctx.fillStyle = "#fff6c8";
  ctx.font = `bold ${Math.max(8, Math.floor(r * 0.85))}px sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const face = symbol.length <= 2 ? symbol : "$";
  ctx.fillText(face, 0, 1);
  ctx.restore();
}

/** Coins dropping into the side coin slot — one after another. */
function drawInsertCoins(
  ctx: Ctx,
  slotX: number, slotY: number,
  count: number, t: number, symbol: string,
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
    drawCoin(ctx, x, y, 11, symbol, squash);
    ctx.globalAlpha = 1;
  }
}

/**
 * Vegas hopper payout: coins pour DOWN from the tray mouth into a catch
 * basin and bounce/pile — not a shatter crack and not a flat flying row.
 */
function drawHopperCascade(ctx: Ctx, t: number, symbol: string, intensity: number, hopperY: number) {
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

    // Staggered pour — continuous stream from the mouth
    const local = clamp01((t - u * 0.55) / 0.7);
    if (local <= 0) continue;

    const ox = lerp(mouthL, mouthR, w);
    // Slight outward drift + gravity drop into the tray
    const drift = (u - 0.5) * 90;
    const x = ox + drift * local + Math.sin(local * Math.PI * 2 + i) * 6;
    const fall = 40 * local + 0.5 * g * local * local;
    let y = mouthY + fall;
    // Bounce once when hitting the tray floor
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
    drawCoin(ctx, x, y, r, symbol, squash);
    ctx.globalAlpha = 1;
  }
}

function consoleLeds(
  ctx: Ctx, bx: number, by: number, bw: number, bh: number,
  credits: number, betMult: number, coinLabel: string, symbol: string,
) {
  const cy = by + bh - 70;
  roundRectPath(ctx, bx + 22, cy, bw - 44, 42, 8);
  ctx.fillStyle = "#2a1810";
  ctx.fill();
  drawLed(ctx, bx + 30, cy + 6, 100, 30, "CREDITS", String(credits));
  drawLed(ctx, bx + 140, cy + 6, 90, 30, "BET", `${betMult}×`);
  drawLed(ctx, bx + 240, cy + 6, 120, 30, "COIN", `${coinLabel}${symbol.length <= 2 ? symbol : ""}`);
}

export async function renderLiveSlotsMachine(opts: SlotsMachineOpts): Promise<AnimationResult | null> {
  const faces = opts.reels ?? ["🍒", "🍋", "🔔"];
  const pool = [...SLOT_POOL];
  const mode = opts.mode;
  const symbol = opts.symbol || "💵";
  const credits = opts.credits ?? 0;
  const betMult = opts.betMult ?? 1;
  const coinLabel = opts.coinValueLabel ?? "";
  const insertCount = opts.insertCount ?? 1;

  const mod = await getCanvas();
  if (!mod) return null;

  const needSyms = [...new Set([...pool, ...faces, symbol, "💵"])];
  const imgMap = await preloadSymbols(mod, needSyms);

  const durationMs =
    mode === "insert" ? 2200
      : mode === "idle" ? 2000
        : mode === "spin" ? 4600
          : mode === "win" ? 3800
            : 2000;
  const maxFrames =
    mode === "spin" ? 40
      : mode === "win" ? 34
        : mode === "insert" ? 22
          : 16;

  const neighbors = faces.map((f) => {
    const idx = pool.indexOf(f as typeof pool[number]);
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
        mode === "spin" ? clamp01(t / 0.16)
          : mode === "idle" || mode === "insert" ? 0.04 + Math.sin(t * Math.PI * 2) * 0.02
            : 0.85;

      const shake =
        mode === "spin" && t > 0.12 && t < 0.8
          ? shakeOffset(`sp-${Math.floor(t * 36)}`, 2 * (1 - t))
          : { dx: 0, dy: 0 };

      ctx.save();
      ctx.translate(shake.dx, shake.dy);
      const { bx, by, bw, bh, slotX, slotY, hopperY } = machineChrome(ctx, t, leverDown);

      const reelY = by + 90;
      const reelH = 148;
      const reelW = 90;
      const gap = 10;
      const total = 3 * reelW + 2 * gap;
      const startX = bx + (bw - total) / 2;
      const stopAt = [0.4, 0.58, 0.76];
      const winGlow = mode === "win" && t > 0.2;

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

      // Payline
      ctx.strokeStyle = "rgba(255, 68, 102, 0.55)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(startX - 4, reelY + reelH / 2);
      ctx.lineTo(startX + total + 4, reelY + reelH / 2);
      ctx.stroke();

      consoleLeds(ctx, bx, by, bw, bh, credits, betMult, coinLabel, symbol);

      // Bottom neon plate
      roundRectPath(ctx, bx + 40, by + bh - 24, bw - 80, 18, 5);
      ctx.fillStyle = "#1a0820";
      ctx.fill();
      ctx.fillStyle = "#ff5577";
      ctx.font = "italic bold 12px Georgia, serif";
      ctx.textAlign = "center";
      ctx.fillText("LIVE · INSERT COINS · PULL", bx + bw / 2, by + bh - 12);

      if (mode === "insert") {
        drawInsertCoins(ctx, slotX, slotY, insertCount, t, symbol);
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

      if (mode === "spin" && t < 0.92) {
        ctx.fillStyle = "#94a3b8";
        ctx.font = "13px sans-serif";
        ctx.textAlign = "center";
        ctx.fillText("spinning…", W / 2 + 30, H - 14);
      }

      ctx.restore();

      // Win celebration — hopper fountain from the tray (no shatter / no row)
      if (mode === "win") {
        const intensity = opts.tier === "jackpot" ? 1 : opts.tier === "line" ? 0.65 : 0.4;
        drawHopperCascade(ctx, t, symbol, intensity, hopperY);
        // Soft tray glow only — no screen shatter / crack overlay
        if (t > 0.15) {
          const glow = ctx.createRadialGradient(W / 2 - 20, hopperY + 20, 4, W / 2 - 20, hopperY + 20, 120);
          glow.addColorStop(0, hexToRgba(0xffd54a, 0.35 * (1 - t * 0.3)));
          glow.addColorStop(1, "rgba(0,0,0,0)");
          ctx.fillStyle = glow;
          ctx.fillRect(0, hopperY - 40, W, H - hopperY + 40);
        }
        if (opts.tier === "jackpot" && t > 0.3) {
          drawSparks(ctx, W / 2 - 20, hopperY + 8, {
            count: 6, color: 0xffd54a, seed: `jp-${Math.floor(t * 5)}`, maxLen: 22,
          });
        }
        const fade = easeOutBack(clamp01((t - 0.18) / 0.22));
        ctx.globalAlpha = Math.min(1, fade);
        // Soft neon banner (NOT a cracked/shattered screen)
        roundRectPath(ctx, W / 2 - 150, 10, 260, 34, 10);
        ctx.fillStyle = "rgba(20, 8, 28, 0.88)";
        ctx.fill();
        ctx.strokeStyle = opts.tier === "jackpot" ? "#ffd54a" : "#4ade80";
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.fillStyle = opts.tier === "jackpot" ? "#ffd54a" : "#4ade80";
        ctx.font = "bold 20px sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        const title = opts.tier === "jackpot"
          ? `★ JACKPOT ${symbol} ★`
          : opts.tier === "pair" ? "PAIR PAY" : "LINE WIN";
        ctx.fillText(title, W / 2 - 20, 27);
        if (opts.payoutLabel) {
          ctx.fillStyle = "#fff6c8";
          ctx.font = "bold 16px sans-serif";
          ctx.fillText(opts.payoutLabel, W / 2 - 20, H - 16);
        }
        ctx.globalAlpha = 1;
      }

      if (mode === "lose" && t > 0.35) {
        ctx.fillStyle = "rgba(148,163,184,0.9)";
        ctx.font = "bold 14px sans-serif";
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
    if (economySymbol && a === economySymbol) return { mult: 40, tier: "jackpot" };
    if (a === "7️⃣") return { mult: 50, tier: "jackpot" };
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

/** Weighted reel roll. Rare chance to land the server economy symbol (jackpot face). */
export function rollSlotsReels(economySymbol?: string): string[] {
  const weightPick = () => {
    const roll = Math.random();
    if (economySymbol && roll < 0.04) return economySymbol;
    if (roll < 0.08) return "7️⃣";
    if (roll < 0.15) return "💎";
    if (roll < 0.27) return "⭐";
    if (roll < 0.41) return "🔔";
    if (roll < 0.55) return "🃏";
    if (roll < 0.74) return "🍋";
    return "🍒";
  };
  return [weightPick(), weightPick(), weightPick()];
}
