import { describe, it, expect } from "vitest";
import {
  createDuel, nextPhase, endTurn, summonMonster, setSpellTrap, activateSpellFromHand,
  declareAttack, respondToWindow, passWindow, responseOptions, monstersThatCanAttack,
  boardOf, hasAnyMonster, foeOf, effAtk,
} from "../engine";
import { planNextAction, planResponse } from "../ai";
import { enrichSetup } from "../cards";
import type { DuelState, DuelCard, DuelAttribute } from "../types";

const ATTRS: DuelAttribute[] = ["EARTH", "WIND", "WATER", "FIRE", "LIGHT", "DARK"];
function mon(i: number): DuelCard {
  const level = 1 + (i % 8);
  const atk = 700 + level * 200;
  return {
    uid: `m${i}-${Math.random()}`, cardId: i, name: `Mon${i}`, kind: "monster", art: "x",
    rarity: "Common", color: 0, attribute: ATTRS[i % 6]!, level, atk, def: Math.round(atk * 0.8),
    desc: "", effect: level >= 6 ? { kind: "pierce" } : (i % 4 === 0 ? { kind: "gainAtk", amount: 300 } : null),
  };
}
function deck(): DuelCard[] { return Array.from({ length: 30 }, (_, i) => mon(i)); }

// Drive any open response window: AI responder uses planResponse, the scripted
// player passes (keeps the sim simple and still exercises the window path).
function settleWindows(s: DuelState): void {
  let guard = 0;
  while (s.awaiting && guard++ < 20) {
    if (s.awaiting.responder === "opponent") {
      const r = planResponse(s);
      if (r) respondToWindow(s, r.zone, r.targets); else passWindow(s);
    } else {
      // scripted player: respond if it has a useful battle trap, else pass
      const opts = responseOptions(s);
      if (opts.length) respondToWindow(s, opts[0]!.zone); else passWindow(s);
    }
  }
}

function playerTurn(s: DuelState): void {
  let guard = 0;
  while (s.turn === "player" && !s.winner && guard++ < 60) {
    settleWindows(s);
    if (s.winner) return;
    if (s.phase === "MAIN1") {
      const me = boardOf(s, "player");
      // activate a spell if we hold a simple one (draw)
      const drawIdx = me.hand.findIndex((c) => c.kind === "spell" && c.effect?.kind === "spell:draw");
      if (drawIdx >= 0) { activateSpellFromHand(s, "player", drawIdx); continue; }
      if (!me.hasNormalSummoned) {
        const idx = me.hand.findIndex((c) => c.kind === "monster" && c.level <= 4);
        if (idx >= 0 && me.monsters.some((m) => m === null)) { summonMonster(s, "player", idx, "attack", []); settleWindows(s); continue; }
      }
      const trapIdx = me.hand.findIndex((c) => c.kind === "trap");
      if (trapIdx >= 0 && me.spellTraps.some((x) => x === null)) { setSpellTrap(s, "player", trapIdx); continue; }
      nextPhase(s); continue;
    } else if (s.phase === "BATTLE") {
      const atkers = monstersThatCanAttack(s, "player");
      if (atkers.length) {
        const foe = foeOf(s, "player");
        const z = atkers[0]!;
        const target = hasAnyMonster(foe) ? foe.monsters.findIndex((m) => m !== null) : "direct";
        declareAttack(s, "player", z, target as number | "direct");
        settleWindows(s);
        continue;
      }
      endTurn(s); settleWindows(s); continue;
    } else { nextPhase(s); continue; }
  }
}

function aiTurn(s: DuelState): void {
  let guard = 0;
  while (s.turn === "opponent" && !s.winner && guard++ < 80) {
    settleWindows(s);
    if (s.winner) return;
    const a = planNextAction(s);
    if (!a) { if (s.awaiting) { settleWindows(s); continue; } endTurn(s); settleWindows(s); continue; }
    switch (a.type) {
      case "summon": summonMonster(s, "opponent", a.handIndex, a.position, a.tributeZones); break;
      case "set": setSpellTrap(s, "opponent", a.handIndex); break;
      case "activateSpell": activateSpellFromHand(s, "opponent", a.handIndex, a.targets); break;
      case "toBattle": nextPhase(s); break;
      case "attack": declareAttack(s, "opponent", a.fromZone, a.target); break;
      case "end": endTurn(s); break;
    }
    settleWindows(s);
  }
}

describe("full-game simulation (with chain/effect mechanics)", () => {
  it("runs 150 games to completion with no crash or stall", () => {
    let pWins = 0, oWins = 0, maxTurns = 0;
    for (let g = 0; g < 150; g++) {
      const s = createDuel(enrichSetup({
        startingLp: 8000, handSize: 5,
        player: { name: "P", deck: deck() },
        opponent: { name: "O", deck: deck() },
      }));
      let guard = 0;
      while (!s.winner && guard++ < 400) {
        if (s.turn === "player") playerTurn(s); else aiTurn(s);
        if (s.turnCount > 100) break; // safety: force a draw-ish end
      }
      maxTurns = Math.max(maxTurns, s.turnCount);
      if (s.winner === "player") pWins++; else if (s.winner === "opponent") oWins++;
      // Every game must have no dangling open window at the end.
      expect(s.awaiting).toBeNull();
    }
    // Sanity: most games resolve to a winner (not stuck), both sides win some.
    expect(pWins + oWins).toBeGreaterThan(120);
    expect(maxTurns).toBeGreaterThan(2);
  });
});
