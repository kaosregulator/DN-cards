// Build downsampled battle-arena background strips from the Alenia Studios
// "Pixel Art Atmospheric" pack (CC BY 4.0 — credit Alenia Studios / KXLT; see
// assets/arenas/CREDITS.md). One-time generator: reads the raw 60-frame source
// spritesheets and emits a compact N-frame horizontal strip + manifest per
// arena into assets/arenas/. Only the derived, game-ready strips are committed.
//
// Usage:
//   node scripts/build-arenas.mjs "<path to 'Pixel Art Atmospheric' dir>"
//
// Source sheets are 60 frames of 320x180 laid out horizontally (19200x180).
// We keep the native 320x180 frame size (crisp pixel art) and sample FRAMES
// frames evenly; the battle canvas scales the strip to fill at draw time.

import sharp from "sharp";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const SRC_FRAME_W = 320, SRC_FRAME_H = 180, SRC_FRAMES = 60;
const FRAMES = 16; // sampled frames per arena

// key → { name, emoji, source file (without clima_ prefix / .png) }
const ARENAS = [
  { key: "aurora",   name: "Aurora Veil",     emoji: "🌌", src: "aurora_boreal" },
  { key: "embers",   name: "Ember Field",     emoji: "🔥", src: "chispas_fuego" },
  { key: "frost",    name: "Frostline",       emoji: "❄️", src: "nieve_cinematica" },
  { key: "storm",    name: "Thunderstorm",    emoji: "⛈️", src: "tormenta_electrica" },
  { key: "ashfall",  name: "Ashfall",         emoji: "🌋", src: "ceniza_volcanica" },
  { key: "godrays",  name: "Sunspire",        emoji: "🌅", src: "godrays" },
  { key: "meteor",   name: "Meteor Storm",    emoji: "☄️", src: "meteoritos" },
  { key: "fog",      name: "Fog of War",      emoji: "🌫️", src: "niebla_espesa" },
];

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, "..", "assets", "arenas");
const srcDir = process.argv[2];
if (!srcDir) { console.error("Pass the 'Pixel Art Atmospheric' directory as arg 1."); process.exit(1); }

mkdirSync(outDir, { recursive: true });

const manifest = { frameW: SRC_FRAME_W, frameH: SRC_FRAME_H, frames: FRAMES, arenas: [] };

for (const a of ARENAS) {
  const sheet = join(srcDir, "SpriteSheets", `clima_${a.src}.png`);
  // Sample FRAMES evenly-spaced source frames.
  const picks = Array.from({ length: FRAMES }, (_, i) => Math.round((i * (SRC_FRAMES - 1)) / (FRAMES - 1)));
  const tiles = [];
  for (let i = 0; i < picks.length; i++) {
    const buf = await sharp(sheet)
      .extract({ left: picks[i] * SRC_FRAME_W, top: 0, width: SRC_FRAME_W, height: SRC_FRAME_H })
      .png()
      .toBuffer();
    tiles.push({ input: buf, left: i * SRC_FRAME_W, top: 0 });
  }
  const out = join(outDir, `${a.key}.png`);
  await sharp({ create: { width: FRAMES * SRC_FRAME_W, height: SRC_FRAME_H, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite(tiles)
    .png({ compressionLevel: 9, palette: true })
    .toFile(out);
  manifest.arenas.push({ key: a.key, name: a.name, emoji: a.emoji });
  console.log(`✓ ${a.key} (${a.src}) → ${out}`);
}

writeFileSync(join(outDir, "manifest.json"), JSON.stringify(manifest, null, 2));
console.log(`✓ manifest.json (${manifest.arenas.length} arenas, ${FRAMES} frames each)`);
