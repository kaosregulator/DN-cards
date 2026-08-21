// ─────────────────────────────────────────────────────────────────────────────
// build-emoji-packs — turn the uploaded emoji-pack GIFs into reusable animation
// TEMPLATES that /emojimoji replays over the user's own image.
//
// Every pack GIF is the same base face animated in one of two ways:
//   • transform  — the face itself moves (spin / shake / nod / panic / oops / …).
//                  We recover a per-frame similarity transform (rotate/scale/move)
//                  from the base silhouette and replay it on the user's image.
//   • overlay    — the face stays put and a decoration animates over/around it
//                  (laser eyes, coffee, brain, confetti, sirens, sunglasses, …).
//                  We subtract the static base to lift just the decoration.
//
// Each template is an ORDERED list of layers (back overlay → base → front overlay),
// so a transformed base plus one or more independent overlays keeps its z-order.
// The base is NEVER shipped — only the extracted decoration sheets + transforms —
// so the user's image is what gets animated.
//
//   node scripts/build-emoji-packs.mjs
//
// Writes assets/emojimoji/packs/*.png (vertical decoration sheets) and packs.json.
// ─────────────────────────────────────────────────────────────────────────────
import sharp from "sharp";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { readdirSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const HERE = new URL("../assets/emojimoji/", import.meta.url).pathname;
const SRC = join(HERE, "src");
const OUT = join(HERE, "packs");
mkdirSync(OUT, { recursive: true });
const S = 128;

// Face MOVES in these (recover + replay the motion); everything else is a static
// face with an animated decoration on top.
const TRANSFORM = new Set(["spin", "shake", "nod", "panic", "lurk", "oops", "ship-it"]);
// Decoration that sits BEHIND the face (a backdrop), so the user image draws over it.
const BACKDROP = new Set(["party"]);

const EMOJI = {
  spin: "🌀", shake: "📳", nod: "🙂", panic: "😱", lurk: "👀", oops: "😬", "ship-it": "🚀",
  boom: "💥", "deal-with-it": "🕶️", hype: "🔥", "laser-eyes": "🔴", party: "🎉", rainbow: "🌈",
  approved: "✅", "big-brain": "🧠", "bless-up": "🙏", celebrate: "🎊", coffee: "☕", done: "👏",
  "fire-drill": "🚨", "heads-up": "🚨", "side-eye": "🫥", thinking: "💭",
};
const DESC = {
  spin: "Spins round and round", shake: "Rapid jitter", nod: "Nods along", panic: "Zooms in a panic",
  lurk: "Peeks up from behind a wall", oops: "Zoom of shame", "ship-it": "Launches off-screen",
  boom: "Big explosion", "deal-with-it": "Sunglasses drop in", hype: "HYPE banner", "laser-eyes": "Laser beams",
  party: "Party lights", rainbow: "Rainbow shimmer", approved: "Stamp of approval", "big-brain": "Galaxy brain",
  "bless-up": "Praying hands", celebrate: "Confetti", coffee: "Coffee break", done: "Slow clap",
  "fire-drill": "Siren alert", "heads-up": "Heads up!", "side-eye": "Side-eye", thinking: "Deep in thought",
};
const title = (slug) => slug.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

// ── raster helpers ─────────────────────────────────────────────────────────────
const rawOf = (buf) => sharp(buf).ensureAlpha().resize(S, S).raw().toBuffer();
async function framesOf(p) {
  const m = await sharp(p, { animated: true }).metadata();
  const n = m.pages || 1;
  const delay = Array.isArray(m.delay) && m.delay[0] ? m.delay[0] : 80;
  const frames = [];
  for (let i = 0; i < n; i++) frames.push(await sharp(p, { page: i }).ensureAlpha().resize(S, S).raw().toBuffer());
  return { frames, delay };
}
function silhouette(buf) {
  let sx = 0, sy = 0, a = 0, mnx = S, mny = S, mxx = 0, mxy = 0;
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    if (buf[(y * S + x) * 4 + 3] > 40) { sx += x; sy += y; a++; if (x < mnx) mnx = x; if (x > mxx) mxx = x; if (y < mny) mny = y; if (y > mxy) mxy = y; }
  }
  return a ? { cx: sx / a, cy: sy / a, area: a, bb: [mnx, mny, mxx, mxy] } : { cx: S / 2, cy: S / 2, area: 1, bb: [0, 0, S, S] };
}
function warpData(baseImg, bs, th, sc, cx, cy) {
  const c = createCanvas(S, S), x = c.getContext("2d");
  x.translate(cx, cy); x.rotate(th); x.scale(sc, sc); x.translate(-bs.cx, -bs.cy); x.drawImage(baseImg, 0, 0);
  return x.getImageData(0, 0, S, S).data;
}
function medResid(F, d) {
  const arr = [];
  for (let i = 0; i < S * S; i++) if (F[i * 4 + 3] > 40 && d[i * 4 + 3] > 40)
    arr.push(Math.abs(F[i * 4] - d[i * 4]) + Math.abs(F[i * 4 + 1] - d[i * 4 + 1]) + Math.abs(F[i * 4 + 2] - d[i * 4 + 2]));
  if (!arr.length) return 999;
  arr.sort((a, b) => a - b); return arr[arr.length >> 1];
}
function despeckle(data) {
  const m = new Uint8Array(S * S);
  for (let i = 0; i < S * S; i++) m[i] = data[i * 4 + 3] > 30 ? 1 : 0;
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    if (!m[y * S + x]) continue;
    let n = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue; const nx = x + dx, ny = y + dy;
      if (nx >= 0 && ny >= 0 && nx < S && ny < S && m[ny * S + nx]) n++;
    }
    if (n <= 2) data[(y * S + x) * 4 + 3] = 0;
  }
}

// ── base (shared by both packs) ──────────────────────────────────────────────
const baseBuf = await rawOf(join(SRC, "comm", "community-pack-base.png"));
const baseImg = await loadImage(await sharp(baseBuf, { raw: { width: S, height: S, channels: 4 } }).png().toBuffer());
const bs = silhouette(baseBuf);
const baseData = warpData(baseImg, bs, 0, 1, bs.cx, bs.cy);

// Per-frame similarity transform of the base → this frame (rotate/scale/translate).
function fitFrame(F) {
  const fst = silhouette(F);
  const sc = Math.sqrt(fst.area / bs.area);
  let th = 0, bm = 1e9;
  for (let d = 0; d < 360; d += 15) {
    const t = d * Math.PI / 180;
    const m = medResid(F, warpData(baseImg, bs, t, sc, fst.cx, fst.cy));
    if (m < bm) { bm = m; th = t; }
  }
  // refine ±10° around best
  for (let d = -10; d <= 10; d += 2) {
    const t = th + d * Math.PI / 180;
    const m = medResid(F, warpData(baseImg, bs, t, sc, fst.cx, fst.cy));
    if (m < bm) { bm = m; th = t; }
  }
  return { th, sc, cx: fst.cx, cy: fst.cy };
}

// Write a vertical decoration sheet from per-frame RGBA layers; null if all empty.
function writeSheet(id, tag, layers) {
  const n = layers.length;
  const sheet = Buffer.alloc(S * S * n * 4, 0);
  let any = false;
  for (let f = 0; f < n; f++) {
    const L = layers[f];
    for (let i = 0; i < S * S * 4; i++) { sheet[f * S * S * 4 + i] = L[i]; if (i % 4 === 3 && L[i] > 8) any = true; }
  }
  if (!any) return null;
  const file = `packs/${id}${tag}.png`;
  return sharp(sheet, { raw: { width: S, height: S * n, channels: 4 } }).png().toFile(join(HERE, file)).then(() => file);
}

const effects = [];
for (const pack of ["comm", "team"]) {
  const dir = join(SRC, pack);
  const gifs = readdirSync(dir).filter((f) => f.endsWith(".gif")).sort();
  for (const gif of gifs) {
    const slug = gif.replace(/^(community|team)-pack-/, "").replace(".gif", "");
    const { frames, delay } = await framesOf(join(dir, gif));
    const isXform = TRANSFORM.has(slug);

    const front = [], back = [];
    let transforms = null;

    if (isXform) {
      transforms = frames.map(fitFrame);
      // stable external decoration (foreground that is not the moving base) —
      // keeps e.g. lurk's wall, drops transient mis-alignment leaks.
      const stable = new Float32Array(S * S);
      const warped = transforms.map((p) => warpData(baseImg, bs, p.th, p.sc, p.cx, p.cy));
      for (let f = 0; f < frames.length; f++)
        for (let i = 0; i < S * S; i++) if (frames[f][i * 4 + 3] > 60 && warped[f][i * 4 + 3] < 40) stable[i]++;
      for (let i = 0; i < S * S; i++) stable[i] /= frames.length;
      for (let f = 0; f < frames.length; f++) {
        const F = frames[f], w = warped[f], out = Buffer.alloc(S * S * 4, 0);
        for (let i = 0; i < S * S; i++) {
          if (F[i * 4 + 3] > 60 && w[i * 4 + 3] < 40 && stable[i] > 0.5) {
            out[i * 4] = F[i * 4]; out[i * 4 + 1] = F[i * 4 + 1]; out[i * 4 + 2] = F[i * 4 + 2]; out[i * 4 + 3] = F[i * 4 + 3];
          }
        }
        despeckle(out); front.push(out);
      }
    } else {
      const toBack = BACKDROP.has(slug);
      for (let f = 0; f < frames.length; f++) {
        const F = frames[f], out = Buffer.alloc(S * S * 4, 0);
        for (let i = 0; i < S * S; i++) {
          const a = F[i * 4 + 3], wa = baseData[i * 4 + 3];
          const diff = Math.abs(F[i * 4] - baseData[i * 4]) + Math.abs(F[i * 4 + 1] - baseData[i * 4 + 1]) + Math.abs(F[i * 4 + 2] - baseData[i * 4 + 2]);
          if (a > 40 && (wa < 40 || diff > 140)) {
            out[i * 4] = F[i * 4]; out[i * 4 + 1] = F[i * 4 + 1]; out[i * 4 + 2] = F[i * 4 + 2]; out[i * 4 + 3] = a;
          }
        }
        despeckle(out); (toBack ? back : front).push(out);
      }
    }

    const backFile = back.length ? await writeSheet(slug, ".back", back) : null;
    const frontFile = front.length ? await writeSheet(slug, ".front", front) : null;

    const layers = [];
    if (backFile) layers.push({ kind: "overlay", sheet: backFile });
    layers.push({ kind: "base" });
    if (frontFile) layers.push({ kind: "overlay", sheet: frontFile });

    effects.push({
      id: slug, name: title(slug), emoji: EMOJI[slug] ?? "🪄", desc: DESC[slug] ?? `${title(pack === "comm" ? "community" : "team")} pack`,
      pack, frames: frames.length, delayMs: Math.max(20, Math.round(delay / 10) * 10),
      transforms: transforms ? transforms.map((p) => [round(p.th), round(p.sc), round(p.cx), round(p.cy)]) : null,
      layers,
    });
    console.log(`${(pack + "/" + slug).padEnd(22)} ${isXform ? "transform" : "overlay "} frames=${frames.length} back=${!!backFile} front=${!!frontFile}`);
  }
}
function round(n) { return Math.round(n * 1000) / 1000; }

const manifest = { tile: S, base: { bb: bs.bb, pivot: [round(bs.cx), round(bs.cy)] }, effects };
writeFileSync(join(HERE, "packs.json"), JSON.stringify(manifest));
console.log(`\nwrote packs.json — ${effects.length} effects`);
