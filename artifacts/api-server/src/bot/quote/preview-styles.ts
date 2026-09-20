/**
 * Offline preview for quote styles — writes PNGs under /tmp/quote-previews.
 * Uses a SYNTHETIC square avatar (never an example quote card image).
 *
 * Usage: node ../../../../node_modules/tsx/dist/cli.mjs src/bot/quote/preview-styles.ts
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { getCanvas } from "../animations/engine.js";
import { QUOTE_STYLES, customFrom } from "./styles.js";
import { renderQuoteCard } from "./render.js";

/** Draw a simple cartoon face so styles are judged on layout, not colliding cards. */
async function makeSyntheticAvatarDataUrl(): Promise<string> {
  const mod = await getCanvas();
  if (!mod) throw new Error("@napi-rs/canvas unavailable");
  const size = 512;
  const canvas = mod.createCanvas(size, size);
  const ctx = canvas.getContext("2d");

  // Skin
  ctx.fillStyle = "#F2C9A0";
  ctx.fillRect(0, 0, size, size);

  // Hair
  ctx.fillStyle = "#2B1A12";
  ctx.beginPath();
  ctx.ellipse(size / 2, size * 0.22, size * 0.42, size * 0.28, 0, 0, Math.PI * 2);
  ctx.fill();

  // Eyes
  ctx.fillStyle = "#1A1A1A";
  ctx.beginPath();
  ctx.arc(size * 0.35, size * 0.45, 22, 0, Math.PI * 2);
  ctx.arc(size * 0.65, size * 0.45, 22, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#FFFFFF";
  ctx.beginPath();
  ctx.arc(size * 0.38, size * 0.43, 7, 0, Math.PI * 2);
  ctx.arc(size * 0.68, size * 0.43, 7, 0, Math.PI * 2);
  ctx.fill();

  // Smile
  ctx.strokeStyle = "#8B4513";
  ctx.lineWidth = 8;
  ctx.beginPath();
  ctx.arc(size / 2, size * 0.58, 70, 0.15 * Math.PI, 0.85 * Math.PI);
  ctx.stroke();

  // Shirt
  ctx.fillStyle = "#3B82F6";
  ctx.fillRect(0, size * 0.82, size, size * 0.18);

  const buf = await canvas.encode("png");
  return `data:image/png;base64,${buf.toString("base64")}`;
}

async function main() {
  const outDir = "/tmp/quote-previews";
  mkdirSync(outDir, { recursive: true });

  const avatarUrl = await makeSyntheticAvatarDataUrl();
  const payload = {
    text: "kaos u can see the asscrack",
    displayName: "le bob when?",
    handle: "everyone.__",
    avatarUrl,
    createdAt: new Date("2026-09-20T12:34:00"),
  };

  const themes = [...QUOTE_STYLES, customFrom("classic")];
  for (const theme of themes) {
    const t0 = Date.now();
    const png = await renderQuoteCard({ ...payload, theme, watermark: "Dex N Cards" });
    const ms = Date.now() - t0;
    if (!png) {
      console.error("FAIL", theme.id, "null buffer");
      continue;
    }
    const file = join(outDir, `${theme.id}.png`);
    writeFileSync(file, png);
    console.log(`OK  ${theme.id.padEnd(14)} ${png.length} bytes  ${ms}ms  → ${file}`);
  }
  console.log("done", pathToFileURL(outDir).href);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
