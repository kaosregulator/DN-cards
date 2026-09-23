import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { access, mkdir, writeFile, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { logger } from "../../../lib/logger.js";
import { getAudioEntry, type QuietAudioEntry } from "./catalog.js";

// ─────────────────────────────────────────────────────────────────────────────
// Quiet Audio — ffmpeg generation + on-disk cache
//
// Prebuild/cached OGG Opus (mono 48kHz ~32kbps) ready for Discord voice messages.
// Ambience is procedural. Quotes are mixed via flite TTS when libflite works.
// ─────────────────────────────────────────────────────────────────────────────

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Runtime cache root (writable). Bundled seeds can live beside the module. */
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
}

function cacheKey(audioId: string, durationSec: number, quoteText: string | null): string {
  const h = createHash("sha1")
    .update(audioId)
    .update("|")
    .update(String(durationSec))
    .update("|")
    .update(quoteText ?? "")
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
      // Soft noise bed — bird-like chirps are hard to fake; keep a light airy bed.
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
  // flite filter is picky — keep ASCII-ish and strip quotes/colons that break lavfi.
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

/** Build a crude Discord waveform (≤256 bytes) from PCM peak sampling via ffmpeg. */
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
    // Fallback: gentle synthetic wave
    const fake = Buffer.alloc(64);
    for (let i = 0; i < 64; i++) fake[i] = 40 + Math.floor(80 * Math.abs(Math.sin(i / 5)));
    return fake.toString("base64");
  }
}

async function writeMeta(metaPath: string, recording: Omit<PreparedRecording, "filePath"> & { file: string }): Promise<void> {
  await writeFile(metaPath, JSON.stringify(recording, null, 2), "utf8");
}

/**
 * Ensure a prepared recording exists on disk. Reuses cache when present.
 * Prefer calling this from the prebuild pool / background — not on the hot path
 * unless a ready fallback is already available.
 */
export async function prepareRecording(opts: {
  entry: QuietAudioEntry;
  durationSec: number;
  quoteText?: string | null;
  forceSpeech?: boolean;
}): Promise<PreparedRecording> {
  const { entry } = opts;
  const durationSec = Math.min(Math.max(opts.durationSec, 15), 600);
  const wantSpeech = Boolean(opts.quoteText) && entry.allowsSpeech && (opts.forceSpeech !== false);
  const quoteText = wantSpeech ? sanitizeFliteText(opts.quoteText ?? "") : null;
  const canSpeak = quoteText ? await isFliteAvailable() : false;
  const speech = Boolean(quoteText && canSpeak);

  const root = quietAudioCacheRoot();
  await mkdir(path.join(root, entry.category), { recursive: true });
  const key = cacheKey(entry.id, durationSec, speech ? quoteText : null);
  const filePath = path.join(root, entry.category, `${key}.ogg`);
  const metaPath = path.join(root, entry.category, `${key}.json`);

  if (await exists(filePath) && await exists(metaPath)) {
    try {
      const meta = JSON.parse(await readFile(metaPath, "utf8")) as PreparedRecording;
      return { ...meta, filePath };
    } catch { /* regenerate */ }
  }

  const lavfi = ambienceLavfi(entry.generator, durationSec, entry.volume);

  if (!speech) {
    await run("ffmpeg", [
      "-hide_banner", "-loglevel", "error", "-y",
      "-f", "lavfi", "-i", lavfi,
      "-c:a", "libopus", "-b:a", "32k", "-ac", "1", "-ar", "48000",
      filePath,
    ]);
  } else {
    // Background + delayed calm voice (~2s in), then continue ambience.
    const voiceDelayMs = 2000;
    const flite = `flite=text='${quoteText}':voice=slt`;
    await run("ffmpeg", [
      "-hide_banner", "-loglevel", "error", "-y",
      "-f", "lavfi", "-i", lavfi,
      "-f", "lavfi", "-i", flite,
      "-filter_complex",
      `[1:a]aresample=48000,aformat=channel_layouts=mono,volume=2.0,adelay=${voiceDelayMs}|${voiceDelayMs}[voice];` +
      `[0:a]aformat=channel_layouts=mono[bg];` +
      `[bg][voice]amix=inputs=2:duration=first:dropout_transition=3,atrim=0:${durationSec}`,
      "-c:a", "libopus", "-b:a", "32k", "-ac", "1", "-ar", "48000",
      filePath,
    ]);
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
  };
  await writeMeta(metaPath, { ...prepared, file: path.basename(filePath) });
  return prepared;
}

/** Instant ambience-only fallback (short) when a long mix isn't ready. */
export async function prepareQuickFallback(entry?: QuietAudioEntry): Promise<PreparedRecording> {
  const e = entry ?? getAudioEntry("rain-gentle-01")!;
  return prepareRecording({ entry: e, durationSec: 30, quoteText: null });
}

let prebuildStarted = false;

/**
 * Warm a ready pool of common recordings in the background.
 * Safe to call multiple times — only the first call schedules work.
 */
export function startQuietAudioPrebuild(): void {
  if (prebuildStarted) return;
  prebuildStarted = true;
  void (async () => {
    try {
      await mkdir(quietAudioCacheRoot(), { recursive: true });
      await isFliteAvailable();
      const { QUIET_AUDIO_CATALOG } = await import("./catalog.js");
      const primary = QUIET_AUDIO_CATALOG.filter(a => a.enabledByDefault).slice(0, 8);
      // Background-only shorts first (instant path), then a few 3-minute mixes.
      for (const entry of primary) {
        await prepareRecording({ entry, durationSec: 30, quoteText: null }).catch(() => {});
      }
      for (const entry of primary.slice(0, 5)) {
        await prepareRecording({ entry, durationSec: 180, quoteText: null }).catch(() => {});
      }
      logger.info({ count: primary.length }, "Quiet audio prebuild pool warmed");
    } catch (err) {
      logger.warn({ err }, "Quiet audio prebuild failed");
    }
  })();
}
