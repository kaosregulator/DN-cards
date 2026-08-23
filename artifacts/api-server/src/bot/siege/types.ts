// ─────────────────────────────────────────────────────────────────────────────
// Siege Battle — domain model.
//
// Siege Battle is a 4-card-per-side RPG card battle layered on top of the
// EXISTING DN Cards combat model. A fighter on the field is a plain `Combatant`
// (same type /battle and Raids use), so every stat, moveset, passive, status and
// Battle Item keeps working unchanged; this module only adds what a formation
// fight needs on top: board slots, life points, reserves, and a hand of Siege
// Battle Cards.
//
// Layering (kept strictly one-directional):
//
//   Card Data  →  Siege Adapter  →  Battle State  →  Action Resolver
//                                                          ↓
//                                                    Battle Events  →  Renderer
//
// The resolver is the ONLY thing that mutates state, and it does all of its
// damage maths through the shared combat engine. The renderer consumes events
// and never computes an outcome.
// ─────────────────────────────────────────────────────────────────────────────

import type { BattleSettings } from "@workspace/db";
import type { Combatant, BattleEvent, MoveType } from "../battle/types.js";
import type { SiegeCard } from "./siege-cards.js";

/** Which team. 0 = the attacking commander, 1 = the garrison / raid boss side. */
export type SideIdx = 0 | 1;

/** Board positions per side. Matches the four board squares the renderer draws. */
export const FORMATION_SIZE = 4;
export type SlotIdx = 0 | 1 | 2 | 3;

/**
 * One board square. `unit` is null when the square is empty — either never
 * filled (a short roster) or the card there was destroyed and not yet replaced.
 */
export interface SiegeSlot {
  unit: Combatant | null;
  /** Squares are stable identities for the renderer across reinforcement waves. */
  index: number;
}

/**
 * A side's whole army: what is on the board, what is left to deploy, its life
 * points, and its Siege Battle Card hand.
 */
export interface SiegeTeam {
  side: SideIdx;
  name: string;
  /** Discord user id, or "AI" for a computer-run garrison. */
  userId: string;
  isAi: boolean;

  /** The four board squares. Always length FORMATION_SIZE. */
  slots: SiegeSlot[];
  /** Cards still in the deck/reserve, deployed when the formation is wiped. */
  reserves: Combatant[];

  /** Life points — only reachable once the formation cannot protect them. */
  lp: number;
  lpMax: number;

  // ── Siege Battle Cards (the action-card hand) ──────────────────────────────
  hand: SiegeCard[];
  drawPile: SiegeCard[];
  discardPile: SiegeCard[];
  /** cardId → turns remaining before it may be played again. */
  cardCooldowns: Record<string, number>;

  /** How many full formations this side has already lost. */
  wavesLost: number;
  /** Battle Item uses left for the whole siege (shared across the team). */
  itemUsesLeft: number;
}

export type SiegePhase =
  /** Waiting on the acting side to choose fighter → target → action. */
  | "command"
  /** A formation was wiped; that side is choosing replacements. */
  | "reinforce"
  | "ended";

/**
 * The complete battle. Everything the resolver needs and nothing it doesn't —
 * no Discord objects, no timers, no rendering state. That keeps the whole engine
 * testable headlessly (see scripts/src/siege-sim.ts).
 */
export interface SiegeBattleState {
  teams: [SiegeTeam, SiegeTeam];
  settings: BattleSettings;
  /** A turn is one side acting, matching /battle's counter. */
  turn: number;
  activeSide: SideIdx;
  phase: SiegePhase;
  /** Set once the battle is decided. */
  winner: SideIdx | null;
  /** Hard stop so a stalemate cannot run forever. */
  maxTurns: number;
  /** Rolling log, newest last. */
  log: SiegeBattleEvent[];
}

// ── Actions ──────────────────────────────────────────────────────────────────

/**
 * Everything a side can do on its turn. Every action names the acting slot, so
 * the commander picks WHICH of their cards acts (not just the front rank).
 */
export type SiegeAction =
  /** Basic attack / signature Special / Ultimate / Defend / Charge — the existing moves. */
  | { kind: "move"; actorSlot: number; move: MoveType; targetSlot?: number }
  /** Play a Siege Battle Card from hand. */
  | { kind: "siege_card"; actorSlot: number; cardId: string; targetSlot?: number }
  /** Use an equipped Battle Item, team-aware. */
  | { kind: "item"; actorSlot: number; itemId: string; targetSide: SideIdx; targetSlot: number }
  /** Swing at the enemy's life points directly (only when that is legal). */
  | { kind: "direct_lp"; actorSlot: number }
  /** Fill empty squares from reserves after a wipe. */
  | { kind: "reinforce"; cardIds: number[] };

/** Why an action was rejected. Surfaced to the UI so buttons can explain themselves. */
export interface SiegeActionRejection {
  ok: false;
  reason: string;
}
export type SiegeActionCheck = { ok: true } | SiegeActionRejection;

// ── Events ───────────────────────────────────────────────────────────────────

/**
 * A log line plus the structured facts a renderer needs to animate it. The
 * renderer reads these; it never recomputes damage. `text`/`flash` are inherited
 * from the existing BattleEvent so /battle's embed themer works unchanged.
 */
export interface SiegeBattleEvent extends BattleEvent {
  /** Which board squares this event touched, for flashes and knockback. */
  actorSide?: SideIdx;
  actorSlot?: number;
  targetSide?: SideIdx;
  targetSlot?: number;
  /** HP removed from a unit (0 for pure buffs/utility). */
  damage?: number;
  /** LP removed from a side. */
  lpDamage?: number;
  /** A unit was destroyed by this event. */
  ko?: boolean;
  /** Structured kind, so a renderer can switch on it without parsing text. */
  event?:
    | "attack" | "special" | "ultimate" | "defend" | "charge" | "item"
    | "siege_card" | "direct_lp" | "ko" | "deploy" | "wipe" | "victory" | "info";
}

/** The result of resolving one action. */
export interface SiegeTurnResult {
  events: SiegeBattleEvent[];
  /** Slots destroyed this action, as {side, slot}. */
  destroyed: { side: SideIdx; slot: number }[];
  /** True when this action ended the battle. */
  battleOver: boolean;
}
