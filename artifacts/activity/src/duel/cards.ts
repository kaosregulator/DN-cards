// ─────────────────────────────────────────────────────────────────────────────
// Spell/Trap card library — "blank" cards with real Yu-Gi-Oh effects.
//
// The server's own card images become the MONSTERS. Spells & traps don't exist
// as server cards yet, so we ship simple placeholder cards (procedural art +
// short INITIALS so you can tell them apart at a glance) that use the classic
// effects. Swap in real art/names later by giving these cardIds; the effect
// keys stay the same.
//
// The client owns these effects because the client resolves them, so it also
// owns the deck's support slots: `enrichSetup` keeps the real monsters and
// replaces whatever support the server sent with this curated, tested library.
// ─────────────────────────────────────────────────────────────────────────────

import type { DuelCard, DuelSetup, DuelEffect } from "./types";

const SPELL_COLOR = 0x1e9e5a;
const TRAP_COLOR = 0x9b2fae;

function mk(uid: string, initials: string, name: string, kind: "spell" | "trap", desc: string, effect: DuelEffect): DuelCard {
  return {
    uid, cardId: null, name: `${name} (${initials})`, kind, art: null,
    rarity: kind === "spell" ? "Spell" : "Trap", color: kind === "spell" ? SPELL_COLOR : TRAP_COLOR,
    attribute: "DIVINE", level: 0, atk: 0, def: 0, desc, effect,
  };
}

// Real effects, placeholder art. Initials in the name double as the card face
// glyph (see ui/card.ts) so they read on the small board.
export const SPELL_LIBRARY: DuelCard[] = [
  mk("sp-pog", "PoG", "Pot of Greed", "spell", "Draw 2 cards.", { kind: "spell:draw", count: 2 }),
  mk("sp-dh", "DH", "Dark Hole", "spell", "Destroy all monsters on the field.", { kind: "spell:destroyAll" }),
  mk("sp-rg", "RG", "Raigeki", "spell", "Destroy all monsters your opponent controls.", { kind: "spell:destroyAllOpp" }),
  mk("sp-mst", "MST", "Mystical Space Typhoon", "spell", "Target 1 Spell/Trap on the field; destroy it.", { kind: "spell:destroySpellTrap" }),
  mk("sp-fis", "FIS", "Fissure", "spell", "Destroy the face-up monster your opponent controls with the lowest ATK.", { kind: "spell:fissure" }),
  mk("sp-bom", "BoM", "Book of Moon", "spell", "Target 1 face-up monster; set it face-down in Defense.", { kind: "spell:flipTarget" }),
  mk("sp-mr", "MR", "Monster Reborn", "spell", "Target 1 monster in either Graveyard; Special Summon it.", { kind: "spell:reborn" }),
  mk("sp-rc", "RC", "Rush Command", "spell", "All monsters you control gain 700 ATK until the End Phase.", { kind: "spell:boost", amount: 700 }),
  mk("sp-fm", "FM", "Field Medic", "spell", "Gain 1500 Life Points.", { kind: "spell:heal", amount: 1500 }),
  mk("sp-aod", "AoD", "Axe of Despair", "spell", "Equip. The equipped monster gains 1000 ATK.", { kind: "equip:atk", atk: 1000 }),
  mk("sp-wf", "WF", "War Banner", "spell", "Continuous. All monsters you control gain 400 ATK.", { kind: "continuous:allyAtk", amount: 400 }),
];

export const TRAP_LIBRARY: DuelCard[] = [
  mk("tr-mf", "MF", "Mirror Force", "trap", "When an opponent's monster declares an attack: destroy all their Attack-Position monsters.", { kind: "trap:mirror" }),
  mk("tr-mc", "MC", "Magic Cylinder", "trap", "When an opponent's monster declares an attack: negate it and inflict its ATK as damage.", { kind: "trap:cylinder" }),
  mk("tr-sa", "SA", "Sakuretsu Armor", "trap", "When an opponent's monster declares an attack: destroy that monster.", { kind: "trap:sakuretsu" }),
  mk("tr-na", "NA", "Negate Attack", "trap", "When an opponent's monster declares an attack: negate it and end the Battle Phase.", { kind: "trap:negateAttack" }),
  mk("tr-th", "TH", "Trap Hole", "trap", "When the opponent Summons a monster with 1000+ ATK: destroy it.", { kind: "trap:trapHole", threshold: 1000 }),
  mk("tr-coh", "CoH", "Call of the Haunted", "trap", "Target 1 monster in your Graveyard; Special Summon it.", { kind: "trap:reborn" }),
];

export const SPELL_TRAP_LIBRARY: DuelCard[] = [...SPELL_LIBRARY, ...TRAP_LIBRARY];

function shuffle<T>(a: T[]): T[] {
  const r = [...a];
  for (let i = r.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [r[i], r[j]] = [r[j]!, r[i]!];
  }
  return r;
}

/** Build a support sub-deck: a spread of spells + traps with unique uids. */
export function buildSupport(count: number): DuelCard[] {
  const pool = shuffle(SPELL_TRAP_LIBRARY);
  const out: DuelCard[] = [];
  for (let i = 0; i < count; i++) {
    const base = pool[i % pool.length]!;
    out.push({ ...base, uid: `${base.uid}#${i}-${Math.random().toString(36).slice(2, 7)}` });
  }
  return out;
}

/**
 * Keep the real monsters from a server deck; replace the support (spell/trap)
 * slots with the curated library so the tested effects are always in play.
 */
export function enrichDeck(deck: DuelCard[]): DuelCard[] {
  const monsters = deck.filter((c) => c.kind === "monster");
  const supportCount = Math.max(6, Math.round(deck.length * 0.18));
  return shuffle([...monsters, ...buildSupport(supportCount)]);
}

export function enrichSetup(setup: DuelSetup): DuelSetup {
  return {
    ...setup,
    player: { ...setup.player, deck: enrichDeck(setup.player.deck) },
    opponent: { ...setup.opponent, deck: enrichDeck(setup.opponent.deck) },
  };
}
