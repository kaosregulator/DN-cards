// ─────────────────────────────────────────────────────────────────────────────
// build-emoji-petpet — the classic "petpet": a hand pats the user's image while
// the image does the squish/bounce, on a TRANSPARENT background (no backdrop).
//
// Drop the hand animation into assets/emojimoji/src/petpet/<name>.gif and run:
//   node scripts/build-emoji-petpet.mjs
//
// The hand becomes the front overlay (green-keyed if it's a green screen, else
// its own transparency is kept). The user's image is squished per frame anchored
// at the bottom, synced to the hand's rhythm and speed (the hand is lowest at the
// middle of the loop, which is where the squish peaks).
//
// Emits into the SAME packs.json (petpet pack first) + packs/*.png.
// ─────────────────────────────────────────────────────────────────────────────
import sharp from "sharp";
import { readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

const HERE = new URL("../assets/emojimoji/", import.meta.url).pathname;
const SRC = join(HERE, "src", "petpet");
const OUTREL = "packs";
const S = 128;

const META = {
  petpet: { name: "Pet Pet", emoji: "🫳", desc: "There, there" },
};
const title = (s) => s.replace(/[-_]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
const isGreen = (r, g, b) => g > 90 && g > r * 1.45 && g > b * 1.35;
const r3 = (n) => Math.round(n * 1000) / 1000;

async function framesOf(p) {
  const m = await sharp(p, { animated: true }).metadata();
  const n = m.pages || 1;
  const delay = Array.isArray(m.delay) && m.delay[0] ? m.delay[0] : 60;
  const frames = [];
  for (let i = 0; i < n; i++) frames.push(await sharp(p, { page: i }).ensureAlpha().resize(S, S, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } }).raw().toBuffer());
  return { frames, delay };
}

const files = existsSync(SRC) ? readdirSync(SRC).filter((f) => /\.(gif|png|jpe?g)$/i.test(f)).sort() : [];
if (!files.length) { console.log("no hand animation in assets/emojimoji/src/petpet/ — add one and rerun."); process.exit(0); }

const petEffects = [];
for (const file of files) {
  const id = file.replace(/\.(gif|png|jpe?g)$/i, "").replace(/[^a-z0-9-]/gi, "-").toLowerCase();
  const { frames, delay } = await framesOf(join(SRC, file));

  // Decide whether the hand is on a green screen (key it) or already transparent.
  let greenPx = 0, opaquePx = 0;
  for (const F of frames) for (let i = 0; i < S * S; i++) { const j = i * 4; if (F[j + 3] > 40) { opaquePx++; if (isGreen(F[j], F[j + 1], F[j + 2])) greenPx++; } }
  const keyGreen = opaquePx > 0 && greenPx / opaquePx > 0.25;

  const sheet = Buffer.alloc(S * S * frames.length * 4, 0);
  for (let f = 0; f < frames.length; f++) {
    const F = frames[f], base = f * S * S * 4;
    for (let i = 0; i < S * S; i++) {
      const j = i * 4;
      if (F[j + 3] <= 40) continue;
      if (keyGreen && isGreen(F[j], F[j + 1], F[j + 2])) continue;
      sheet[base + j] = F[j]; sheet[base + j + 1] = F[j + 1]; sheet[base + j + 2] = F[j + 2]; sheet[base + j + 3] = F[j + 3];
    }
  }
  const sheetFile = `${OUTREL}/${id}.front.png`;
  await sharp(sheet, { raw: { width: S, height: S * frames.length, channels: 4 } }).png().toFile(join(HERE, sheetFile));

  // Classic petpet squish, bottom-anchored, peaking mid-loop (when the hand is
  // down). tri: 0 → 1 → 0 across the frames.
  const bb = [Math.round(S * 0.08), Math.round(S * 0.12), Math.round(S * 0.92), Math.round(S * 0.98)];
  const cx = (bb[0] + bb[2]) / 2, bottom = bb[3];
  const transforms = frames.map((_, i) => {
    const phase = frames.length > 1 ? i / (frames.length - 1) : 0;
    const tri = 1 - Math.abs(2 * phase - 1);
    const sx = 1 + 0.12 * tri;   // widen
    const sy = 1 - 0.20 * tri;   // shorten
    return [0, r3(sx), r3(sy), r3(cx), r3(bottom)];
  });

  const meta = META[id] ?? { name: title(id), emoji: "🫳", desc: "Petpet" };
  petEffects.push({
    id, name: meta.name, emoji: meta.emoji, desc: meta.desc, pack: "petpet",
    frames: frames.length, delayMs: Math.max(20, Math.round(delay / 10) * 10),
    transforms,
    layers: [{ kind: "base" }, { kind: "overlay", sheet: sheetFile }],
    bb, pivot: [r3(cx), r3(bottom)],
  });
  console.log(`${id.padEnd(14)} petpet frames=${frames.length} keyGreen=${keyGreen} delay=${delay}`);
}

const manifestPath = join(HERE, "packs.json");
let manifest = { tile: S, base: { bb: [0, 0, S, S], pivot: [S / 2, S / 2] }, effects: [] };
if (existsSync(manifestPath)) manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const others = manifest.effects.filter((e) => e.pack !== "petpet");
manifest.effects = [...petEffects, ...others];
writeFileSync(manifestPath, JSON.stringify(manifest));
console.log(`\nwrote packs.json — ${petEffects.length} petpet + ${others.length} others = ${manifest.effects.length}`);
