// ─────────────────────────────────────────────────────────────────────────────
// build-emoji-greenscreen — the easy, reliable path. These template GIFs carry
// a GREEN-SCREEN slot: the green marks exactly where the user's image goes, and
// everything else is the foreground animation. We chroma-key the green to a hole
// and stamp the user's image behind it — no base alignment, no subtraction, no
// leftover traces.
//
// Drop any green-screen GIF into assets/emojimoji/src/green/<name>.gif and run:
//   node scripts/build-emoji-greenscreen.mjs
// Emits into the SAME packs.json (green pack first) + packs/*.png.
// ─────────────────────────────────────────────────────────────────────────────
import sharp from "sharp";
import { readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

const HERE = new URL("../assets/emojimoji/", import.meta.url).pathname;
const SRC = join(HERE, "src", "green");
const OUTREL = "packs";
const S = 128;
const CAP = 16;                    // frames kept per template (emoji-sized)

// Optional per-file display metadata; falls back to a title-cased name + 🎬.
const META = {
  tv: { name: "On TV", emoji: "📺", desc: "Playing on the screen" },
  scared: { name: "The Door", emoji: "😱", desc: "Revealed behind the door" },
};
const title = (s) => s.replace(/[-_]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

// A pixel is chroma-key green: green channel clearly dominant.
const isGreen = (r, g, b) => g > 90 && g > r * 1.45 && g > b * 1.35;

async function framesOf(p) {
  const m = await sharp(p, { animated: true }).metadata();
  const n = m.pages || 1;
  const delay = Array.isArray(m.delay) && m.delay[0] ? m.delay[0] : 80;
  const step = Math.max(1, Math.floor(n / CAP));
  const frames = [];
  for (let i = 0; i < n && frames.length < CAP; i += step) frames.push(await sharp(p, { page: i }).ensureAlpha().resize(S, S, { fit: "cover" }).raw().toBuffer());
  return { frames, delay: Math.min(delay * step, 200) };
}
const r3 = (n) => Math.round(n * 1000) / 1000;

const files = existsSync(SRC) ? readdirSync(SRC).filter((f) => f.endsWith(".gif")).sort() : [];
const greenEffects = [];
for (const file of files) {
  const id = file.replace(/\.gif$/, "").replace(/[^a-z0-9-]/gi, "-").toLowerCase();
  const { frames, delay } = await framesOf(join(SRC, file));

  // slot = union of every green pixel (where the user shows over the run)
  let mnx = S, mny = S, mxx = 0, mxy = 0, greenTotal = 0;
  for (const F of frames) for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const i = (y * S + x) * 4;
    if (isGreen(F[i], F[i + 1], F[i + 2])) { greenTotal++; if (x < mnx) mnx = x; if (x > mxx) mxx = x; if (y < mny) mny = y; if (y > mxy) mxy = y; }
  }
  if (greenTotal < 40) { console.log(`${id.padEnd(18)} SKIP — no green slot found`); continue; }

  // front sheet = each frame with the green keyed out (hole = the slot)
  const sheet = Buffer.alloc(S * S * frames.length * 4, 0);
  for (let f = 0; f < frames.length; f++) {
    const F = frames[f], base = f * S * S * 4;
    for (let i = 0; i < S * S; i++) {
      const j = i * 4;
      if (isGreen(F[j], F[j + 1], F[j + 2])) continue; // green → transparent slot
      sheet[base + j] = F[j]; sheet[base + j + 1] = F[j + 1]; sheet[base + j + 2] = F[j + 2]; sheet[base + j + 3] = F[j + 3];
    }
  }
  const sheetFile = `${OUTREL}/${id}.front.png`;
  await sharp(sheet, { raw: { width: S, height: S * frames.length, channels: 4 } }).png().toFile(join(HERE, sheetFile));

  const meta = META[id] ?? { name: title(id), emoji: "🎬", desc: "Green-screen scene" };
  greenEffects.push({
    id, name: meta.name, emoji: meta.emoji, desc: meta.desc, pack: "green",
    frames: frames.length, delayMs: Math.max(20, Math.round(delay / 10) * 10),
    transforms: null,
    layers: [{ kind: "base" }, { kind: "overlay", sheet: sheetFile }],
    bb: [mnx, mny, mxx, mxy].map(Math.round),
    pivot: [r3((mnx + mxx) / 2), r3((mny + mxy) / 2)],
  });
  console.log(`${id.padEnd(18)} green frames=${frames.length} slot=[${mnx},${mny},${mxx},${mxy}]`);
}

const manifestPath = join(HERE, "packs.json");
let manifest = { tile: S, base: { bb: [0, 0, S, S], pivot: [S / 2, S / 2] }, effects: [] };
if (existsSync(manifestPath)) manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const others = manifest.effects.filter((e) => e.pack !== "green");
manifest.effects = [...greenEffects, ...others];   // green pack first
writeFileSync(manifestPath, JSON.stringify(manifest));
console.log(`\nwrote packs.json — ${greenEffects.length} green + ${others.length} others = ${manifest.effects.length}`);
