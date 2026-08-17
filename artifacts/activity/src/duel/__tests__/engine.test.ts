import { describe, it, expect, beforeEach } from "vitest";
import {
  createDuel, summonMonster, declareAttack, nextPhase, endTurn, changePosition,
  tributesNeeded, boardOf, effAtk, effDef,
} from "../engine";
import type { DuelState, FieldMonster, MonsterPosition, PlayerId } from "../types";
import { monster, setupWith, freezeRandom } from "./helpers";

function place(state: DuelState, who: PlayerId, zone: number, atk: number, def = 1000, position: MonsterPosition = "attack", effect = null): void {
  const m: FieldMonster = {
    card: monster(`Z${zone}`, atk, def, 4, effect), position,
    atkMod: 0, defMod: 0, turnBoost: 0, hasAttacked: 0, summonedThisTurn: false, faceUp: position !== "set",
  };
  boardOf(state, who).monsters[zone] = m;
}

function freshBattle(): DuelState {
  const s = createDuel(setupWith([], []));
  s.phase = "BATTLE";
  return s;
}

describe("phases & turns", () => {
  beforeEach(() => freezeRandom(0));

  it("starts player-first in Main Phase 1 with no opening draw", () => {
    const s = createDuel(setupWith([], []));
    expect(s.turn).toBe("player");
    expect(s.phase).toBe("MAIN1");
    expect(s.turnCount).toBe(1);
    expect(s.player.hand.length).toBe(5);
  });

  it("advances phases MAIN1 → BATTLE → MAIN2 → END", () => {
    const s = createDuel(setupWith([], []));
    nextPhase(s); expect(s.phase).toBe("BATTLE");
    nextPhase(s); expect(s.phase).toBe("MAIN2");
    nextPhase(s); expect(s.phase).toBe("END");
  });

  it("endTurn passes to opponent, draws for them, lands in MAIN1", () => {
    const s = createDuel(setupWith([], []));
    const before = s.opponent.hand.length;
    endTurn(s);
    expect(s.turn).toBe("opponent");
    expect(s.phase).toBe("MAIN1");
    expect(s.opponent.hand.length).toBe(before + 1);
    expect(s.turnCount).toBe(2);
  });
});

describe("summoning", () => {
  beforeEach(() => freezeRandom(0));

  it("tribute costs by level", () => {
    expect(tributesNeeded(4)).toBe(0);
    expect(tributesNeeded(5)).toBe(1);
    expect(tributesNeeded(6)).toBe(1);
    expect(tributesNeeded(7)).toBe(2);
    expect(tributesNeeded(12)).toBe(2);
  });

  it("normal summons a level-4 monster with no tribute", () => {
    const s = createDuel(setupWith([], []));
    s.player.hand = [monster("Beater", 1800, 1000, 4)];
    summonMonster(s, "player", 0, "attack", []);
    expect(s.player.monsters.filter(Boolean).length).toBe(1);
    expect(s.player.hasNormalSummoned).toBe(true);
    expect(s.player.hand.length).toBe(0);
  });

  it("blocks a second normal summon in one turn", () => {
    const s = createDuel(setupWith([], []));
    s.player.hand = [monster("A", 1800), monster("B", 1700)];
    summonMonster(s, "player", 0, "attack", []);
    summonMonster(s, "player", 0, "attack", []);
    expect(s.player.monsters.filter(Boolean).length).toBe(1);
  });

  it("requires and consumes tributes for a level-7 monster", () => {
    const s = createDuel(setupWith([], []));
    place(s, "player", 0, 1000);
    place(s, "player", 1, 1000);
    s.player.hand = [monster("Boss", 2500, 2000, 7)];
    // Without tributes: fails.
    summonMonster(s, "player", 0, "attack", []);
    expect(s.player.hand.length).toBe(1);
    // With 2 tributes: succeeds, tributes go to grave.
    summonMonster(s, "player", 0, "attack", [0, 1]);
    expect(s.player.graveyard.length).toBe(2);
    expect(s.player.monsters.filter(Boolean).length).toBe(1);
    expect(s.player.monsters.find((m) => m?.card.name === "Boss")).toBeTruthy();
  });
});

describe("combat math", () => {
  beforeEach(() => freezeRandom(0));

  it("attacker beats a weaker attack-position monster and deals the difference", () => {
    const s = freshBattle();
    place(s, "player", 0, 2000);
    place(s, "opponent", 0, 1500);
    declareAttack(s, "player", 0, 0);
    expect(s.opponent.monsters[0]).toBeNull();
    expect(s.opponent.lp).toBe(8000 - 500);
  });

  it("attacker into a stronger monster dies and controller takes the difference", () => {
    const s = freshBattle();
    place(s, "player", 0, 1200);
    place(s, "opponent", 0, 1800);
    declareAttack(s, "player", 0, 0);
    expect(s.player.monsters[0]).toBeNull();
    expect(s.player.lp).toBe(8000 - 600);
  });

  it("equal ATK destroys both, no damage", () => {
    const s = freshBattle();
    place(s, "player", 0, 1500);
    place(s, "opponent", 0, 1500);
    declareAttack(s, "player", 0, 0);
    expect(s.player.monsters[0]).toBeNull();
    expect(s.opponent.monsters[0]).toBeNull();
    expect(s.player.lp).toBe(8000);
    expect(s.opponent.lp).toBe(8000);
  });

  it("attacking a defense monster: higher ATK destroys, no LP loss without pierce", () => {
    const s = freshBattle();
    place(s, "player", 0, 2000);
    place(s, "opponent", 0, 1000, 1500, "defense");
    declareAttack(s, "player", 0, 0);
    expect(s.opponent.monsters[0]).toBeNull();
    expect(s.opponent.lp).toBe(8000);
  });

  it("pierce deals (ATK - DEF) to a defending monster's controller", () => {
    const s = freshBattle();
    const m = boardOf(s, "player");
    m.monsters[0] = {
      card: monster("Piercer", 2000, 1000, 4, { kind: "pierce" }), position: "attack",
      atkMod: 0, defMod: 0, turnBoost: 0, hasAttacked: 0, summonedThisTurn: false, faceUp: true,
    };
    place(s, "opponent", 0, 500, 1500, "defense");
    declareAttack(s, "player", 0, 0);
    expect(s.opponent.monsters[0]).toBeNull();
    expect(s.opponent.lp).toBe(8000 - 500);
  });

  it("attacking into a higher DEF wall: attacker survives, controller takes difference", () => {
    const s = freshBattle();
    place(s, "player", 0, 1000);
    place(s, "opponent", 0, 800, 1800, "defense");
    declareAttack(s, "player", 0, 0);
    expect(s.player.monsters[0]).toBeTruthy();
    expect(s.opponent.monsters[0]).toBeTruthy();
    expect(s.player.lp).toBe(8000 - 800);
  });

  it("direct attack deals full ATK and only when the foe has no monsters", () => {
    const s = freshBattle();
    place(s, "player", 0, 1900);
    declareAttack(s, "player", 0, "direct");
    expect(s.opponent.lp).toBe(8000 - 1900);
    // With a blocker, direct is refused.
    const s2 = freshBattle();
    place(s2, "player", 0, 1900);
    place(s2, "opponent", 0, 1000);
    declareAttack(s2, "player", 0, "direct");
    expect(s2.opponent.lp).toBe(8000);
  });

  it("a face-down monster flips face-up when attacked", () => {
    const s = freshBattle();
    place(s, "player", 0, 2000);
    place(s, "opponent", 0, 1000, 1200, "set");
    expect(s.opponent.monsters[0]!.faceUp).toBe(false);
    declareAttack(s, "player", 0, 0);
    expect(s.opponent.monsters[0]).toBeNull(); // 2000 > 1200 def
  });

  it("a monster cannot attack twice (without double attack)", () => {
    const s = freshBattle();
    place(s, "player", 0, 1000);
    declareAttack(s, "player", 0, "direct");
    declareAttack(s, "player", 0, "direct");
    expect(s.opponent.lp).toBe(8000 - 1000);
  });

  it("reduces LP to a win when it hits zero", () => {
    const s = freshBattle();
    s.opponent.lp = 500;
    place(s, "player", 0, 1900);
    declareAttack(s, "player", 0, "direct");
    expect(s.opponent.lp).toBe(0);
    expect(s.winner).toBe("player");
  });
});

describe("position changes", () => {
  beforeEach(() => freezeRandom(0));

  it("flips a set monster to face-up attack in Main Phase", () => {
    const s = createDuel(setupWith([], []));
    place(s, "player", 0, 1500, 1000, "set");
    changePosition(s, "player", 0);
    expect(s.player.monsters[0]!.faceUp).toBe(true);
    expect(s.player.monsters[0]!.position).toBe("attack");
  });

  it("toggles attack ↔ defense for a face-up monster", () => {
    const s = createDuel(setupWith([], []));
    place(s, "player", 0, 1500, 1000, "attack");
    changePosition(s, "player", 0);
    expect(s.player.monsters[0]!.position).toBe("defense");
  });

  it("cannot change position the turn it was summoned", () => {
    const s = createDuel(setupWith([], []));
    place(s, "player", 0, 1500, 1000, "attack");
    s.player.monsters[0]!.summonedThisTurn = true;
    changePosition(s, "player", 0);
    expect(s.player.monsters[0]!.position).toBe("attack");
  });
});

describe("effAtk / effDef modifiers", () => {
  it("reflects atkMod / defMod", () => {
    const m: FieldMonster = {
      card: monster("X", 1000, 800), position: "attack",
      atkMod: 300, defMod: -200, turnBoost: 0, hasAttacked: 0, summonedThisTurn: false, faceUp: true,
    };
    expect(effAtk(m)).toBe(1300);
    expect(effDef(m)).toBe(600);
  });
});
