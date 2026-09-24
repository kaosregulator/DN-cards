// Premium live slot machine — bronze/neon “one-armed bandit” look.
// Reuses pack/battle particle helpers for win celebrations.

import {
  encodeAnimation, clamp01, lerp, easeOutBack,
  hexToRgba, roundRectPath, type Ctx,
} from "../animations/engine.js";
import type { AnimationResult } from "../animations/types.js";
import { drawConfetti, drawSparks, drawExplosion, shakeOffset } from "../animations/particles.js";
import { createBurst, updateParticles, drawParticles, type Particle } from "../animations/effects.js";

const W = 560;
const H = 420;

export const SLOT_POOL = ["🍒", "🍋", "🔔", "⭐", "💎", "🃏", "7️⃣"] as const;

export type SlotsMachineMode = "idle" | "spin" | "win" | "lose";

export type SlotsMachineOpts = {
  mode: SlotsMachineMode;
  /** Final reel faces (length 3). */
  reels?: string[];
  /** Server economy symbol — used as jackpot face when all 7️⃣ match, shown on win banner. */
  symbol: string;
  payoutLabel?: string;
  tier?: "jackpot" | "line" | "pair" | "lose";
  /** Coins / rings to rain on jackpot & line wins. */
  coinBurst?: boolean;
};

function machineChrome(ctx: Ctx, t: number, leverDown: number) {
  // Casino floor backdrop
  const bg = ctx.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, "#1a0f14");
  bg.addColorStop(1, "#0a0610");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  // Soft vignette
  ctx.fillStyle = "rgba(0,0,0,0.25)";
  ctx.fillRect(0, 0, W, H);

  // Body — bronze frame
  const bx = 70, by = 28, bw = 360, bh = 360;
  roundRectPath(ctx, bx, by, bw, bh, 28);
  const bronze = ctx.createLinearGradient(bx, by, bx + bw, by + bh);
  bronze.addColorStop(0, "#c9a06a");
  bronze.addColorStop(0.35, "#8b5e34");
  bronze.addColorStop(0.7, "#d4b07a");
  bronze.addColorStop(1, "#6b4226");
  ctx.fillStyle = bronze;
  ctx.fill();

  // Inner dark cavity
  roundRectPath(ctx, bx + 14, by + 14, bw - 28, bh - 28, 20);
  ctx.fillStyle = "#1a0a12";
  ctx.fill();

  // Top marquee
  roundRectPath(ctx, bx + 28, by + 22, bw - 56, 52, 10);
  ctx.fillStyle = "#2a1030";
  ctx.fill();
  ctx.fillStyle = hexToRgba(0xff2244, 0.35 + Math.sin(t * Math.PI * 4) * 0.1);
  ctx.font = "italic bold 28px Georgia, serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("Casino", bx + bw / 2, by + 48);
  ctx.fillStyle = "#ff4466";
  ctx.fillText("Casino", bx + bw / 2, by + 48);

  // Lever (right side)
  const lx = bx + bw + 18;
  const ly = by + 110;
  const pull = leverDown; // 0 upright → 1 pulled down
  ctx.save();
  ctx.translate(lx + 10, ly);
  ctx.rotate(lerp(-0.15, 0.85, pull));
  // shaft
  ctx.strokeStyle = "#b8b8c0";
  ctx.lineWidth = 10;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(0, -90);
  ctx.stroke();
  // ball
  ctx.fillStyle = "#e11d2e";
  ctx.beginPath();
  ctx.arc(0, -100, 16, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#ff6b7a";
  ctx.beginPath();
  ctx.arc(-4, -104, 6, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // Lever base
  ctx.fillStyle = "#6b4226";
  ctx.beginPath();
  ctx.arc(lx + 10, ly, 18, 0, Math.PI * 2);
  ctx.fill();

  return { bx, by, bw, bh };
}

function drawReelWindow(
  ctx: Ctx,
  x: number, y: number, w: number, h: number,
  face: string,
  scrollSyms: string[],
  scrollT: number,
  spinning: boolean,
) {
  // White mechanical drum look
  roundRectPath(ctx, x, y, w, h, 8);
  ctx.fillStyle = "#f5f5f7";
  ctx.fill();
  ctx.strokeStyle = "#2a2a32";
  ctx.lineWidth = 3;
  ctx.stroke();

  ctx.save();
  ctx.beginPath();
  roundRectPath(ctx, x + 2, y + 2, w - 4, h - 4, 6);
  ctx.clip();

  if (spinning) {
    const cell = h / 3;
    const offset = (scrollT % 1) * cell;
    for (let k = -1; k < 4; k++) {
      const sym = scrollSyms[(Math.floor(scrollT) + k + 50) % scrollSyms.length]!;
      const sy = y + h / 2 + k * cell - offset;
      ctx.font = `${Math.floor(w * 0.55)}px sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillStyle = "#111";
      ctx.fillText(sym, x + w / 2, sy);
    }
    // Motion blur wash
    ctx.fillStyle = "rgba(255,255,255,0.15)";
    ctx.fillRect(x, y, w, h);
  } else {
    // Show neighbors faintly (classic drum)
    ctx.globalAlpha = 0.35;
    ctx.font = `${Math.floor(w * 0.38)}px sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(scrollSyms[0]!, x + w / 2, y + h * 0.18);
    ctx.fillText(scrollSyms[2]!, x + w / 2, y + h * 0.82);
    ctx.globalAlpha = 1;
    ctx.font = `${Math.floor(w * 0.62)}px sans-serif`;
    ctx.fillStyle = "#111";
    ctx.fillText(face, x + w / 2, y + h / 2);
  }
  ctx.restore();
}

function drawCoinRain(ctx: Ctx, t: number, symbol: string, count: number) {
  for (let i = 0; i < count; i++) {
    const seed = Math.sin(i * 12.9898) * 43758.5453;
    const u = seed - Math.floor(seed);
    const x = 40 + u * (W - 80);
    const fall = ((t * 1.4 + u) % 1.2);
    const y = -20 + fall * (H + 40);
    const r = 6 + (u * 7);
    const squash = 0.55 + Math.abs(Math.sin(t * 20 + i)) * 0.45;
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(squash, 1);
    ctx.fillStyle = "#f5c84c";
    ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#c9922a";
    ctx.beginPath(); ctx.arc(0, 0, r * 0.55, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#fff6c8";
    ctx.font = `bold ${Math.max(8, Math.floor(r))}px sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const face = symbol.length <= 2 ? symbol : "$";
    ctx.fillText(face, 0, 1);
    ctx.restore();
  }
}

function consoleButtons(ctx: Ctx, bx: number, by: number, bw: number, bh: number, glow: boolean) {
  const cy = by + bh - 78;
  // ledge
  roundRectPath(ctx, bx + 24, cy, bw - 48, 48, 8);
  ctx.fillStyle = "#3a2418";
  ctx.fill();
  // small white squares
  for (let i = 0; i < 5; i++) {
    ctx.fillStyle = "#eeeef2";
    ctx.fillRect(bx + 40 + i * 36, cy + 14, 22, 22);
  }
  // big red spin button
  const rx = bx + bw - 70;
  const ry = cy + 24;
  ctx.fillStyle = glow ? "#ff3344" : "#c41828";
  ctx.beginPath(); ctx.arc(rx, ry, 18, 0, Math.PI * 2); ctx.fill();
  if (glow) {
    ctx.strokeStyle = "rgba(255,80,100,0.6)";
    ctx.lineWidth = 4;
    ctx.beginPath(); ctx.arc(rx, ry, 24, 0, Math.PI * 2); ctx.stroke();
  }

  // bottom neon plate
  roundRectPath(ctx, bx + 40, by + bh - 28, bw - 80, 22, 6);
  ctx.fillStyle = "#2a1030";
  ctx.fill();
  ctx.fillStyle = "#ff4466";
  ctx.font = "italic bold 14px Georgia, serif";
  ctx.textAlign = "center";
  ctx.fillText("LIVE SLOTS", bx + bw / 2, by + bh - 15);
}

/**
 * Render the live slot machine GIF.
 * - idle: gentle neon pulse + upright lever, waiting for PULL
 * - spin: lever pulls, reels scroll & lock, shake
 * - win: coins fly + confetti + jackpot banner with economy symbol
 * - lose: reels stop, soft “try again” cue
 */
export async function renderLiveSlotsMachine(opts: SlotsMachineOpts): Promise<AnimationResult | null> {
  const faces = opts.reels ?? ["🍒", "🍋", "🔔"];
  const pool = [...SLOT_POOL, opts.symbol.length <= 3 ? opts.symbol : "💰"];
  const mode = opts.mode;
  const durationMs = mode === "idle" ? 1800 : mode === "spin" ? 4800 : mode === "win" ? 3200 : 2200;
  const maxFrames = mode === "spin" ? 42 : mode === "win" ? 28 : 16;

  // Neighbor symbols for drum look
  const neighbors = faces.map((f, i) => {
    const idx = pool.indexOf(f as typeof pool[number]);
    const a = pool[(idx - 1 + pool.length) % pool.length]!;
    const b = pool[(idx + 1) % pool.length]!;
    return [a, f, b] as string[];
  });

  let particles: Particle[] = [];
  if (mode === "win") {
    particles = createBurst(W / 2, H / 2, 0xf5c84c, 40, 160);
  }

  return encodeAnimation({
    width: W, height: H, durationMs, speed: "normal", maxFrames, quality: 14, renderScale: 0.85,
    render: async ({ ctx, t }) => {
      const leverDown =
        mode === "spin" ? clamp01(t / 0.18)
          : mode === "idle" ? 0.05 + Math.sin(t * Math.PI * 2) * 0.03
            : 0.9;

      const shake =
        mode === "spin" && t > 0.15 && t < 0.85
          ? shakeOffset(`spin-${Math.floor(t * 40)}`, 2.5 * (1 - t))
          : mode === "win" && t < 0.35
            ? shakeOffset(`win-${Math.floor(t * 30)}`, 4)
            : { dx: 0, dy: 0 };

      ctx.save();
      ctx.translate(shake.dx, shake.dy);
      const { bx, by, bw, bh } = machineChrome(ctx, t, leverDown);

      // Reel window area
      const reelY = by + 95;
      const reelH = 150;
      const reelW = 88;
      const gap = 12;
      const total = 3 * reelW + 2 * gap;
      const startX = bx + (bw - total) / 2;

      const stopAt = [0.38, 0.58, 0.78];
      for (let i = 0; i < 3; i++) {
        const spinning = mode === "spin" && t < (stopAt[i] ?? 0.8);
        const scrollT = t * 28 + i * 5;
        const face = faces[i]!;
        drawReelWindow(
          ctx,
          startX + i * (reelW + gap),
          reelY,
          reelW,
          reelH,
          face,
          neighbors[i] ?? [pool[0]!, face, pool[1]!],
          scrollT,
          spinning,
        );
      }

      // Payline
      ctx.strokeStyle = "rgba(255, 68, 102, 0.65)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(startX - 6, reelY + reelH / 2);
      ctx.lineTo(startX + total + 6, reelY + reelH / 2);
      ctx.stroke();

      consoleButtons(ctx, bx, by, bw, bh, mode === "idle" || (mode === "spin" && t < 0.2));

      // Idle prompt
      if (mode === "idle") {
        ctx.fillStyle = hexToRgba(0xffe4a0, 0.7 + Math.sin(t * Math.PI * 4) * 0.3);
        ctx.font = "bold 16px sans-serif";
        ctx.textAlign = "center";
        ctx.fillText("PULL THE LEVER", W / 2 + 40, H - 18);
      }

      ctx.restore();

      // Win celebration overlays (outside shake)
      if (mode === "win") {
        if (opts.coinBurst !== false) {
          drawCoinRain(ctx, t, opts.symbol, opts.tier === "jackpot" ? 48 : 28);
        }
        if (t > 0.1) {
          drawConfetti(ctx, W, H, {
            count: opts.tier === "jackpot" ? 70 : 40,
            seed: `slots-win-${opts.tier}`,
            colors: [0xff5e78, 0xffd54a, 0x4ad991, 0xff2244, 0xf5c84c],
          });
        }
        if (t > 0.05 && t < 0.4) {
          drawExplosion(ctx, W / 2, H / 2 - 20, {
            radius: 80 + t * 60,
            color: 0xffd54a,
            seed: "slots-boom",
          });
        }
        particles = updateParticles(particles);
        drawParticles(ctx, particles);
        drawSparks(ctx, W / 2, reelY + reelH / 2, { count: 12, color: 0xffcc33, seed: `jp-${Math.floor(t * 10)}` });

        const fade = easeOutBack(clamp01((t - 0.25) / 0.3));
        ctx.globalAlpha = Math.min(1, fade);
        ctx.fillStyle = opts.tier === "jackpot" ? "#ffd54a" : "#4ade80";
        ctx.font = "bold 26px sans-serif";
        ctx.textAlign = "center";
        const title = opts.tier === "jackpot"
          ? `★ JACKPOT ${opts.symbol} ★`
          : opts.tier === "pair" ? "PAIR PAY" : "LINE WIN";
        ctx.fillText(title, W / 2, 22);
        if (opts.payoutLabel) {
          ctx.fillStyle = "#fff6c8";
          ctx.font = "bold 18px sans-serif";
          ctx.fillText(opts.payoutLabel, W / 2, H - 16);
        }
        ctx.globalAlpha = 1;
      }

      if (mode === "lose" && t > 0.4) {
        ctx.fillStyle = "rgba(148,163,184,0.9)";
        ctx.font = "bold 16px sans-serif";
        ctx.textAlign = "center";
        ctx.fillText("No line — spin again?", W / 2, H - 16);
      }

      if (mode === "spin" && t < 0.9) {
        ctx.fillStyle = "#94a3b8";
        ctx.font = "14px sans-serif";
        ctx.textAlign = "center";
        ctx.fillText("spinning…", W / 2 + 40, H - 16);
      }
    },
  });
}

/** Score 3-reel result. Jackpot face is 7️⃣; banner uses economy `symbol`. */
export function scoreSlotsReels(reels: string[]): {
  mult: number;
  tier: "jackpot" | "line" | "pair" | "lose";
} {
  const [a, b, c] = reels;
  if (a && a === b && b === c) {
    if (a === "7️⃣") return { mult: 50, tier: "jackpot" };
    if (a === "💎") return { mult: 25, tier: "jackpot" };
    if (a === "⭐") return { mult: 15, tier: "line" };
    if (a === "🔔") return { mult: 10, tier: "line" };
    return { mult: 6, tier: "line" };
  }
  if ((a && a === b) || (b && b === c) || (a && a === c)) {
    return { mult: 2, tier: "pair" };
  }
  return { mult: 0, tier: "lose" };
}

export function rollSlotsReels(jackpotSymbol?: string): string[] {
  const weightPick = () => {
    const roll = Math.random();
    // Rare: inject economy symbol as a special face (~3%)
    if (jackpotSymbol && jackpotSymbol.length <= 3 && roll < 0.03) return jackpotSymbol;
    if (roll < 0.06) return "7️⃣";
    if (roll < 0.14) return "💎";
    if (roll < 0.26) return "⭐";
    if (roll < 0.40) return "🔔";
    if (roll < 0.55) return "🃏";
    if (roll < 0.75) return "🍋";
    return "🍒";
  };
  return [weightPick(), weightPick(), weightPick()];
}
