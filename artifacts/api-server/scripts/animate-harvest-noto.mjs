#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// Harvest Noto animated-emoji MOTION into the /animate motion library.
//
// For each emoji codepoint it downloads the real Lottie
// (fonts.gstatic.com/s/e/notoemoji/latest/<cp>/lottie.json), reads each layer's
// keyframed transform, and converts it into a normalized, resolution-independent
// MotionTrack: motion RELATIVE to the layer's rest pose, tagged by the emoji's
// name and the layer's role (eyes/mouth/brows/global). ONLY the motion is
// extracted — never the artwork — so the tracks re-animate the user's own emoji.
//
// Output: data/noto-motion-library.json, merged over the builtin tracks at
// runtime (see library/motion-library.ts). Fetches go through `curl` so the
// environment's HTTPS proxy is honored.
//
//   node scripts/animate-harvest-noto.mjs            # curated face set
//   node scripts/animate-harvest-noto.mjs --all      # include the extended set
//   node scripts/animate-harvest-noto.mjs 1f600 1f971 …   # explicit codepoints
// ─────────────────────────────────────────────────────────────────────────────

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const exec = promisify(execFile);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(HERE, "../data/noto-motion-library.json");

// Expressive faces are the richest motion source (blinks, yawns, mouths); a few
// animals/objects add head/body motion. Extend freely — every emoji contributes.
const CORE = [
  "1f600","1f603","1f604","1f601","1f606","1f605","1f923","1f602","1f642","1f643",
  "1f609","1f60a","1f607","1f970","1f60d","1f929","1f618","1f617","1f61a","1f619",
  "1f60b","1f61b","1f61c","1f92a","1f61d","1f911","1f917","1f92d","1f92b","1f914",
  "1f910","1f610","1f611","1f636","1f60f","1f612","1f644","1f62c","1f925","1f60c",
  "1f614","1f62a","1f924","1f634","1f637","1f912","1f915","1f922","1f92e","1f927",
  "1f975","1f976","1f974","1f635","1f92f","1f920","1f973","1f60e","1f913","1f9d0",
  "1f615","1f61f","1f641","2639","1f62e","1f62f","1f632","1f633","1f97a","1f626",
  "1f627","1f628","1f630","1f625","1f622","1f62d","1f631","1f616","1f623","1f61e",
  "1f613","1f629","1f62b","1f971","1f624","1f621","1f620","1f92c","1f608","1f47f",
];
const EXTENDED = [
  "1f436","1f431","1f439","1f42d","1f430","1f43b","1f43c","1f428","1f42f","1f981",
  "1f42e","1f437","1f438","1f435","1f648","1f649","1f64a","1f47b","1f47d","1f916",
  "1f383","1f4a9","1f921","1f479","1f480","2764","1f494","1f4a5","1f4ab","2b50",
];

function argsCodepoints() {
  const args = process.argv.slice(2);
  const explicit = args.filter(a => !a.startsWith("--"));
  if (explicit.length) return explicit;
  return args.includes("--all") ? [...CORE, ...EXTENDED] : CORE;
}

// ── Lottie helpers ───────────────────────────────────────────────────────────

/** Cubic-bezier ease [ox,oy,ix,iy] from a keyframe pair's out/in handles. */
function easeOf(kf, next) {
  if (!kf || !kf.o || !next || !next.i) return undefined;
  const ox = Array.isArray(kf.o.x) ? kf.o.x[0] : kf.o.x;
  const oy = Array.isArray(kf.o.y) ? kf.o.y[0] : kf.o.y;
  const ix = Array.isArray(next.i.x) ? next.i.x[0] : next.i.x;
  const iy = Array.isArray(next.i.y) ? next.i.y[0] : next.i.y;
  if ([ox, oy, ix, iy].some(v => typeof v !== "number")) return undefined;
  return [ox, oy, ix, iy];
}

/** Sample a scalar dimension `dim` of an animated property into keyframes. */
function scalarKeyframes(prop, dim, ip, op, transform) {
  if (!prop || prop.a !== 1 || !Array.isArray(prop.k)) return null;
  const span = op - ip || 1;
  const out = [];
  const kfs = prop.k;
  for (let i = 0; i < kfs.length; i++) {
    const kf = kfs[i];
    if (typeof kf.t !== "number") continue;
    const s = Array.isArray(kf.s) ? kf.s[dim] : kf.s;
    if (typeof s !== "number") continue;
    const t = Math.min(1, Math.max(0, (kf.t - ip) / span));
    out.push({ t, raw: s, ease: easeOf(kf, kfs[i + 1]) });
  }
  if (out.length < 2) return null;
  const rest = out[0].raw;
  const kf = out.map(k => {
    const v = transform(k.raw, rest);
    return k.ease ? { t: round(k.t), v: round(v), ease: k.ease.map(round) } : { t: round(k.t), v: round(v) };
  });
  // Ensure a closed loop for seamless playback: append rest at t=1 if absent.
  if (kf[kf.length - 1].t < 0.999) kf.push({ t: 1, v: kf[0].v });
  return dedupeFlat(kf);
}

function round(n) { return Math.round(n * 10000) / 10000; }

/** Drop a curve that never actually moves. */
function dedupeFlat(kf) {
  const moved = kf.some(k => Math.abs(k.v - kf[0].v) > 1e-4);
  return moved ? kf : null;
}

const LAYER_REGION = [
  [/\b(all|head|face|null|root|body|base)\b/i, "global"],
  [/brow|eyebrow/i, "brows"],
  [/(^|[^a-z])eye|lid|lash|pupil|iris/i, "eyes"],
  [/mouth|lip|teeth|tongue|jaw/i, "mouth"],
  [/cheek|blush|tear/i, "cheeks"],
];
function regionForLayer(nm) {
  for (const [re, region] of LAYER_REGION) if (re.test(nm || "")) return region;
  return "global";
}

// Mirror of NAME_MAP in library/tags.ts — keep in sync so harvested tracks carry
// the same canonical tags the planner's gesture presets search for.
const NAME_MAP = {
  yawning: ["yawn", "tired", "open", "sleepy"], sleeping: ["sleepy", "tired", "close"],
  sleepy: ["sleepy", "tired"], tired: ["tired", "sleepy"],
  grinning: ["grin", "happy", "smile", "open"], grin: ["grin", "happy", "smile"],
  beaming: ["grin", "happy", "smile", "wide"], smiling: ["smile", "happy"], smile: ["smile", "happy"],
  laughing: ["laugh", "happy", "open", "tears"], joy: ["laugh", "happy", "tears"], rofl: ["laugh", "happy", "tilt"],
  crying: ["cry", "sad", "tears"], sobbing: ["cry", "sad", "tears", "open"], loudly: ["cry", "open", "tears"],
  sad: ["sad", "worry"], frowning: ["sad", "worry"], pensive: ["sad", "think"], disappointed: ["sad"],
  angry: ["angry", "mad", "furrow"], pouting: ["angry", "mad", "pout", "furrow"], rage: ["angry", "mad", "shout"],
  screaming: ["shock", "fear", "open", "wide"], fearful: ["fear", "shock", "widen"], anguished: ["fear", "open"],
  astonished: ["surprise", "shock", "open", "wide"], surprised: ["surprise", "shock", "widen", "open"],
  hushed: ["surprise", "open"], gasping: ["gasp", "surprise", "open"], open: ["open", "surprise"],
  flushed: ["shock", "widen"], hearts: ["love", "happy"], kissing: ["kiss", "love", "pout"], kiss: ["kiss", "love", "pout"],
  wink: ["wink", "silly", "blink"], winking: ["wink", "silly", "blink"], tongue: ["silly", "open"],
  zany: ["silly", "wink", "wobble"], goofy: ["silly", "wink"], smirking: ["smirk", "smug"],
  unamused: ["neutral", "roll", "smug"], rolling: ["roll", "silly"], expressionless: ["neutral", "close"],
  neutral: ["neutral"], thinking: ["think", "smirk"], raised: ["raise", "smug", "think"], eyebrow: ["raise", "brows"],
  confused: ["confused", "tilt"], dizzy: ["dizzy", "spin", "roll"], woozy: ["dizzy", "wobble"],
  exploding: ["shock", "open"], cold: ["cold", "shiver"], freezing: ["cold", "shiver", "shake"], hot: ["hot", "open"],
  sneezing: ["sneeze", "sick"], sick: ["sick"], nauseated: ["sick"], vomiting: ["sick", "open"],
  cowboy: ["cool", "smile"], sunglasses: ["cool", "smug"], partying: ["party", "happy"], singing: ["sing", "open", "happy"],
  yelling: ["yell", "shout", "open", "wide"], relieved: ["neutral", "close"], drooling: ["silly", "open"],
  shaking: ["shake", "quake", "shock"], nodding: ["nod"], spinning: ["spin"],
};
function tagsFromName(name) {
  const words = String(name).toLowerCase().replace(/^emoji[_ ]*/i, "").split(/[^a-z0-9]+/).filter(Boolean);
  const set = new Set(words);
  for (const w of words) for (const t of (NAME_MAP[w] || [])) set.add(t);
  return [...set];
}

function categorize(region, tags) {
  if (region === "effect") return "effect";
  if (region === "eyes" || region === "brows" || region === "cheeks") return "face";
  if (region === "mouth") return "mouth";
  const full = ["spin", "wobble", "float", "bob", "bounce", "shiver", "quake", "zoom", "pulse"];
  if (tags.some(t => full.includes(t))) return "full";
  return "head";
}

/** Build channel curves for one layer's transform. */
function channelsFor(ks, region, ip, op) {
  const ch = {};
  // Position (combined [x,y] or split .x/.y).
  const p = ks.p;
  let xProp = null, yProp = null;
  if (p) {
    if (p.s === true) { xProp = p.x; yProp = p.y; }
    else { xProp = p; yProp = p; }
  }
  const w = ks.__w || 1024, h = ks.__h || 1024;
  const tx = xProp && scalarKeyframes(xProp, p && p.s === true ? 0 : 0, ip, op, (v, r) => (v - r) / w);
  const ty = yProp && scalarKeyframes(yProp, p && p.s === true ? 0 : 1, ip, op, (v, r) => (v - r) / h);
  if (tx) ch.tx = tx;
  if (ty) ch.ty = ty;
  // Scale [sx,sy] as ratio to rest.
  const sx = scalarKeyframes(ks.s, 0, ip, op, (v, r) => (r ? v / r : 1));
  const sy = scalarKeyframes(ks.s, 1, ip, op, (v, r) => (r ? v / r : 1));
  if (region === "global") {
    if (sx) ch.scaleX = sx;
    if (sy) ch.scaleY = sy;
    const rot = scalarKeyframes(ks.r, 0, ip, op, (v, r) => (v - r) * Math.PI / 180);
    if (rot) ch.rotate = rot;
  } else {
    // Warp regions: vertical scale reads as squash (blink/open); keep horizontal.
    if (sy) ch.squashY = sy;
    if (sx) ch.scaleX = sx;
  }
  const alpha = scalarKeyframes(ks.o, 0, ip, op, (v) => v / 100);
  if (alpha) ch.alpha = alpha;
  return ch;
}

function peakIntensity(channels) {
  let peak = 0;
  for (const [name, kf] of Object.entries(channels)) {
    const rest = name === "scaleX" || name === "scaleY" || name === "squashY" || name === "alpha" ? 1 : 0;
    for (const k of kf) {
      let dev = Math.abs(k.v - rest);
      if (name === "rotate") dev /= Math.PI;
      if (dev > peak) peak = dev;
    }
  }
  return Math.min(1, Math.round(peak * 1000) / 1000);
}

async function fetchLottie(cp) {
  const url = `https://fonts.gstatic.com/s/e/notoemoji/latest/${cp}/lottie.json`;
  try {
    const { stdout } = await exec("curl", ["-fsS", "--max-time", "30", url], { maxBuffer: 64 * 1024 * 1024 });
    return { url, json: JSON.parse(stdout) };
  } catch {
    return null;
  }
}

function glyphOf(cp) {
  try { return String.fromCodePoint(...cp.split("_").map(h => parseInt(h, 16))); }
  catch { return "❓"; }
}

async function harvest() {
  const codepoints = argsCodepoints();
  const tracks = [];
  let emojiCount = 0;

  for (const cp of codepoints) {
    const res = await fetchLottie(cp);
    if (!res) { process.stderr.write(`  skip ${cp} (no lottie)\n`); continue; }
    const { url, json } = res;
    const name = String(json.nm || "").replace(/^emoji_/i, "") || cp;
    const glyph = glyphOf(cp);
    const nameTags = tagsFromName(name);
    const ip = json.ip ?? 0, op = json.op ?? 1;
    emojiCount++;

    const perRegion = {};
    for (let li = 0; li < (json.layers || []).length; li++) {
      const layer = json.layers[li];
      if (!layer || !layer.ks) continue;
      const region = regionForLayer(layer.nm);
      if (perRegion[region]) continue; // one track per region per emoji
      layer.ks.__w = json.w; layer.ks.__h = json.h;
      const channels = channelsFor(layer.ks, region, ip, op);
      if (Object.keys(channels).length === 0) continue;
      const tags = [...new Set([...nameTags, ...tagsFromName(layer.nm || "")])];
      const track = {
        id: `noto:${cp}:${region}`,
        region,
        category: categorize(region, tags),
        name: region === "global" ? name : `${name} ${region}`,
        emoji: glyph,
        tags,
        source: { name, glyph, origin: "noto", license: "Apache-2.0", codepoint: cp, url },
        channels,
        intensity: peakIntensity(channels),
      };
      if (track.intensity < 0.01) continue; // no meaningful motion
      perRegion[region] = track;
    }
    for (const t of Object.values(perRegion)) tracks.push(t);
    process.stderr.write(`  ${cp} ${glyph} ${name} → ${Object.keys(perRegion).length} track(s)\n`);
  }

  const file = {
    version: 1,
    builtAt: new Date().toISOString(),
    emojiCount,
    tracks,
  };
  await mkdir(path.dirname(OUT), { recursive: true });
  await writeFile(OUT, JSON.stringify(file, null, 0));
  process.stderr.write(`\nHarvested ${tracks.length} motion tracks from ${emojiCount} emoji → ${OUT}\n`);
}

harvest().catch(err => { console.error(err); process.exit(1); });
