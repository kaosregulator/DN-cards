// ─────────────────────────────────────────────────────────────────────────────
// Duel actions — the serialisable move vocabulary.
//
// Every move a player can make is expressed as one plain-JSON DuelAction and
// applied through applyAction(). Online duels send these objects over the wire:
// both clients run the same engine over the same seeded state, so replaying the
// identical action stream keeps the two boards in lockstep without ever
// shipping game state across the network.
// ─────────────────────────────────────────────────────────────────────────────

import type { DuelState, DuelEvent, PlayerId, MonsterPosition, TargetRef } from "./types";
import {
  summonMonster, setSpellTrap, activateSpellFromHand, activateSetCard,
  changePosition, declareAttack, nextPhase, endTurn, respondToWindow, passWindow,
} from "./engine";

export type DuelAction =
  | { k: "summon"; handIndex: number; position: MonsterPosition; tributeZones: number[] }
  | { k: "set"; handIndex: number }
  | { k: "activateHand"; handIndex: number; targets: TargetRef[] }
  | { k: "activateSet"; zone: number; targets: TargetRef[] }
  | { k: "changePos"; zone: number }
  | { k: "attack"; fromZone: number; target: number | "direct" }
  | { k: "phase" }
  | { k: "endTurn" }
  | { k: "respond"; zone: number }
  | { k: "pass" };

/** Apply one action on behalf of `who`. Returns the engine's event stream. */
export function applyAction(state: DuelState, who: PlayerId, a: DuelAction): DuelEvent[] {
  switch (a.k) {
    case "summon": return summonMonster(state, who, a.handIndex, a.position, a.tributeZones);
    case "set": return setSpellTrap(state, who, a.handIndex);
    case "activateHand": return activateSpellFromHand(state, who, a.handIndex, a.targets);
    case "activateSet": return activateSetCard(state, who, a.zone, a.targets);
    case "changePos": return changePosition(state, who, a.zone);
    case "attack": return declareAttack(state, who, a.fromZone, a.target);
    case "phase": return nextPhase(state);
    case "endTurn": return endTurn(state);
    case "respond": return respondToWindow(state, a.zone);
    case "pass": return passWindow(state);
  }
}

/** Reject anything that isn't a well-formed action before it touches the engine. */
export function isDuelAction(v: unknown): v is DuelAction {
  if (!v || typeof v !== "object") return false;
  const a = v as Record<string, unknown>;
  const int = (n: unknown) => Number.isInteger(n);
  switch (a.k) {
    case "summon":
      return int(a.handIndex)
        && (a.position === "attack" || a.position === "defense" || a.position === "set")
        && Array.isArray(a.tributeZones) && a.tributeZones.every(int);
    case "set": return int(a.handIndex);
    case "activateHand": return int(a.handIndex) && Array.isArray(a.targets);
    case "activateSet": return int(a.zone) && Array.isArray(a.targets);
    case "changePos": return int(a.zone);
    case "attack": return int(a.fromZone) && (a.target === "direct" || int(a.target));
    case "phase": case "endTurn": case "pass": return true;
    case "respond": return int(a.zone);
    default: return false;
  }
}
