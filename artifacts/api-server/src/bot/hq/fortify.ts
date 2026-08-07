// ─────────────────────────────────────────────────────────────────────────────
// HQ — base fortification (the tower-defence layer).
//
// This is what makes Build mode MATTER in combat. A player's base defence in a
// siege is no longer just its garrison cards: the walls, towers, moats and traps
// they BUILD on the grounds (hq_terrain, roomId "base") harden that garrison, and
// a purchased base UPGRADE tier adds a flat bonus on top.
//
// A fortification is a single percentage applied to the DEFENDING side's power /
// stats when a siege resolves (see hq/siege.ts + hq/siege-battle.ts). It is pure
// and derived — nothing here writes state:
//
//   totalPct = min(CAP, tier.fortifyPct + buildPct)
//   buildPct = min(BUILD_CAP, Σ(area × material.defense) × POINTS_TO_PCT)
//
// so stacking real defensive structures climbs toward a cap, and the base tier
// (bought with shards) guarantees a floor. Territories (AI-held) have no player
// build, so they simply pass 0 and are unaffected.
// ─────────────────────────────────────────────────────────────────────────────

import { surfaceDefense } from "./defs/surfaces.js";
import type { HqTerrainFeature } from "./render-terrain.js";

// ── Base upgrade ladder ───────────────────────────────────────────────────────
// Bought with shards from the base's 🏰 Defenses panel. Each tier is a flat
// fortification floor; `cost` is the price to reach it from the previous tier.
export interface BaseTier {
  level: number;
  label: string;
  emoji: string;
  cost: number;        // shards to upgrade INTO this tier
  fortifyPct: number;  // flat defence bonus at this tier
}

export const BASE_TIERS: BaseTier[] = [
  { level: 0, label: "Outpost",    emoji: "🏕️", cost: 0,     fortifyPct: 0 },
  { level: 1, label: "Stronghold", emoji: "🛖", cost: 1_500,  fortifyPct: 10 },
  { level: 2, label: "Fortress",   emoji: "🏰", cost: 4_000,  fortifyPct: 22 },
  { level: 3, label: "Citadel",    emoji: "🏯", cost: 9_000,  fortifyPct: 36 },
  { level: 4, label: "Bastion",    emoji: "🏛️", cost: 18_000, fortifyPct: 52 },
];

export const MAX_BASE_TIER = BASE_TIERS[BASE_TIERS.length - 1]!.level;

/** Resolve a stored tier level to its record, clamped to the valid range. */
export function baseTier(level: number | null | undefined): BaseTier {
  const l = Math.max(0, Math.min(MAX_BASE_TIER, Math.floor(level ?? 0)));
  return BASE_TIERS[l] ?? BASE_TIERS[0]!;
}

/** The next tier up (for the Upgrade button), or null at max. */
export function nextBaseTier(level: number | null | undefined): BaseTier | null {
  const t = baseTier(level);
  return BASE_TIERS[t.level + 1] ?? null;
}

// ── Built-defence fortification ───────────────────────────────────────────────
const POINTS_TO_PCT = 0.35;   // fortification % per defence point
const BUILD_FORTIFY_CAP = 60; // most a build alone can contribute
export const FORTIFY_TOTAL_CAP = 85; // ceiling on tier + build combined

/** Raw defence points a built layout contributes (area × per-tile defence). */
export function buildDefensePoints(features: HqTerrainFeature[]): number {
  let pts = 0;
  for (const f of features) {
    const d = surfaceDefense(f.materialId);
    if (d > 0) pts += d * Math.max(1, f.w) * Math.max(1, f.h);
  }
  return pts;
}

/** The fortification % from built defences alone, capped. */
export function buildFortifyPct(features: HqTerrainFeature[]): number {
  return Math.min(BUILD_FORTIFY_CAP, Math.round(buildDefensePoints(features) * POINTS_TO_PCT));
}

export interface Fortification {
  tier: BaseTier;
  tierPct: number;   // from the base upgrade tier
  buildPct: number;  // from placed defensive structures
  totalPct: number;  // min(CAP, tierPct + buildPct) — what the siege applies
  points: number;    // raw build points (for the defences readout)
}

/** The full fortification for a base: its upgrade tier + what it has built. */
export function computeFortification(
  features: HqTerrainFeature[], tierLevel: number | null | undefined,
): Fortification {
  const tier = baseTier(tierLevel);
  const points = buildDefensePoints(features);
  const buildPct = Math.min(BUILD_FORTIFY_CAP, Math.round(points * POINTS_TO_PCT));
  const totalPct = Math.min(FORTIFY_TOTAL_CAP, tier.fortifyPct + buildPct);
  return { tier, tierPct: tier.fortifyPct, buildPct, totalPct, points };
}

// ── Purchasable shields ───────────────────────────────────────────────────────
// A shield keeps a base un-attackable until it expires (writes hqBaseState.
// shieldUntil). Sold from the same 🏰 Defenses panel.
export interface ShieldProduct { id: string; label: string; emoji: string; hours: number; cost: number; }

export const SHIELD_PRODUCTS: ShieldProduct[] = [
  { id: "shield6",  label: "6-Hour Shield",  emoji: "🛡️", hours: 6,  cost: 400 },
  { id: "shield24", label: "24-Hour Shield", emoji: "🛡️", hours: 24, cost: 1_200 },
  { id: "shield72", label: "3-Day Shield",   emoji: "🛡️", hours: 72, cost: 3_000 },
];

export function shieldProduct(id: string): ShieldProduct | undefined {
  return SHIELD_PRODUCTS.find(s => s.id === id);
}
