// ─────────────────────────────────────────────────────────────────────────────
// Duel read-model — assembles a TRUE Yu-Gi-Oh style duel setup from REAL DN
// Cards, WITHOUT mutating anything. The Phaser "Battle Phaser" activity presents
// and resolves the duel client-side (a rich mini-game, exactly like the existing
// battle/raid/pack preview scenes are non-authoritative). Authoritative economy
// and the classic turn-based `/battle` combat stay in the bot untouched.
//
// The card ART and NAMES come from the server's own cards. The Yu-Gi-Oh rules,
// stats, attributes and card kinds are DERIVED here (the "moves & rules from the
// reference repos" live in the client duel engine). Nothing is granted or spent.
// ─────────────────────────────────────────────────────────────────────────────

import { getUserCollection, getAllCards } from "../db.js";
import {
  RARITY_COLORS, RARITY_LABELS, type Rarity,
} from "../cards-data.js";
import type { Card } from "@workspace/db";

const RARITY_RANK: Record<Rarity, number> = {
  common: 0, uncommon: 1, rare: 2, epic: 3, legendary: 4, mythic: 5,
};

// Yu-Gi-Oh attributes, mapped from a card's rarity so every duel line-up looks
// varied. cardType keyword hints override the rarity default when they clearly
// signal an element (e.g. a "Dragon"/"Fire" typed card).
const ATTRIBUTE_BY_RANK = ["EARTH", "WIND", "WATER", "FIRE", "LIGHT", "DARK"] as const;
export type DuelAttribute = (typeof ATTRIBUTE_BY_RANK)[number] | "DIVINE";

const ATTRIBUTE_HINTS: Array<[RegExp, DuelAttribute]> = [
  [/fire|flame|inferno|burn|magma|lava|blaze/i, "FIRE"],
  [/water|aqua|sea|ocean|frost|ice|tide|naval/i, "WATER"],
  [/wind|air|sky|storm|jet|aero|gale|cyclone/i, "WIND"],
  [/earth|ground|rock|stone|tank|armor|iron|steel/i, "EARTH"],
  [/light|holy|solar|radiant|angel|divine/i, "LIGHT"],
  [/dark|shadow|night|void|demon|abyss|black/i, "DARK"],
];

export type DuelCardKind = "monster" | "spell" | "trap";

export interface DuelCard {
  /** Stable per-duel id (real card id for monsters, synthetic for support). */
  uid: string;
  /** Underlying DN card id when this is a real card (monsters), else null. */
  cardId: number | null;
  name: string;
  kind: DuelCardKind;
  /** Proxied art path for monsters (loads through the Discord proxy), else null. */
  art: string | null;
  rarity: string;
  color: number;
  // Monster fields (0 for spell/trap):
  attribute: DuelAttribute;
  level: number; // 1..12 (stars)
  atk: number;
  def: number;
  desc: string;
  /** A signature effect keyword the client engine understands (monsters/support). */
  effect: DuelEffect | null;
}

// A compact, engine-readable effect vocabulary. The client duel engine turns
// these into "moves" (rules ported from the reference repos). Kept small and
// data-driven so new effects never need a client change.
export type DuelEffect =
  | { kind: "pierce" }                          // battle damage pierces DEF
  | { kind: "gainAtk"; amount: number }         // continuous ATK boost while on field
  | { kind: "drawOnSummon"; count: number }     // draw when normal-summoned
  | { kind: "burn"; amount: number }            // deal LP damage when summoned
  | { kind: "doubleAttack" }                    // may attack twice per Battle Phase
  | { kind: "spell:draw"; count: number }       // Pot-of-Greed style
  | { kind: "spell:boost"; amount: number }     // Rush/limiter style team ATK up
  | { kind: "spell:heal"; amount: number }      // regain LP
  | { kind: "trap:mirror" }                     // Mirror Force: destroy attackers
  | { kind: "trap:cylinder"; }                  // reflect attack as burn
  | { kind: "trap:trapHole"; threshold: number }; // destroy summoned monster w/ ATK ≥ threshold

// Proxied card-art path (relative to the Activity's API base). Discord's iframe
// CSP blocks arbitrary hosts, so ALL art must flow through our own endpoint.
function artPath(cardId: number): string {
  return `/activity/card-art/${cardId}`;
}

function attributeFor(card: { rarity: string; cardType?: string | null; name: string }): DuelAttribute {
  const hay = `${card.cardType ?? ""} ${card.name}`;
  for (const [re, attr] of ATTRIBUTE_HINTS) if (re.test(hay)) return attr;
  const rank = RARITY_RANK[(card.rarity as Rarity)] ?? 0;
  return ATTRIBUTE_BY_RANK[Math.min(ATTRIBUTE_BY_RANK.length - 1, rank)]!;
}

// Derive Yu-Gi-Oh stats from a card's worth + rarity. Higher worth / rarity →
// higher Level (stars), ATK and DEF. Tuned so a common sits ~1000 ATK and a
// legendary approaches the classic ~3000 blue-eyes bracket.
function deriveStats(worth: number, rarity: Rarity): { level: number; atk: number; def: number } {
  const rank = RARITY_RANK[rarity] ?? 0;
  const worthTerm = Math.min(2200, Math.round(Math.sqrt(Math.max(0, worth)) * 26));
  const atk = 700 + rank * 320 + worthTerm;
  const def = Math.round(atk * (0.55 + rank * 0.05));
  // Level scales with rank and worth; clamped to the legal 1..12 range.
  const level = Math.max(1, Math.min(12, 3 + rank + Math.floor(worthTerm / 500)));
  // Round ATK/DEF to tidy 10s for a card-game feel.
  return { level, atk: Math.round(atk / 10) * 10, def: Math.round(def / 10) * 10 };
}

// A monster's signature effect, chosen deterministically from its power tier so
// stronger cards feel special. Description text stays the card's own flavour.
function effectFor(level: number, rank: number, atk: number): DuelEffect | null {
  if (rank >= 4 && atk >= 2600) return { kind: "doubleAttack" };
  if (rank >= 3) return { kind: "pierce" };
  if (rank === 2) return { kind: "gainAtk", amount: 300 };
  if (level >= 5) return { kind: "burn", amount: 400 };
  if (rank === 1) return { kind: "drawOnSummon", count: 1 };
  return null;
}

export function toMonster(card: {
  id: number; name: string; rarity: string; cardType?: string | null;
  description?: string | null; flavor?: string | null; worthValue: number;
  imageUrl?: string | null;
}): DuelCard {
  const r = ((card.rarity in RARITY_RANK ? card.rarity : "common") as Rarity);
  const rank = RARITY_RANK[r] ?? 0;
  const { level, atk, def } = deriveStats(card.worthValue, r);
  const desc = (card.description || card.flavor || "").trim()
    || "A battle-hardened DN Cards unit ready to duel.";
  return {
    uid: `m${card.id}`,
    cardId: card.id,
    name: card.name,
    kind: "monster",
    art: card.imageUrl ? artPath(card.id) : null,
    rarity: RARITY_LABELS[r] ?? card.rarity,
    color: RARITY_COLORS[r] ?? 0x8899aa,
    attribute: attributeFor(card),
    level, atk, def,
    desc,
    effect: effectFor(level, rank, atk),
  };
}

// ── Generic support cards (spells & traps) ────────────────────────────────────
// These are NOT server cards — they are the classic "moves & rules" from the
// reference repos, so every deck plays like a real Yu-Gi-Oh duel. Art is drawn
// procedurally on the client (no external images → no CSP problems).
const SUPPORT_POOL: DuelCard[] = [
  supportCard("s-draw", "Card of Fortune", "spell", "Draw 2 cards.", 0x1e9e5a, { kind: "spell:draw", count: 2 }),
  supportCard("s-boost", "Rush Command", "spell", "All your monsters gain 700 ATK until the End Phase.", 0x1e9e5a, { kind: "spell:boost", amount: 700 }),
  supportCard("s-heal", "Field Medic", "spell", "Regain 1500 Life Points.", 0x1e9e5a, { kind: "spell:heal", amount: 1500 }),
  supportCard("t-mirror", "Mirror Barrier", "trap", "When an opponent declares an attack, destroy all their attack-position monsters.", 0x8a2be2, { kind: "trap:mirror" }),
  supportCard("t-cylinder", "Reflect Cylinder", "trap", "Negate an attack and inflict its ATK as damage to the opponent.", 0x8a2be2, { kind: "trap:cylinder" }),
  supportCard("t-hole", "Ambush Pit", "trap", "When the opponent summons a monster with 1500+ ATK, destroy it.", 0x8a2be2, { kind: "trap:trapHole", threshold: 1500 }),
];

function supportCard(uid: string, name: string, kind: "spell" | "trap", desc: string, color: number, effect: DuelEffect): DuelCard {
  return {
    uid, cardId: null, name, kind, art: null, rarity: kind === "spell" ? "Spell" : "Trap",
    color, attribute: "DIVINE", level: 0, atk: 0, def: 0, desc, effect,
  };
}

// Build a legal-ish 40-card deck: the given monsters (weighted by how many the
// player owns), padded with clones so short collections still duel, plus a
// sprinkle of support cards for depth.
function buildDeck(monsters: DuelCard[], targetMonsters = 34, supportCount = 6): DuelCard[] {
  const deck: DuelCard[] = [];
  if (monsters.length === 0) return [...SUPPORT_POOL];
  let i = 0;
  while (deck.length < targetMonsters) {
    const base = monsters[i % monsters.length]!;
    // Clone with a unique uid so identical cards are distinct in-hand.
    deck.push({ ...base, uid: `${base.uid}#${deck.length}` });
    i++;
  }
  for (let s = 0; s < supportCount; s++) {
    const base = SUPPORT_POOL[s % SUPPORT_POOL.length]!;
    deck.push({ ...base, uid: `${base.uid}#${s}` });
  }
  return shuffle(deck);
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

export interface DuelSetup {
  startingLp: number;
  handSize: number;
  player: { name: string; deck: DuelCard[] };
  opponent: { name: string; deck: DuelCard[] };
}

const AI_NAMES = [
  "Rival Kaiser", "Shadow Duelist", "Battle City Champ", "Ghoul Enforcer",
  "Arena Rival", "Dark Signer", "Neo Duelist",
];

/**
 * Assemble a full duel: the player's real cards vs an AI deck drawn from the
 * guild's card pool (scaled to be a fair rival). Read-only.
 */
export async function duelReadModel(
  guildId: string, userId: string, username: string,
): Promise<DuelSetup> {
  const [coll, pool] = await Promise.all([
    getUserCollection(guildId, userId),
    getAllCards(guildId),
  ]);

  // Player monsters: strongest-first, weighted by owned count so favourites
  // recur. Cap the unique pool so the deck stays coherent.
  const owned = [...coll]
    .filter((c) => c.imageUrl) // real art only for the player's own line-up
    .sort((a, b) => b.worthValue - a.worthValue);
  const playerMonsters: DuelCard[] = (owned.length ? owned : [fallbackCard()])
    .slice(0, 16)
    .map((c) => toMonster(c));

  // Opponent monsters: pull from the guild pool, biased toward mid/high worth so
  // the AI is a real threat, but never obscure event-only cards.
  const rivalSource = (pool.length ? pool : [fallbackCard() as unknown as Card])
    .filter((c) => c.imageUrl)
    .sort((a, b) => b.worthValue - a.worthValue)
    .slice(0, 24);
  const opponentMonsters: DuelCard[] = (rivalSource.length ? rivalSource : playerMonsters.map(fromDuel))
    .slice(0, 16)
    .map((c) => toMonster(c));

  return {
    startingLp: 8000,
    handSize: 5,
    player: { name: username || "You", deck: buildDeck(playerMonsters) },
    opponent: {
      name: AI_NAMES[Math.floor(Math.random() * AI_NAMES.length)]!,
      deck: buildDeck(opponentMonsters.length ? opponentMonsters : playerMonsters),
    },
  };
}

function fallbackCard() {
  return {
    id: 0, name: "Rookie Recruit", rarity: "common", cardType: "vehicle",
    description: "A fresh DN Cards recruit — every duelist starts somewhere.",
    flavor: null, worthValue: 40, imageUrl: null,
  };
}

// Reverse a derived monster back into a card-ish shape (used only as a last
// resort when the guild pool is empty, to mirror the player's own deck).
function fromDuel(d: DuelCard) {
  return {
    id: d.cardId ?? 0, name: d.name, rarity: "common", cardType: "vehicle",
    description: d.desc, flavor: null, worthValue: 100, imageUrl: null,
  };
}

// ── Shop read-model ───────────────────────────────────────────────────────────
// The Card Shop interior browses the server's REAL cards (our art + names) with
// their derived duel stats and a shard price. Read-only — buying is a later,
// authoritative bot flow; this powers the shelves and the card inspector.
export interface ShopCard {
  cardId: number;
  name: string;
  art: string | null;
  rarity: string;
  color: number;
  level: number;
  atk: number;
  def: number;
  attribute: DuelAttribute;
  desc: string;
  price: number;   // shards
  owned: number;   // how many the player owns (0 = not yet owned)
}

export async function shopReadModel(guildId: string, userId: string): Promise<{ shards: number; cards: ShopCard[] }> {
  const [pool, coll] = await Promise.all([
    getAllCards(guildId),
    getUserCollection(guildId, userId),
  ]);
  const ownedById = new Map<number, number>();
  for (const c of coll) ownedById.set(c.id, (c.count ?? 0) + (c.shinyCount ?? 0));

  const cards: ShopCard[] = pool
    .filter((c) => c.imageUrl && !c.isArchived)
    .sort((a, b) => a.worthValue - b.worthValue)
    .slice(0, 60)
    .map((c) => {
      const m = toMonster(c);
      return {
        cardId: c.id, name: c.name, art: m.art, rarity: m.rarity, color: m.color,
        level: m.level, atk: m.atk, def: m.def, attribute: m.attribute, desc: m.desc,
        price: Math.max(50, Math.round(c.worthValue * 1.25)),
        owned: ownedById.get(c.id) ?? 0,
      };
    });
  return { shards: 0, cards };
}
