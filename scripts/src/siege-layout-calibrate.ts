// Calibrate the FINAL horizontal battle-line geometry on arena.png.
//   BLUE [1][2][3][4]  VS  [1][2][3][4] RED
process.env.DATABASE_URL ||= "postgres://siege-calibrate";
process.env.HQ_ASSETS_DIR ||= new URL("../../artifacts/api-server/assets/hq", import.meta.url).pathname;

import { writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const base = "../../artifacts/api-server/src/bot";
const { getCanvas } = await import(`${base}/animations/engine.js`) as any;
const { spriteForPrefix } = await import(`${base}/hq/assets.js`) as any;

const OUT = process.env.SIEGE_CALIBRATE_OUT
  || "/opt/cursor/artifacts/siege_horizontal_line_calibrate.png";

const W = 1200, H = 800;
const CARD = { w: 128, h: 178 };
const LINE_Y = 340, GAP = 14, CENTER_GAP = 88, N = 4;

function slot(side: 0 | 1, i: number) {
  const rowW = N * CARD.w + (N - 1) * GAP;
  const leftOrigin = (W / 2 - CENTER_GAP / 2) - rowW;
  const rightOrigin = W / 2 + CENTER_GAP / 2;
  const origin = side === 0 ? leftOrigin : rightOrigin;
  return { x: origin + i * (CARD.w + GAP), y: LINE_Y };
}

function framesDir(): string | null {
  const candidates = [
    fileURLToPath(new URL("../../artifacts/api-server/assets/frames/", import.meta.url)),
    join(process.cwd(), "artifacts/api-server/assets/frames"),
  ];
  for (const d of candidates) if (existsSync(join(d, "DN_Card_Frame_Blue.png"))) return d;
  return null;
}

async function main() {
  const cmod = await getCanvas();
  if (!cmod) throw new Error("canvas unavailable");
  const arena = await cmod.loadImage(spriteForPrefix("siege-scene", "arena"));
  const dir = framesDir();
  const blue = dir ? await cmod.loadImage(join(dir, "DN_Card_Frame_Blue_256px.png")) : null;
  const red = dir ? await cmod.loadImage(join(dir, "DN_Card_Frame_Red_256px.png")) : null;
  const canvas = cmod.createCanvas(W, H);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(arena, 0, 0, W, H);

  // Center lane
  ctx.strokeStyle = "rgba(255,215,0,0.7)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(W / 2, LINE_Y - 20);
  ctx.lineTo(W / 2, LINE_Y + CARD.h + 40);
  ctx.stroke();

  for (const side of [0, 1] as const) {
    for (let i = 0; i < N; i++) {
      const p = slot(side, i);
      const frame = side === 0 ? blue : red;
      ctx.fillStyle = "rgba(8,12,20,0.85)";
      ctx.fillRect(p.x, p.y, CARD.w, CARD.h);
      if (frame) ctx.drawImage(frame, p.x, p.y, CARD.w, CARD.h);
      ctx.fillStyle = side === 0 ? "#38bdf8" : "#f87171";
      ctx.font = "bold 16px sans-serif";
      ctx.fillText(`${side === 0 ? "B" : "R"}${i + 1}`, p.x + 48, p.y + 96);
    }
  }

  ctx.fillStyle = "#fef3c7";
  ctx.font = "bold 18px sans-serif";
  ctx.fillText("BLUE [1][2][3][4]   VS   [1][2][3][4] RED", W / 2 - 220, LINE_Y - 36);

  writeFileSync(OUT, await canvas.encode("png"));
  console.log("wrote", OUT);
}

await main();
