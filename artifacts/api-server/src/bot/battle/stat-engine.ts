// Stat Engine — derives a battle-stat layer from existing card data.
//
// IMPORTANT: this NEVER modifies a card. It reads the card's rarity, worth, and
// type and produces a BattleStats object on the fly. Admins can override any
// stat per-guild via `battle_card_config` (the overrides win). Derivation is
// deterministic (seeded by card id/name) so a given card always has the same
// battle identity, but different cards feel distinct — a tank tanks, an
// aircraft is fast and evasive, etc.

import type { Card, BattleSettings, BattleCardConfig } from "@workspace/db";
import type { BattleStats, Rarity } from "./types.js";
import { rarityRank } from "./config-engine.js";

// Per-card-type archetype weighting. Multipliers applied to the derived base.
// Unknown types fall back to "balanced".
const ARCHETYPES: Record<string, Partial<Record<keyof BattleStats, number>>> = {
  tank:     { maxHealth: 1.35, defense: 1.4, attack: 0.95, speed: 0.75, dodge: 0.7 },
  ship:     { maxHealth: 1.3, defense: 1.25, attack: 1.05, speed: 0.7, dodge: 0.65 },
  boss:     { maxHealth: 1.45, defense: 1.2, attack: 1.3, speed: 0.85, critChance: 1.2 },
  aircraft: { maxHealth: 0.85, defense: 0.8, attack: 1.15, speed: 1.45, dodge: 1.5, critChance: 1.2 },
  vehicle:  { maxHealth: 1.0, defense: 1.0, attack: 1.05, speed: 1.05 },
  infantry: { maxHealth: 0.9, defense: 0.95, attack: 1.15, speed: 1.2, critChance: 1.15, accuracy: 1.1 },
  community:{ maxHealth: 1.1, defense: 1.1, attack: 1.1, speed: 1.1, luck: 1.4 },
  event:    { maxHealth: 1.1, defense: 1.05, attack: 1.15, speed: 1.05, luck: 1.2 },
  limited:  { maxHealth: 1.15, defense: 1.1, attack: 1.2, speed: 1.05, critChance: 1.15 },
  achievement: { maxHealth: 1.1, defense: 1.1, attack: 1.1, speed: 1.1 },
};

// Small deterministic hash → 0..1, seeded by card id + name.
function seeded(cardId: number, name: string, salt: number): number {
  let h = 2166136261 ^ (cardId * 2654435761) ^ (salt * 40503);
  for (let i = 0; i < name.length; i++) {
    h ^= name.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  h ^= h >>> 13;
  return ((h >>> 0) % 10000) / 10000;
}

// Variance in ±spread around 1.0, deterministic per (card, salt).
function variance(cardId: number, name: string, salt: number, spread: number): number {
  return 1 + (seeded(cardId, name, salt) - 0.5) * 2 * spread;
}

export function deriveStats(
  card: Pick<Card, "id" | "name" | "rarity" | "worthValue" | "cardType">,
  settings: BattleSettings,
  effectiveRarity?: Rarity,
): BattleStats {
  const rarity = (effectiveRarity ?? (card.rarity as Rarity));
  const rank = rarityRank(rarity);
  const arch = ARCHETYPES[(card.cardType ?? "").toLowerCase()] ?? {};

  // Worth contributes a soft, capped bump so a 10k-worth legendary isn't 100×
  // stronger than a 200-worth rare — logarithmic-ish via sqrt.
  const worthBump = Math.min(400, Math.sqrt(Math.max(0, card.worthValue)));

  const baseHealth = settings.hpBase + rank * settings.hpPerRarity
    + Math.round((card.worthValue ?? 0) / Math.max(1, settings.hpWorthDivisor));
  const baseAttack = settings.attackBase + rank * settings.attackPerRarity + Math.round(worthBump / 12);
  const baseDefense = settings.defenseBase + rank * settings.defensePerRarity + Math.round(worthBump / 20);
  const baseSpeed = settings.speedBase + rank * 6;

  const apply = (key: keyof BattleStats, base: number, salt: number, spread: number): number => {
    const mult = arch[key] ?? 1;
    return Math.max(1, Math.round(base * mult * variance(card.id, card.name, salt, spread)));
  };

  const luck = Math.round((10 + rank * 3) * (arch.luck ?? 1) * variance(card.id, card.name, 7, 0.25));

  return {
    maxHealth: apply("maxHealth", baseHealth, 1, 0.08),
    attack: apply("attack", baseAttack, 2, 0.12),
    defense: apply("defense", baseDefense, 3, 0.12),
    speed: apply("speed", baseSpeed, 4, 0.15),
    luck,
    critChance: clampPct(Math.round((settings.critChancePct + rank * 1.5) * (arch.critChance ?? 1) * variance(card.id, card.name, 5, 0.2)), 3, 60),
    accuracy: clampPct(Math.round((88 + rank) * (arch.accuracy ?? 1)), 60, 100),
    dodge: clampPct(Math.round((settings.dodgeChancePct + rank) * (arch.dodge ?? 1) * variance(card.id, card.name, 6, 0.2)), 0, 55),
    energyMax: 100,
    ultimateMax: settings.ultimateThreshold,
  };
}

function clampPct(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

// Merge admin overrides (from battle_card_config) onto derived stats. Any null
// column falls back to the derived value.
export function applyStatOverrides(
  derived: BattleStats, cfg: BattleCardConfig | undefined | null,
): BattleStats {
  if (!cfg) return derived;
  return {
    maxHealth: cfg.health ?? derived.maxHealth,
    attack: cfg.attack ?? derived.attack,
    defense: cfg.defense ?? derived.defense,
    speed: cfg.speed ?? derived.speed,
    luck: cfg.luck ?? derived.luck,
    critChance: cfg.critChance ?? derived.critChance,
    accuracy: cfg.accuracy ?? derived.accuracy,
    dodge: cfg.dodge ?? derived.dodge,
    energyMax: cfg.energyMax ?? derived.energyMax,
    ultimateMax: cfg.ultimateMax ?? derived.ultimateMax,
  };
}

// A compact "power rating" used for AI card picks + matchmaking display.
export function powerRating(s: BattleStats): number {
  return Math.round(
    s.maxHealth * 0.5 + s.attack * 2 + s.defense * 1.5 + s.speed * 1.2
    + s.critChance * 3 + s.dodge * 2 + s.luck * 1.5,
  );
}
