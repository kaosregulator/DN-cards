// Extract the animated OVERLAY (sunglasses, lasers, tinfoil hat, "4K" frame …)
// out of pre-made emoji-pack GIFs, so /emojimoji can composite that overlay over
// the USER's image instead of the pack's base. Uses per-pixel median subtraction:
// the static base averages out across frames, leaving just the moving overlay —
// so no separate base image is needed and GIF re-quantization speckle is ignored.
//
//   node scripts/extract-emoji-overlays.mjs /path/to/extracted/packs
//
// Writes assets/emojimoji/<id>.png (a 128×(128·frames) vertical sprite sheet) and
// prints the {id, frames, delayMs} manifest to paste into effects.ts.
import sharp from "sharp";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const SRC = process.argv[2];
if (!SRC) { console.error("usage: node scripts/extract-emoji-overlays.mjs <packs-dir>"); process.exit(1); }
const OUT = new URL("../assets/emojimoji/", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const SIZE = 128;

// Which overlay effects to lift, and the source GIF for each. Median subtraction
// only isolates *moving* overlays cleanly (the base averages out); static
// overlays like the foil hat / "4K" viewfinder are drawn in effects.ts instead.
const OVERLAYS = [
  { id: "dealwithit", name: "Deal With It", emoji: "🕶️", gif: "comm/community-pack-deal-with-it.gif" },
  { id: "lasereyes", name: "Laser Eyes", emoji: "🔴", gif: "comm/community-pack-laser-eyes.gif" },
];

async function framesOf(gif) {
  const meta = await sharp(gif, { animated: true }).metadata();
  const n = meta.pages || 1;
  const delay = Array.isArray(meta.delay) && meta.delay[0] ? meta.delay[0] : 60;
  const frames = [];
  for (let i = 0; i < n; i++) {
    const { data } = await sharp(gif, { page: i }).ensureAlpha().resize(SIZE, SIZE).raw().toBuffer({ resolveWithObject: true });
    frames.push(data);
  }
  return { frames, delay };
}

function medianOf(frames) {
  const n = frames.length, px = SIZE * SIZE * 4;
  const med = Buffer.alloc(px);
  const col = new Array(n);
  for (let k = 0; k < px; k++) { for (let f = 0; f < n; f++) col[f] = frames[f][k]; col.sort((a, b) => a - b); med[k] = col[n >> 1]; }
  return med;
}

const manifest = [];
for (const ov of OVERLAYS) {
  const { frames, delay } = await framesOf(join(SRC, ov.gif));
  const med = medianOf(frames);
  // Stack the extracted overlay frames vertically into one sheet.
  const sheet = Buffer.alloc(SIZE * SIZE * frames.length * 4, 0);
  const rowStride = SIZE * 4;
  const mask = new Uint8Array(SIZE * SIZE); // per-frame overlay mask (for despeckle)
  const idx = (x, y) => y * SIZE + x;
  for (let f = 0; f < frames.length; f++) {
    const F = frames[f];
    mask.fill(0);
    for (let i = 0; i < SIZE * SIZE; i++) {
      const j = i * 4;
      const dr = Math.abs(F[j] - med[j]), dg = Math.abs(F[j + 1] - med[j + 1]), db = Math.abs(F[j + 2] - med[j + 2]);
      const medA = med[j + 3], frA = F[j + 3];
      if (dr + dg + db > 78 || (medA < 25 && frA > 60)) mask[i] = 1;
    }
    // Despeckle: drop overlay pixels with ≤1 overlay neighbour (isolated fur
    // dither) while keeping thin lines (frames, laser beams) that have 2+.
    const base = f * SIZE * rowStride;
    for (let y = 0; y < SIZE; y++) {
      for (let x = 0; x < SIZE; x++) {
        if (!mask[idx(x, y)]) continue;
        let n = 0;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          const nx = x + dx, ny = y + dy;
          if (nx >= 0 && ny >= 0 && nx < SIZE && ny < SIZE && mask[idx(nx, ny)]) n++;
        }
        if (n <= 1) continue;
        const j = idx(x, y) * 4, o = base + j;
        sheet[o] = F[j]; sheet[o + 1] = F[j + 1]; sheet[o + 2] = F[j + 2]; sheet[o + 3] = F[j + 3];
      }
    }
  }
  await sharp(sheet, { raw: { width: SIZE, height: SIZE * frames.length, channels: 4 } })
    .png().toFile(join(OUT, `${ov.id}.png`));
  manifest.push({ id: ov.id, name: ov.name, emoji: ov.emoji, frames: frames.length, delayMs: Math.max(20, Math.round(delay / 10) * 10) });
  console.log(`extracted ${ov.id.padEnd(12)} frames=${frames.length} delay=${delay}ms`);
}
writeFileSync(join(OUT, "manifest.json"), JSON.stringify(manifest, null, 2));
console.log("\nmanifest:\n" + JSON.stringify(manifest));
