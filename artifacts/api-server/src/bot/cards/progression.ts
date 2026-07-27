// ─────────────────────────────────────────────────────────────────────────────
// DN Cards — Shared card progression service (SINGLE SOURCE OF TRUTH)
//
// Every stat-bearing feature — Battles, Raids, Recycle/Fusion, spawn/pack catch
// previews, admin stat tooling — resolves a card's power through ONE path:
//
//     get_scaled_stats(card, cfg, settings, LEVEL, rarity, STAR_RANK)
//
// where LEVEL (1–100) and STAR_RANK (0–5) come from the shared `card_progress`
// row. This module is the umbrella over that contract. It:
//
//   • Re-exports the canonical stat/level/star primitives so callers have one
//     import and cannot accidentally re-implement scaling (the +8%/★ multiplier,
//     the level curve, the clamps all live here / behind here).
//   • Owns "variable acquisition" — rolling a concrete {starRank, level} for a
//     newly-acquired card from the guild's config (or a per-card override) and
//     writing it into the same `card_progress` row battles read. So a card that
//     spawns/drops/pulls pre-levelled is instantly battle-ready with NO separate
//     stat path.
//
// Acquisition is opt-in: with no config, every card arrives at 0★ / Lv 1 exactly
// as before. All config reads are defensive (try/catch) so the bot keeps working
// even before the new tables are migrated.
// ─────────────────────────────────────────────────────────────────────────────

import {
  db, cardProgressTable,
  cardAcquisitionConfigTable, cardAcquisitionOverridesTable,
} from "@workspace/db";
import type { AcquisitionSource, CardAcquisitionConfig, CardAcquisitionOverride } from "@workspace/db";
import { and, eq, sql } from "drizzle-orm";
import { logger } from "../../lib/logger.js";
import { MAX_LEVEL, xpForLevel } from "./leveling.js";
import { MAX_STAR } from "./stars.js";

// ── Canonical progression primitives (re-exports) ────────────────────────────
// These are THE definitions. Import them from here (or from the module noted)
// rather than re-deriving any scaling formula.
export { MAX_LEVEL, levelFromXp, starsForLevel, xpForLevel, levelForStars } from "./leveling.js";
export { MAX_STAR, starRankString } from "./stars.js";
export {
  getScaledStats, get_scaled_stats, applyStarBonus, scaleByLevel,
  starStatMultiplier, powerRating, STAR_BONUS_PER, MAX_STAR_RANK,
} from "../battle/stat-engine.js";

export type { AcquisitionSource } from "@workspace/db";

// ── Clamps ───────────────────────────────────────────────────────────────────
export function clampStar(star: number): number {
  return Math.max(0, Math.min(MAX_STAR, Math.round(star) || 0));
}
export function clampLevel(level: number): number {
  return Math.max(1, Math.min(MAX_LEVEL, Math.round(level) || 1));
}

export interface CardProgressionGrant {
  starRank: number;
  level: number;
}

// Inclusive random integer in [min, max], each end clamped into [floor, ceil].
// A missing/invalid bound collapses to the other so a fixed value still works.
function rollInRange(min: number | null | undefined, max: number | null | undefined, floor: number, ceil: number): number {
  let lo = Math.max(floor, Math.min(ceil, Math.round(min ?? floor)));
  let hi = Math.max(floor, Math.min(ceil, Math.round(max ?? lo)));
  if (hi < lo) [lo, hi] = [hi, lo];
  return Math.floor(Math.random() * (hi - lo + 1)) + lo;
}

// ── Acquisition config resolution ────────────────────────────────────────────
// Resolution order (most specific wins), all reads best-effort:
//   1. per-card override for this source     (card_acquisition_overrides)
//   2. per-card override for "*"             (card_acquisition_overrides)
//   3. guild default for this source         (card_acquisition_config)
//   4. guild default for "*"                 (card_acquisition_config)
//   5. nothing → { starRank: 0, level: 1 }   (unchanged legacy behaviour)
interface RangeRow {
  enabled: boolean;
  starMin: number; starMax: number;
  levelMin: number; levelMax: number;
}

async function resolveAcquisitionRange(
  guildId: string, cardId: number, source: AcquisitionSource,
): Promise<RangeRow | null> {
  try {
    // 1 & 2 — per-card override (specific source then "*").
    const overrides = await db.select().from(cardAcquisitionOverridesTable)
      .where(and(
        eq(cardAcquisitionOverridesTable.guildId, guildId),
        eq(cardAcquisitionOverridesTable.cardId, cardId),
      ));
    const ovForSource = overrides.find(o => o.source === source)
      ?? overrides.find(o => o.source === "*");
    if (ovForSource) return ovForSource;

    // 3 & 4 — guild default (specific source then "*").
    const configs = await db.select().from(cardAcquisitionConfigTable)
      .where(eq(cardAcquisitionConfigTable.guildId, guildId));
    const cfgForSource = configs.find(c => c.source === source)
      ?? configs.find(c => c.source === "*");
    if (cfgForSource) return cfgForSource;
  } catch (err) {
    // Table not migrated yet, or a transient DB error — fall back to legacy.
    logger.debug({ err, guildId, cardId, source }, "resolveAcquisitionRange fell back to defaults");
  }
  return null;
}

// Roll the Star Rank + Level a freshly-acquired card should arrive with. Returns
// { starRank: 0, level: 1 } (a no-op grant) when nothing is configured.
export async function rollAcquisitionProgression(
  guildId: string, cardId: number, source: AcquisitionSource,
): Promise<CardProgressionGrant> {
  const range = await resolveAcquisitionRange(guildId, cardId, source);
  if (!range || !range.enabled) return { starRank: 0, level: 1 };
  return {
    starRank: rollInRange(range.starMin, range.starMax, 0, MAX_STAR),
    level: rollInRange(range.levelMin, range.levelMax, 1, MAX_LEVEL),
  };
}

// A grant is meaningful only if it raises a card above the 0★ / Lv 1 baseline.
export function isMeaningfulGrant(grant: CardProgressionGrant): boolean {
  return clampStar(grant.starRank) > 0 || clampLevel(grant.level) > 1;
}

// ── Apply progression to the shared card_progress row ────────────────────────
// Writes into the EXACT row battles/raids/fusion read. Uses GREATEST() so a
// low-roll acquisition can never downgrade a card the player already levelled or
// fused higher — acquisition only ever bumps a card up.
export async function grantCardProgression(
  guildId: string, userId: string, cardId: number, grant: CardProgressionGrant,
): Promise<CardProgressionGrant | null> {
  const starRank = clampStar(grant.starRank);
  const level = clampLevel(grant.level);
  if (!isMeaningfulGrant({ starRank, level })) return null;
  const xp = xpForLevel(level);
  try {
    await db.insert(cardProgressTable)
      .values({ guildId, userId, cardId, starRank, level, xp })
      .onConflictDoUpdate({
        target: [cardProgressTable.guildId, cardProgressTable.userId, cardProgressTable.cardId],
        set: {
          starRank: sql`GREATEST(${cardProgressTable.starRank}, ${starRank})`,
          level: sql`GREATEST(${cardProgressTable.level}, ${level})`,
          xp: sql`GREATEST(${cardProgressTable.xp}, ${xp})`,
          updatedAt: new Date(),
        },
      });
    return { starRank, level };
  } catch (err) {
    logger.warn({ err, guildId, userId, cardId }, "grantCardProgression failed (non-fatal)");
    return null;
  }
}

// Convenience: roll from config for a source AND apply it, returning the grant
// actually written (null when it was a no-op baseline). Used by catch/pack flows.
export async function rollAndGrantProgression(
  guildId: string, userId: string, cardId: number, source: AcquisitionSource,
): Promise<CardProgressionGrant | null> {
  const grant = await rollAcquisitionProgression(guildId, cardId, source);
  if (!isMeaningfulGrant(grant)) return null;
  return grantCardProgression(guildId, userId, cardId, grant);
}

// ── Acquisition config CRUD (admin "default + overrides hub") ─────────────────
// A source string of "*" means "all sources". Ranges are normalised (clamped +
// ordered) before writing so a stored row is always safe to roll from.
export interface AcquisitionRangeInput {
  enabled: boolean;
  starMin: number; starMax: number;
  levelMin: number; levelMax: number;
}

function normalizeRange(r: AcquisitionRangeInput): AcquisitionRangeInput {
  let starMin = clampStar(r.starMin), starMax = clampStar(r.starMax);
  let levelMin = clampLevel(r.levelMin), levelMax = clampLevel(r.levelMax);
  if (starMax < starMin) [starMin, starMax] = [starMax, starMin];
  if (levelMax < levelMin) [levelMin, levelMax] = [levelMax, levelMin];
  return { enabled: r.enabled, starMin, starMax, levelMin, levelMax };
}

// Guild-level default for a source ("*" = all sources).
export async function setGuildAcquisitionConfig(
  guildId: string, source: AcquisitionSource | "*", range: AcquisitionRangeInput, updatedBy?: string,
): Promise<void> {
  const n = normalizeRange(range);
  await db.insert(cardAcquisitionConfigTable)
    .values({ guildId, source, ...n, updatedBy: updatedBy ?? null })
    .onConflictDoUpdate({
      target: [cardAcquisitionConfigTable.guildId, cardAcquisitionConfigTable.source],
      set: { ...n, updatedAt: new Date(), updatedBy: updatedBy ?? null },
    });
}

export async function getGuildAcquisitionConfigs(guildId: string): Promise<CardAcquisitionConfig[]> {
  try {
    return await db.select().from(cardAcquisitionConfigTable)
      .where(eq(cardAcquisitionConfigTable.guildId, guildId));
  } catch { return []; }
}

// Per-card override ("the hub"). Wins over the guild default for that card.
export async function setCardAcquisitionOverride(
  guildId: string, cardId: number, source: AcquisitionSource | "*", range: AcquisitionRangeInput, updatedBy?: string,
): Promise<void> {
  const n = normalizeRange(range);
  await db.insert(cardAcquisitionOverridesTable)
    .values({ guildId, cardId, source, ...n, updatedBy: updatedBy ?? null })
    .onConflictDoUpdate({
      target: [cardAcquisitionOverridesTable.guildId, cardAcquisitionOverridesTable.cardId, cardAcquisitionOverridesTable.source],
      set: { ...n, updatedAt: new Date(), updatedBy: updatedBy ?? null },
    });
}

export async function deleteCardAcquisitionOverride(
  guildId: string, cardId: number, source: AcquisitionSource | "*",
): Promise<boolean> {
  const res = await db.delete(cardAcquisitionOverridesTable)
    .where(and(
      eq(cardAcquisitionOverridesTable.guildId, guildId),
      eq(cardAcquisitionOverridesTable.cardId, cardId),
      eq(cardAcquisitionOverridesTable.source, source),
    ))
    .returning({ id: cardAcquisitionOverridesTable.id });
  return res.length > 0;
}

export async function getCardAcquisitionOverrides(guildId: string, cardId?: number): Promise<CardAcquisitionOverride[]> {
  try {
    const where = cardId != null
      ? and(eq(cardAcquisitionOverridesTable.guildId, guildId), eq(cardAcquisitionOverridesTable.cardId, cardId))
      : eq(cardAcquisitionOverridesTable.guildId, guildId);
    return await db.select().from(cardAcquisitionOverridesTable).where(where);
  } catch { return []; }
}
