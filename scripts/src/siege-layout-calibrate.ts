// One-off: draw floor UV grid + proposed battle-line stand seats on arena.png.
process.env.DATABASE_URL ||= "postgres://siege-calibrate";
process.env.HQ_ASSETS_DIR ||= new URL("../../artifacts/api-server/assets/hq", import.meta.url).pathname;

import { writeFileSync } from "node:fs";

const base = "../../artifacts/api-server/src/bot";
const { getCanvas } = await import(`${base}/animations/engine.js`) as any;
const { spriteForPrefix } = await import(`${base}/hq/assets.js`) as any;

const OUT = process.env.SIEGE_CALIBRATE_OUT
  || "/opt/cursor/artifacts/siege_floor_grid_calibrate.png";

const W = 1200, H = 800;
const BOARD = { nearY: 687, farY: 387, nearHalf: 520, farHalf: 360 };
const STAND_W = 228, STAND_H = 298;

function spot(u: number, v: number) {
  const baseY = BOARD.nearY + (BOARD.farY - BOARD.nearY) * v;
  const half = BOARD.nearHalf + (BOARD.farHalf - BOARD.nearHalf) * v;
  return { cx: W / 2 + u * half, baseY };
}

/** Single battle LINE per side — front near the center lane → back toward the wall. */
const LINE = [
  { u: -0.22, v: 0.06, s: 0.62 }, // 0 front (active / nearest the clash lane)
  { u: -0.40, v: 0.28, s: 0.54 },
  { u: -0.56, v: 0.50, s: 0.46 },
  { u: -0.70, v: 0.72, s: 0.40 }, // 3 rear
] as const;

async function main() {
  const cmod = await getCanvas();
  if (!cmod) throw new Error("canvas unavailable");
  const arenaPath = spriteForPrefix("siege-scene", "arena");
  const bluePath = spriteForPrefix("siege-scene", "stand-blue");
  const redPath = spriteForPrefix("siege-scene", "stand-red");
  const arena = await cmod.loadImage(arenaPath);
  const standBlue = await cmod.loadImage(bluePath);
  const standRed = await cmod.loadImage(redPath);
  const canvas = cmod.createCanvas(W, H);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(arena, 0, 0, W, H);

  // Perspective grid
  ctx.strokeStyle = "rgba(0,255,180,0.35)";
  ctx.lineWidth = 1;
  for (let v = 0; v <= 1.001; v += 0.1) {
    const a = spot(-1, v), b = spot(1, v);
    ctx.beginPath(); ctx.moveTo(a.cx, a.baseY); ctx.lineTo(b.cx, b.baseY); ctx.stroke();
    ctx.fillStyle = "#7CFFC4"; ctx.font = "11px sans-serif";
    ctx.fillText(`v${v.toFixed(1)}`, 6, a.baseY - 2);
  }
  for (let u = -1; u <= 1.001; u += 0.1) {
    const a = spot(u, 0), b = spot(u, 1);
    ctx.beginPath(); ctx.moveTo(a.cx, a.baseY); ctx.lineTo(b.cx, b.baseY); ctx.stroke();
  }

  // Center lane
  ctx.strokeStyle = "rgba(255,215,0,0.75)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(W / 2, BOARD.farY);
  ctx.lineTo(W / 2, BOARD.nearY);
  ctx.stroke();

  for (const side of [0, 1] as const) {
    for (let i = 0; i < LINE.length; i++) {
      const f = LINE[i]!;
      const u = side === 0 ? f.u : -f.u;
      const p = spot(u, f.v);
      const dw = STAND_W * f.s, dh = STAND_H * f.s;
      const img = side === 0 ? standBlue : standRed;
      ctx.globalAlpha = 0.96;
      ctx.drawImage(img, p.cx - dw / 2, p.baseY - dh, dw, dh);
      ctx.globalAlpha = 1;
      ctx.fillStyle = side === 0 ? "#38bdf8" : "#f87171";
      ctx.beginPath(); ctx.arc(p.cx, p.baseY, 5, 0, Math.PI * 2); ctx.fill();
      ctx.font = "bold 13px sans-serif";
      ctx.fillText(`${side === 0 ? "B" : "R"}${i}`, p.cx - 8, p.baseY + 16);
      // Slide path toward center (attack direction)
      const toward = side === 0 ? 1 : -1;
      const slide = 70 * f.s;
      ctx.strokeStyle = side === 0 ? "rgba(56,189,248,0.8)" : "rgba(248,113,113,0.8)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(p.cx, p.baseY - dh * 0.45);
      ctx.lineTo(p.cx + toward * slide, p.baseY - dh * 0.45);
      ctx.stroke();
    }
  }

  writeFileSync(OUT, await canvas.encode("png"));
  console.log("wrote", OUT);
}

await main();
