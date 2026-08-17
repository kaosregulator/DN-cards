// ─────────────────────────────────────────────────────────────────────────────
// Duel domain types — the shared vocabulary of the true Yu-Gi-Oh style duel.
//
// The card MODEL (attributes, kinds, effects) and the DECK come from the DN
// Cards backend (/activity/duel); the RULES that move these pieces around live
// in engine.ts. This file is framework-free so the engine can be unit-reasoned
// about without Phaser.
// ─────────────────────────────────────────────────────────────────────────────

export type DuelAttribute = "EARTH" | "WIND" | "WATER" | "FIRE" | "LIGHT" | "DARK" | "DIVINE";
export type DuelCardKind = "monster" | "spell" | "trap";

// Effect vocabulary — mirrors bot/activity/duel-model.ts. Data-driven so the
// engine handles new cards without new code.
export type DuelEffect =
  | { kind: "pierce" }
  | { kind: "gainAtk"; amount: number }
  | { kind: "drawOnSummon"; count: number }
  | { kind: "burn"; amount: number }
  | { kind: "doubleAttack" }
  | { kind: "spell:draw"; count: number }
  | { kind: "spell:boost"; amount: number }
  | { kind: "spell:heal"; amount: number }
  | { kind: "trap:mirror" }
  | { kind: "trap:cylinder" }
  | { kind: "trap:trapHole"; threshold: number };

/** A card as delivered by the backend deck (immutable template). */
export interface DuelCard {
  uid: string;
  cardId: number | null;
  name: string;
  kind: DuelCardKind;
  art: string | null;
  rarity: string;
  color: number;
  attribute: DuelAttribute;
  level: number;
  atk: number;
  def: number;
  desc: string;
  effect: DuelEffect | null;
}

export interface DuelSetup {
  startingLp: number;
  handSize: number;
  player: { name: string; deck: DuelCard[] };
  opponent: { name: string; deck: DuelCard[] };
}

export type MonsterPosition = "attack" | "defense" | "set"; // set = face-down defense

/** A monster occupying a field zone, with its live (mutable) battle state. */
export interface FieldMonster {
  card: DuelCard;
  position: MonsterPosition;
  /** ATK after continuous modifiers (gainAtk, spell:boost). */
  atkMod: number;
  defMod: number;
  /** Portion of atkMod that came from a turn-scoped boost (wears off at End). */
  turnBoost: number;
  hasAttacked: number; // attacks used this Battle Phase
  summonedThisTurn: boolean;
  faceUp: boolean;
}

/** A set spell/trap in a spell&trap zone. */
export interface FieldSpellTrap {
  card: DuelCard;
  faceUp: boolean;
}

export type PlayerId = "player" | "opponent";

export interface PlayerBoard {
  id: PlayerId;
  name: string;
  lp: number;
  deck: DuelCard[];
  hand: DuelCard[];
  monsters: (FieldMonster | null)[]; // length 5
  spellTraps: (FieldSpellTrap | null)[]; // length 5
  graveyard: DuelCard[];
  hasNormalSummoned: boolean;
}

export type Phase = "DRAW" | "STANDBY" | "MAIN1" | "BATTLE" | "MAIN2" | "END";

export interface DuelState {
  player: PlayerBoard;
  opponent: PlayerBoard;
  turn: PlayerId;
  phase: Phase;
  turnCount: number;
  startingLp: number;
  winner: PlayerId | null;
  log: string[];
}

// ── Events — the engine's narration, so the scene can animate deterministically.
export type DuelEvent =
  | { t: "draw"; who: PlayerId; card: DuelCard }
  | { t: "deckout"; who: PlayerId }
  | { t: "phase"; phase: Phase; who: PlayerId }
  | { t: "turn"; who: PlayerId; turnCount: number }
  | { t: "summon"; who: PlayerId; zone: number; card: DuelCard; position: MonsterPosition; tributes: number }
  | { t: "flip"; who: PlayerId; zone: number }
  | { t: "positionChange"; who: PlayerId; zone: number; position: MonsterPosition }
  | { t: "setSpellTrap"; who: PlayerId; zone: number; card: DuelCard }
  | { t: "activate"; who: PlayerId; card: DuelCard; text: string }
  | { t: "attackDeclare"; who: PlayerId; fromZone: number; toZone: number | "direct" }
  | { t: "clash"; who: PlayerId; fromZone: number; toZone: number | "direct" }
  | { t: "destroy"; who: PlayerId; zone: number; card: DuelCard }
  | { t: "damage"; who: PlayerId; amount: number; reason: string }
  | { t: "heal"; who: PlayerId; amount: number }
  | { t: "buff"; who: PlayerId; text: string }
  | { t: "log"; text: string }
  | { t: "win"; who: PlayerId };

export const ZONES = 5;
