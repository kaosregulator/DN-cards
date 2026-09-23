// Animated GIFs for UnbelievaBoat mini-games (canvas → GIF).

import { encodeAnimation, type Ctx } from "../animations/engine.js";
import type { AnimationResult } from "../animations/types.js";

const W = 420;
const H = 240;

function bg(ctx: Ctx, t: number) {
  ctx.fillStyle = "#1a1028";
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = "#2a1840";
  for (let i = 0; i < 20; i++) {
    const x = (i * 47 + t * 30) % W;
    const y = (i * 31) % H;
    ctx.fillRect(x, y, 2, 2);
  }
}

function roundRect(ctx: Ctx, x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

/** Spinning coin for Cash Check-In — label is guild currency symbol (emoji ok as text). */
export async function renderCoinSpinGif(opts: {
  amount: number;
  symbol: string;
  streak: number;
}): Promise<AnimationResult | null> {
  const label = opts.symbol.length <= 4 ? opts.symbol : "💵";
  return encodeAnimation({
    width: W,
    height: H,
    durationMs: 1600,
    speed: "normal",
    maxFrames: 20,
    quality: 12,
    render: async ({ ctx, t }) => {
      bg(ctx, t);
      const cx = W / 2;
      const cy = H / 2 - 10;
      const squash = Math.abs(Math.cos(t * Math.PI * 4));
      const rw = 54 * (0.18 + 0.82 * squash);
      const rh = 54;
      ctx.fillStyle = "#f5c84c";
      ctx.beginPath();
      ctx.arc(cx, cy, Math.max(rw, rh * 0.35), 0, Math.PI * 2);
      ctx.fill();
      // Squash illusion via width scale on a second circle
      ctx.fillStyle = "#c9922a";
      ctx.beginPath();
      ctx.arc(cx, cy, Math.max(8, rw * 0.55), 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#fff6c8";
      ctx.font = "bold 28px sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      if (squash > 0.35) ctx.fillText(label, cx, cy);
      ctx.fillStyle = "#ffe08a";
      ctx.font = "bold 22px sans-serif";
      ctx.fillText(`+${opts.amount}`, cx, H - 48);
      ctx.fillStyle = "#c4b5fd";
      ctx.font = "14px sans-serif";
      ctx.fillText(`streak ${opts.streak}`, cx, H - 24);
    },
  });
}

export async function renderRouletteGif(opts: {
  landing: number;
  color: "red" | "black" | "green";
}): Promise<AnimationResult | null> {
  const colors = ["#c0392b", "#1a1a1a", "#c0392b", "#1a1a1a", "#27ae60", "#c0392b", "#1a1a1a"];
  return encodeAnimation({
    width: W,
    height: H,
    durationMs: 1800,
    speed: "normal",
    maxFrames: 22,
    quality: 14,
    render: async ({ ctx, t }) => {
      bg(ctx, t);
      const cx = W / 2;
      const cy = H / 2;
      const rot = t * Math.PI * 6 + (opts.landing / 37) * Math.PI * 2;
      const r = 78;
      for (let i = 0; i < 14; i++) {
        const a0 = rot + (i / 14) * Math.PI * 2;
        const a1 = rot + ((i + 1) / 14) * Math.PI * 2;
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.arc(cx, cy, r, a0, a1);
        ctx.closePath();
        ctx.fillStyle = colors[i % colors.length]!;
        ctx.fill();
      }
      ctx.fillStyle = "#f5c84c";
      ctx.beginPath();
      ctx.arc(cx, cy, 22, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#111";
      ctx.font = "bold 16px sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(String(opts.landing), cx, cy);
      // Ball
      const br = r - 10;
      const ba = -Math.PI / 2 + (1 - t) * Math.PI * 8;
      ctx.fillStyle = "#ecf0f1";
      ctx.beginPath();
      ctx.arc(cx + Math.cos(ba) * br, cy + Math.sin(ba) * br, 7, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = opts.color === "red" ? "#e74c3c" : opts.color === "green" ? "#2ecc71" : "#bdc3c7";
      ctx.font = "bold 18px sans-serif";
      ctx.fillText(opts.color.toUpperCase(), cx, H - 28);
    },
  });
}

export async function renderBlackjackGif(opts: {
  playerTotal: number;
  dealerTotal: number;
  outcome: "win" | "lose" | "push";
}): Promise<AnimationResult | null> {
  return encodeAnimation({
    width: W,
    height: H,
    durationMs: 1400,
    speed: "normal",
    maxFrames: 16,
    quality: 12,
    render: async ({ ctx, t }) => {
      bg(ctx, t);
      const drawCard = (x: number, y: number, face: string, delay: number) => {
        const show = t > delay;
        ctx.fillStyle = show ? "#f8fafc" : "#334155";
        roundRect(ctx, x, y, 52, 72, 6);
        ctx.fill();
        if (show) {
          ctx.fillStyle = "#0f172a";
          ctx.font = "bold 20px sans-serif";
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillText(face, x + 26, y + 36);
        }
      };
      ctx.fillStyle = "#a78bfa";
      ctx.font = "14px sans-serif";
      ctx.textAlign = "left";
      ctx.fillText("Dealer", 40, 28);
      ctx.fillText("You", 40, 130);
      drawCard(40, 40, String(Math.min(opts.dealerTotal, 21)), 0.15);
      drawCard(100, 40, t > 0.7 ? String(opts.dealerTotal) : "?", 0.35);
      drawCard(40, 142, String(Math.min(opts.playerTotal, 21)), 0.05);
      drawCard(100, 142, String(opts.playerTotal), 0.25);
      const label = opts.outcome === "win" ? "YOU WIN" : opts.outcome === "push" ? "PUSH" : "BUST / LOSE";
      ctx.fillStyle = opts.outcome === "win" ? "#4ade80" : opts.outcome === "push" ? "#fbbf24" : "#f87171";
      ctx.font = "bold 22px sans-serif";
      ctx.textAlign = "center";
      if (t > 0.55) ctx.fillText(label, W / 2 + 80, H / 2);
    },
  });
}

export async function renderRussianGif(opts: {
  survived: boolean;
  chamber: number;
}): Promise<AnimationResult | null> {
  return encodeAnimation({
    width: W,
    height: H,
    durationMs: 1700,
    speed: "normal",
    maxFrames: 20,
    quality: 12,
    render: async ({ ctx, t }) => {
      bg(ctx, t);
      const cx = W / 2;
      const cy = H / 2 - 8;
      const spin = t * Math.PI * 5;
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(spin);
      ctx.fillStyle = "#64748b";
      ctx.beginPath();
      ctx.arc(0, 0, 60, 0, Math.PI * 2);
      ctx.fill();
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        ctx.fillStyle = i === opts.chamber ? "#ef4444" : "#1e293b";
        ctx.beginPath();
        ctx.arc(Math.cos(a) * 34, Math.sin(a) * 34, 12, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
      ctx.fillStyle = opts.survived ? "#4ade80" : "#f87171";
      ctx.font = "bold 24px sans-serif";
      ctx.textAlign = "center";
      if (t > 0.72) {
        ctx.fillText(opts.survived ? "CLICK — safe" : "BANG!", cx, H - 32);
      } else {
        ctx.fillStyle = "#cbd5e1";
        ctx.font = "16px sans-serif";
        ctx.fillText("spinning…", cx, H - 32);
      }
    },
  });
}

export async function renderRobGif(opts: { success: boolean }): Promise<AnimationResult | null> {
  return encodeAnimation({
    width: W,
    height: H,
    durationMs: 1500,
    speed: "normal",
    maxFrames: 18,
    quality: 12,
    render: async ({ ctx, t }) => {
      bg(ctx, t);
      const drawStick = (x: number, y: number, color: string, run: number) => {
        ctx.strokeStyle = color;
        ctx.lineWidth = 3;
        ctx.lineCap = "round";
        ctx.beginPath();
        ctx.arc(x, y - 28, 10, 0, Math.PI * 2);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(x, y - 18);
        ctx.lineTo(x, y + 10);
        ctx.moveTo(x, y - 8);
        ctx.lineTo(x - 14, y + 4 + Math.sin(run) * 4);
        ctx.moveTo(x, y - 8);
        ctx.lineTo(x + 14, y + 4 - Math.sin(run) * 4);
        ctx.moveTo(x, y + 10);
        ctx.lineTo(x - 10, y + 28 + Math.cos(run) * 3);
        ctx.moveTo(x, y + 10);
        ctx.lineTo(x + 10, y + 28 - Math.cos(run) * 3);
        ctx.stroke();
      };
      const thiefX = 80 + t * 180;
      drawStick(thiefX, 120, "#f472b6", t * 20);
      drawStick(320, 120, "#60a5fa", 0);
      // bag
      ctx.fillStyle = "#fbbf24";
      ctx.beginPath();
      ctx.arc(thiefX + 18, 100, 10, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = opts.success ? "#4ade80" : "#f87171";
      ctx.font = "bold 20px sans-serif";
      ctx.textAlign = "center";
      if (t > 0.65) ctx.fillText(opts.success ? "GOT AWAY!" : "CAUGHT!", W / 2, H - 28);
    },
  });
}

/** PG “beg for cash” meme strip — command may be named slut; visual stays wholesome. */
export async function renderBegGif(): Promise<AnimationResult | null> {
  return encodeAnimation({
    width: W,
    height: H,
    durationMs: 1400,
    speed: "normal",
    maxFrames: 16,
    quality: 12,
    render: async ({ ctx, t }) => {
      bg(ctx, t);
      // Sign
      ctx.fillStyle = "#fef3c7";
      roundRect(ctx, 90, 40, 240, 70, 10);
      ctx.fill();
      ctx.fillStyle = "#92400e";
      ctx.font = "bold 18px sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("pls spare some cash?", W / 2, 70);
      ctx.font = "14px sans-serif";
      ctx.fillText("(PG · dramatic beg)", W / 2, 94);
      // Kneeling stick
      const bob = Math.sin(t * Math.PI * 4) * 4;
      ctx.strokeStyle = "#f9a8d4";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(W / 2, 150 + bob, 12, 0, Math.PI * 2);
      ctx.moveTo(W / 2, 162 + bob);
      ctx.lineTo(W / 2, 190);
      ctx.moveTo(W / 2, 170 + bob);
      ctx.lineTo(W / 2 - 30, 155 + bob);
      ctx.moveTo(W / 2, 170 + bob);
      ctx.lineTo(W / 2 + 30, 155 + bob);
      ctx.stroke();
      // Floating coins
      ctx.fillStyle = "#facc15";
      for (let i = 0; i < 5; i++) {
        const x = 60 + i * 70;
        const y = 200 - ((t * 80 + i * 20) % 60);
        ctx.beginPath();
        ctx.arc(x, y, 8, 0, Math.PI * 2);
        ctx.fill();
      }
    },
  });
}
