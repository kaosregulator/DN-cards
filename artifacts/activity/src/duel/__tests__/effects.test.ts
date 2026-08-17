import { describe, it, expect, beforeEach } from "vitest";
import {
  createDuel, activateSpellFromHand, activateSetCard, summonMonster,
  declareAttack, respondToWindow, passWindow, responseOptions, recomputeContinuous,
  boardOf, effAtk, changePosition, nextPhase,
} from "../engine";
import type { DuelState, FieldMonster, MonsterPosition, PlayerId, DuelCard } from "../types";
import { monster, spell, trap, setupWith, freezeRandom } from "./helpers";

function place(state: DuelState, who: PlayerId, zone: number, atk: number, def = 1000, position: MonsterPosition = "attack", effect = null): void {
  boardOf(state, who).monsters[zone] = {
    card: monster(`Z${who}${zone}`, atk, def, 4, effect), position,
    atkMod: 0, defMod: 0, turnBoost: 0, hasAttacked: 0, summonedThisTurn: false, faceUp: position !== "set",
  } as FieldMonster;
  recomputeContinuous(state);
}
function setTrapAt(state: DuelState, who: PlayerId, zone: number, card: DuelCard): void {
  boardOf(state, who).spellTraps[zone] = { card, faceUp: false };
}
function battle(): DuelState {
  const s = createDuel(setupWith([], []));
  s.phase = "BATTLE";
  return s;
}

describe("spell effects", () => {
  beforeEach(() => freezeRandom(0));

  it("Pot of Greed draws 2", () => {
    const s = createDuel(setupWith([], []));
    s.player.hand = [spell("Pot", { kind: "spell:draw", count: 2 })];
    const before = s.player.deck.length;
    activateSpellFromHand(s, "player", 0);
    expect(s.player.hand.length).toBe(2);
    expect(s.player.deck.length).toBe(before - 2);
    expect(s.player.graveyard.length).toBe(1);
  });

  it("Dark Hole destroys ALL monsters both sides", () => {
    const s = createDuel(setupWith([], []));
    place(s, "player", 0, 1500); place(s, "player", 1, 1200);
    place(s, "opponent", 0, 1800);
    s.player.hand = [spell("Dark Hole", { kind: "spell:destroyAll" })];
    activateSpellFromHand(s, "player", 0);
    expect(s.player.monsters.filter(Boolean).length).toBe(0);
    expect(s.opponent.monsters.filter(Boolean).length).toBe(0);
    expect(s.player.graveyard.length).toBe(3); // 2 monsters + the spell
  });

  it("Raigeki destroys only opponent monsters", () => {
    const s = createDuel(setupWith([], []));
    place(s, "player", 0, 1500);
    place(s, "opponent", 0, 1800); place(s, "opponent", 1, 900);
    s.player.hand = [spell("Raigeki", { kind: "spell:destroyAllOpp" })];
    activateSpellFromHand(s, "player", 0);
    expect(s.player.monsters.filter(Boolean).length).toBe(1);
    expect(s.opponent.monsters.filter(Boolean).length).toBe(0);
  });

  it("Fissure destroys the opponent's lowest-ATK face-up monster", () => {
    const s = createDuel(setupWith([], []));
    place(s, "opponent", 0, 1800); place(s, "opponent", 1, 900); place(s, "opponent", 2, 1200);
    s.player.hand = [spell("Fissure", { kind: "spell:fissure" })];
    activateSpellFromHand(s, "player", 0);
    expect(s.opponent.monsters[1]).toBeNull(); // 900 was lowest
    expect(s.opponent.monsters.filter(Boolean).length).toBe(2);
  });

  it("targeted destroy removes the chosen monster", () => {
    const s = createDuel(setupWith([], []));
    place(s, "opponent", 2, 2000);
    s.player.hand = [spell("Snipe", { kind: "spell:destroyTarget" })];
    activateSpellFromHand(s, "player", 0, [{ side: "opponent", kind: "monster", zone: 2 }]);
    expect(s.opponent.monsters[2]).toBeNull();
  });

  it("MST destroys a targeted set spell/trap", () => {
    const s = createDuel(setupWith([], []));
    setTrapAt(s, "opponent", 3, trap("Mirror", { kind: "trap:mirror" }));
    s.player.hand = [spell("MST", { kind: "spell:destroySpellTrap" })];
    activateSpellFromHand(s, "player", 0, [{ side: "opponent", kind: "spellTrap", zone: 3 }]);
    expect(s.opponent.spellTraps[3]).toBeNull();
  });

  it("Book of Moon flips a face-up monster face-down", () => {
    const s = createDuel(setupWith([], []));
    place(s, "opponent", 0, 2400);
    s.player.hand = [spell("BoM", { kind: "spell:flipTarget" })];
    activateSpellFromHand(s, "player", 0, [{ side: "opponent", kind: "monster", zone: 0 }]);
    expect(s.opponent.monsters[0]!.faceUp).toBe(false);
    expect(s.opponent.monsters[0]!.position).toBe("set");
  });

  it("Monster Reborn special-summons a monster from a graveyard", () => {
    const s = createDuel(setupWith([], []));
    s.player.graveyard = [monster("Revived", 2500, 2000, 7)];
    s.player.hand = [spell("Reborn", { kind: "spell:reborn" })];
    activateSpellFromHand(s, "player", 0, [{ side: "player", kind: "grave", index: 0 }]);
    expect(s.player.monsters.filter(Boolean).length).toBe(1);
    expect(s.player.monsters.find((m) => m?.card.name === "Revived")).toBeTruthy();
    expect(s.player.graveyard.find((c) => c.name === "Revived")).toBeFalsy();
  });

  it("Field Medic heals LP", () => {
    const s = createDuel(setupWith([], []));
    s.player.lp = 3000;
    s.player.hand = [spell("Medic", { kind: "spell:heal", amount: 1500 })];
    activateSpellFromHand(s, "player", 0);
    expect(s.player.lp).toBe(4500);
  });

  it("Rush Command boosts all your monsters for the turn only", () => {
    const s = createDuel(setupWith([], []));
    place(s, "player", 0, 1500);
    s.player.hand = [spell("Rush", { kind: "spell:boost", amount: 700 })];
    activateSpellFromHand(s, "player", 0);
    expect(effAtk(s.player.monsters[0]!)).toBe(2200);
    // Boost wears off at End Phase (clearTurnBoosts on nextPhase to END).
    s.phase = "MAIN2";
    nextPhase(s); // → END, clears turn boosts
    expect(s.phase).toBe("END");
    expect(effAtk(s.player.monsters[0]!)).toBe(1500);
  });
});

describe("equip / continuous / field", () => {
  beforeEach(() => freezeRandom(0));

  it("equip spell adds ATK to the equipped monster and stays on the field", () => {
    const s = createDuel(setupWith([], []));
    place(s, "player", 0, 1500);
    s.player.hand = [spell("Axe", { kind: "equip:atk", atk: 1000 })];
    activateSpellFromHand(s, "player", 0, [{ side: "player", kind: "monster", zone: 0 }]);
    expect(effAtk(s.player.monsters[0]!)).toBe(2500);
    expect(s.player.spellTraps.filter(Boolean).length).toBe(1); // stays on field
  });

  it("continuous spell boosts all your monsters while face-up", () => {
    const s = createDuel(setupWith([], []));
    s.player.hand = [spell("Banner", { kind: "continuous:allyAtk", amount: 400 })];
    activateSpellFromHand(s, "player", 0);
    place(s, "player", 0, 1000);
    place(s, "player", 1, 1800);
    expect(effAtk(s.player.monsters[0]!)).toBe(1400);
    expect(effAtk(s.player.monsters[1]!)).toBe(2200);
  });

  it("field spell boosts only matching-attribute monsters", () => {
    const s = createDuel(setupWith([], []));
    s.player.hand = [spell("Volcano", { kind: "field:attrBoost", attribute: "FIRE", amount: 500 })];
    activateSpellFromHand(s, "player", 0);
    boardOf(s, "player").monsters[0] = { card: monster("Fireguy", 1500, 1000, 4, null, "FIRE"), position: "attack", atkMod: 0, defMod: 0, turnBoost: 0, hasAttacked: 0, summonedThisTurn: false, faceUp: true };
    boardOf(s, "player").monsters[1] = { card: monster("Earthguy", 1500, 1000, 4, null, "EARTH"), position: "attack", atkMod: 0, defMod: 0, turnBoost: 0, hasAttacked: 0, summonedThisTurn: false, faceUp: true };
    recomputeContinuous(s);
    expect(effAtk(s.player.monsters[0]!)).toBe(2000);
    expect(effAtk(s.player.monsters[1]!)).toBe(1500);
  });
});

describe("chain / response windows — battle traps", () => {
  beforeEach(() => freezeRandom(0));

  it("Mirror Force destroys all attacking monsters and negates the attack", () => {
    const s = battle();
    place(s, "player", 0, 2000); place(s, "player", 1, 1700);
    place(s, "opponent", 0, 1000);
    setTrapAt(s, "opponent", 0, trap("Mirror Force", { kind: "trap:mirror" }));
    declareAttack(s, "player", 0, 0);
    expect(s.awaiting?.responder).toBe("opponent");
    const opts = responseOptions(s);
    expect(opts.length).toBe(1);
    respondToWindow(s, opts[0]!.zone);
    // Both attack-position monsters of the player are gone; no battle damage.
    expect(s.player.monsters.filter(Boolean).length).toBe(0);
    expect(s.opponent.monsters[0]).toBeTruthy();
    expect(s.opponent.lp).toBe(8000);
    expect(s.awaiting).toBeNull();
  });

  it("Sakuretsu Armor destroys just the attacker", () => {
    const s = battle();
    place(s, "player", 0, 2500);
    place(s, "opponent", 0, 1000);
    setTrapAt(s, "opponent", 0, trap("Sakuretsu", { kind: "trap:sakuretsu" }));
    declareAttack(s, "player", 0, 0);
    respondToWindow(s, 0);
    expect(s.player.monsters[0]).toBeNull();
    expect(s.opponent.monsters[0]).toBeTruthy();
    expect(s.opponent.lp).toBe(8000);
  });

  it("Magic Cylinder reflects the attacker's ATK as damage and negates", () => {
    const s = battle();
    place(s, "player", 0, 2000);
    setTrapAt(s, "opponent", 0, trap("Cylinder", { kind: "trap:cylinder" }));
    declareAttack(s, "player", 0, "direct");
    respondToWindow(s, 0);
    expect(s.player.lp).toBe(8000 - 2000);
    expect(s.opponent.lp).toBe(8000);
  });

  it("Negate Attack negates and ends the Battle Phase", () => {
    const s = battle();
    place(s, "player", 0, 2000);
    setTrapAt(s, "opponent", 0, trap("Negate", { kind: "trap:negateAttack" }));
    declareAttack(s, "player", 0, "direct");
    respondToWindow(s, 0);
    expect(s.opponent.lp).toBe(8000);
    expect(s.phase).toBe("MAIN2");
  });

  it("passing the window lets the attack resolve normally", () => {
    const s = battle();
    place(s, "player", 0, 2000);
    setTrapAt(s, "opponent", 0, trap("Mirror Force", { kind: "trap:mirror" }));
    declareAttack(s, "player", 0, "direct");
    expect(s.awaiting).toBeTruthy();
    passWindow(s);
    expect(s.opponent.lp).toBe(8000 - 2000);
    expect(s.opponent.spellTraps[0]).toBeTruthy(); // trap not used
  });

  it("no window opens when the defender has no battle trap", () => {
    const s = battle();
    place(s, "player", 0, 1500);
    declareAttack(s, "player", 0, "direct");
    expect(s.awaiting).toBeNull();
    expect(s.opponent.lp).toBe(8000 - 1500);
  });
});

describe("chain / response windows — summon traps", () => {
  beforeEach(() => freezeRandom(0));

  it("Trap Hole destroys a summoned monster over the threshold", () => {
    const s = createDuel(setupWith([], []));
    setTrapAt(s, "opponent", 0, trap("Trap Hole", { kind: "trap:trapHole", threshold: 1000 }));
    s.player.hand = [monster("Big", 1800, 1000, 4)];
    summonMonster(s, "player", 0, "attack", []);
    expect(s.awaiting?.responder).toBe("opponent");
    respondToWindow(s, 0);
    expect(s.player.monsters.filter(Boolean).length).toBe(0);
    expect(s.player.graveyard.find((c) => c.name === "Big")).toBeTruthy();
  });

  it("Trap Hole does NOT open for a weak summon under the threshold", () => {
    const s = createDuel(setupWith([], []));
    setTrapAt(s, "opponent", 0, trap("Trap Hole", { kind: "trap:trapHole", threshold: 1000 }));
    s.player.hand = [monster("Small", 800, 1000, 4)];
    summonMonster(s, "player", 0, "attack", []);
    expect(s.awaiting).toBeNull();
    expect(s.player.monsters.filter(Boolean).length).toBe(1);
  });
});

describe("Call of the Haunted (slow trap)", () => {
  beforeEach(() => freezeRandom(0));
  it("special summons a monster from your own graveyard on your turn", () => {
    const s = createDuel(setupWith([], []));
    s.player.graveyard = [monster("Fallen", 2000, 1700, 5)];
    setTrapAt(s, "player", 0, trap("CoH", { kind: "trap:reborn" }));
    s.player.spellTraps[0]!.faceUp = false;
    activateSetCard(s, "player", 0, [{ side: "player", kind: "grave", index: 0 }]);
    expect(s.player.monsters.find((m) => m?.card.name === "Fallen")).toBeTruthy();
  });
});

describe("flip effect", () => {
  beforeEach(() => freezeRandom(0));
  it("flipping a flip:destroy monster destroys an opponent monster", () => {
    const s = createDuel(setupWith([], []));
    boardOf(s, "player").monsters[0] = { card: monster("ManEater", 400, 600, 3, { kind: "flip:destroy" }), position: "set", atkMod: 0, defMod: 0, turnBoost: 0, hasAttacked: 0, summonedThisTurn: false, faceUp: false };
    place(s, "opponent", 0, 3000);
    changePosition(s, "player", 0); // flip summon
    expect(s.opponent.monsters[0]).toBeNull();
  });
});
