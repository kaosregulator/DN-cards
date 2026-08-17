// ─────────────────────────────────────────────────────────────────────────────
// Duel AI — a compact, readable opponent. It plans ONE action at a time given
// the current state, so the DuelScene can animate cleanly between moves (summon,
// set, attack, end) instead of resolving a whole turn in a single frame.
// ─────────────────────────────────────────────────────────────────────────────

import {
  boardOf, foeOf, effAtk, effDef, tributesNeeded, hasAnyMonster, monstersThatCanAttack,
} from "./engine";
import type { DuelState, MonsterPosition } from "./types";

export type AiAction =
  | { type: "summon"; handIndex: number; position: MonsterPosition; tributeZones: number[] }
  | { type: "set"; handIndex: number }
  | { type: "activateSpell"; handIndex: number }
  | { type: "toBattle" }
  | { type: "attack"; fromZone: number; target: number | "direct" }
  | { type: "end" };

const AI = "opponent" as const;

export function planNextAction(state: DuelState): AiAction | null {
  if (state.winner) return null;
  if (state.turn !== AI) return null;
  const me = boardOf(state, AI);
  const foe = foeOf(state, AI);

  if (state.phase === "MAIN1") {
    // 1) Normal Summon the best monster we can afford.
    if (!me.hasNormalSummoned) {
      const summon = pickSummon(state);
      if (summon) return summon;
    }
    // 2) Play a clearly beneficial Spell from hand.
    const spellIdx = me.hand.findIndex((c) => c.kind === "spell" && c.effect &&
      (c.effect.kind === "spell:draw" ||
       (c.effect.kind === "spell:heal" && me.lp < state.startingLp * 0.6) ||
       (c.effect.kind === "spell:boost" && hasAnyMonster(me))));
    if (spellIdx >= 0) return { type: "activateSpell", handIndex: spellIdx };
    // 3) Set a Trap face-down to threaten the player.
    const trapIdx = me.hand.findIndex((c) => c.kind === "trap");
    if (trapIdx >= 0 && me.spellTraps.some((s) => s === null)) return { type: "set", handIndex: trapIdx };
    // 4) Move to Battle if we have attackers, else pass.
    if (me.monsters.some((m) => m && m.faceUp && m.position === "attack")) return { type: "toBattle" };
    return { type: "end" };
  }

  if (state.phase === "BATTLE") {
    const attackers = monstersThatCanAttack(state, AI);
    let best: AiAction | null = null;
    let bestScore = -Infinity;
    for (const z of attackers) {
      const m = me.monsters[z]!;
      const atk = effAtk(m);
      if (!hasAnyMonster(foe)) {
        // Direct attack — score by raw damage.
        const score = atk + 100000; // strongly prefer a direct hit
        if (score > bestScore) { bestScore = score; best = { type: "attack", fromZone: z, target: "direct" }; }
        continue;
      }
      // Find the best monster we can beat without dying.
      foe.monsters.forEach((d, dz) => {
        if (!d) return;
        const dv = d.position === "attack" ? effAtk(d) : (d.faceUp ? effDef(d) : Math.min(effDef(d), 1600));
        if (d.position === "attack") {
          if (atk > effAtk(d)) {
            const score = (atk - effAtk(d)) + effAtk(d); // reward killing a big threat
            if (score > bestScore) { bestScore = score; best = { type: "attack", fromZone: z, target: dz }; }
          }
        } else {
          if (atk > dv) {
            const score = 500 + (m.card.effect?.kind === "pierce" ? atk - dv : 0);
            if (score > bestScore) { bestScore = score; best = { type: "attack", fromZone: z, target: dz }; }
          }
        }
      });
    }
    if (best) return best;
    return { type: "end" };
  }

  // Any other phase: just end the turn.
  return { type: "end" };
}

/** Choose the strongest affordable monster + a sensible battle position. */
function pickSummon(state: DuelState): AiAction | null {
  const me = boardOf(state, AI);
  const foe = foeOf(state, AI);
  const openZones = me.monsters.filter((m) => m === null).length;
  const foeBest = Math.max(0, ...foe.monsters.map((m) => (m && m.faceUp ? effAtk(m) : 0)));

  let bestIdx = -1;
  let bestAtk = -1;
  me.hand.forEach((c, i) => {
    if (c.kind !== "monster") return;
    const need = tributesNeeded(c.level);
    const fieldCount = me.monsters.filter((m) => m !== null).length;
    // Need at least `need` tributes on field and a zone left after tributing.
    if (need > fieldCount) return;
    if (need === 0 && openZones === 0) return;
    if (c.atk > bestAtk) { bestAtk = c.atk; bestIdx = i; }
  });
  if (bestIdx < 0) return null;

  const card = me.hand[bestIdx]!;
  const need = tributesNeeded(card.level);
  // Tribute the weakest own monsters if needed.
  const tributeZones: number[] = [];
  if (need > 0) {
    const ranked = me.monsters
      .map((m, z) => ({ m, z }))
      .filter((x) => x.m !== null)
      .sort((a, b) => effAtk(a.m!) - effAtk(b.m!))
      .slice(0, need)
      .map((x) => x.z);
    if (ranked.length < need) return null;
    tributeZones.push(...ranked);
  }
  // Position: attack if it beats the player's best (or player has none); else set defensively.
  const position: MonsterPosition = card.atk > foeBest || foeBest === 0 ? "attack" : (card.def >= card.atk ? "set" : "defense");
  return { type: "summon", handIndex: bestIdx, position, tributeZones };
}
