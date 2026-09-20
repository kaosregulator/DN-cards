/**
 * Offline preview for dual-quote styles.
 * Usage: node ../../../../node_modules/tsx/dist/cli.mjs src/bot/quote/preview-dual.ts
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getCanvas } from "../animations/engine.js";
import { DUAL_QUOTE_STYLES } from "./dual-styles.js";
import { renderDualQuoteCard } from "./render-dual.js";

async function makeAvatar(color: string, label: string): Promise<string> {
  const mod = await getCanvas();
  if (!mod) throw new Error("canvas unavailable");
  const size = 256;
  const canvas = mod.createCanvas(size, size);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, size, size);
  ctx.fillStyle = "#1A1A1A";
  ctx.beginPath();
  ctx.arc(size * 0.35, size * 0.42, 14, 0, Math.PI * 2);
  ctx.arc(size * 0.65, size * 0.42, 14, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "#1A1A1A";
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.arc(size / 2, size * 0.55, 40, 0.15 * Math.PI, 0.85 * Math.PI);
  ctx.stroke();
  ctx.fillStyle = "#FFF";
  ctx.font = "700 28px Arial";
  ctx.textAlign = "center";
  ctx.fillText(label, size / 2, size * 0.92);
  const buf = await canvas.encode("png");
  return `data:image/png;base64,${buf.toString("base64")}`;
}

async function main() {
  const outDir = "/tmp/duo-quote-previews";
  mkdirSync(outDir, { recursive: true });
  const avA = await makeAvatar("#F2C9A0", "A");
  const avB = await makeAvatar("#A0C4F2", "B");
  const a = {
    text: "This is a sample message for the dual quote preview.",
    displayName: "Username 1",
    handle: "user1",
    avatarUrl: avA,
    createdAt: new Date("2026-09-20T12:34:00"),
  };
  const b = {
    text: "And this is the reply that makes the whole thing funny.",
    displayName: "Username 2",
    handle: "user2",
    avatarUrl: avB,
    createdAt: new Date("2026-09-20T12:35:01"),
  };

  for (const theme of DUAL_QUOTE_STYLES) {
    const t0 = Date.now();
    const png = await renderDualQuoteCard({ a, b, theme });
    const ms = Date.now() - t0;
    if (!png) {
      console.error("FAIL", theme.id);
      continue;
    }
    const file = join(outDir, `${theme.id}.png`);
    writeFileSync(file, png);
    console.log(`OK  ${theme.id.padEnd(14)} ${png.length} bytes  ${ms}ms`);
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
