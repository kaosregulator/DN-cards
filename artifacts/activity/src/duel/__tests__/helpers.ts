// Shared test helpers: build decks, cards, and a duel with deterministic RNG.
import { vi } from "vitest";
import type { DuelCard, DuelSetup, DuelAttribute, DuelEffect, DuelCardKind } from "../types";

let uidSeq = 0;
export function card(partial: Partial<DuelCard> & { name: string }): DuelCard {
  return {
    uid: partial.uid ?? `c${uidSeq++}`,
    cardId: partial.cardId ?? null,
    name: partial.name,
    kind: partial.kind ?? "monster",
    art: partial.art ?? null,
    rarity: partial.rarity ?? "Common",
    color: partial.color ?? 0xffffff,
    attribute: partial.attribute ?? "EARTH",
    level: partial.level ?? 4,
    atk: partial.atk ?? 1500,
    def: partial.def ?? 1000,
    desc: partial.desc ?? "",
    effect: partial.effect ?? null,
  };
}

export function monster(name: string, atk: number, def = 1000, level = 4, effect: DuelEffect | null = null, attribute: DuelAttribute = "EARTH"): DuelCard {
  return card({ name, atk, def, level, effect, attribute, kind: "monster" });
}

export function spell(name: string, effect: DuelEffect): DuelCard {
  return card({ name, kind: "spell", effect, atk: 0, def: 0, level: 0, attribute: "DIVINE" });
}
export function trap(name: string, effect: DuelEffect): DuelCard {
  return card({ name, kind: "trap", effect, atk: 0, def: 0, level: 0, attribute: "DIVINE" });
}

/** Fill a deck to `n` cards with vanilla beaters so draws never deck-out. */
export function padDeck(cards: DuelCard[], n = 40): DuelCard[] {
  const out = [...cards];
  let i = 0;
  while (out.length < n) out.push(monster(`Filler ${i}`, 1000 + (i % 3) * 100, 800, 4));
  return out;
}

export function setupWith(playerDeck: DuelCard[], opponentDeck: DuelCard[], handSize = 5, startingLp = 8000): DuelSetup {
  return {
    startingLp, handSize,
    player: { name: "P", deck: padDeck(playerDeck) },
    opponent: { name: "O", deck: padDeck(opponentDeck) },
  };
}

/** Freeze Math.random so shuffles/draws are deterministic across a test. */
export function freezeRandom(value = 0): void {
  vi.spyOn(Math, "random").mockReturnValue(value);
}
export function kind(k: DuelCardKind): DuelCardKind { return k; }
