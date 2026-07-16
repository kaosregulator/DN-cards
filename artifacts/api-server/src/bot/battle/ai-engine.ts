// AI Engine — computer opponent.
//
// Picks a valid owned card (from whatever pool the caller supplies — for AI the
// caller passes the full eligible battle pool) and chooses moves each turn with
// difficulty-scaled intelligence. Easy is nearly random; Nightmare plays close
// to optimally, defends when low, banks energy, and spends ultimates decisively.

import type { BattleSettings } from "@workspace/db";
import type { Combatant, MoveType, AiDifficulty } from "./types.js";
import { getArena } from "./arenas.js";
import { availableMoves } from "./combat-engine.js";
import { getBattleItem } from "./items.js";

// AI tactical skill (0..1) now comes from the chosen ARENA — higher arenas play
// sharper. `AiDifficulty` is an alias for the arena key.
function skillFor(arena: AiDifficulty): number {
  return getArena(arena).aiSkill;
}

// Choose an index into a scored pool. Higher arenas → prefer stronger cards;
// the Beginner arena picks (nearly) at random.
export function pickAiCardIndex(scores: number[], difficulty: AiDifficulty): number {
  if (scores.length === 0) return -1;
  const skill = skillFor(difficulty);
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
  const skill = skillFor(difficulty);
  const hpPct = actor.hp / actor.stats.maxHealth;
  const foeHpPct = foe.hp / foe.stats.maxHealth;

  // Battle-item intelligence — decide whether THIS turn is the moment to use the
  // equipped item, based on its effect and the current battle state. Evaluated
  // for smart play; low-skill AI only stumbles into it randomly below.
  const item = moves.item ? getBattleItem(actor.itemId) : null;

  // Random / dumb play for low skill or on a "mistake" roll.
  if (Math.random() > skill) {
    const pool: MoveType[] = ["attack", "attack", "charge", "defend", "skip"];
    if (moves.special) pool.push("special");
    if (moves.item) pool.push("item");
    return pool[Math.floor(Math.random() * pool.length)]!;
  }

  // Use the battle item when it's genuinely the right call.
  if (item) {
    const energyPct = actor.energy / Math.max(1, actor.stats.energyMax);
    switch (item.effectType) {
      case "heal":
        if (hpPct < 0.5) return "item";                          // heal before it's too late
        break;
      case "shield":
        if (hpPct < 0.55 && foeHpPct > 0.4) return "item";       // brace when the fight will drag
        break;
      case "energy":
        if (energyPct < 0.3) return "item";                      // top up to unlock the Special
        break;
      case "damage":
        if (foeHpPct < 0.3 || foe.shield > 0 || Math.random() < 0.4) return "item"; // finish / burst
        break;
      case "debuff":
        if (foeHpPct > 0.5) return "item";                       // cripple a healthy foe early
        break;
      case "buff":
      case "status":
        if (hpPct > 0.4 && Math.random() < 0.5) return "item";   // set up while healthy
        break;
    }
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

// Human-readable arena label used in the AI-offer prompt (delegates to the
// arena registry so labels never drift).
export { arenaLabel as AI_LABEL } from "./arenas.js";
