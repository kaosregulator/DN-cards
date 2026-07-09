// AI Engine — computer opponent.
//
// Picks a valid owned card (from whatever pool the caller supplies — for AI the
// caller passes the full eligible battle pool) and chooses moves each turn with
// difficulty-scaled intelligence. Easy is nearly random; Nightmare plays close
// to optimally, defends when low, banks energy, and spends ultimates decisively.

import type { BattleSettings } from "@workspace/db";
import type { Combatant, MoveType, AiDifficulty } from "./types.js";
import { availableMoves } from "./combat-engine.js";

const SKILL: Record<AiDifficulty, number> = {
  easy: 0.15, normal: 0.45, hard: 0.7, expert: 0.85, nightmare: 0.97,
};

// Choose an index into a scored pool. Higher difficulty → prefers stronger
// cards; easy picks (nearly) at random.
export function pickAiCardIndex(scores: number[], difficulty: AiDifficulty): number {
  if (scores.length === 0) return -1;
  const skill = SKILL[difficulty];
  if (Math.random() > skill) return Math.floor(Math.random() * scores.length);
  // Weighted toward the top: sort a copy, bias selection.
  const idx = scores.map((s, i) => ({ s, i })).sort((a, b) => b.s - a.s);
  const topN = Math.max(1, Math.round(idx.length * (1 - skill) + 1));
  const chosen = idx[Math.floor(Math.random() * topN)]!;
  return chosen.i;
}

export function chooseAiMove(
  actor: Combatant, foe: Combatant, settings: BattleSettings, difficulty: AiDifficulty,
): MoveType {
  const moves = availableMoves(actor, settings);
  const skill = SKILL[difficulty];
  const hpPct = actor.hp / actor.stats.maxHealth;
  const foeHpPct = foe.hp / foe.stats.maxHealth;

  // Random / dumb play for low skill or on a "mistake" roll.
  if (Math.random() > skill) {
    const pool: MoveType[] = ["attack", "attack", "charge", "defend", "skip"];
    if (moves.special) pool.push("special");
    return pool[Math.floor(Math.random() * pool.length)]!;
  }

  // Smart play.
  if (moves.ultimate) return "ultimate";                         // always cash a charged ult
  if (foeHpPct < 0.35 && moves.special) return "special";        // press the kill
  if (hpPct < 0.3) {
    if (moves.special_card && (actor.specialEffect === "heal" || actor.specialEffect === "shield")) return "special_card";
    if (Math.random() < 0.6) return "defend";
  }
  if (moves.special_card && Math.random() < 0.4) return "special_card";
  if (moves.special && actor.energy >= settings.specialCost && Math.random() < 0.6) return "special";
  if (actor.energy < settings.specialCost && Math.random() < 0.3) return "charge";
  return "attack";
}

// Human-readable label used in the AI-offer prompt.
export const AI_LABELS: Record<AiDifficulty, string> = {
  easy: "🟢 Easy", normal: "🔵 Normal", hard: "🟠 Hard", expert: "🔴 Expert", nightmare: "💀 Nightmare",
};
