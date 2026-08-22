// ─────────────────────────────────────────────────────────────────────────────
// build-emoji-scenes — borrow the "scene / reaction" meme GIFs (jail, pet, will-
// slap, pokéball, ditto, …) as /emojimoji templates. These GIFs are a cat
// placeholder inside a scene, so we STAMP the user's image into the cat's slot
// and keep the scene's own overlays/animation on top — we do NOT redraw or
// transform the user's image (makeemoji-style compositing).
//
// Method (per gif, one alignment — fast, not per-frame):
//   1. Align the shared cat base to this gif (scale+offset) using its median
//      frame (the static cat stays sharp; moving props blur out).
//   2. The cat's silhouette = the SLOT. The user's image is stamped there.
//   3. Overlay = the scene's props. To leave ZERO cat behind, we keep an overlay
//      blob only if it extends OUTSIDE the cat silhouette (bars, hands, Patrick,
//      toilet, ball all do); blobs living entirely inside the silhouette are cat
//      remnants (eyes/mouth) and are dropped. Props over the face survive because
//      they connect to the part that spills outside.
//
// Specials: ditto (Ditto animates, then the user pops in), door (user revealed
// behind an opening), pokéball (user emerges/unshrinks out of the ball).
//
// Emits into the SAME packs.json (scenes first) + packs/*.png.
//   node scripts/build-emoji-scenes.mjs
// ─────────────────────────────────────────────────────────────────────────────
import sharp from "sharp";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const HERE = new URL("../assets/emojimoji/", import.meta.url).pathname;
const SRC = join(HERE, "src", "scenes");
const OUTREL = "packs";
const S = 128;

const SCENES = [
  { id: "jail", name: "Jail", emoji: "🚔", desc: "Behind bars", cap: 10 },
  { id: "pet", name: "Headpat", emoji: "✋", desc: "There there", cap: 10 },
  { id: "will-slap", name: "Slap", emoji: "🤚", desc: "Oscar-night slap", cap: 10 },
  { id: "cat-slap", name: "Cat Slap", emoji: "🐱", desc: "Smacked by a cat", cap: 10 },
  { id: "boooo", name: "Booo", emoji: "👻", desc: "Booed off", cap: 12 },
  { id: "pokeball-emerge", name: "Pokéball", emoji: "🔴", desc: "Emerge from the ball", special: "emerge", cap: 14 },
  { id: "ditto", name: "Ditto", emoji: "🟣", desc: "Transform out of Ditto", special: "ditto" },
  { id: "peepo-poopoo", name: "Throne", emoji: "🚽", desc: "On the throne", cap: 10 },
  { id: "taking-notes", name: "Taking Notes", emoji: "📝", desc: "Noted.", cap: 10 },
  { id: "typing", name: "Typing", emoji: "⌨️", desc: "Furious typing", cap: 10 },
  { id: "touch-grass", name: "Touch Grass", emoji: "🌱", desc: "Please touch grass", cap: 10 },
  { id: "cleaning", name: "Cleaning", emoji: "🧽", desc: "Scrub scrub", cap: 12 },
  { id: "runn", name: "Run", emoji: "🏃", desc: "Run for it", cap: 14 },
  // courage-scream dropped: it's a full 265-frame cartoon clip with the cat baked
  // in at full frame, so there is no clean slot to stamp into (would show the cat).
];

// ── raster helpers ────────────────────────────────────────────────────────────
const rawOf = (buf) => sharp(buf).ensureAlpha().resize(S, S).raw().toBuffer();
async function framesOf(p, cap) {
  const m = await sharp(p, { animated: true }).metadata();
  const n = m.pages || 1;
  const delay = Array.isArray(m.delay) && m.delay[0] ? m.delay[0] : 70;
  const step = Math.max(1, Math.floor(n / cap));
  const frames = [];
  for (let i = 0; i < n && frames.length < cap; i += step) frames.push(await sharp(p, { page: i }).ensureAlpha().resize(S, S).raw().toBuffer());
  return { frames, delay: Math.min(delay * step, 200), pages: n };
}
async function framesRange(p, from, to, count) {
  const frames = [];
  for (let k = 0; k < count; k++) frames.push(await sharp(p, { page: Math.round(from + (to - from) * (k / (count - 1))) }).ensureAlpha().resize(S, S).raw().toBuffer());
  return frames;
}
function medianFrame(frames) {
  const out = Buffer.alloc(S * S * 4);
  const col = new Array(frames.length);
  for (let k = 0; k < S * S * 4; k++) { for (let f = 0; f < frames.length; f++) col[f] = frames[f][k]; col.sort((a, b) => a - b); out[k] = col[col.length >> 1]; }
  return out;
}
function silh(b) {
  let sx = 0, sy = 0, a = 0, mnx = S, mny = S, mxx = 0, mxy = 0;
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) if (b[(y * S + x) * 4 + 3] > 40) { sx += x; sy += y; a++; if (x < mnx) mnx = x; if (x > mxx) mxx = x; if (y < mny) mny = y; if (y > mxy) mxy = y; }
  return a ? { cx: sx / a, cy: sy / a, area: a, bb: [mnx, mny, mxx, mxy] } : { cx: S / 2, cy: S / 2, area: 1, bb: [0, 0, S, S] };
}
function warp(baseImg, bs, sc, tx, ty) {
  const c = createCanvas(S, S), x = c.getContext("2d");
  x.translate(bs.cx + tx, bs.cy + ty); x.scale(sc, sc); x.translate(-bs.cx, -bs.cy); x.drawImage(baseImg, 0, 0);
  return x.getImageData(0, 0, S, S).data;
}
function score(F, w) {
  const arr = [];
  for (let i = 0; i < S * S; i++) if (w[i * 4 + 3] > 60) arr.push(F[i * 4 + 3] < 30 ? 300 : Math.abs(F[i * 4] - w[i * 4]) + Math.abs(F[i * 4 + 1] - w[i * 4 + 1]) + Math.abs(F[i * 4 + 2] - w[i * 4 + 2]));
  if (!arr.length) return 1e9;
  arr.sort((a, b) => a - b); return arr[Math.floor(arr.length * 0.6)];
}
// One alignment of the cat base to a target frame (the gif's median).
function alignBase(baseImg, bs, target) {
  let best = { sc: 1, tx: 0, ty: 0, s: 1e9 };
  for (let sc = 0.55; sc <= 1.3; sc += 0.05) for (let tx = -24; tx <= 24; tx += 6) for (let ty = -24; ty <= 24; ty += 6) {
    const s = score(target, warp(baseImg, bs, sc, tx, ty)); if (s < best.s) best = { sc, tx, ty, s };
  }
  return warp(baseImg, bs, best.sc, best.tx, best.ty);
}
// Keep overlay blobs that spill OUTSIDE the cat (real props); drop blobs living
// entirely inside it (cat remnants). `outside[i]` = pixel is beyond the cat.
function keepProps(mask, outside) {
  const seen = new Uint8Array(S * S), keep = new Uint8Array(S * S);
  for (let start = 0; start < S * S; start++) {
    if (!mask[start] || seen[start]) continue;
    const stack = [start], cells = []; seen[start] = 1; let touchesOutside = false;
    while (stack.length) {
      const i = stack.pop(); cells.push(i); if (outside[i]) touchesOutside = true;
      const x = i % S, y = (i / S) | 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy; if (nx < 0 || ny < 0 || nx >= S || ny >= S) continue;
        const j = ny * S + nx; if (mask[j] && !seen[j]) { seen[j] = 1; stack.push(j); }
      }
    }
    // Keep a blob if it spills outside the cat (a real prop) OR is large (a big
    // foreground object like SpongeBob when the cat fills the frame). Small
    // interior blobs are cat remnants → dropped.
    if ((touchesOutside && cells.length > 12) || cells.length > 320) for (const i of cells) keep[i] = 1;
  }
  return keep;
}
function despeckle(data) {
  const m = new Uint8Array(S * S);
  for (let i = 0; i < S * S; i++) m[i] = data[i * 4 + 3] > 30 ? 1 : 0;
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    if (!m[y * S + x]) continue; let n = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { if (!dx && !dy) continue; const nx = x + dx, ny = y + dy; if (nx >= 0 && ny >= 0 && nx < S && ny < S && m[ny * S + nx]) n++; }
    if (n <= 2) data[(y * S + x) * 4 + 3] = 0;
  }
}
async function writeSheet(id, tag, layerRGBA) {
  const n = layerRGBA.length, sheet = Buffer.alloc(S * S * n * 4, 0); let any = false;
  for (let f = 0; f < n; f++) { layerRGBA[f].copy(sheet, f * S * S * 4); for (let i = 3; i < S * S * 4; i += 4) if (layerRGBA[f][i] > 8) any = true; }
  if (!any) return null;
  const file = `${OUTREL}/${id}${tag}.png`;
  await sharp(sheet, { raw: { width: S, height: S * n, channels: 4 } }).png().toFile(join(HERE, file));
  return file;
}
const r3 = (n) => Math.round(n * 1000) / 1000;

// ── base (shared cat) ─────────────────────────────────────────────────────────
const baseBuf = await rawOf(join(HERE, "src", "comm", "community-pack-base.png"));
const baseImg = await loadImage(await sharp(baseBuf, { raw: { width: S, height: S, channels: 4 } }).png().toBuffer());
const bs = silh(baseBuf);

// Align the cat base to a gif and lift the props for every frame; returns
// { front:[rgba], slotBB, aligned }.
function liftProps(frames, aligned) {
  const outside = new Uint8Array(S * S);
  for (let i = 0; i < S * S; i++) if (aligned[i * 4 + 3] < 40) outside[i] = 1;
  const front = [];
  for (const F of frames) {
    const mask = new Uint8Array(S * S);
    for (let i = 0; i < S * S; i++) {
      if (F[i * 4 + 3] <= 50) continue;
      const wa = aligned[i * 4 + 3];
      const diff = Math.abs(F[i * 4] - aligned[i * 4]) + Math.abs(F[i * 4 + 1] - aligned[i * 4 + 1]) + Math.abs(F[i * 4 + 2] - aligned[i * 4 + 2]);
      if (wa < 40 || diff > 150) mask[i] = 1;   // outside cat, or clearly not the cat
    }
    const keep = keepProps(mask, outside);
    const out = Buffer.alloc(S * S * 4, 0);
    for (let i = 0; i < S * S; i++) if (keep[i]) { out[i * 4] = F[i * 4]; out[i * 4 + 1] = F[i * 4 + 1]; out[i * 4 + 2] = F[i * 4 + 2]; out[i * 4 + 3] = F[i * 4 + 3]; }
    despeckle(out);
    front.push(out);
  }
  return front;
}

async function buildStamp(cfg, opts = {}) {
  const { frames, delay } = await framesOf(join(SRC, `${cfg.id}.gif`), cfg.cap);
  const aligned = alignBase(baseImg, bs, medianFrame(frames));
  const slot = silh(aligned);                       // where the cat was → the slot
  const front = liftProps(frames, aligned);
  const frontFile = await writeSheet(cfg.id, ".front", front);
  const layers = [{ kind: "base" }]; if (frontFile) layers.push({ kind: "overlay", sheet: frontFile });
  let transforms = null;
  if (opts.emerge) {                                // user unshrinks out of the ball
    const [cx, cy] = [(slot.bb[0] + slot.bb[2]) / 2, (slot.bb[1] + slot.bb[3]) / 2];
    transforms = front.map((_, f) => {
      const t = f / (front.length - 1);
      const sc = t < 0.75 ? 0.15 + (t / 0.75) * 0.9 : 1.05;
      return [0, r3(sc), r3(cx), r3(cy)];
    });
  }
  return effect(cfg, front.length, delay, transforms, layers, slot.bb, [(slot.bb[0] + slot.bb[2]) / 2, (slot.bb[1] + slot.bb[3]) / 2]);
}

async function buildDitto(cfg) {
  const p = join(SRC, "ditto.gif");
  const dframes = await framesRange(p, 0, 22, 6);   // Ditto wobble
  const cat = await framesRange(p, 34, 60, 4);      // its own placeholder → slot position
  const aligned = alignBase(baseImg, bs, medianFrame(cat));
  const slot = silh(aligned);
  const nPop = 6, front = [], transforms = [];
  for (const F of dframes) {
    const out = Buffer.alloc(S * S * 4, 0);
    for (let i = 0; i < S * S; i++) if (F[i * 4 + 3] > 50) { out[i * 4] = F[i * 4]; out[i * 4 + 1] = F[i * 4 + 1]; out[i * 4 + 2] = F[i * 4 + 2]; out[i * 4 + 3] = F[i * 4 + 3]; }
    despeckle(out); front.push(out); transforms.push([0, 0, slot.cx, slot.cy]);   // user hidden
  }
  const [cx, cy] = [(slot.bb[0] + slot.bb[2]) / 2, (slot.bb[1] + slot.bb[3]) / 2];
  for (let k = 0; k < nPop; k++) {
    front.push(Buffer.alloc(S * S * 4, 0));
    const t = k / (nPop - 1);
    const sc = t < 0.7 ? 0.4 + (t / 0.7) * 0.75 : 1.15 - ((t - 0.7) / 0.3) * 0.15;
    transforms.push([0, r3(sc), r3(cx), r3(cy)]);
  }
  const frontFile = await writeSheet(cfg.id, ".front", front);
  const layers = [{ kind: "base" }]; if (frontFile) layers.push({ kind: "overlay", sheet: frontFile });
  return effect(cfg, front.length, 90, transforms, layers, slot.bb, [cx, cy]);
}

async function buildDoor(cfg) {
  const { frames, delay } = await framesOf(join(SRC, `${cfg.id}.gif`), cfg.cap);
  const door = [Math.round(S * 0.36), Math.round(S * 0.30), Math.round(S * 0.66), Math.round(S * 0.86)];
  const front = [];
  for (const F of frames) {
    const out = Buffer.from(F);
    for (let y = door[1]; y < door[3]; y++) for (let x = door[0]; x < door[2]; x++) {
      const i = (y * S + x) * 4;
      if (0.3 * F[i] + 0.59 * F[i + 1] + 0.11 * F[i + 2] < 70) out[i + 3] = 0;   // dark opening → reveal user
    }
    front.push(out);
  }
  const frontFile = await writeSheet(cfg.id, ".front", front);
  const layers = [{ kind: "base" }]; if (frontFile) layers.push({ kind: "overlay", sheet: frontFile });
  return effect(cfg, frames.length, delay, frames.map(() => [0, 1, (door[0] + door[2]) / 2, (door[1] + door[3]) / 2]), layers, door, [(door[0] + door[2]) / 2, (door[1] + door[3]) / 2]);
}

function effect(cfg, frames, delayMs, transforms, layers, bb, pivot) {
  return { id: cfg.id, name: cfg.name, emoji: cfg.emoji, desc: cfg.desc, pack: "scenes", frames, delayMs: Math.max(20, Math.round(delayMs / 10) * 10), transforms, layers, bb: bb.map((n) => Math.round(n)), pivot: pivot.map(r3) };
}

// ── run ───────────────────────────────────────────────────────────────────────
const sceneEffects = [];
for (const cfg of SCENES) {
  const eff = cfg.special === "ditto" ? await buildDitto(cfg) : cfg.special === "door" ? await buildDoor(cfg) : await buildStamp(cfg, { emerge: cfg.special === "emerge" });
  sceneEffects.push(eff);
  console.log(`${cfg.id.padEnd(18)} ${(cfg.special ?? "stamp").padEnd(8)} frames=${eff.frames} slot=[${eff.bb}]`);
}

const manifestPath = join(HERE, "packs.json");
let manifest = { tile: S, base: { bb: bs.bb, pivot: [r3(bs.cx), r3(bs.cy)] }, effects: [] };
if (existsSync(manifestPath)) manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const others = manifest.effects.filter((e) => e.pack !== "scenes");
manifest.effects = [...sceneEffects, ...others];
writeFileSync(manifestPath, JSON.stringify(manifest));
console.log(`\nwrote packs.json — ${sceneEffects.length} scenes + ${others.length} others = ${manifest.effects.length}`);
