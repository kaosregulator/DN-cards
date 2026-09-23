import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { access, mkdir, writeFile, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { logger } from "../../../lib/logger.js";
import { getAudioEntry, curatedEntries, type QuietAudioEntry } from "./catalog.js";
import {
  getSourceAsset, sourceAbsPath, type QuietSourceAsset,
} from "./sources.js";
import { downloadOpenverseMedia } from "./openverse.js";

// ─────────────────────────────────────────────────────────────────────────────
// Quiet Audio — prepare / cache / prebuild
//
// Priority:
//   1. Curated licensed recording (Openverse CC0 harvest)
//   2. Cached prepared mix
//   3. Procedural ffmpeg fallback
//
// Primary Quiet Room formats: 3:00 and 5:00.
// Subtle variation: source variant, fade timing, quote placement, volume.
// ─────────────────────────────────────────────────────────────────────────────

/** Runtime cache root (writable prepared mixes). */
export function quietAudioCacheRoot(): string {
  return process.env["QUIET_AUDIO_CACHE"]
    ?? path.resolve(process.cwd(), "quiet-audio-cache");
}

export interface PreparedRecording {
  audioId: string;
  title: string;
  durationSec: number;
  filePath: string;
  hasSpeech: boolean;
  quoteText: string | null;
  waveformB64: string;
  blurb: string;
  sourceKind: "curated" | "procedural";
  sourceAssetId?: string;
}

export interface MixVariation {
  fadeInSec: number;
  fadeOutSec: number;
  quoteDelaySec: number;
  volumeMul: number;
  voiceVolume: number;
}

function pickVariation(): MixVariation {
  return {
    fadeInSec: 1 + Math.random() * 2,          // 1–3s
    fadeOutSec: 2 + Math.random() * 2,         // 2–4s
    quoteDelaySec: 6 + Math.random() * 6,      // 6–12s
    volumeMul: 0.92 + Math.random() * 0.16,    // ±~8%
    voiceVolume: 1.05 + Math.random() * 0.35,  // quiet, not overpowering
  };
}

function cacheKey(
  audioId: string,
  durationSec: number,
  quoteText: string | null,
  sourceAssetId: string | null,
  variationSalt: string,
): string {
  const h = createHash("sha1")
    .update(audioId)
    .update("|")
    .update(String(durationSec))
    .update("|")
    .update(quoteText ?? "")
    .update("|")
    .update(sourceAssetId ?? "proc")
    .update("|")
    .update(variationSalt)
    .digest("hex")
    .slice(0, 16);
  return `${audioId}_${durationSec}s_${quoteText ? "q" : "bg"}_${h}`;
}

async function exists(p: string): Promise<boolean> {
  try { await access(p); return true; } catch { return false; }
}

function run(cmd: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
    let err = "";
    child.stderr.on("data", (d: Buffer) => { err += d.toString(); });
    child.on("error", reject);
    child.on("close", code => {
      if (code === 0) resolve();
      else reject(new Error(`${cmd} exited ${code}: ${err.slice(-800)}`));
    });
  });
}

/** lavfi graph for procedural ambience by generator key. */
function ambienceLavfi(generator: string, durationSec: number, volume: number): string {
  const d = Math.max(5, durationSec);
  const v = volume;
  switch (generator) {
    case "rain_gentle":
      return `anoisesrc=color=brown:sample_rate=48000:amplitude=${v},afade=t=in:st=0:d=1.5,afade=t=out:st=${d - 2}:d=2,atrim=0:${d}`;
    case "rain_window":
      return `anoisesrc=color=pink:sample_rate=48000:amplitude=${v * 0.9},highpass=f=400,lowpass=f=6000,afade=t=in:st=0:d=1.2,afade=t=out:st=${d - 2}:d=2,atrim=0:${d}`;
    case "ocean_calm":
      return `anoisesrc=color=brown:sample_rate=48000:amplitude=${v},lowpass=f=800,afade=t=in:st=0:d=2,afade=t=out:st=${d - 2}:d=2,atrim=0:${d}`;
    case "ocean_waves":
      return `anoisesrc=color=pink:sample_rate=48000:amplitude=${v},lowpass=f=1200,tremolo=f=0.08:d=0.5,afade=t=in:st=0:d=2,afade=t=out:st=${d - 2}:d=2,atrim=0:${d}`;
    case "fireplace":
      return `anoisesrc=color=brown:sample_rate=48000:amplitude=${v * 0.85},highpass=f=200,lowpass=f=3500,afade=t=in:st=0:d=1,afade=t=out:st=${d - 2}:d=2,atrim=0:${d}`;
    case "forest_night":
      return `anoisesrc=color=pink:sample_rate=48000:amplitude=${v * 0.7},bandpass=f=2000:width_type=h:w=1500,afade=t=in:st=0:d=2,afade=t=out:st=${d - 2}:d=2,atrim=0:${d}`;
    case "forest_birds":
      return `anoisesrc=color=pink:sample_rate=48000:amplitude=${v * 0.55},bandpass=f=2800:width_type=h:w=1800,afade=t=in:st=0:d=1.5,afade=t=out:st=${d - 2}:d=2,atrim=0:${d}`;
    case "night_soft":
      return `anoisesrc=color=brown:sample_rate=48000:amplitude=${v * 0.65},lowpass=f=600,afade=t=in:st=0:d=2,afade=t=out:st=${d - 2}:d=2,atrim=0:${d}`;
    case "cozy_room":
      return `anoisesrc=color=brown:sample_rate=48000:amplitude=${v * 0.5},lowpass=f=400,afade=t=in:st=0:d=1.5,afade=t=out:st=${d - 2}:d=2,atrim=0:${d}`;
    case "wind_soft":
      return `anoisesrc=color=pink:sample_rate=48000:amplitude=${v},highpass=f=100,lowpass=f=1500,tremolo=f=0.05:d=0.4,afade=t=in:st=0:d=2,afade=t=out:st=${d - 2}:d=2,atrim=0:${d}`;
    case "thunder_distant":
      return `anoisesrc=color=brown:sample_rate=48000:amplitude=${v},lowpass=f=500,afade=t=in:st=0:d=1,afade=t=out:st=${d - 2}:d=2,atrim=0:${d}`;
    case "stream":
      return `anoisesrc=color=white:sample_rate=48000:amplitude=${v * 0.55},bandpass=f=2500:width_type=h:w=2000,afade=t=in:st=0:d=1.5,afade=t=out:st=${d - 2}:d=2,atrim=0:${d}`;
    case "music_pad":
      return `sine=frequency=110:sample_rate=48000,volume=${v * 0.5},afade=t=in:st=0:d=3,afade=t=out:st=${d - 3}:d=3,atrim=0:${d}`;
    case "music_piano":
      return `sine=frequency=261.63:sample_rate=48000,volume=${v},afade=t=in:st=0:d=0.05,afade=t=out:st=1.5:d=1.2,aloop=loop=${Math.max(1, Math.floor(d / 2))}:size=96000,atrim=0:${d},afade=t=out:st=${d - 2}:d=2`;
    case "sleep":
      return `anoisesrc=color=brown:sample_rate=48000:amplitude=${v * 0.55},lowpass=f=350,afade=t=in:st=0:d=3,afade=t=out:st=${d - 3}:d=3,atrim=0:${d}`;
    default:
      return `anoisesrc=color=brown:sample_rate=48000:amplitude=${v},afade=t=in:st=0:d=1,afade=t=out:st=${d - 2}:d=2,atrim=0:${d}`;
  }
}

function sanitizeFliteText(text: string): string {
  return text
    .replace(/[“”"']/g, "")
    .replace(/:/g, " —")
    .replace(/[^a-zA-Z0-9 .,!?\-—']/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 180);
}

let fliteAvailable: boolean | null = null;

export async function isFliteAvailable(): Promise<boolean> {
  if (fliteAvailable !== null) return fliteAvailable;
  const out = path.join(quietAudioCacheRoot(), "_flite_probe.wav");
  await mkdir(quietAudioCacheRoot(), { recursive: true });
  try {
    await run("ffmpeg", [
      "-hide_banner", "-loglevel", "error", "-y",
      "-f", "lavfi", "-i", "flite=text='hello':voice=slt",
      "-t", "1", out,
    ]);
    fliteAvailable = true;
  } catch {
    fliteAvailable = false;
    logger.warn("Quiet audio: ffmpeg flite TTS unavailable — ambience-only mixes");
  }
  return fliteAvailable;
}

async function buildWaveform(oggPath: string): Promise<string> {
  const rawPath = `${oggPath}.peak.raw`;
  try {
    await run("ffmpeg", [
      "-hide_banner", "-loglevel", "error", "-y",
      "-i", oggPath,
      "-ac", "1", "-ar", "8000", "-f", "s16le", rawPath,
    ]);
    const buf = await readFile(rawPath);
    const samples = buf.length / 2;
    const points = Math.min(256, Math.max(8, Math.floor(samples / 80)));
    const out = Buffer.alloc(points);
    const window = Math.max(1, Math.floor(samples / points));
    for (let i = 0; i < points; i++) {
      let peak = 0;
      const start = i * window;
      for (let j = 0; j < window && (start + j) * 2 + 1 < buf.length; j++) {
        const v = Math.abs(buf.readInt16LE((start + j) * 2));
        if (v > peak) peak = v;
      }
      out[i] = Math.min(255, Math.floor((peak / 32768) * 255));
    }
    return out.toString("base64");
  } catch {
    const fake = Buffer.alloc(64);
    for (let i = 0; i < 64; i++) fake[i] = 40 + Math.floor(80 * Math.abs(Math.sin(i / 5)));
    return fake.toString("base64");
  }
}

async function writeMeta(
  metaPath: string,
  recording: Omit<PreparedRecording, "filePath"> & { file: string },
): Promise<void> {
  await writeFile(metaPath, JSON.stringify(recording, null, 2), "utf8");
}

async function ensureSourceFile(asset: QuietSourceAsset): Promise<string | null> {
  const abs = sourceAbsPath(asset);
  if (await exists(abs)) return abs;

  // Attempt one-time download into the bundled sources tree (or cache mirror).
  try {
    await mkdir(path.dirname(abs), { recursive: true });
    const buf = await downloadOpenverseMedia(asset.mediaUrl);
    await writeFile(abs, buf);
    logger.info({ assetId: asset.id, bytes: buf.length }, "Quiet source harvested on demand");
    return abs;
  } catch (err) {
    // Mirror into cache as a last resort path
    const mirror = path.join(quietAudioCacheRoot(), "sources", asset.file);
    if (await exists(mirror)) return mirror;
    try {
      await mkdir(path.dirname(mirror), { recursive: true });
      const buf = await downloadOpenverseMedia(asset.mediaUrl);
      await writeFile(mirror, buf);
      logger.info({ assetId: asset.id, mirror }, "Quiet source mirrored into cache");
      return mirror;
    } catch (err2) {
      logger.warn({ err: err2, assetId: asset.id }, "Quiet curated source unavailable");
      return null;
    }
  }
}

function pickSourceAsset(entry: QuietAudioEntry): QuietSourceAsset | null {
  const ids = entry.sourceIds ?? [];
  if (ids.length === 0) return null;
  const shuffled = [...ids].sort(() => Math.random() - 0.5);
  for (const id of shuffled) {
    const asset = getSourceAsset(id);
    if (asset) return asset;
  }
  return null;
}

/**
 * Look for any already-prepared mix for this entry+duration (ambience or quote).
 * Prefers ambience-only when quoteText is null; otherwise any matching length.
 */
export async function findReadyRecording(
  entry: QuietAudioEntry,
  durationSec: number,
  preferSpeech: boolean,
): Promise<PreparedRecording | null> {
  const dir = path.join(quietAudioCacheRoot(), entry.category);
  if (!(await exists(dir))) return null;
  let files: string[] = [];
  try { files = await readdir(dir); } catch { return null; }

  const prefix = `${entry.id}_${durationSec}s_`;
  const candidates = files
    .filter(f => f.startsWith(prefix) && f.endsWith(".ogg"))
    .filter(f => preferSpeech ? f.includes("_q_") : f.includes("_bg_"));

  // Fall back to any duration match if preferred speech type missing
  const pool = candidates.length > 0
    ? candidates
    : files.filter(f => f.startsWith(prefix) && f.endsWith(".ogg"));

  if (pool.length === 0) return null;
  const pick = pool[Math.floor(Math.random() * pool.length)]!;
  const filePath = path.join(dir, pick);
  const metaPath = filePath.replace(/\.ogg$/, ".json");
  try {
    if (await exists(metaPath)) {
      const meta = JSON.parse(await readFile(metaPath, "utf8")) as PreparedRecording;
      return { ...meta, filePath };
    }
  } catch { /* ignore */ }
  return null;
}

async function renderFromSource(opts: {
  entry: QuietAudioEntry;
  sourcePath: string;
  sourceAssetId: string;
  durationSec: number;
  quoteText: string | null;
  speech: boolean;
  variation: MixVariation;
  filePath: string;
}): Promise<void> {
  const { durationSec, variation } = opts;
  const vol = opts.entry.volume * variation.volumeMul;
  const fadeIn = variation.fadeInSec.toFixed(2);
  const fadeOut = variation.fadeOutSec.toFixed(2);
  const outStart = Math.max(0, durationSec - variation.fadeOutSec).toFixed(2);

  // Loop/extend source to cover target duration, then fade + optional voice.
  // -stream_loop -1 with -t duration is reliable for short preview MP3s.
  if (!opts.speech) {
    await run("ffmpeg", [
      "-hide_banner", "-loglevel", "error", "-y",
      "-stream_loop", "-1", "-i", opts.sourcePath,
      "-t", String(durationSec),
      "-af", `volume=${vol.toFixed(3)},afade=t=in:st=0:d=${fadeIn},afade=t=out:st=${outStart}:d=${fadeOut},aformat=channel_layouts=mono`,
      "-c:a", "libopus", "-b:a", "32k", "-ac", "1", "-ar", "48000",
      opts.filePath,
    ]);
    return;
  }

  const delayMs = Math.round(variation.quoteDelaySec * 1000);
  const flite = `flite=text='${opts.quoteText}':voice=slt`;
  await run("ffmpeg", [
    "-hide_banner", "-loglevel", "error", "-y",
    "-stream_loop", "-1", "-i", opts.sourcePath,
    "-t", String(durationSec),
    "-f", "lavfi", "-i", flite,
    "-filter_complex",
    `[0:a]volume=${vol.toFixed(3)},afade=t=in:st=0:d=${fadeIn},afade=t=out:st=${outStart}:d=${fadeOut},aformat=channel_layouts=mono[bg];` +
    `[1:a]aresample=48000,aformat=channel_layouts=mono,volume=${variation.voiceVolume.toFixed(2)},adelay=${delayMs}|${delayMs}[voice];` +
    `[bg][voice]amix=inputs=2:duration=first:dropout_transition=3,atrim=0:${durationSec}`,
    "-c:a", "libopus", "-b:a", "32k", "-ac", "1", "-ar", "48000",
    opts.filePath,
  ]);
}

async function renderProcedural(opts: {
  entry: QuietAudioEntry;
  durationSec: number;
  quoteText: string | null;
  speech: boolean;
  variation: MixVariation;
  filePath: string;
}): Promise<void> {
  const vol = opts.entry.volume * opts.variation.volumeMul;
  const lavfi = ambienceLavfi(opts.entry.generator, opts.durationSec, vol);

  if (!opts.speech) {
    await run("ffmpeg", [
      "-hide_banner", "-loglevel", "error", "-y",
      "-f", "lavfi", "-i", lavfi,
      "-c:a", "libopus", "-b:a", "32k", "-ac", "1", "-ar", "48000",
      opts.filePath,
    ]);
    return;
  }

  const delayMs = Math.round(opts.variation.quoteDelaySec * 1000);
  const flite = `flite=text='${opts.quoteText}':voice=slt`;
  await run("ffmpeg", [
    "-hide_banner", "-loglevel", "error", "-y",
    "-f", "lavfi", "-i", lavfi,
    "-f", "lavfi", "-i", flite,
    "-filter_complex",
    `[1:a]aresample=48000,aformat=channel_layouts=mono,volume=${opts.variation.voiceVolume.toFixed(2)},adelay=${delayMs}|${delayMs}[voice];` +
    `[0:a]aformat=channel_layouts=mono[bg];` +
    `[bg][voice]amix=inputs=2:duration=first:dropout_transition=3,atrim=0:${opts.durationSec}`,
    "-c:a", "libopus", "-b:a", "32k", "-ac", "1", "-ar", "48000",
    opts.filePath,
  ]);
}

/**
 * Ensure a prepared recording exists on disk.
 * Tries curated source first, then procedural fallback.
 */
export async function prepareRecording(opts: {
  entry: QuietAudioEntry;
  durationSec: number;
  quoteText?: string | null;
  forceSpeech?: boolean;
  /** Reuse a ready cache hit when possible (default true). */
  preferReady?: boolean;
}): Promise<PreparedRecording> {
  const { entry } = opts;
  const durationSec = Math.min(Math.max(opts.durationSec, 15), 600);
  const wantSpeech = Boolean(opts.quoteText) && entry.allowsSpeech && (opts.forceSpeech !== false);
  const quoteText = wantSpeech ? sanitizeFliteText(opts.quoteText ?? "") : null;
  const canSpeak = quoteText ? await isFliteAvailable() : false;
  const speech = Boolean(quoteText && canSpeak);

  if (opts.preferReady !== false) {
    const ready = await findReadyRecording(entry, durationSec, speech);
    if (ready && (!speech || ready.hasSpeech)) {
      logger.debug({ audioId: entry.id, durationSec, path: ready.filePath }, "Quiet audio cache hit");
      return ready;
    }
  }

  const variation = pickVariation();
  // Stable-ish salt so identical quote+source still can vary across prepares,
  // but same call path remains reproducible via cache key.
  const salt = [
    variation.fadeInSec.toFixed(1),
    variation.quoteDelaySec.toFixed(1),
    variation.volumeMul.toFixed(2),
  ].join(",");

  let sourceAsset: QuietSourceAsset | null = null;
  let sourcePath: string | null = null;
  if (entry.kind === "curated" || (entry.sourceIds?.length ?? 0) > 0) {
    sourceAsset = pickSourceAsset(entry);
    if (sourceAsset) {
      sourcePath = await ensureSourceFile(sourceAsset);
    }
  }

  const root = quietAudioCacheRoot();
  await mkdir(path.join(root, entry.category), { recursive: true });
  const key = cacheKey(
    entry.id,
    durationSec,
    speech ? quoteText : null,
    sourcePath ? sourceAsset?.id ?? null : null,
    salt,
  );
  const filePath = path.join(root, entry.category, `${key}.ogg`);
  const metaPath = path.join(root, entry.category, `${key}.json`);

  if (await exists(filePath) && await exists(metaPath)) {
    try {
      const meta = JSON.parse(await readFile(metaPath, "utf8")) as PreparedRecording;
      return { ...meta, filePath };
    } catch { /* regenerate */ }
  }

  const sourceKind: "curated" | "procedural" = sourcePath ? "curated" : "procedural";
  try {
    if (sourcePath && sourceAsset) {
      await renderFromSource({
        entry, sourcePath, sourceAssetId: sourceAsset.id,
        durationSec, quoteText, speech, variation, filePath,
      });
    } else {
      await renderProcedural({ entry, durationSec, quoteText, speech, variation, filePath });
    }
  } catch (err) {
    // If curated render failed, fall back to procedural once.
    if (sourceKind === "curated") {
      logger.warn({ err, audioId: entry.id }, "Curated mix failed — procedural fallback");
      await renderProcedural({ entry, durationSec, quoteText, speech, variation, filePath });
    } else {
      throw err;
    }
  }

  const waveformB64 = await buildWaveform(filePath);
  const prepared: PreparedRecording = {
    audioId: entry.id,
    title: entry.title,
    durationSec,
    filePath,
    hasSpeech: speech,
    quoteText: speech ? quoteText : null,
    waveformB64,
    blurb: entry.blurb,
    sourceKind: sourcePath ? "curated" : "procedural",
    sourceAssetId: sourcePath ? sourceAsset?.id : undefined,
  };
  await writeMeta(metaPath, { ...prepared, file: path.basename(filePath) });
  logger.info({
    audioId: entry.id,
    durationSec,
    sourceKind: prepared.sourceKind,
    sourceAssetId: prepared.sourceAssetId,
    hasSpeech: speech,
  }, "Quiet recording prepared");
  return prepared;
}

/** Instant short fallback when a long mix isn't ready. */
export async function prepareQuickFallback(entry?: QuietAudioEntry): Promise<PreparedRecording> {
  const e = entry ?? getAudioEntry("curated-rain-gentle") ?? getAudioEntry("rain-gentle-01")!;
  // Prefer a ready 3-minute if present; else make a 30s clip.
  const ready = await findReadyRecording(e, 180, false);
  if (ready) return ready;
  return prepareRecording({ entry: e, durationSec: 30, quoteText: null, preferReady: false });
}

/**
 * Prepare the preferred experience for a Quiet Room enter:
 * try ready 3/5 min curated first; generate if needed; never block forever.
 */
export async function prepareQuietExperience(opts: {
  entry: QuietAudioEntry;
  durationSec: number;
  quoteText: string | null;
  withSpeech: boolean;
}): Promise<PreparedRecording> {
  const durationSec = opts.durationSec === 300 ? 300 : 180;
  const quote = opts.withSpeech ? opts.quoteText : null;

  // 1) Ready cache
  const ready = await findReadyRecording(opts.entry, durationSec, Boolean(quote));
  if (ready) return ready;

  // 2) Prepare preferred length (may take a few seconds for first mix)
  try {
    return await prepareRecording({
      entry: opts.entry,
      durationSec,
      quoteText: quote,
      preferReady: false,
    });
  } catch (err) {
    logger.warn({ err, audioId: opts.entry.id }, "Preferred Quiet mix failed — quick fallback");
    return prepareQuickFallback(opts.entry);
  }
}

let prebuildStarted = false;

/**
 * Warm a smart ready pool:
 *  - curated 3:00 & 5:00 ambience across categories
 *  - a few quote mixes in the background
 * Does NOT generate every quote×audio combination.
 */
export function startQuietAudioPrebuild(): void {
  if (prebuildStarted) return;
  prebuildStarted = true;
  void (async () => {
    try {
      await mkdir(quietAudioCacheRoot(), { recursive: true });
      await isFliteAvailable();

      const curated = curatedEntries().filter(a => a.enabledByDefault);
      // Phase 1: short instant fallbacks for a couple of entries
      for (const entry of curated.slice(0, 4)) {
        await prepareRecording({ entry, durationSec: 30, quoteText: null, preferReady: false }).catch(() => {});
      }

      // Phase 2: 3-minute ambience pool (main)
      for (const entry of curated) {
        await prepareRecording({ entry, durationSec: 180, quoteText: null, preferReady: false }).catch(err => {
          logger.debug({ err, id: entry.id }, "prebuild 3m skip");
        });
      }

      // Phase 3: 5-minute ambience for top-weight curated
      const top = [...curated].sort((a, b) => (b.weight ?? 1) - (a.weight ?? 1)).slice(0, 10);
      for (const entry of top) {
        await prepareRecording({ entry, durationSec: 300, quoteText: null, preferReady: false }).catch(() => {});
      }

      // Phase 4: a few speech mixes with a shared calm quote (background variety)
      if (await isFliteAvailable()) {
        const sampleQuotes = [
          "You do not have to figure everything out right now.",
          "Take your time. There is nowhere you need to be.",
          "Nothing is chasing you here.",
        ];
        let qi = 0;
        for (const entry of top.slice(0, 6)) {
          if (!entry.allowsSpeech) continue;
          const q = sampleQuotes[qi++ % sampleQuotes.length]!;
          await prepareRecording({
            entry, durationSec: 180, quoteText: q, preferReady: false,
          }).catch(() => {});
        }
      }

      logger.info({
        curated: curated.length,
        cache: quietAudioCacheRoot(),
      }, "Quiet audio prebuild pool warmed (3m/5m curated)");
    } catch (err) {
      logger.warn({ err }, "Quiet audio prebuild failed");
    }
  })();
}
