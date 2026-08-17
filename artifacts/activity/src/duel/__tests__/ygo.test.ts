import { describe, it, expect, beforeEach } from "vitest";
import { createDuel, declareAttack, summonMonster, responseOptions, trapsNegated, boardOf, recomputeContinuous } from "../engine";
import { enrichDeck, bindMonster, SPELL_LIBRARY, TRAP_LIBRARY } from "../cards";
import { YGO_MONSTERS, YGO_SPELLS, YGO_TRAPS, templateForTier } from "../ygo-cards";
import type { DuelState, FieldMonster, PlayerId } from "../types";
import { monster, trap, setupWith, freezeRandom } from "./helpers";

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
    const monsters = out.filter((c) => c.kind === "monster");
    const support = out.filter((c) => c.kind !== "monster");
    expect(monsters.length).toBe(20);
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
