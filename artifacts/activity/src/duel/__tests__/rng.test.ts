import { describe, it, expect, afterEach } from "vitest";
import { mulberry32, setSeed, resetRng, shuffle, makeSeed } from "../rng";
import { createDuel } from "../engine";
import { enrichSetup } from "../cards";
import { monster } from "./helpers";
import type { DuelCard, DuelSetup } from "../types";

afterEach(() => resetRng());

function deck(n = 24): DuelCard[] {
  return Array.from({ length: n }, (_, i) => ({ ...monster(`C${i}`, 800 + i * 70), cardId: 900 + i }));
}
function setup(): DuelSetup {
  return {
    startingLp: 8000, handSize: 5,
    player: { name: "P1", deck: deck() },
    opponent: { name: "P2", deck: deck() },
  };
}
/** A stable fingerprint of everything a duel randomised. */
function fingerprint(s: ReturnType<typeof createDuel>): string {
  const side = (b: typeof s.player) =>
    [b.hand.map((c) => c.realName ?? c.name).join("|"),
     b.deck.map((c) => c.realName ?? c.name).join("|"),
     b.extraDeck.map((c) => c.realName ?? c.name).join("|")].join("//");
  return `${side(s.player)}##${side(s.opponent)}`;
}

describe("seeded RNG", () => {
  it("mulberry32 is deterministic and stays in [0,1)", () => {
    const a = mulberry32(12345), b = mulberry32(12345);
    for (let i = 0; i < 200; i++) {
      const v = a();
      expect(v).toBe(b());
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it("different seeds diverge", () => {
    const a = mulberry32(1), b = mulberry32(2);
    const seqA = Array.from({ length: 10 }, () => a());
    const seqB = Array.from({ length: 10 }, () => b());
    expect(seqA).not.toEqual(seqB);
  });

  it("shuffle is a permutation and repeats under the same seed", () => {
    const src = Array.from({ length: 40 }, (_, i) => i);
    setSeed(777); const one = shuffle(src);
    setSeed(777); const two = shuffle(src);
    expect(one).toEqual(two);
    expect([...one].sort((a, b) => a - b)).toEqual(src); // nothing lost or duplicated
    setSeed(778);
    expect(shuffle(src)).not.toEqual(one);
  });

  it("makeSeed returns a 32-bit unsigned integer", () => {
    for (let i = 0; i < 50; i++) {
      const s = makeSeed();
      expect(Number.isInteger(s)).toBe(true);
      expect(s).toBeGreaterThanOrEqual(0);
      expect(s).toBeLessThanOrEqual(0xffffffff);
    }
  });
});

// This is the property online play depends on: two clients handed the same
// setup + seed must build byte-identical opening states.
describe("lockstep determinism", () => {
  it("same setup + same seed → identical duels on both clients", () => {
    const shared = setup();
    setSeed(4242); const clientA = createDuel(enrichSetup(shared), 4242);
    setSeed(4242); const clientB = createDuel(enrichSetup(shared), 4242);
    expect(fingerprint(clientA)).toBe(fingerprint(clientB));
    expect(clientA.player.hand.length).toBe(5);
    expect(clientA.player.extraDeck.length).toBeGreaterThan(0);
  });

  it("a different seed produces a different duel", () => {
    const shared = setup();
    setSeed(1); const a = createDuel(enrichSetup(shared), 1);
    setSeed(2); const b = createDuel(enrichSetup(shared), 2);
    expect(fingerprint(a)).not.toBe(fingerprint(b));
  });

  it("seeding covers deck-building randomness too, not just the draw", () => {
    // enrichSetup picks support cards and Extra Deck uids randomly; both must
    // land the same way for the lockstep replay to agree.
    const shared = setup();
    setSeed(99); const a = enrichSetup(shared);
    setSeed(99); const b = enrichSetup(shared);
    expect(a.player.deck.map((c) => c.uid)).toEqual(b.player.deck.map((c) => c.uid));
    expect(a.opponent.deck.map((c) => c.uid)).toEqual(b.opponent.deck.map((c) => c.uid));
  });
});
