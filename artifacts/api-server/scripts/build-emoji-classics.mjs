// ─────────────────────────────────────────────────────────────────────────────
// build-emoji-classics — bring back four centred-overlay effects that work over
// any image (no green screen): Rainbow, Caught in 4K, Laser Eyes, and Blame
// (pointing fingers + sweat). The user's image is the base; the effect is drawn
// or lifted onto a transparent overlay sheet on top.
//
//   node scripts/build-emoji-classics.mjs
// Emits into the SAME packs.json (classics pack) + packs/*.png.
// ─────────────────────────────────────────────────────────────────────────────
import sharp from "sharp";
import { createCanvas, loadImage, GlobalFonts } from "@napi-rs/canvas";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const HERE = new URL("../assets/emojimoji/", import.meta.url).pathname;
const SRC = join(HERE, "src", "classics");
const OUTREL = "packs";
const S = 128, C = S / 2, TAU = Math.PI * 2;
const r3 = (n) => Math.round(n * 1000) / 1000;

const EMOJI_FONT = "/usr/share/fonts/truetype/noto/NotoColorEmoji.ttf";
if (existsSync(EMOJI_FONT)) GlobalFonts.registerFromPath(EMOJI_FONT, "NotoEmoji");

async function writeSheet(id, layerCanvases) {
  const n = layerCanvases.length, sheet = Buffer.alloc(S * S * n * 4, 0);
  for (let f = 0; f < n; f++) {
    const d = layerCanvases[f].getContext("2d").getImageData(0, 0, S, S).data;
    Buffer.from(d.buffer, d.byteOffset, d.byteLength).copy(sheet, f * S * S * 4);
  }
  const file = `${OUTREL}/${id}.front.png`;
  await sharp(sheet, { raw: { width: S, height: S * n, channels: 4 } }).png().toFile(join(HERE, file));
  return file;
}
const effect = (o) => ({ pack: "classics", transforms: null, bb: [4, 4, S - 4, S - 4], pivot: [C, C], ...o });

// ── Caught in 4K: viewfinder brackets + blinking REC + 4K badge ────────────────
function caughtFrames(n) {
  const out = [];
  for (let f = 0; f < n; f++) {
    const t = f / n, c = createCanvas(S, S), x = c.getContext("2d");
    const m = 8, L = 26, w = 4;
    x.fillStyle = "#ffffff";
    x.fillRect(m, m, L, w); x.fillRect(m, m, w, L);
    x.fillRect(S - m - L, m, L, w); x.fillRect(S - m - w, m, w, L);
    x.fillRect(m, S - m - w, L, w); x.fillRect(m, S - m - L, w, L);
    x.fillRect(S - m - L, S - m - w, L, w); x.fillRect(S - m - w, S - m - L, w, L);
    if (Math.sin(t * TAU * 2) > -0.2) {
      x.fillStyle = "#ff3b30"; x.beginPath(); x.arc(m + 12, m + 42, 5, 0, TAU); x.fill();
      x.fillStyle = "#ffffff"; x.font = "bold 13px sans-serif"; x.textBaseline = "middle"; x.fillText("REC", m + 20, m + 42);
    }
    x.fillStyle = "#ffffff"; x.font = "bold 16px sans-serif"; x.textAlign = "right"; x.textBaseline = "bottom"; x.fillText("4K", S - m - 6, S - m - 6);
    out.push(c);
  }
  return out;
}

// ── Blame: pointing-finger emoji all around, jabbing in, + a sweat drop ─────────
function blameFrames(n) {
  const out = [];
  const fingers = 7, radius = 46;
  for (let f = 0; f < n; f++) {
    const t = f / n, jab = Math.abs(Math.sin(t * TAU)); // 0→1→0 poke
    const c = createCanvas(S, S), x = c.getContext("2d");
    x.font = "30px NotoEmoji"; x.textAlign = "center"; x.textBaseline = "middle";
    for (let i = 0; i < fingers; i++) {
      const a = (i / fingers) * TAU - Math.PI / 2;
      const r = radius + 12 - jab * 12;                 // fingers poke inward
      const fx = C + Math.cos(a) * r, fy = C + Math.sin(a) * r;
      x.save(); x.translate(fx, fy); x.rotate(a + Math.PI); // 👉 points toward centre
      x.fillText("👉", 0, 0); x.restore();
    }
    // sweat drop bobbing at the upper-right of the subject
    x.save(); x.translate(S - 34, 30 + jab * 5); x.font = "26px NotoEmoji"; x.fillText("💦", 0, 0); x.restore();
    out.push(c);
  }
  return out;
}

// ── Laser Eyes: lift the animated beams from the community-pack gif ─────────────
const isDiff = (F, B, i) => {
  const a = F[i * 4 + 3], ba = B[i * 4 + 3];
  const d = Math.abs(F[i * 4] - B[i * 4]) + Math.abs(F[i * 4 + 1] - B[i * 4 + 1]) + Math.abs(F[i * 4 + 2] - B[i * 4 + 2]);
  return a > 40 && (ba < 40 || d > 140);
};
async function laserFrames() {
  const base = await sharp(join(SRC, "cat-base.png")).ensureAlpha().resize(S, S).raw().toBuffer();
  const p = join(SRC, "laser-eyes.gif"), meta = await sharp(p, { animated: true }).metadata(), n = meta.pages || 1;
  const out = [], delay = Array.isArray(meta.delay) && meta.delay[0] ? meta.delay[0] : 60;
  for (let f = 0; f < n; f++) {
    const F = await sharp(p, { page: f }).ensureAlpha().resize(S, S).raw().toBuffer();
    const c = createCanvas(S, S), x = c.getContext("2d"), im = x.createImageData(S, S);
    for (let i = 0; i < S * S; i++) if (isDiff(F, base, i)) { const j = i * 4; im.data[j] = F[j]; im.data[j + 1] = F[j + 1]; im.data[j + 2] = F[j + 2]; im.data[j + 3] = F[j + 3]; }
    x.putImageData(im, 0, 0); out.push(c);
  }
  return { out, delay };
}

// ── assemble ────────────────────────────────────────────────────────────────
const effects = [];

// Rainbow — no sheet, the renderer cycles the image's colours.
effects.push(effect({ id: "rainbow", name: "Rainbow", emoji: "🌈", desc: "Cycles the image's colours", frames: 24, delayMs: 45, layers: [{ kind: "base" }], hueCycle: true }));

// Caught in 4K
{ const fr = caughtFrames(16); const sheet = await writeSheet("caught", fr);
  effects.push(effect({ id: "caught", name: "Caught in 4K", emoji: "📸", desc: "Recording viewfinder frame", frames: fr.length, delayMs: 70, layers: [{ kind: "base" }, { kind: "overlay", sheet }] })); }

// Laser Eyes
{ const { out, delay } = await laserFrames(); const sheet = await writeSheet("laser-eyes", out);
  effects.push(effect({ id: "laser-eyes", name: "Laser Eyes", emoji: "🔴", desc: "Laser beams from the eyes", frames: out.length, delayMs: Math.max(20, Math.round(delay / 10) * 10), layers: [{ kind: "base" }, { kind: "overlay", sheet }] })); }

// Blame (image slightly inset so the fingers ring it)
{ const fr = blameFrames(14); const sheet = await writeSheet("blame", fr);
  effects.push({ ...effect({ id: "blame", name: "Blame", emoji: "👉", desc: "Everyone's pointing… ugh", frames: fr.length, delayMs: 60, layers: [{ kind: "base" }, { kind: "overlay", sheet }] }), bb: [20, 20, S - 20, S - 20], pivot: [C, C] }); }

for (const e of effects) console.log(`${e.id.padEnd(12)} classics frames=${e.frames}${e.hueCycle ? " hueCycle" : ""}`);

const manifestPath = join(HERE, "packs.json");
let manifest = { tile: S, base: { bb: [0, 0, S, S], pivot: [C, C] }, effects: [] };
if (existsSync(manifestPath)) manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const others = manifest.effects.filter((e) => e.pack !== "classics");
manifest.effects = [...others, ...effects];   // classics after the green/petpet packs
writeFileSync(manifestPath, JSON.stringify(manifest));
console.log(`\nwrote packs.json — ${effects.length} classics + ${others.length} others = ${manifest.effects.length}`);
