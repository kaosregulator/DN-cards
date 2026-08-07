// ─────────────────────────────────────────────────────────────────────────────
// HQ — per-guild settings (the siege ruleset).
//
// Sieges used to open with "how do you want to watch this?", which put a
// presentation choice in front of a gameplay action and meant no two assaults in
// a server looked the same. Presentation is now the SERVER OWNER's call — set
// once in `/hqadmin`, exactly like `/battle`'s animation settings — and every
// siege in the guild runs that way.
//
// Reads are cached per guild for a short window because a siege re-reads the
// config on every launch; writes bust the entry immediately.
// ─────────────────────────────────────────────────────────────────────────────

import { db, hqSettingsTable, type HqSettings } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "../../lib/logger.js";

/** How a siege plays out for everyone in a guild. */
export type SiegeMode = "turn" | "cinematic" | "classic" | "live" | "static";

export const SIEGE_MODES: {
  id: SiegeMode; label: string; emoji: string; blurb: string;
}[] = [
  { id: "turn", label: "Turn-for-Turn", emoji: "⚔️",
    blurb: "The full interactive assault — you command every move, the garrison answers." },
  { id: "cinematic", label: "Cinematic", emoji: "🎥",
    blurb: "The opening film, then the siege resolves itself." },
  { id: "classic", label: "Classic", emoji: "📜",
    blurb: "Auto-resolved, animated, with move-by-move captions." },
  { id: "live", label: "Animated", emoji: "🎬",
    blurb: "Auto-resolved as a clean animation, no captions." },
  { id: "static", label: "Instant", emoji: "🖼️",
    blurb: "Auto-resolved to a single result frame. Fastest." },
];

export const DEFAULT_SIEGE_MODE: SiegeMode = "turn";

const MODE_IDS = new Set<string>(SIEGE_MODES.map(m => m.id));

/** Resolve a stored mode, degrading to the default so a stale value never throws. */
export function resolveSiegeMode(id: string | null | undefined): SiegeMode {
  return id && MODE_IDS.has(id) ? id as SiegeMode : DEFAULT_SIEGE_MODE;
}

export function siegeModeMeta(id: SiegeMode) {
  return SIEGE_MODES.find(m => m.id === id) ?? SIEGE_MODES[0]!;
}

// The shape the siege runtime reads — already clamped and resolved, so callers
// never have to re-validate a stored number.
export interface HqSiegeConfig {
  mode: SiegeMode;
  intro: boolean;
  turnSeconds: number;
  turnVisuals: boolean;
  itemUses: number;
  maxTurns: number;
}

export const SIEGE_LIMITS = {
  turnSeconds: { min: 15, max: 180 },
  itemUses: { min: 0, max: 10 },
  maxTurns: { min: 10, max: 120 },
} as const;

const clamp = (n: number, lo: number, hi: number, fallback: number): number =>
  Number.isFinite(n) ? Math.max(lo, Math.min(hi, Math.round(n))) : fallback;

function toConfig(row: HqSettings | null): HqSiegeConfig {
  return {
    mode: resolveSiegeMode(row?.siegeMode),
    intro: row?.siegeIntro ?? true,
    turnSeconds: clamp(row?.siegeTurnSeconds ?? 45, SIEGE_LIMITS.turnSeconds.min, SIEGE_LIMITS.turnSeconds.max, 45),
    turnVisuals: row?.siegeTurnVisuals ?? true,
    itemUses: clamp(row?.siegeItemUses ?? 3, SIEGE_LIMITS.itemUses.min, SIEGE_LIMITS.itemUses.max, 3),
    maxTurns: clamp(row?.siegeMaxTurns ?? 40, SIEGE_LIMITS.maxTurns.min, SIEGE_LIMITS.maxTurns.max, 40),
  };
}

/** The config a guild with no row yet gets — also the fallback when a read fails. */
export const DEFAULT_SIEGE_CONFIG: HqSiegeConfig = toConfig(null);

// A siege launch reads this immediately before building the runtime, and the
// admin panel re-reads it on every click; a short TTL keeps that off the DB
// without making a settings change feel laggy.
const CACHE_TTL_MS = 30_000;
const cache = new Map<string, { at: number; cfg: HqSiegeConfig }>();

/** The guild's siege ruleset. Never throws — a failed read yields the defaults. */
export async function getSiegeConfig(guildId: string): Promise<HqSiegeConfig> {
  const hit = cache.get(guildId);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.cfg;
  try {
    const [row] = await db.select().from(hqSettingsTable)
      .where(eq(hqSettingsTable.guildId, guildId)).limit(1);
    const cfg = toConfig(row ?? null);
    cache.set(guildId, { at: Date.now(), cfg });
    return cfg;
  } catch (err) {
    logger.debug({ err, guildId }, "hq settings: read failed, using defaults");
    return DEFAULT_SIEGE_CONFIG;
  }
}

/** Patch the guild's siege ruleset and return the resolved result. */
export async function updateSiegeConfig(
  guildId: string, patch: Partial<HqSiegeConfig>,
): Promise<HqSiegeConfig> {
  const values: Partial<typeof hqSettingsTable.$inferInsert> = {};
  if (patch.mode !== undefined) values.siegeMode = resolveSiegeMode(patch.mode);
  if (patch.intro !== undefined) values.siegeIntro = patch.intro;
  if (patch.turnSeconds !== undefined) {
    values.siegeTurnSeconds = clamp(patch.turnSeconds, SIEGE_LIMITS.turnSeconds.min, SIEGE_LIMITS.turnSeconds.max, 45);
  }
  if (patch.turnVisuals !== undefined) values.siegeTurnVisuals = patch.turnVisuals;
  if (patch.itemUses !== undefined) {
    values.siegeItemUses = clamp(patch.itemUses, SIEGE_LIMITS.itemUses.min, SIEGE_LIMITS.itemUses.max, 3);
  }
  if (patch.maxTurns !== undefined) {
    values.siegeMaxTurns = clamp(patch.maxTurns, SIEGE_LIMITS.maxTurns.min, SIEGE_LIMITS.maxTurns.max, 40);
  }
  await db.insert(hqSettingsTable)
    .values({ guildId, ...values })
    .onConflictDoUpdate({
      target: [hqSettingsTable.guildId],
      set: { ...values, updatedAt: new Date() },
    });
  cache.delete(guildId);
  return getSiegeConfig(guildId);
}
