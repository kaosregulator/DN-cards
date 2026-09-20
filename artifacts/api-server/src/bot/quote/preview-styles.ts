/**
 * Offline preview for quote styles — writes PNGs under /tmp/quote-previews.
 * Usage: pnpm exec tsx src/bot/quote/preview-styles.ts
 */
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { QUOTE_STYLES, customFrom } from "./styles.js";
import { renderQuoteCard } from "./render.js";

async function main() {
  const outDir = "/tmp/quote-previews";
  mkdirSync(outDir, { recursive: true });

  const sampleCandidates = [
    "/home/ubuntu/.cursor/projects/workspace/assets/bd144b8f-e344-476c-9ee3-e178f953135a.webp",
    join(process.cwd(), "assets/brand/brand-logo.png"),
  ];
  let avatarUrl: string | null = null;
  for (const p of sampleCandidates) {
    if (existsSync(p)) {
      // Prefer a data URL so we don't need network for the avatar.
      const buf = readFileSync(p);
      const mime = p.endsWith(".webp") ? "image/webp" : "image/png";
      avatarUrl = `data:${mime};base64,${buf.toString("base64")}`;
      break;
    }
  }

  const payload = {
    text: "kaos u can see the asscrack",
    displayName: "le bob when?",
    handle: "everyone.__",
    avatarUrl,
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
