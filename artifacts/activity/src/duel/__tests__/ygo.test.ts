import { describe, it, expect, beforeEach } from "vitest";
import { createDuel, declareAttack, summonMonster, responseOptions, trapsNegated, boardOf, recomputeContinuous, activateSpellFromHand } from "../engine";
import { enrichDeck, bindMonster, buildExtraDeck, SPELL_LIBRARY, TRAP_LIBRARY } from "../cards";
import { YGO_MONSTERS, YGO_SPELLS, YGO_TRAPS, YGO_FUSIONS, templateForTier, bestFusionFor } from "../ygo-cards";
import type { DuelState, FieldMonster, PlayerId } from "../types";
import { monster, spell, trap, setupWith, freezeRandom } from "./helpers";
import type { DuelCard } from "../types";

/** Wrap a card as a face-up attack-position field monster. */
function fieldMon(card: DuelCard): FieldMonster {
  return {
    card, position: "attack", atkMod: 0, defMod: 0, turnBoost: 0,
    hasAttacked: 0, summonedThisTurn: false, faceUp: true,
  };
}

function place(state: DuelState, who: PlayerId, zone: number, atk: number, effect: never | null = null): void {
  boardOf(state, who).monsters[zone] = {
    card: monster(`M${zone}`, atk, 1000, 4, effect), position: "attack",
    atkMod: 0, defMod: 0, turnBoost: 0, hasAttacked: 0, summonedThisTurn: false, faceUp: true,
  } as FieldMonster;
  recomputeContinuous(state);
}

describe("real Yu-Gi-Oh card data", () => {
  it("every monster template has real, sane card data", () => {
    expect(YGO_MONSTERS.length).toBeGreaterThan(20);
    for (const m of YGO_MONSTERS) {
      expect(m.name.length).toBeGreaterThan(2);
      expect(m.description.length).toBeGreaterThan(10);
      expect(m.level).toBeGreaterThanOrEqual(1);
      expect(m.level).toBeLessThanOrEqual(12);
      expect(m.atk).toBeGreaterThanOrEqual(0);
      expect(m.def).toBeGreaterThanOrEqual(0);
      expect(m.race.length).toBeGreaterThan(2);
      expect(["EARTH", "WIND", "WATER", "FIRE", "LIGHT", "DARK", "DIVINE"]).toContain(m.attribute);
    }
  });

  it("includes the classics with their real stats", () => {
    const byName = new Map(YGO_MONSTERS.map((m) => [m.name, m]));
    const blue = byName.get("Blue-Eyes White Dragon")!;
    expect(blue.atk).toBe(3000); expect(blue.def).toBe(2500); expect(blue.level).toBe(8);
    const dm = byName.get("Dark Magician")!;
    expect(dm.atk).toBe(2500); expect(dm.def).toBe(2100); expect(dm.level).toBe(7);
    const skull = byName.get("Summoned Skull")!;
    expect(skull.atk).toBe(2500); expect(skull.level).toBe(6);
    const meb = byName.get("Man-Eater Bug")!;
    expect(meb.effect).toEqual({ kind: "flip:destroy" });
  });

  it("spells and traps carry real names and real card text", () => {
    const names = [...YGO_SPELLS, ...YGO_TRAPS].map((c) => c.name);
    expect(names).toContain("Pot of Greed");
    expect(names).toContain("Dark Hole");
    expect(names).toContain("Mirror Force");
    expect(names).toContain("Monster Reborn");
    expect(YGO_SPELLS.find((s) => s.name === "Pot of Greed")!.description).toBe("Draw 2 cards.");
    expect(YGO_TRAPS.find((s) => s.name === "Mirror Force")!.description).toMatch(/declares an attack/i);
  });

  it("binding is deterministic and tier-ordered", () => {
    const a = templateForTier(1234, 0.95);
    const b = templateForTier(1234, 0.95);
    expect(a.name).toBe(b.name); // same card → same real card, always
    const weak = templateForTier(1234, 0.0);
    const strong = templateForTier(1234, 1.0);
    expect(strong.atk).toBeGreaterThan(weak.atk);
  });
});

describe("binding server cards to real cards", () => {
  beforeEach(() => freezeRandom(0));

  it("keeps YOUR name/art/id but uses the real card's stats, text and effect", () => {
    const mine = { ...monster("Dark Night Tank", 999, 111, 2), cardId: 42, art: "/activity/card-art/42" };
    const bound = bindMonster(mine, 1.0);
    expect(bound.name).toBe("Dark Night Tank");      // your name kept
    expect(bound.art).toBe("/activity/card-art/42"); // your art kept
    expect(bound.cardId).toBe(42);
    expect(bound.realName).toBeTruthy();             // real card recorded
    expect(bound.race).toBeTruthy();
    // Stats now come from the real card, not the derived ones.
    expect(bound.atk).not.toBe(999);
    const tpl = YGO_MONSTERS.find((m) => m.name === bound.realName)!;
    expect(bound.atk).toBe(tpl.atk);
    expect(bound.def).toBe(tpl.def);
    expect(bound.level).toBe(tpl.level);
    expect(bound.desc).toBe(tpl.description);
    expect(bound.effect).toEqual(tpl.effect);
  });

  it("enrichDeck binds every monster and adds real spells/traps", () => {
    const deck = Array.from({ length: 20 }, (_, i) => ({ ...monster(`Card ${i}`, 800 + i * 90), cardId: 100 + i }));
    const out = enrichDeck(deck);
    const monsters = out.filter((c) => c.kind === "monster" && c.fusionMinLevelSum == null);
    const fusions = out.filter((c) => c.fusionMinLevelSum != null);
    const support = out.filter((c) => c.kind !== "monster");
    expect(monsters.length).toBe(20);
    expect(fusions.length).toBeGreaterThan(0);
    expect(support.length).toBeGreaterThanOrEqual(6);
    for (const m of monsters) expect(m.realName).toBeTruthy();
    for (const s of support) {
      expect(s.desc.length).toBeGreaterThan(5);
      expect(s.realName).toBeTruthy();
      expect(s.sub).toBeTruthy();
    }
  });

  it("stronger server cards bind to stronger real cards", () => {
    const deck = Array.from({ length: 12 }, (_, i) => ({ ...monster(`C${i}`, 500 + i * 200), cardId: 500 + i }));
    const out = enrichDeck(deck).filter((c) => c.kind === "monster");
    const weakest = out.find((c) => c.name === "C0")!;
    const strongest = out.find((c) => c.name === "C11")!;
    expect(strongest.atk).toBeGreaterThan(weakest.atk);
  });

  it("the shipped libraries are the real cards", () => {
    expect(SPELL_LIBRARY.every((c) => c.kind === "spell" && !!c.realName)).toBe(true);
    expect(TRAP_LIBRARY.every((c) => c.kind === "trap" && !!c.realName)).toBe(true);
    expect(SPELL_LIBRARY.map((c) => c.name)).toContain("Pot of Greed");
  });
});

describe("Jinzo — Trap Cards cannot be activated", () => {
  beforeEach(() => freezeRandom(0));
  const JINZO = { kind: "negateTraps" } as never;

  it("blocks the defender's battle-trap response window", () => {
    const s = createDuel(setupWith([], []));
    s.phase = "BATTLE";
    place(s, "player", 0, 2400, JINZO); // attacker controls Jinzo
    boardOf(s, "opponent").spellTraps[0] = { card: trap("Mirror Force", { kind: "trap:mirror" }), faceUp: false };
    expect(trapsNegated(s)).toBe(true);
    declareAttack(s, "player", 0, "direct");
    // No window opened, the attack resolved straight through.
    expect(s.awaiting).toBeNull();
    expect(s.opponent.lp).toBe(8000 - 2400);
    expect(s.opponent.spellTraps[0]).toBeTruthy(); // trap unused
  });

  it("blocks Trap Hole on summon", () => {
    const s = createDuel(setupWith([], []));
    place(s, "opponent", 0, 2400, JINZO);
    boardOf(s, "opponent").spellTraps[0] = { card: trap("Trap Hole", { kind: "trap:trapHole", threshold: 1000 }), faceUp: false };
    s.player.hand = [monster("Big", 1800, 1000, 4)];
    summonMonster(s, "player", 0, "attack", []);
    expect(s.awaiting).toBeNull();
    expect(s.player.monsters.filter(Boolean).length).toBe(1); // survived
  });

  it("responseOptions is empty while a negating monster is face-up", () => {
    const s = createDuel(setupWith([], []));
    s.phase = "BATTLE";
    boardOf(s, "opponent").spellTraps[0] = { card: trap("Mirror Force", { kind: "trap:mirror" }), faceUp: false };
    place(s, "player", 0, 1000);
    declareAttack(s, "player", 0, "direct");
    expect(responseOptions(s).length).toBe(1); // normally available
    // Now add Jinzo and re-check.
    place(s, "player", 1, 2400, JINZO);
    expect(trapsNegated(s)).toBe(true);
    expect(responseOptions(s).length).toBe(0);
  });
});

describe("Fusion Summoning (Polymerization)", () => {
  beforeEach(() => freezeRandom(0));

  function withExtra(): DuelState {
    const s = createDuel(setupWith([], []));
    s.player.extraDeck = buildExtraDeck([]);
    return s;
  }

  it("gives every deck an Extra Deck of real Fusion monsters", () => {
    const deck = enrichDeck(Array.from({ length: 12 }, (_, i) => ({ ...monster(`C${i}`, 900 + i * 120), cardId: 700 + i })));
    const s = createDuel({ startingLp: 8000, handSize: 5, player: { name: "P", deck }, opponent: { name: "O", deck: [...deck] } });
    expect(s.player.extraDeck.length).toBe(YGO_FUSIONS.length);
    for (const f of s.player.extraDeck) {
      expect(f.fusionMinLevelSum).toBeGreaterThan(0);
      expect(f.realName).toBeTruthy();
    }
    // Fusions never sit in the main deck or hand.
    expect(s.player.deck.some((c) => c.fusionMinLevelSum != null)).toBe(false);
    expect(s.player.hand.some((c) => c.fusionMinLevelSum != null)).toBe(false);
  });

  it("fuses two monsters into the best Fusion their Levels allow", () => {
    const s = withExtra();
    // Two Level-7s → sum 14 → Blue-Eyes Ultimate Dragon (needs 14).
    boardOf(s, "player").monsters[0] = fieldMon(monster("A", 2400, 2000, 7));
    boardOf(s, "player").monsters[1] = fieldMon(monster("B", 2300, 2100, 7));
    s.player.hand = [spell("Polymerization", { kind: "spell:fusion" })];
    activateSpellFromHand(s, "player", 0, [
      { side: "player", kind: "monster", zone: 0 },
      { side: "player", kind: "monster", zone: 1 },
    ]);
    const field = s.player.monsters.filter(Boolean);
    expect(field.length).toBe(1);
    expect(field[0]!.card.realName).toBe("Blue-Eyes Ultimate Dragon");
    expect(field[0]!.card.atk).toBe(4500);
    // Both materials went to the Graveyard.
    expect(s.player.graveyard.filter((c) => c.name === "A" || c.name === "B").length).toBe(2);
  });

  it("picks a weaker Fusion when the Levels are lower", () => {
    const s = withExtra();
    boardOf(s, "player").monsters[0] = fieldMon(monster("A", 1200, 900, 3));
    boardOf(s, "player").monsters[1] = fieldMon(monster("B", 1300, 900, 3));
    s.player.hand = [spell("Polymerization", { kind: "spell:fusion" })];
    activateSpellFromHand(s, "player", 0, [
      { side: "player", kind: "monster", zone: 0 },
      { side: "player", kind: "monster", zone: 1 },
    ]);
    const field = s.player.monsters.filter(Boolean);
    expect(field.length).toBe(1);
    expect(field[0]!.card.realName).toBe("Flame Swordsman"); // needs only 6
  });

  it("refuses when the materials are too weak for any Fusion", () => {
    const s = withExtra();
    boardOf(s, "player").monsters[0] = fieldMon(monster("A", 400, 400, 1));
    boardOf(s, "player").monsters[1] = fieldMon(monster("B", 400, 400, 2));
    s.player.hand = [spell("Polymerization", { kind: "spell:fusion" })];
    activateSpellFromHand(s, "player", 0, [
      { side: "player", kind: "monster", zone: 0 },
      { side: "player", kind: "monster", zone: 1 },
    ]);
    // Materials survive; nothing summoned.
    expect(s.player.monsters.filter(Boolean).length).toBe(2);
  });

  it("bestFusionFor ranks by ATK within the legal set", () => {
    expect(bestFusionFor(4)).toBeNull();
    expect(bestFusionFor(6)!.name).toBe("Flame Swordsman");
    expect(bestFusionFor(14)!.name).toBe("Blue-Eyes Ultimate Dragon");
  });
});

describe("search effects (Sangan / Witch)", () => {
  beforeEach(() => freezeRandom(0));

  it("adds a qualifying monster from the Deck to the hand when sent to the GY", () => {
    const s = createDuel(setupWith([], []));
    const searcher = monster("Searcher", 1000, 600, 3, { kind: "searchOnDeath", maxAtk: 1500 });
    boardOf(s, "player").monsters[0] = fieldMon(searcher);
    s.player.deck = [monster("TooBig", 2500, 2000, 7), monster("JustRight", 1200, 900, 4)];
    // Destroy it with a Dark Hole.
    s.player.hand = [spell("Dark Hole", { kind: "spell:destroyAll" })];
    const handBefore = s.player.hand.length; // just the Dark Hole
    activateSpellFromHand(s, "player", 0);
    // Searched the legal one, skipped the 2500 ATK monster.
    expect(s.player.hand.some((c) => c.name === "JustRight")).toBe(true);
    expect(s.player.hand.some((c) => c.name === "TooBig")).toBe(false);
    // Dark Hole left the hand, the searched card arrived.
    expect(s.player.hand.length).toBe(handBefore - 1 + 1);
  });

  it("fires when the searcher dies in battle", () => {
    const s = createDuel(setupWith([], []));
    s.phase = "BATTLE";
    const searcher = monster("Sangan-like", 1000, 600, 3, { kind: "searchOnDeath", maxAtk: 1500 });
    boardOf(s, "opponent").monsters[0] = fieldMon(searcher);
    boardOf(s, "player").monsters[0] = fieldMon(monster("Beater", 2000, 1000, 4));
    s.opponent.deck = [monster("Fetched", 1400, 1000, 4)];
    declareAttack(s, "player", 0, 0);
    expect(s.opponent.monsters[0]).toBeNull();
    expect(s.opponent.hand.some((c) => c.name === "Fetched")).toBe(true);
  });

  it("does nothing when the Deck holds no legal target", () => {
    const s = createDuel(setupWith([], []));
    const searcher = monster("Searcher", 1000, 600, 3, { kind: "searchOnDeath", maxAtk: 1000 });
    boardOf(s, "player").monsters[0] = fieldMon(searcher);
    s.player.deck = [monster("Huge", 3000, 2500, 8)];
    s.player.hand = [spell("Dark Hole", { kind: "spell:destroyAll" })];
    activateSpellFromHand(s, "player", 0);
    expect(s.player.hand.length).toBe(0); // spell left the hand, nothing searched
    expect(s.player.deck.length).toBe(1);
  });
});

describe("Field Spell library", () => {
  it("provides an Attribute-boost Field Spell for all six real Attributes", () => {
    const fields = YGO_SPELLS.filter((s) => s.effect?.kind === "field:attrBoost");
    expect(fields.length).toBe(6);
    const attrs = new Set(fields.map((f) => (f.effect as { attribute: string }).attribute));
    for (const a of ["FIRE", "WATER", "WIND", "EARTH", "LIGHT", "DARK"]) {
      expect(attrs.has(a), `missing Field Spell for ${a}`).toBe(true);
    }
    // They ship in the support library so decks actually draw them.
    expect(SPELL_LIBRARY.some((c) => c.effect?.kind === "field:attrBoost")).toBe(true);
  });
});
