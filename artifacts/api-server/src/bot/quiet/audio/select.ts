import { listAudioConfigs } from "../models.js";
import type { QuietTheme } from "../quotes.js";
import {
  QUIET_AUDIO_CATALOG,
  getAudioEntry,
  pickDuration,
  type QuietAudioEntry,
} from "./catalog.js";

// ─────────────────────────────────────────────────────────────────────────────
// Intelligent random selection — compatible theme + audio pairs, anti-repeat.
// ─────────────────────────────────────────────────────────────────────────────

export interface QuietAudioPick {
  entry: QuietAudioEntry;
  durationSec: number;
  withSpeech: boolean;
}

export async function pickQuietAudio(opts: {
  theme?: QuietTheme | null;
  recentAudioIds?: string[];
  preferSpeech?: boolean;
  preferDurationSec?: number;
}): Promise<QuietAudioPick> {
  let configs: Awaited<ReturnType<typeof listAudioConfigs>> = [];
  try {
    configs = await listAudioConfigs();
  } catch {
    configs = [];
  }
  const disabled = new Set(configs.filter(c => !c.enabled).map(c => c.audioId));
  const weightBoost = new Map(configs.map(c => [c.audioId, Math.max(1, c.weight)]));

  let pool = QUIET_AUDIO_CATALOG.filter(a => a.enabledByDefault && !disabled.has(a.id));
  if (pool.length === 0) pool = [...QUIET_AUDIO_CATALOG];

  const theme = opts.theme ?? null;
  let themed = theme
    ? pool.filter(a => a.compatibleThemes.includes(theme))
    : pool;
  if (themed.length === 0) themed = pool;

  const recent = new Set(opts.recentAudioIds ?? []);
  let fresh = themed.filter(a => !recent.has(a.id));
  if (fresh.length === 0) fresh = themed;

  // Weighted random
  const weights = fresh.map(a => weightBoost.get(a.id) ?? 1);
  const total = weights.reduce((s, w) => s + w, 0);
  let r = Math.random() * total;
  let entry = fresh[0]!;
  for (let i = 0; i < fresh.length; i++) {
    r -= weights[i]!;
    if (r <= 0) { entry = fresh[i]!; break; }
  }

  const preferDuration = opts.preferDurationSec ?? (Math.random() < 0.55 ? 180 : 300);
  const durationSec = pickDuration(entry, preferDuration);
  const withSpeech = entry.allowsSpeech && (opts.preferSpeech !== false) && Math.random() < 0.72;

  return { entry, durationSec, withSpeech };
}

export function describeAudioCard(
  entry: QuietAudioEntry,
  durationSec: number,
): string {
  const m = Math.floor(durationSec / 60);
  const s = durationSec % 60;
  const clock = `${m}:${String(s).padStart(2, "0")}`;
  return `**${entry.title} — ${clock}**`;
}

export { getAudioEntry };
