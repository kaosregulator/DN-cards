import { listAudioConfigs } from "../models.js";
import type { QuietTheme } from "../quotes.js";
import {
  QUIET_AUDIO_CATALOG,
  THEME_CATEGORY_PREFS,
  getAudioEntry,
  pickDuration,
  type QuietAudioCategory,
  type QuietAudioEntry,
} from "./catalog.js";

// ─────────────────────────────────────────────────────────────────────────────
// Intelligent random selection — theme-aware categories, curated-first,
// anti-repeat, 3:00 / 5:00 primary lengths.
// ─────────────────────────────────────────────────────────────────────────────

export interface QuietAudioPick {
  entry: QuietAudioEntry;
  durationSec: number;
  withSpeech: boolean;
}

function weightedPick<T>(items: T[], weightFn: (item: T) => number): T {
  const weights = items.map(weightFn);
  const total = weights.reduce((s, w) => s + w, 0);
  let r = Math.random() * Math.max(total, 1);
  for (let i = 0; i < items.length; i++) {
    r -= weights[i]!;
    if (r <= 0) return items[i]!;
  }
  return items[items.length - 1]!;
}

function themeCategories(theme: QuietTheme | null | undefined): QuietAudioCategory[] | null {
  if (!theme) return null;
  return THEME_CATEGORY_PREFS[theme] ?? null;
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
  const prefs = themeCategories(theme);

  // Theme filter: compatibleThemes first, then category prefs as soft boost.
  let themed = theme
    ? pool.filter(a => a.compatibleThemes.includes(theme))
    : pool;
  if (themed.length === 0) themed = pool;

  const recent = new Set(opts.recentAudioIds ?? []);
  let fresh = themed.filter(a => !recent.has(a.id));
  if (fresh.length === 0) fresh = themed;

  // Prefer curated when available in the fresh pool.
  const curatedFresh = fresh.filter(a => a.kind === "curated");
  const pickPool = curatedFresh.length > 0 ? curatedFresh : fresh;

  const entry = weightedPick(pickPool, a => {
    let w = (a.weight ?? 1) * (weightBoost.get(a.id) ?? 1);
    if (a.kind === "curated") w *= 2.5;
    if (prefs?.includes(a.category)) w *= 1.8;
    return w;
  });

  // Primary formats: 3:00 or 5:00 (slight preference for 3m for snappier first send).
  const preferDuration = opts.preferDurationSec
    ?? (Math.random() < 0.58 ? 180 : 300);
  const durationSec = pickDuration(entry, preferDuration);

  // Speech: common but not mandatory; music-without-speech stays quiet.
  const withSpeech = entry.allowsSpeech
    && (opts.preferSpeech !== false)
    && Math.random() < 0.68;

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
