// ─────────────────────────────────────────────────────────────────────────────
// Effect metadata — pure classification helpers the engine and UI/AI share to
// decide what a card needs (targets) and when it can be activated. The actual
// state mutation (resolveEffect) lives in engine.ts to avoid a circular import.
// ─────────────────────────────────────────────────────────────────────────────

import type { DuelEffect } from "./types";

export interface TargetSpec {
  area: "monster" | "spellTrap" | "grave";
  side: "own" | "opp" | "any";
  count: number;
  faceUpOnly?: boolean;
}

/** What this effect must target before it can resolve (null = no target). */
export function targetSpecFor(effect: DuelEffect | null): TargetSpec | null {
  if (!effect) return null;
  switch (effect.kind) {
    case "spell:destroyTarget": return { area: "monster", side: "opp", count: 1 };
    case "spell:destroySpellTrap": return { area: "spellTrap", side: "any", count: 1 };
    case "spell:flipTarget": return { area: "monster", side: "any", count: 1, faceUpOnly: true };
    case "spell:reborn": return { area: "grave", side: "any", count: 1 };
    case "trap:reborn": return { area: "grave", side: "own", count: 1 };
    case "equip:atk": return { area: "monster", side: "own", count: 1 };
    case "flip:destroy": return { area: "monster", side: "opp", count: 1 };
    default: return null;
  }
}

/** Equip/Continuous/Field spells stay face-up on the field instead of going to the GY. */
export function isPersistentSpell(effect: DuelEffect | null): boolean {
  if (!effect) return false;
  return effect.kind === "equip:atk" || effect.kind === "continuous:allyAtk" || effect.kind === "field:attrBoost";
}

/** Traps that answer an attack declaration (Battle Step timing). */
export function trapReactsToAttack(effect: DuelEffect | null): boolean {
  if (!effect) return false;
  return effect.kind === "trap:mirror" || effect.kind === "trap:cylinder"
    || effect.kind === "trap:sakuretsu" || effect.kind === "trap:negateAttack";
}

/** Traps that answer a monster being summoned. */
export function trapReactsToSummon(effect: DuelEffect | null): boolean {
  return effect?.kind === "trap:trapHole";
}

/** Traps the controller activates on their own turn (slow, Main-Phase timing). */
export function trapIsMainPhase(effect: DuelEffect | null): boolean {
  return effect?.kind === "trap:reborn";
}

export function isSpellEffect(effect: DuelEffect | null): boolean {
  return !!effect && effect.kind.startsWith("spell:") || isPersistentSpell(effect);
}
