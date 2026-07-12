// Battle System — shared types.
//
// The combat model is intentionally data-driven so new game modes (2v2, boss
// raids, tower, arena, tournaments…) can reuse the exact same Combatant /
// BattleStats / combat-engine primitives without a rewrite. A "battle" is just
// N combatants on two sides with a turn order — everything else is layered on
// top of that.

import type { Rarity } from "../cards-data.js";

export type { Rarity };

export type AiDifficulty = "easy" | "normal" | "hard" | "expert" | "nightmare";

export const AI_DIFFICULTIES: AiDifficulty[] = ["easy", "normal", "hard", "expert", "nightmare"];

// Derived (or admin-overridden) combat stats for a single card.
export interface BattleStats {
  maxHealth: number;
  attack: number;
  defense: number;
  speed: number;
  luck: number;        // nudges crit / dodge / lucky events
  critChance: number;  // percent
  accuracy: number;    // percent
  dodge: number;       // percent
  energyMax: number;
  ultimateMax: number;
}

export type StatusKind =
  | "poison" | "burn" | "freeze" | "shield" | "reflect" | "buff" | "regen" | "weaken" | "stealth";

export interface StatusEffect {
  kind: StatusKind;
  turns: number;
  magnitude: number;   // dmg/turn, shield hp, or percent depending on kind
  label: string;
  emoji: string;
}

export interface Combatant {
  userId: string;          // "AI" for the computer
  displayName: string;
  isAi: boolean;
  aiDifficulty?: AiDifficulty;
  side: 0 | 1;

  cardId: number;
  cardName: string;
  cardRarity: Rarity;
  cardType: string;
  cardImageUrl: string | null;
  // Signature moveset key (see movesets engine) driving the "Special" move.
  // Optional so non-battle Combatant constructions stay valid; null → generic.
  moveset?: string | null;

  stats: BattleStats;
  hp: number;
  shield: number;
  energy: number;
  ultimate: number;        // 0..stats.ultimateMax
  status: StatusEffect[];

  // Optional special support card (a second owned card).
  specialCardId: number | null;
  specialCardName: string | null;
  specialEffect: string | null;   // effect key from special-cards engine
  specialCooldownMax: number;
  specialCooldownRemaining: number;

  // Transient per-turn flags.
  defending: boolean;
  nextAttackBoostPct: number;      // from Charge / buffs, consumed on next attack
  doubleNextAttack: boolean;
  frozenTurns: number;             // skips this many of the combatant's turns
  lastStandUsed: boolean;
}

export type MoveType =
  | "attack" | "special" | "defend" | "special_card" | "charge" | "skip" | "ultimate";

// A single visible line in the battle log.
export interface BattleEvent {
  text: string;
  // Animation hint — the embed builder can theme the frame around it.
  flash?: "crit" | "miss" | "dodge" | "counter" | "shield" | "shield_break"
    | "combo" | "laststand" | "ultimate" | "heal" | "ko" | "poison" | "burn" | "freeze";
}

export interface TurnResult {
  events: BattleEvent[];
  koed: boolean;           // did the defender get knocked out?
}
