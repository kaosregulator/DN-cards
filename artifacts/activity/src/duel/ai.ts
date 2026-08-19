// ─────────────────────────────────────────────────────────────────────────────
// Duel AI — a compact, readable opponent. Plans ONE action at a time so the
// DuelScene can animate cleanly between moves, and answers response windows
// (chain) when it is the one being attacked / reacted to.
// ─────────────────────────────────────────────────────────────────────────────

import {
  boardOf, foeOf, effAtk, effDef, tributesNeeded, hasAnyMonster, monstersThatCanAttack,
  responseOptions, bestExtraDeckFusion,
} from "./engine";
import { targetSpecFor } from "./effects";
import type { DuelState, MonsterPosition, TargetRef, PlayerId } from "./types";

export type AiAction =
  | { type: "summon"; handIndex: number; position: MonsterPosition; tributeZones: number[] }
  | { type: "set"; handIndex: number }
  | { type: "activateSpell"; handIndex: number; targets: TargetRef[] }
  | { type: "toBattle" }
  | { type: "attack"; fromZone: number; target: number | "direct" }
  | { type: "end" };

const AI = "opponent" as const;

export function planNextAction(state: DuelState): AiAction | null {
  if (state.winner || state.awaiting) return null;
  if (state.turn !== AI) return null;
  const me = boardOf(state, AI);
  const foe = foeOf(state, AI);

  if (state.phase === "MAIN1") {
    // 1) A clearly good Spell (removal / draw / reborn) BEFORE summoning.
    const spell = pickSpell(state);
    if (spell) return spell;
    // 2) Normal Summon the best monster we can afford.
    if (!me.hasNormalSummoned) {
      const summon = pickSummon(state);
      if (summon) return summon;
    }
    // 3) Set a Trap to threaten the player.
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
        const score = atk + 100000;
        if (score > bestScore) { bestScore = score; best = { type: "attack", fromZone: z, target: "direct" }; }
        continue;
      }
      foe.monsters.forEach((d, dz) => {
        if (!d) return;
        if (d.position === "attack") {
          if (atk > effAtk(d)) {
            const score = (atk - effAtk(d)) + effAtk(d);
            if (score > bestScore) { bestScore = score; best = { type: "attack", fromZone: z, target: dz }; }
          }
        } else {
          const dv = d.faceUp ? effDef(d) : Math.min(effDef(d), 1600);
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

  return { type: "end" };
}

/** Decide whether to answer an open response window (returns the zone to activate). */
export function planResponse(state: DuelState): { zone: number; targets: TargetRef[] } | null {
  if (!state.awaiting || state.awaiting.responder !== AI) return null;
  const opts = responseOptions(state);
  if (opts.length === 0) return null;
  // Prefer the strongest answer: negate/destroy over reflect.
  const rank = (k: string) => (k === "trap:mirror" ? 4 : k === "trap:sakuretsu" ? 3 : k === "trap:cylinder" ? 3 : k === "trap:negateAttack" ? 2 : k === "trap:trapHole" ? 4 : 1);
  const best = [...opts].sort((a, b) => rank(b.effect.kind) - rank(a.effect.kind))[0]!;
  return { zone: best.zone, targets: [] };
}

// ── Spell selection with targets ──────────────────────────────────────────────
function pickSpell(state: DuelState): AiAction | null {
  const me = boardOf(state, AI);
  const foe = foeOf(state, AI);
  const foeMonsters = foe.monsters.filter((m) => m !== null).length;
  const myMonsters = me.monsters.filter((m) => m !== null).length;
  const foeBest = Math.max(0, ...foe.monsters.map((m) => (m && m.faceUp ? effAtk(m) : 0)));

  for (let i = 0; i < me.hand.length; i++) {
    const c = me.hand[i];
    if (!c || c.kind !== "spell" || !c.effect) continue;
    const eff = c.effect;
    const targets = () => targetsFor(state, eff.kind);
    switch (eff.kind) {
      case "spell:draw": return { type: "activateSpell", handIndex: i, targets: [] };
      case "spell:fusion": {
        // Fuse the two biggest monsters we control if that clears the bar.
        const owned = me.monsters
          .map((m, z) => ({ m, z })).filter((x) => x.m)
          .sort((a, b) => b.m!.card.level - a.m!.card.level)
          .slice(0, 2);
        if (owned.length < 2) break;
        const levelSum = owned.reduce((n, x) => n + x.m!.card.level, 0);
        const pick = bestExtraDeckFusion(me, levelSum);
        // Only worth it if the Fusion beats both materials.
        if (!pick || pick.atk <= Math.max(...owned.map((x) => effAtk(x.m!)))) break;
        return {
          type: "activateSpell", handIndex: i,
          targets: owned.map((x) => ({ side: AI, kind: "monster", zone: x.z }) as TargetRef),
        };
      }
      case "spell:destroyAllOpp": if (foeMonsters >= 1) return act(i); break;
      case "spell:destroyAll": if (foeMonsters > myMonsters) return act(i); break;
      case "spell:fissure": if (foeMonsters >= 1) return act(i); break;
      case "spell:destroyTarget": { const t = targets(); if (t.length) return { type: "activateSpell", handIndex: i, targets: t }; break; }
      case "spell:destroySpellTrap": { const t = targets(); if (t.length) return { type: "activateSpell", handIndex: i, targets: t }; break; }
      case "spell:reborn": { const t = targets(); if (t.length) return { type: "activateSpell", handIndex: i, targets: t }; break; }
      case "spell:heal": if (me.lp < state.startingLp * 0.5) return act(i); break;
      case "spell:boost": if (myMonsters >= 1 && foeBest === 0) return act(i); break;
      case "continuous:allyAtk": if (myMonsters >= 1) return act(i); break;
      case "equip:atk": { const t = targets(); if (t.length) return { type: "activateSpell", handIndex: i, targets: t }; break; }
      default: break;
    }
  }
  return null;

  function act(i: number): AiAction { return { type: "activateSpell", handIndex: i, targets: [] }; }
}

/** Compute AI targets for a targeting effect. */
function targetsFor(state: DuelState, kind: string): TargetRef[] {
  const me = boardOf(state, AI);
  const foe = foeOf(state, AI);
  const spec = targetSpecFor({ kind } as never);
  if (!spec) return [];
  if (spec.area === "monster") {
    if (kind === "equip:atk") { const z = strongestZone(me); return z >= 0 ? [{ side: AI, kind: "monster", zone: z }] : []; }
    const z = strongestZone(foe); return z >= 0 ? [{ side: foe.id, kind: "monster", zone: z }] : [];
  }
  if (spec.area === "spellTrap") {
    const z = foe.spellTraps.findIndex((s) => s !== null);
    return z >= 0 ? [{ side: foe.id, kind: "spellTrap", zone: z }] : [];
  }
  if (spec.area === "grave") {
    // Reborn: best monster in either graveyard.
    let bestSide: PlayerId = AI, bestIdx = -1, bestAtk = -1;
    for (const pid of [AI, foe.id] as PlayerId[]) {
      boardOf(state, pid).graveyard.forEach((c, idx) => {
        if (c.kind === "monster" && c.atk > bestAtk) { bestAtk = c.atk; bestIdx = idx; bestSide = pid; }
      });
    }
    return bestIdx >= 0 ? [{ side: bestSide, kind: "grave", index: bestIdx }] : [];
  }
  return [];
}
function strongestZone(b: import("./types").PlayerBoard): number {
  let best = -1, bestAtk = -1;
  b.monsters.forEach((m, z) => { if (m && effAtk(m) > bestAtk) { bestAtk = effAtk(m); best = z; } });
  return best;
}

function pickSummon(state: DuelState): AiAction | null {
  const me = boardOf(state, AI);
  const foe = foeOf(state, AI);
  const openZones = me.monsters.filter((m) => m === null).length;
  const foeBest = Math.max(0, ...foe.monsters.map((m) => (m && m.faceUp ? effAtk(m) : 0)));

  let bestIdx = -1, bestAtk = -1;
  me.hand.forEach((c, i) => {
    if (c.kind !== "monster") return;
    const need = tributesNeeded(c.level);
    const fieldCount = me.monsters.filter((m) => m !== null).length;
    if (need > fieldCount) return;
    if (need === 0 && openZones === 0) return;
    if (c.atk > bestAtk) { bestAtk = c.atk; bestIdx = i; }
  });
  if (bestIdx < 0) return null;

  const card = me.hand[bestIdx]!;
  const need = tributesNeeded(card.level);
  const tributeZones: number[] = [];
  if (need > 0) {
    const ranked = me.monsters.map((m, z) => ({ m, z })).filter((x) => x.m !== null)
      .sort((a, b) => effAtk(a.m!) - effAtk(b.m!)).slice(0, need).map((x) => x.z);
    if (ranked.length < need) return null;
    tributeZones.push(...ranked);
  }
  const position: MonsterPosition = card.atk > foeBest || foeBest === 0 ? "attack" : (card.def >= card.atk ? "set" : "defense");
  return { type: "summon", handIndex: bestIdx, position, tributeZones };
}
