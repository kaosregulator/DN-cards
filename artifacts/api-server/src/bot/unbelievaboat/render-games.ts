// Animated GIFs for UnbelievaBoat casino — felt-table look, GIF-safe flats.

import { encodeAnimation, type Ctx } from "../animations/engine.js";
import type { AnimationResult } from "../animations/types.js";
import { cardLabel, type Card } from "./cards.js";

const W = 480;
const H = 280;

function felt(ctx: Ctx) {
  ctx.fillStyle = "#0d3b2e";
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = "#0a2f24";
  ctx.fillRect(16, 16, W - 32, H - 32);
  // Rail
  ctx.strokeStyle = "#8b5a2b";
  ctx.lineWidth = 10;
  ctx.beginPath();
  ctx.rect(10, 10, W - 20, H - 20);
  ctx.stroke();
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

function drawCardFace(ctx: Ctx, x: number, y: number, label: string, faceDown = false) {
  roundRect(ctx, x, y, 56, 78, 6);
  if (faceDown) {
    ctx.fillStyle = "#1e3a8a";
    ctx.fill();
    ctx.fillStyle = "#3b82f6";
    ctx.fillRect(x + 8, y + 10, 40, 58);
    return;
  }
  ctx.fillStyle = "#f8fafc";
  ctx.fill();
  const red = label.includes("♥") || label.includes("♦");
  ctx.fillStyle = red ? "#dc2626" : "#0f172a";
  ctx.font = "bold 16px sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(label, x + 28, y + 39);
}

export async function renderCoinSpinGif(opts: {
  amount: number;
  symbol: string;
  streak: number;
}): Promise<AnimationResult | null> {
  const label = opts.symbol.length <= 4 ? opts.symbol : "💵";
  return encodeAnimation({
    width: W, height: H, durationMs: 1600, speed: "normal", maxFrames: 20, quality: 12,
    render: async ({ ctx, t }) => {
      felt(ctx);
      const cx = W / 2, cy = H / 2 - 16;
      const squash = Math.abs(Math.cos(t * Math.PI * 4));
      const r = 18 + 36 * squash;
      ctx.fillStyle = "#f5c84c";
      ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#c9922a";
      ctx.beginPath(); ctx.arc(cx, cy, r * 0.62, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#fff6c8";
      ctx.font = "bold 28px sans-serif";
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      if (squash > 0.4) ctx.fillText(label, cx, cy);
      ctx.fillStyle = "#fde68a";
      ctx.font = "bold 22px sans-serif";
      ctx.fillText(`+${opts.amount}`, cx, H - 52);
      ctx.fillStyle = "#a7f3d0";
      ctx.font = "14px sans-serif";
      ctx.fillText(`streak ${opts.streak}`, cx, H - 28);
    },
  });
}

export async function renderRouletteGif(opts: {
  landing: number;
  color: "red" | "black" | "green";
}): Promise<AnimationResult | null> {
  const colors = ["#c0392b", "#111", "#c0392b", "#111", "#27ae60", "#c0392b", "#111", "#c0392b"];
  return encodeAnimation({
    width: W, height: H, durationMs: 2000, speed: "normal", maxFrames: 24, quality: 14,
    render: async ({ ctx, t }) => {
      felt(ctx);
      const cx = W / 2, cy = H / 2 - 4;
      const rot = t * Math.PI * 7 + (opts.landing / 37) * Math.PI * 2;
      const r = 88;
      for (let i = 0; i < 16; i++) {
        const a0 = rot + (i / 16) * Math.PI * 2;
        const a1 = rot + ((i + 1) / 16) * Math.PI * 2;
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.arc(cx, cy, r, a0, a1);
        ctx.closePath();
        ctx.fillStyle = colors[i % colors.length]!;
        ctx.fill();
      }
      ctx.fillStyle = "#f5c84c";
      ctx.beginPath(); ctx.arc(cx, cy, 26, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#111";
      ctx.font = "bold 18px sans-serif";
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText(String(opts.landing), cx, cy);
      const br = r - 12;
      const ba = -Math.PI / 2 + (1 - t) * Math.PI * 10;
      ctx.fillStyle = "#f1f5f9";
      ctx.beginPath();
      ctx.arc(cx + Math.cos(ba) * br, cy + Math.sin(ba) * br, 8, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = opts.color === "red" ? "#f87171" : opts.color === "green" ? "#4ade80" : "#e2e8f0";
      ctx.font = "bold 18px sans-serif";
      ctx.fillText(opts.color.toUpperCase(), cx, H - 24);
    },
  });
}

export async function renderBlackjackTableGif(opts: {
  player: Card[];
  dealer: Card[];
  hideDealer: boolean;
  banner?: string;
}): Promise<AnimationResult | null> {
  return encodeAnimation({
    width: W, height: H, durationMs: 900, speed: "normal", maxFrames: 10, quality: 12,
    render: async ({ ctx, t }) => {
      felt(ctx);
      ctx.fillStyle = "#ecfdf5";
      ctx.font = "bold 14px sans-serif";
      ctx.textAlign = "left";
      ctx.fillText("DEALER", 36, 36);
      ctx.fillText("YOU", 36, 150);
      opts.dealer.forEach((c, i) => {
        const faceDown = opts.hideDealer && i === 1;
        const slide = Math.min(1, t * 2 + i * 0.1);
        drawCardFace(ctx, 36 + i * 64, 48, cardLabel(c), faceDown || slide < 0.3);
      });
      opts.player.forEach((c, i) => {
        const slide = Math.min(1, t * 2 + i * 0.1);
        if (slide < 0.2) return;
        drawCardFace(ctx, 36 + i * 64, 162, cardLabel(c));
      });
      if (opts.banner && t > 0.4) {
        ctx.fillStyle = "#fbbf24";
        ctx.font = "bold 22px sans-serif";
        ctx.textAlign = "center";
        ctx.fillText(opts.banner, W - 120, H / 2);
      }
    },
  });
}

/** @deprecated alias */
export async function renderBlackjackGif(opts: {
  playerTotal: number;
  dealerTotal: number;
  outcome: "win" | "lose" | "push";
}): Promise<AnimationResult | null> {
  return encodeAnimation({
    width: W, height: H, durationMs: 1200, speed: "normal", maxFrames: 12, quality: 12,
    render: async ({ ctx, t }) => {
      felt(ctx);
      ctx.fillStyle = "#ecfdf5";
      ctx.font = "bold 28px sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(`${opts.playerTotal} vs ${opts.dealerTotal}`, W / 2, H / 2 - 20);
      ctx.fillStyle = opts.outcome === "win" ? "#4ade80" : opts.outcome === "push" ? "#fbbf24" : "#f87171";
      if (t > 0.4) ctx.fillText(opts.outcome.toUpperCase(), W / 2, H / 2 + 30);
    },
  });
}

export async function renderHigherLowerGif(opts: {
  shown: string;
  next?: string;
  result?: "win" | "lose";
}): Promise<AnimationResult | null> {
  return encodeAnimation({
    width: W, height: H, durationMs: 1100, speed: "normal", maxFrames: 12, quality: 12,
    render: async ({ ctx, t }) => {
      felt(ctx);
      drawCardFace(ctx, W / 2 - 90, 90, opts.shown);
      if (opts.next && t > 0.45) drawCardFace(ctx, W / 2 + 30, 90, opts.next);
      else drawCardFace(ctx, W / 2 + 30, 90, "?", true);
      ctx.fillStyle = "#ecfdf5";
      ctx.font = "bold 18px sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("HIGHER  or  LOWER?", W / 2, 50);
      if (opts.result && t > 0.55) {
        ctx.fillStyle = opts.result === "win" ? "#4ade80" : "#f87171";
        ctx.fillText(opts.result === "win" ? "NICE CALL" : "WRONG", W / 2, H - 36);
      }
    },
  });
}

export async function renderRedBlackGif(opts: {
  pick: "red" | "black";
  landed: "red" | "black";
  win: boolean;
}): Promise<AnimationResult | null> {
  return encodeAnimation({
    width: W, height: H, durationMs: 1400, speed: "normal", maxFrames: 16, quality: 12,
    render: async ({ ctx, t }) => {
      felt(ctx);
      const flip = Math.floor(t * 10) % 2 === 0 ? "#dc2626" : "#0f172a";
      roundRect(ctx, W / 2 - 50, 70, 100, 120, 12);
      ctx.fillStyle = t < 0.7 ? flip : (opts.landed === "red" ? "#dc2626" : "#0f172a");
      ctx.fill();
      ctx.fillStyle = "#f8fafc";
      ctx.font = "bold 22px sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(t < 0.7 ? "?" : opts.landed.toUpperCase(), W / 2, 130);
      ctx.fillStyle = "#a7f3d0";
      ctx.font = "16px sans-serif";
      ctx.fillText(`You picked ${opts.pick}`, W / 2, 40);
      if (t > 0.75) {
        ctx.fillStyle = opts.win ? "#4ade80" : "#f87171";
        ctx.font = "bold 22px sans-serif";
        ctx.fillText(opts.win ? "WIN ×2" : "LOSE", W / 2, H - 36);
      }
    },
  });
}

export async function renderSlotsGif(opts: {
  reels: string[];
  win: boolean;
}): Promise<AnimationResult | null> {
  const pool = ["🍒", "🍋", "🔔", "⭐", "💎", "7️⃣"];
  return encodeAnimation({
    width: W, height: H, durationMs: 1600, speed: "normal", maxFrames: 18, quality: 12,
    render: async ({ ctx, t }) => {
      felt(ctx);
      roundRect(ctx, 60, 60, W - 120, 140, 16);
      ctx.fillStyle = "#111827";
      ctx.fill();
      for (let i = 0; i < 3; i++) {
        const x = 100 + i * 110;
        roundRect(ctx, x, 80, 90, 100, 10);
        ctx.fillStyle = "#1f2937";
        ctx.fill();
        const sym = t < 0.75 ? pool[Math.floor((t * 30 + i * 3) % pool.length)]! : opts.reels[i]!;
        ctx.font = "48px sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(sym, x + 45, 130);
      }
      if (t > 0.8) {
        ctx.fillStyle = opts.win ? "#4ade80" : "#94a3b8";
        ctx.font = "bold 20px sans-serif";
        ctx.textAlign = "center";
        ctx.fillText(opts.win ? "JACKPOT LINE!" : "No line", W / 2, H - 36);
      }
    },
  });
}

export async function renderRussianGif(opts: {
  survived: boolean;
  chamber: number;
}): Promise<AnimationResult | null> {
  return encodeAnimation({
    width: W, height: H, durationMs: 1700, speed: "normal", maxFrames: 20, quality: 12,
    render: async ({ ctx, t }) => {
      felt(ctx);
      const cx = W / 2, cy = H / 2 - 8;
      const spin = t * Math.PI * 5;
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(spin);
      ctx.fillStyle = "#64748b";
      ctx.beginPath(); ctx.arc(0, 0, 60, 0, Math.PI * 2); ctx.fill();
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
      if (t > 0.72) ctx.fillText(opts.survived ? "CLICK — safe" : "BANG!", cx, H - 32);
      else {
        ctx.fillStyle = "#cbd5e1";
        ctx.font = "16px sans-serif";
        ctx.fillText("spinning…", cx, H - 32);
      }
    },
  });
}

export async function renderRobGif(opts: { success: boolean }): Promise<AnimationResult | null> {
  return encodeAnimation({
    width: W, height: H, durationMs: 1500, speed: "normal", maxFrames: 18, quality: 12,
    render: async ({ ctx, t }) => {
      felt(ctx);
      const drawStick = (x: number, y: number, color: string, run: number) => {
        ctx.strokeStyle = color;
        ctx.lineWidth = 3;
        ctx.lineCap = "round";
        ctx.beginPath();
        ctx.arc(x, y - 28, 10, 0, Math.PI * 2);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(x, y - 18); ctx.lineTo(x, y + 10);
        ctx.moveTo(x, y - 8); ctx.lineTo(x - 14, y + 4 + Math.sin(run) * 4);
        ctx.moveTo(x, y - 8); ctx.lineTo(x + 14, y + 4 - Math.sin(run) * 4);
        ctx.moveTo(x, y + 10); ctx.lineTo(x - 10, y + 28 + Math.cos(run) * 3);
        ctx.moveTo(x, y + 10); ctx.lineTo(x + 10, y + 28 - Math.cos(run) * 3);
        ctx.stroke();
      };
      const thiefX = 80 + t * 200;
      drawStick(thiefX, 130, "#f472b6", t * 20);
      drawStick(340, 130, "#60a5fa", 0);
      ctx.fillStyle = "#fbbf24";
      ctx.beginPath(); ctx.arc(thiefX + 18, 110, 10, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = opts.success ? "#4ade80" : "#f87171";
      ctx.font = "bold 20px sans-serif";
      ctx.textAlign = "center";
      if (t > 0.65) ctx.fillText(opts.success ? "GOT AWAY!" : "CAUGHT!", W / 2, H - 28);
    },
  });
}

export async function renderBegGif(): Promise<AnimationResult | null> {
  return encodeAnimation({
    width: W, height: H, durationMs: 1400, speed: "normal", maxFrames: 16, quality: 12,
    render: async ({ ctx, t }) => {
      felt(ctx);
      ctx.fillStyle = "#fef3c7";
      roundRect(ctx, 110, 40, 260, 70, 10);
      ctx.fill();
      ctx.fillStyle = "#92400e";
      ctx.font = "bold 18px sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("pls spare some cash?", W / 2, 70);
      ctx.font = "14px sans-serif";
      ctx.fillText("(PG · dramatic beg)", W / 2, 94);
      const bob = Math.sin(t * Math.PI * 4) * 4;
      ctx.strokeStyle = "#f9a8d4";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(W / 2, 160 + bob, 12, 0, Math.PI * 2);
      ctx.moveTo(W / 2, 172 + bob); ctx.lineTo(W / 2, 200);
      ctx.moveTo(W / 2, 180 + bob); ctx.lineTo(W / 2 - 30, 165 + bob);
      ctx.moveTo(W / 2, 180 + bob); ctx.lineTo(W / 2 + 30, 165 + bob);
      ctx.stroke();
      ctx.fillStyle = "#facc15";
      for (let i = 0; i < 5; i++) {
        const x = 70 + i * 80;
        const y = 230 - ((t * 80 + i * 20) % 60);
        ctx.beginPath(); ctx.arc(x, y, 8, 0, Math.PI * 2); ctx.fill();
      }
    },
  });
}

export async function renderWorkGif(opts: { payout: number }): Promise<AnimationResult | null> {
  return encodeAnimation({
    width: W, height: 200, durationMs: 1000, speed: "normal", maxFrames: 12, quality: 12,
    render: async ({ ctx, t }) => {
      felt(ctx);
      ctx.fillStyle = "#fde68a";
      ctx.font = "bold 22px sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("SHIFT COMPLETE", W / 2, 70);
      ctx.fillStyle = "#a7f3d0";
      ctx.font = "18px sans-serif";
      if (t > 0.3) ctx.fillText(`+${opts.payout} cash`, W / 2, 120);
    },
  });
}
