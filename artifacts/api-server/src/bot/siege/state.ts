// ─────────────────────────────────────────────────────────────────────────────
// Siege Battle — state construction and pure queries.
//
// Nothing here mutates a battle in a rules-meaningful way; the resolver owns
// that. These are the questions the UI, the AI and the resolver all need to ask
// about a board, kept in one place so the rules for "can I be attacked directly"
// exist exactly once.
// ─────────────────────────────────────────────────────────────────────────────

import type { BattleSettings } from "@workspace/db";
import type { Combatant } from "../battle/types.js";
import { buildSiegeDeck, type SiegeCard } from "./siege-cards.js";
import {
  FORMATION_SIZE, type SiegeBattleState, type SiegeSlot, type SiegeTeam,
  type SideIdx, type SiegeBattleEvent,
} from "./types.js";

/** How many Siege Battle Cards a commander holds. */
export const HAND_SIZE = 5;
/** Default life points when a caller doesn't specify. */
export const DEFAULT_LP = 6000;

export interface BuildTeamInput {
  side: SideIdx;
  name: string;
  userId: string;
  isAi: boolean;
  /** Strongest-first roster. The first four take the board, the rest are reserves. */
  roster: Combatant[];
  lp?: number;
  itemUses?: number;
}

/** Lay a roster out on the board: first four to the squares, remainder to reserve. */
export function buildTeam(input: BuildTeamInput, rng: () => number = Math.random): SiegeTeam {
  const slots: SiegeSlot[] = [];
  for (let i = 0; i < FORMATION_SIZE; i++) {
    slots.push({ index: i, unit: input.roster[i] ?? null });
  }
  const drawPile = buildSiegeDeck(rng);
  const hand: SiegeCard[] = [];
  const lp = input.lp ?? DEFAULT_LP;
  const team: SiegeTeam = {
    side: input.side,
    name: input.name,
    userId: input.userId,
    isAi: input.isAi,
    slots,
    reserves: input.roster.slice(FORMATION_SIZE),
    lp,
    lpMax: lp,
    hand,
    drawPile,
    discardPile: [],
    cardCooldowns: {},
    wavesLost: 0,
    exposed: false,
    itemUsesLeft: input.itemUses ?? 3,
  };
  for (let i = 0; i < HAND_SIZE; i++) drawCard(team);
  return team;
}

export interface BuildBattleInput {
  attacker: BuildTeamInput;
  defender: BuildTeamInput;
  settings: BattleSettings;
  maxTurns?: number;
  firstSide?: SideIdx;
}

/**
 * A safety cap so a stalemate cannot run forever. It has to scale with the
 * armies: life points are only reachable after every card on a side has been
 * destroyed, so a seven-card roster legitimately needs far more turns to reach a
 * decision than a four-card one. Simulation puts a 4-card siege at ~34 turns and
 * a 7-card siege at ~51; this leaves comfortable headroom above both so the cap
 * stays a backstop rather than the usual way a siege ends.
 */
export function defaultMaxTurns(attackerRoster: number, defenderRoster: number): number {
  return 40 + 6 * Math.max(attackerRoster, defenderRoster);
}

export function buildSiegeBattle(input: BuildBattleInput, rng: () => number = Math.random): SiegeBattleState {
  return {
    teams: [
      buildTeam({ ...input.attacker, side: 0 }, rng),
      buildTeam({ ...input.defender, side: 1 }, rng),
    ],
    settings: input.settings,
    turn: 1,
    activeSide: input.firstSide ?? 0,
    phase: "command",
    winner: null,
    maxTurns: input.maxTurns
      ?? defaultMaxTurns(input.attacker.roster.length, input.defender.roster.length),
    log: [],
  };
}

// ── Draw / discard ───────────────────────────────────────────────────────────

/** Draw one card, reshuffling the discard pile when the draw pile runs dry. */
export function drawCard(team: SiegeTeam, rng: () => number = Math.random): SiegeCard | null {
  if (team.drawPile.length === 0) {
    if (team.discardPile.length === 0) return null;
    team.drawPile = team.discardPile;
    team.discardPile = [];
    for (let i = team.drawPile.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [team.drawPile[i], team.drawPile[j]] = [team.drawPile[j]!, team.drawPile[i]!];
    }
  }
  const card = team.drawPile.pop() ?? null;
  if (card) team.hand.push(card);
  return card;
}

/** Top the hand back up to HAND_SIZE (called at the start of a side's turn). */
export function refillHand(team: SiegeTeam, rng: () => number = Math.random): SiegeCard[] {
  const drawn: SiegeCard[] = [];
  while (team.hand.length < HAND_SIZE) {
    const c = drawCard(team, rng);
    if (!c) break;
    drawn.push(c);
  }
  return drawn;
}

// ── Queries ──────────────────────────────────────────────────────────────────

export const otherSide = (s: SideIdx): SideIdx => (s === 0 ? 1 : 0);
export const teamOf = (state: SiegeBattleState, side: SideIdx): SiegeTeam => state.teams[side];

/** A unit is alive when it exists and has HP left. */
export const isAlive = (u: Combatant | null): u is Combatant => !!u && u.hp > 0;

/** Board squares holding a living card. */
export function livingSlots(team: SiegeTeam): SiegeSlot[] {
  return team.slots.filter(s => isAlive(s.unit));
}
export function livingUnits(team: SiegeTeam): Combatant[] {
  return livingSlots(team).map(s => s.unit!);
}
export function livingCount(team: SiegeTeam): number {
  return livingSlots(team).length;
}
/** Squares with no living card — either empty or holding a destroyed one. */
export function emptySlots(team: SiegeTeam): SiegeSlot[] {
  return team.slots.filter(s => !isAlive(s.unit));
}

/** The formation is wiped when nothing on the board can still fight. */
export function formationEmpty(team: SiegeTeam): boolean {
  return livingCount(team) === 0;
}

/** Can this side still refill the board from its deck? */
export function canReinforce(team: SiegeTeam): boolean {
  return team.reserves.some(c => c.hp > 0) && emptySlots(team).length > 0;
}

/**
 * THE core defence rule. A side's life points are only reachable when its
 * formation cannot protect them any more: nothing standing on the board AND
 * nothing left to deploy. Cards that explicitly bypass the formation (a
 * `breakthrough` Siege Card) are the deliberate exception and check this
 * themselves.
 */
export function lpExposed(team: SiegeTeam): boolean {
  return formationEmpty(team) && !canReinforce(team);
}

/** A side has lost when its LP is gone. */
export function isDefeated(team: SiegeTeam): boolean {
  return team.lp <= 0;
}

/** Find the slot a unit occupies, or -1. */
export function slotOfUnit(team: SiegeTeam, unit: Combatant): number {
  return team.slots.findIndex(s => s.unit === unit);
}

/** The default target when a caller doesn't choose one: the first living card. */
export function defaultTargetSlot(team: SiegeTeam): number {
  const s = livingSlots(team)[0];
  return s ? s.index : -1;
}

// ── Logging ──────────────────────────────────────────────────────────────────

export function pushEvents(state: SiegeBattleState, events: SiegeBattleEvent[]): void {
  state.log.push(...events);
  // Keep the log bounded; the UI only ever shows a tail of it.
  if (state.log.length > 400) state.log.splice(0, state.log.length - 400);
}

/** A short human summary of a side's board, for embeds. */
export function formationSummary(team: SiegeTeam): string {
  return team.slots
    .map(s => {
      if (!s.unit) return "▫️ —";
      if (s.unit.hp <= 0) return `☠️ ~~${s.unit.cardName}~~`;
      const pct = Math.round((s.unit.hp / s.unit.stats.maxHealth) * 100);
      return `${pct > 60 ? "🟩" : pct > 25 ? "🟨" : "🟥"} ${s.unit.cardName} (${pct}%)`;
    })
    .join("\n");
}
