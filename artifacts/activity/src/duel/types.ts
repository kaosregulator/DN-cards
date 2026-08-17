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

// Effect vocabulary. The MONSTER effects (first block) mirror
// bot/activity/duel-model.ts — the server sends those. The SPELL/TRAP effects
// (second block) are defined by the client card library (duel/cards.ts) using
// real Yu-Gi-Oh effects, so the server never needs to know about them.
export type DuelEffect =
  // ── Monster (continuous / on-summon / battle) ──
  | { kind: "pierce" }
  | { kind: "gainAtk"; amount: number }
  | { kind: "drawOnSummon"; count: number }
  | { kind: "burn"; amount: number }
  | { kind: "doubleAttack" }
  | { kind: "flip:destroy" }              // flip effect: destroy 1 opponent monster (targeted)
  | { kind: "negateTraps" }               // Jinzo — Trap Cards cannot be activated
  // ── Spell ──
  | { kind: "spell:draw"; count: number }
  | { kind: "spell:boost"; amount: number }
  | { kind: "spell:heal"; amount: number }
  | { kind: "spell:destroyTarget" }        // destroy 1 target monster
  | { kind: "spell:destroySpellTrap" }     // destroy 1 target spell/trap (MST)
  | { kind: "spell:destroyAll" }           // Dark Hole — all monsters both sides
  | { kind: "spell:destroyAllOpp" }        // Raigeki — all opponent monsters
  | { kind: "spell:fissure" }              // destroy opponent's lowest-ATK monster
  | { kind: "spell:flipTarget" }           // Book of Moon — flip 1 face-up monster face-down
  | { kind: "spell:reborn" }               // Monster Reborn — SS 1 from any graveyard (targeted)
  // ── Equip / Continuous / Field (persistent) ──
  | { kind: "equip:atk"; atk: number; def?: number }   // attach to a monster
  | { kind: "continuous:allyAtk"; amount: number }     // all your monsters +ATK while on field
  | { kind: "field:attrBoost"; attribute: DuelAttribute; amount: number } // attribute-wide aura
  // ── Trap ──
  | { kind: "trap:mirror" }                // Mirror Force — destroy all attacking monsters
  | { kind: "trap:cylinder" }              // Magic Cylinder — negate + burn attacker ATK
  | { kind: "trap:sakuretsu" }             // Sakuretsu Armor — destroy the attacker
  | { kind: "trap:negateAttack" }          // Negate Attack — negate + end Battle Phase
  | { kind: "trap:trapHole"; threshold: number } // destroy a just-summoned monster ATK ≥ threshold
  | { kind: "trap:reborn" };               // Call of the Haunted — SS 1 from your graveyard (targeted)

/** A reference to a card the player/AI picked as an effect's target. */
export type TargetRef =
  | { side: PlayerId; kind: "monster"; zone: number }
  | { side: PlayerId; kind: "spellTrap"; zone: number }
  | { side: PlayerId; kind: "grave"; index: number };

/** A card as delivered by the backend deck (immutable template). */
export interface DuelCard {
  uid: string;
  cardId: number | null;
  /** Display name — the SERVER card's own name (your art, your naming). */
  name: string;
  kind: DuelCardKind;
  art: string | null;
  rarity: string;
  color: number;
  attribute: DuelAttribute;
  level: number;
  atk: number;
  def: number;
  /** The REAL Yu-Gi-Oh card text this card plays as. */
  desc: string;
  effect: DuelEffect | null;
  /** The real Yu-Gi-Oh card this one is bound to (name shown as a subtitle). */
  realName?: string;
  /** Real card Type line: Dragon / Spellcaster / Warrior … (monsters). */
  race?: string;
  /** Spell/Trap sub-type: Normal / Quick-Play / Continuous / Equip / Counter. */
  sub?: string;
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
  /** For equip spells: the monster this card is attached to. */
  equipTarget?: { side: PlayerId; zone: number };
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

/** A single activated card waiting on the chain (resolves LIFO). */
export interface ChainLink {
  who: PlayerId;
  card: DuelCard;
  effect: DuelEffect;
  targets: TargetRef[];
  negated?: boolean;
}

/** What resumes once the current chain finishes resolving. */
export type PendingAction =
  | { type: "battle"; attackerSide: PlayerId; attacker: number; target: number | "direct"; negated: boolean; endBattlePhase?: boolean }
  | { type: "summonTrigger"; who: PlayerId; zone: number };

/** An open priority window: `responder` may activate a set card or pass. */
export interface ResponseWindow {
  responder: PlayerId;
  passes: number; // consecutive passes; two in a row closes the window
}

export interface DuelState {
  player: PlayerBoard;
  opponent: PlayerBoard;
  turn: PlayerId;
  phase: Phase;
  turnCount: number;
  startingLp: number;
  winner: PlayerId | null;
  log: string[];
  // Chain / priority machinery (P0 mechanic).
  chain: ChainLink[];
  pending: PendingAction | null;
  awaiting: ResponseWindow | null;
}

// ── Events — the engine's narration, so the scene can animate deterministically.
export type DuelEvent =
  | { t: "draw"; who: PlayerId; card: DuelCard }
  | { t: "deckout"; who: PlayerId }
  | { t: "phase"; phase: Phase; who: PlayerId }
  | { t: "turn"; who: PlayerId; turnCount: number }
  | { t: "summon"; who: PlayerId; zone: number; card: DuelCard; position: MonsterPosition; tributes: number }
  | { t: "specialSummon"; who: PlayerId; zone: number; card: DuelCard }
  | { t: "flip"; who: PlayerId; zone: number }
  | { t: "positionChange"; who: PlayerId; zone: number; position: MonsterPosition }
  | { t: "setSpellTrap"; who: PlayerId; zone: number; card: DuelCard }
  | { t: "activate"; who: PlayerId; card: DuelCard; text: string }
  | { t: "chainResolve"; who: PlayerId; card: DuelCard }
  | { t: "negate"; text: string }
  | { t: "equip"; who: PlayerId; card: DuelCard; zone: number }
  | { t: "window"; responder: PlayerId }
  | { t: "attackDeclare"; who: PlayerId; fromZone: number; toZone: number | "direct" }
  | { t: "clash"; who: PlayerId; fromZone: number; toZone: number | "direct" }
  | { t: "destroy"; who: PlayerId; zone: number; card: DuelCard }
  | { t: "damage"; who: PlayerId; amount: number; reason: string }
  | { t: "heal"; who: PlayerId; amount: number }
  | { t: "buff"; who: PlayerId; text: string }
  | { t: "log"; text: string }
  | { t: "win"; who: PlayerId };

export const ZONES = 5;
