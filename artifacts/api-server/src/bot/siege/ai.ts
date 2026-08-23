// ─────────────────────────────────────────────────────────────────────────────
// Siege Battle — AI commander.
//
// The AI has NO combat rules of its own. It picks from exactly the same
// `legalActions(state)` list a human's buttons are built from, and its choice is
// resolved by exactly the same resolver. It is a scoring function over legal
// actions, nothing more — so a garrison can never do something a player could
// not, and a rules change applies to both sides at once.
// ─────────────────────────────────────────────────────────────────────────────

import { getSiegeCard } from "./siege-cards.js";
import { livingSlots, lpExposed, otherSide, teamOf } from "./state.js";
import { legalActions } from "./resolver.js";
import type { SiegeAction, SiegeBattleState } from "./types.js";

/** How sharply the AI plays. Mirrors the /battle difficulty bands. */
export type SiegeAiSkill = "easy" | "normal" | "hard" | "nightmare";

const SKILL_NOISE: Record<SiegeAiSkill, number> = {
  easy: 60, normal: 28, hard: 10, nightmare: 0,
};

/**
 * Score an action. Higher is better. The heuristics are deliberately simple and
 * readable: finish wounded targets, spend a charged ultimate on a crowd, use the
 * hand, and go for LP the moment it is exposed.
 */
function score(state: SiegeBattleState, action: SiegeAction): number {
  const side = state.activeSide;
  const team = teamOf(state, side);
  const foes = teamOf(state, otherSide(side));
  const actor = team.slots[action.kind === "reinforce" ? 0 : action.actorSlot]?.unit;
  if (!actor) return -Infinity;

  const targetUnit = (slot?: number) =>
    slot == null ? null : foes.slots[slot]?.unit ?? null;

  switch (action.kind) {
    case "direct_lp":
      // Nothing is standing in the way — end it.
      return 1000 + actor.stats.attack;

    case "reinforce":
      return 900;

    case "move": {
      const t = targetUnit(action.targetSlot);
      const hpFrac = t ? t.hp / t.stats.maxHealth : 1;
      switch (action.move) {
        case "ultimate": {
          // Worth most against a full enemy line (it splashes) or a near-dead card.
          const crowd = livingSlots(foes).length;
          return 700 + crowd * 40 + (1 - hpFrac) * 120;
        }
        case "special":
          return 500 + (1 - hpFrac) * 150;
        case "attack":
          // Prefer finishing a wounded card over chipping a fresh one.
          return 400 + (1 - hpFrac) * 200;
        case "defend":
          return actor.hp / actor.stats.maxHealth < 0.3 ? 450 : 120;
        case "charge":
          return actor.energy < 30 ? 300 : 80;
        case "special_card":
          return 350;
        case "skip":
          return 10;
        default:
          return 50;
      }
    }

    case "siege_card": {
      const card = getSiegeCard(action.cardId);
      if (!card) return 0;
      const t = targetUnit(action.targetSlot);
      const hpFrac = t ? t.hp / t.stats.maxHealth : 1;
      let s = 520;
      switch (card.effect) {
        case "breakthrough": s = 1100; break;                       // straight to LP
        case "execute":      s = 800 + (1 - hpFrac) * 300; break;   // finisher
        case "focus_fire":   s = 780; break;
        case "cleave":       s = 700 + livingSlots(foes).length * 30; break;
        case "multi_strike": s = 600 + (1 - hpFrac) * 150; break;
        case "drain":        s = 560 + (1 - actor.hp / actor.stats.maxHealth) * 200; break;
        case "redeploy":     s = 850; break;
        case "rally":        s = 520 + livingSlots(team).length * 25; break;
        case "guard_order":  s = actor.hp / actor.stats.maxHealth < 0.4 ? 640 : 300; break;
        case "counter_order":s = 420; break;
        case "disrupt":      s = t && t.shield > 0 ? 640 : 380; break;
        case "overload":     s = 560 + (actor.ultimate / Math.max(1, actor.stats.ultimateMax)) * 300; break;
      }
      return s;
    }

    case "item": {
      const target = teamOf(state, action.targetSide).slots[action.targetSlot]?.unit;
      if (!target) return 0;
      const frac = target.hp / target.stats.maxHealth;
      // Heal an ally that actually needs it; otherwise items are low priority.
      return action.targetSide === side ? (frac < 0.4 ? 700 : 100) : 300;
    }
  }
}

/**
 * Choose this turn's action. Returns null only when the side genuinely has no
 * legal action (which the caller should treat as a skip).
 */
export function chooseSiegeAction(
  state: SiegeBattleState, skill: SiegeAiSkill = "normal",
  rng: () => number = Math.random,
): SiegeAction | null {
  const actions = legalActions(state);
  if (actions.length === 0) return null;

  // The moment LP is exposed, take the straight line to victory.
  const foes = teamOf(state, otherSide(state.activeSide));
  if (lpExposed(foes)) {
    const direct = actions.filter(a => a.kind === "direct_lp"
      || (a.kind === "siege_card" && getSiegeCard(a.cardId)?.effect === "breakthrough"));
    if (direct.length) return direct[Math.floor(rng() * direct.length)]!;
  }

  const noise = SKILL_NOISE[skill];
  let best: SiegeAction | null = null;
  let bestScore = -Infinity;
  for (const a of actions) {
    const s = score(state, a) + (noise ? (rng() - 0.5) * 2 * noise * 10 : 0);
    if (s > bestScore) { bestScore = s; best = a; }
  }
  return best;
}
