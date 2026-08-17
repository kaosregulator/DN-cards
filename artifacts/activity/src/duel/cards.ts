// ─────────────────────────────────────────────────────────────────────────────
// Deck assembly — binds the server's cards to REAL Yu-Gi-Oh cards.
//
// Your card ART and NAME are always kept. Everything the rules care about — the
// Level, Attribute, Type, ATK / DEF, the card text and the effect — comes from a
// real Yu-Gi-Oh card of a matching power tier (see duel/ygo-cards.ts), so a duel
// plays by the real game's numbers while showing your artwork.
//
// Spells and Traps are real cards too (Pot of Greed, Dark Hole, Mirror Force,
// Magic Cylinder, …). They have no server art, so they render as clean
// procedural cards carrying the real name and text.
// ─────────────────────────────────────────────────────────────────────────────

import type { DuelCard, DuelSetup } from "./types";
import { YGO_SPELLS, YGO_TRAPS, templateForTier, type YgoSpellTrap } from "./ygo-cards";

const SPELL_COLOR = 0x1e9e5a;
const TRAP_COLOR = 0x9b2fae;

/** Turn a real Spell/Trap definition into a playable duel card. */
export function supportCard(def: YgoSpellTrap, uid: string): DuelCard {
  return {
    uid,
    cardId: null,
    name: def.name,
    kind: def.kind,
    art: null,
    rarity: def.kind === "spell" ? "Spell" : "Trap",
    color: def.kind === "spell" ? SPELL_COLOR : TRAP_COLOR,
    attribute: "DIVINE",
    level: 0, atk: 0, def: 0,
    desc: def.description,
    effect: def.effect,
    realName: def.name,
    sub: def.sub,
  };
}

export const SPELL_LIBRARY: DuelCard[] = YGO_SPELLS.map((d, i) => supportCard(d, `sp${i}`));
export const TRAP_LIBRARY: DuelCard[] = YGO_TRAPS.map((d, i) => supportCard(d, `tr${i}`));
export const SPELL_TRAP_LIBRARY: DuelCard[] = [...SPELL_LIBRARY, ...TRAP_LIBRARY];

/**
 * Bind ONE server monster to a real Yu-Gi-Oh card. Keeps the card's own name,
 * art, rarity colour and id; takes its Level / Attribute / Type / ATK / DEF /
 * card text / effect from the real card.
 *
 * `tier` (0..1) is the card's relative power in the deck, so your strongest
 * cards bind to the strongest real cards.
 */
export function bindMonster(card: DuelCard, tier: number): DuelCard {
  const t = templateForTier(card.cardId ?? 0, tier);
  return {
    ...card,
    attribute: t.attribute,
    level: t.level,
    atk: t.atk,
    def: t.def,
    desc: t.description,
    effect: t.effect,
    realName: t.name,
    race: t.race,
  };
}

function shuffle<T>(a: T[]): T[] {
  const r = [...a];
  for (let i = r.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [r[i], r[j]] = [r[j]!, r[i]!];
  }
  return r;
}

/** Build a support sub-deck: a spread of real spells + traps with unique uids. */
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
 * Keep the real monsters from a server deck (binding each to a real Yu-Gi-Oh
 * card) and fill the support slots from the real Spell/Trap library.
 */
export function enrichDeck(deck: DuelCard[]): DuelCard[] {
  const monsters = deck.filter((c) => c.kind === "monster");
  // Rank by the backend-derived ATK so "strongest card → strongest real card".
  const ranked = [...monsters].sort((a, b) => a.atk - b.atk);
  const tierOf = new Map<string, number>();
  ranked.forEach((c, i) => tierOf.set(c.uid, ranked.length > 1 ? i / (ranked.length - 1) : 0.5));
  const bound = monsters.map((c) => bindMonster(c, tierOf.get(c.uid) ?? 0.5));

  const supportCount = Math.max(6, Math.round(deck.length * 0.18));
  return shuffle([...bound, ...buildSupport(supportCount)]);
}

export function enrichSetup(setup: DuelSetup): DuelSetup {
  return {
    ...setup,
    player: { ...setup.player, deck: enrichDeck(setup.player.deck) },
    opponent: { ...setup.opponent, deck: enrichDeck(setup.opponent.deck) },
  };
}
