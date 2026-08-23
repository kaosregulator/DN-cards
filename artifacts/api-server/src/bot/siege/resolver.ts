// ─────────────────────────────────────────────────────────────────────────────
// Siege Battle — the Action Resolver.
//
// The ONLY place a siege battle changes. Every action a player or the AI can
// take goes through `checkAction` (is it legal?) and `resolveAction` (do it),
// and every point of damage is computed by the shared combat engine — this file
// contains no damage formula of its own. That keeps a Siege blow, a /battle blow
// and a Raid blow numerically identical, which is the whole point of having one
// engine.
//
// Order of business for a normal turn:
//   startTurn()      — status ticks → DRAW PHASE (refill hand); stays in DRAW
//   enterMainPhase() — DRAW → MAIN so combat actions become legal
//   resolveAction()  — the chosen action (legal only in MAIN / reinforce)
//   endTurn()        — hand over, deploy reinforcements, check for a winner
// ─────────────────────────────────────────────────────────────────────────────

import type { Combatant, MoveType } from "../battle/types.js";
import {
  resolveMove, resolveTeamUltimate, startOfTurn, availableMoves, strikeWith,
} from "../battle/combat-engine.js";
import { getBattleItem, applyItemUse } from "../battle/items.js";
import { getSiegeCard, type SiegeCard } from "./siege-cards.js";
import {
  canReinforce, defaultTargetSlot, emptySlots, formationEmpty, isAlive,
  livingSlots, livingUnits, lpExposed, otherSide, pushEvents, refillHand, teamOf,
} from "./state.js";
import type {
  SiegeAction, SiegeActionCheck, SiegeBattleEvent, SiegeBattleState, SiegeTeam,
  SiegeTurnResult, SiegeStruck, SideIdx,
} from "./types.js";

const reject = (reason: string): SiegeActionCheck => ({ ok: false, reason });
const OK: SiegeActionCheck = { ok: true };

/** Tag plain combat-engine events with the board coordinates a renderer needs. */
function tag(
  events: { text: string; flash?: SiegeBattleEvent["flash"] }[],
  meta: Partial<SiegeBattleEvent>,
): SiegeBattleEvent[] {
  return events.map(e => ({ ...e, ...meta }));
}

/**
 * Clamp every meter on the board. The combat engine's own entry points clamp
 * their two participants, but a team action touches cards they never see (splash
 * targets, counter-attackers, drained allies), so the resolver normalises the
 * whole board after any mutation. One place, so no action can leak a negative HP
 * bar into a render.
 */
function clampBoard(state: SiegeBattleState): void {
  for (const team of state.teams) {
    team.lp = Math.max(0, team.lp);
    for (const slot of team.slots) {
      const u = slot.unit;
      if (!u) continue;
      if (u.hp < 0) u.hp = 0;
      if (u.hp > u.stats.maxHealth) u.hp = u.stats.maxHealth;
      if (u.shield < 0) u.shield = 0;
      u.energy = Math.max(0, Math.min(u.stats.energyMax, u.energy));
      u.ultimate = Math.max(0, Math.min(u.stats.ultimateMax, u.ultimate));
    }
    for (const r of team.reserves) if (r.hp < 0) r.hp = 0;
  }
}

// ── Turn lifecycle ───────────────────────────────────────────────────────────

/**
 * Begin the acting side's turn:
 *   1. Tick living cards (DoT, regen, energy) and Siege Card cooldowns
 *   2. DRAW PHASE — move cards from drawPile → hand (reshuffle discard if dry)
 *
 * Leaves `state.phase === "draw"` so Discord can show the draw cinematic before
 * combat buttons unlock. Call `enterMainPhase` next.
 *
 * Returns the events plus which of its own cards died to damage-over-time.
 * Combat actions are illegal while `state.phase === "draw"`.
 */
export function startTurn(state: SiegeBattleState): SiegeTurnResult {
  if (state.phase === "ended") {
    return { events: [], destroyed: [], struck: [], damageDealt: 0, lpDamage: 0, battleOver: true };
  }

  const team = teamOf(state, state.activeSide);
  const events: SiegeBattleEvent[] = [];
  const destroyed: { side: SideIdx; slot: number }[] = [];

  // ── DRAW PHASE ────────────────────────────────────────────────────────────
  state.phase = "draw";
  events.push({
    text: `🃏 **Draw Phase** — **${team.name}** draws.`,
    event: "phase", actorSide: team.side,
  });

  for (const slot of team.slots) {
    const unit = slot.unit;
    if (!isAlive(unit)) continue;
    const r = startOfTurn(unit, state.settings);
    events.push(...tag(r.events, { actorSide: team.side, actorSlot: slot.index }));
    if (unit.hp < 0) unit.hp = 0;
    if (unit.hp <= 0) {
      destroyed.push({ side: team.side, slot: slot.index });
      events.push({
        text: `☠️ **${unit.cardName}** falls.`, flash: "ko", event: "ko",
        targetSide: team.side, targetSlot: slot.index, ko: true,
      });
    }
  }

  for (const id of Object.keys(team.cardCooldowns)) {
    const left = (team.cardCooldowns[id] ?? 0) - 1;
    if (left > 0) team.cardCooldowns[id] = left;
    else delete team.cardCooldowns[id];
  }

  const drawn: SiegeCard[] = refillHand(team);
  if (drawn.length > 0) {
    events.push({
      text: `🃏 Drew **${drawn.length}** Siege Battle Card${drawn.length === 1 ? "" : "s"}`
        + (drawn.length <= 3 ? `: ${drawn.map(c => c.name).join(", ")}` : "")
        + `. Hand **${team.hand.length}**.`,
      event: "draw", actorSide: team.side,
    });
  } else {
    events.push({
      text: `🃏 Hand is full (**${team.hand.length}**) — no cards drawn.`,
      event: "draw", actorSide: team.side,
    });
  }

  clampBoard(state);
  pushEvents(state, events);
  return { events, destroyed, struck: [], damageDealt: 0, lpDamage: 0, battleOver: false, drawnCards: drawn };
}

/**
 * Leave DRAW and open MAIN so combat actions become legal. Idempotent if already
 * in MAIN; no-op if the battle ended.
 */
export function enterMainPhase(state: SiegeBattleState): SiegeTurnResult {
  if (state.phase === "ended") {
    return { events: [], destroyed: [], struck: [], damageDealt: 0, lpDamage: 0, battleOver: true };
  }
  if (state.phase === "main") {
    return { events: [], destroyed: [], struck: [], damageDealt: 0, lpDamage: 0, battleOver: false };
  }
  const team = teamOf(state, state.activeSide);
  state.phase = "main";
  const events: SiegeBattleEvent[] = [{
    text: `⚔️ **Main Phase** — **${team.name}** chooses an action.`,
    event: "phase", actorSide: team.side,
  }];
  pushEvents(state, events);
  return { events, destroyed: [], struck: [], damageDealt: 0, lpDamage: 0, battleOver: false };
}

/**
 * Close the acting side's turn: deploy reinforcements for anyone whose board is
 * empty, expose LP where nothing is left, decide a winner, then hand over.
 */
export function endTurn(state: SiegeBattleState): SiegeTurnResult {
  const events: SiegeBattleEvent[] = [];

  for (const team of state.teams) {
    if (!formationEmpty(team)) continue;
    if (canReinforce(team)) {
      events.push({
        text: `🚩 **${team.name}**'s formation is destroyed — reinforcements move up!`,
        flash: "combo", event: "wipe", targetSide: team.side,
      });
      events.push(...autoReinforce(state, team.side));
    } else if (!team.exposed) {
      // Nothing left on the board AND nothing left to deploy: the commander is
      // exposed from here on. Announced exactly once (the flag guards re-firing).
      team.exposed = true;
      events.push({
        text: `💥 **${team.name}** has no cards left to defend — their life points are exposed!`,
        flash: "shield_break", event: "wipe", targetSide: team.side,
      });
    }
  }

  const winner = decideWinner(state);
  if (winner !== null) {
    state.winner = winner;
    state.phase = "ended";
    events.push({
      text: `🏆 **${state.teams[winner].name}** wins the siege!`,
      flash: "ultimate", event: "victory", actorSide: winner,
    });
    pushEvents(state, events);
    return { events, destroyed: [], struck: [], damageDealt: 0, lpDamage: 0, battleOver: true };
  }

  state.activeSide = otherSide(state.activeSide);
  if (state.activeSide === 0) state.turn++;
  if (state.turn > state.maxTurns) {
    state.winner = decideOnPoints(state);
    state.phase = "ended";
    events.push({
      text: `⌛ The siege stalls — it is decided on ground taken.`,
      event: "info",
    });
    pushEvents(state, events);
    return { events, destroyed: [], struck: [], damageDealt: 0, lpDamage: 0, battleOver: true };
  }
  pushEvents(state, events);
  return { events, destroyed: [], struck: [], damageDealt: 0, lpDamage: 0, battleOver: false };
}

/** A side loses when its LP hits zero. */
function decideWinner(state: SiegeBattleState): SideIdx | null {
  if (state.teams[0].lp <= 0) return 1;
  if (state.teams[1].lp <= 0) return 0;
  return null;
}

/** Turn-cap fallback: most LP left, then most cards standing. */
function decideOnPoints(state: SiegeBattleState): SideIdx | null {
  const [a, b] = state.teams;
  if (a.lp !== b.lp) return a.lp > b.lp ? 0 : 1;
  const la = livingSlots(a).length, lb = livingSlots(b).length;
  if (la !== lb) return la > lb ? 0 : 1;
  return null;
}

/** Move reserves onto every empty square, strongest first. */
export function autoReinforce(state: SiegeBattleState, side: SideIdx): SiegeBattleEvent[] {
  const team = teamOf(state, side);
  const events: SiegeBattleEvent[] = [];
  for (const slot of emptySlots(team)) {
    const next = team.reserves.find(c => c.hp > 0);
    if (!next) break;
    team.reserves.splice(team.reserves.indexOf(next), 1);
    slot.unit = next;
    events.push({
      text: `🛡️ **${next.cardName}** deploys to the line.`,
      flash: "shield", event: "deploy", actorSide: side, actorSlot: slot.index,
    });
  }
  if (events.length) team.wavesLost++;
  return events;
}

// ── Legality ─────────────────────────────────────────────────────────────────

function actorAt(team: SiegeTeam, slot: number): Combatant | null {
  const s = team.slots[slot];
  return isAlive(s?.unit ?? null) ? s!.unit : null;
}

export function checkAction(state: SiegeBattleState, action: SiegeAction): SiegeActionCheck {
  if (state.phase === "ended") return reject("The siege is already over.");
  if (state.phase === "draw") return reject("Still drawing — wait for the Main Phase.");

  const team = teamOf(state, state.activeSide);
  const foes = teamOf(state, otherSide(state.activeSide));

  if (action.kind === "reinforce") {
    if (state.phase !== "reinforce" && state.phase !== "main") {
      return reject("Reinforcements can only deploy during the reinforce window.");
    }
    if (!canReinforce(team)) return reject("There is nothing left to deploy.");
    return OK;
  }

  // Normal combat actions require MAIN PHASE — never DRAW.
  if (state.phase !== "main") {
    return reject("Actions are only available during the Main Phase.");
  }

  const actor = actorAt(team, action.actorSlot);
  if (!actor) return reject("That square has no card standing on it.");

  switch (action.kind) {
    case "move": {
      const legal = availableMoves(actor, state.settings);
      if (!legal[action.move]) return reject(`${actor.cardName} cannot use that move right now.`);
      if (isTargetedMove(action.move)) {
        if (formationEmpty(foes)) return reject("There are no enemy cards to attack.");
        const t = action.targetSlot ?? defaultTargetSlot(foes);
        if (!actorAt(foes, t)) return reject("That target is not standing.");
      }
      return OK;
    }
    case "siege_card": {
      const card = getSiegeCard(action.cardId);
      if (!card) return reject("Unknown siege card.");
      if (!team.hand.some(c => c.id === card.id)) return reject(`${card.name} is not in your hand.`);
      if ((team.cardCooldowns[card.id] ?? 0) > 0) {
        return reject(`${card.name} is on cooldown for ${team.cardCooldowns[card.id]} more turn(s).`);
      }
      if (actor.energy < card.energyCost) {
        return reject(`${actor.cardName} needs ${card.energyCost} energy for ${card.name}.`);
      }
      return checkSiegeCardConditions(state, card, action.targetSlot);
    }
    case "item": {
      if (team.itemUsesLeft <= 0) return reject("No battle item uses left.");
      const item = getBattleItem(action.itemId, state.settings.guildId);
      if (!item) return reject("Unknown battle item.");
      const targetTeam = teamOf(state, action.targetSide);
      if (!actorAt(targetTeam, action.targetSlot)) return reject("That target is not standing.");
      return OK;
    }
    case "direct_lp": {
      if (!lpExposed(foes)) return reject("Their formation still protects them.");
      return OK;
    }
  }
}

function checkSiegeCardConditions(
  state: SiegeBattleState, card: SiegeCard, targetSlot?: number,
): SiegeActionCheck {
  const team = teamOf(state, state.activeSide);
  const foes = teamOf(state, otherSide(state.activeSide));
  const c = card.conditions;

  // Targeting sanity first.
  if (card.target === "enemy_unit" || card.target === "enemy_all") {
    if (formationEmpty(foes)) return reject("There are no enemy cards to target.");
  }
  if (card.target === "enemy_unit") {
    const t = targetSlot ?? defaultTargetSlot(foes);
    const unit = actorAt(foes, t);
    if (!unit) return reject("That target is not standing.");
    if (c?.targetHpBelowPct != null) {
      const pct = (unit.hp / unit.stats.maxHealth) * 100;
      if (pct > c.targetHpBelowPct) {
        return reject(`${card.name} only works on a target below ${c.targetHpBelowPct}% HP.`);
      }
    }
  }
  if (card.target === "ally_unit") {
    const t = targetSlot ?? defaultTargetSlot(team);
    if (!actorAt(team, t)) return reject("That ally is not standing.");
  }
  if (card.target === "enemy_lp" && !c?.enemyFormationEmpty && !lpExposed(foes)) {
    return reject("Their formation still protects them.");
  }

  if (!c) return OK;
  if (c.enemyFormationEmpty && !formationEmpty(foes)) {
    return reject(`${card.name} needs the enemy formation broken.`);
  }
  if (c.alliesFallenAtLeast != null) {
    const fallen = team.slots.filter(s => s.unit && s.unit.hp <= 0).length;
    if (fallen < c.alliesFallenAtLeast) {
      return reject(`${card.name} needs ${c.alliesFallenAtLeast} of your cards to have fallen.`);
    }
  }
  if (c.livingAlliesAtLeast != null && livingSlots(team).length < c.livingAlliesAtLeast) {
    return reject(`${card.name} needs ${c.livingAlliesAtLeast} of your cards standing.`);
  }
  if (c.requiresEmptyFriendlySquare && !canReinforce(team)) {
    return reject(`${card.name} needs an empty square and a reserve card.`);
  }
  return OK;
}

export function isTargetedMove(move: MoveType): boolean {
  return move === "attack" || move === "special" || move === "ultimate" || move === "special_card";
}

/** Every action the acting side could legally take right now (drives UI + AI). */
export function legalActions(state: SiegeBattleState): SiegeAction[] {
  const out: SiegeAction[] = [];
  if (state.phase === "ended") return out;
  const team = teamOf(state, state.activeSide);
  const foes = teamOf(state, otherSide(state.activeSide));
  const foeSlots = livingSlots(foes).map(s => s.index);

  for (const slot of livingSlots(team)) {
    const a = slot.index;
    const moves: MoveType[] = ["attack", "special", "ultimate", "defend", "charge", "special_card", "skip"];
    for (const move of moves) {
      if (isTargetedMove(move)) {
        for (const t of foeSlots) {
          const act: SiegeAction = { kind: "move", actorSlot: a, move, targetSlot: t };
          if (checkAction(state, act).ok) out.push(act);
        }
      } else {
        const act: SiegeAction = { kind: "move", actorSlot: a, move };
        if (checkAction(state, act).ok) out.push(act);
      }
    }
    for (const card of team.hand) {
      const targets = card.target === "enemy_unit" ? foeSlots
        : card.target === "ally_unit" ? livingSlots(team).map(s => s.index)
        : [undefined];
      for (const t of targets) {
        const act: SiegeAction = { kind: "siege_card", actorSlot: a, cardId: card.id, targetSlot: t };
        if (checkAction(state, act).ok) out.push(act);
      }
    }
    const direct: SiegeAction = { kind: "direct_lp", actorSlot: a };
    if (checkAction(state, direct).ok) out.push(direct);
  }
  return out;
}

// ── Resolution ───────────────────────────────────────────────────────────────

export function resolveAction(state: SiegeBattleState, action: SiegeAction): SiegeTurnResult {
  const check = checkAction(state, action);
  if (!check.ok) {
    return {
      events: [{ text: `⚠️ ${check.reason}`, event: "info" }],
      destroyed: [], struck: [], damageDealt: 0, lpDamage: 0, battleOver: false,
      rejected: true,
    };
  }
  const side = state.activeSide;
  const team = teamOf(state, side);
  const foeSide = otherSide(side);
  const foes = teamOf(state, foeSide);

  // Snapshot the board so kills and damage are measured, not inferred.
  const before = snapshotBoard(state);
  let events: SiegeBattleEvent[] = [];

  switch (action.kind) {
    case "reinforce":
      events = autoReinforce(state, side);
      break;
    case "move":
      events = resolveMoveAction(state, action.actorSlot, action.move, action.targetSlot);
      break;
    case "siege_card":
      events = resolveSiegeCard(state, action.actorSlot, action.cardId, action.targetSlot);
      break;
    case "item":
      events = resolveItem(state, action.actorSlot, action.itemId, action.targetSide, action.targetSlot);
      break;
    case "direct_lp":
      events = resolveDirectLp(state, action.actorSlot);
      break;
  }

  clampBoard(state);
  const destroyed = diffDestroyed(state, before);
  const struck = diffStruck(state, before);
  for (const d of destroyed) {
    const unit = state.teams[d.side].slots[d.slot]?.unit;
    events.push({
      text: `☠️ **${unit?.cardName ?? "A card"}** is destroyed!`,
      flash: "ko", event: "ko", targetSide: d.side, targetSlot: d.slot, ko: true,
    });
  }
  // Attach the measured damage to the events that caused it, so a renderer can
  // read a per-card number straight off the log without re-deriving anything.
  for (const hit of struck) {
    if (hit.damage <= 0) continue;
    const e = events.find(ev => ev.targetSide === hit.side && ev.targetSlot === hit.slot && ev.damage == null);
    if (e) e.damage = hit.damage;
  }
  const damageDealt = struck
    .filter(h => h.side === foeSide && h.damage > 0)
    .reduce((sum, h) => sum + h.damage, 0);
  const lpDamage = (before.lp[0] - state.teams[0].lp) + (before.lp[1] - state.teams[1].lp);
  void team; void foes;
  pushEvents(state, events);
  return { events, destroyed, struck, damageDealt, lpDamage, battleOver: false };
}

/**
 * A before-picture of the board. Damage is measured by diffing this against the
 * board after the action, so the numbers the renderer draws are the numbers the
 * engine actually applied — never parsed back out of log text.
 */
interface BoardSnapshot {
  alive: boolean[][];
  /** HP + shield per slot (the whole damage-absorbing pool). */
  pool: number[][];
  lp: [number, number];
}

function snapshotBoard(state: SiegeBattleState): BoardSnapshot {
  return {
    alive: state.teams.map(t => t.slots.map(s => isAlive(s.unit))),
    pool: state.teams.map(t => t.slots.map(s => (s.unit ? s.unit.hp + s.unit.shield : 0))),
    lp: [state.teams[0].lp, state.teams[1].lp],
  };
}

function diffDestroyed(state: SiegeBattleState, before: BoardSnapshot): { side: SideIdx; slot: number }[] {
  const out: { side: SideIdx; slot: number }[] = [];
  state.teams.forEach((t, si) => {
    t.slots.forEach((s, i) => {
      if (before.alive[si]![i] && !isAlive(s.unit)) out.push({ side: si as SideIdx, slot: i });
    });
  });
  return out;
}

function diffStruck(state: SiegeBattleState, before: BoardSnapshot): SiegeStruck[] {
  const out: SiegeStruck[] = [];
  state.teams.forEach((t, si) => {
    t.slots.forEach((s, i) => {
      if (!s.unit) return;
      const was = before.pool[si]![i]!;
      const now = s.unit.hp + s.unit.shield;
      if (was !== now) out.push({ side: si as SideIdx, slot: i, before: was, damage: was - now });
    });
  });
  return out;
}

// ── Standard moves ───────────────────────────────────────────────────────────

function resolveMoveAction(
  state: SiegeBattleState, actorSlot: number, move: MoveType, targetSlot?: number,
): SiegeBattleEvent[] {
  const side = state.activeSide;
  const team = teamOf(state, side);
  const foeSide = otherSide(side);
  const foes = teamOf(state, foeSide);
  const actor = actorAt(team, actorSlot)!;

  if (!isTargetedMove(move)) {
    const r = resolveMove(state.settings, actor, actor, move);
    return tag(r.events, { actorSide: side, actorSlot, event: move === "defend" ? "defend" : "charge" });
  }

  const t = targetSlot ?? defaultTargetSlot(foes);
  const target = actorAt(foes, t)!;

  // A charged ULTIMATE with 2+ enemy cards standing detonates on the whole line
  // — the "full bar" team wipe. Same rule the previous siege had, now expressed
  // against the formation.
  const living = livingUnits(foes);
  if (move === "ultimate" && actor.ultimate >= actor.stats.ultimateMax && living.length > 1) {
    const order = livingSlots(foes);
    const focus = order.findIndex(s => s.index === t);
    const tu = resolveTeamUltimate(state.settings, actor, order.map(s => s.unit!), Math.max(0, focus));
    return tag(tu.events, {
      actorSide: side, actorSlot, targetSide: foeSide, targetSlot: t, event: "ultimate",
    });
  }

  const r = resolveMove(state.settings, actor, target, move);
  return tag(r.events, {
    actorSide: side, actorSlot, targetSide: foeSide, targetSlot: t,
    event: move === "ultimate" ? "ultimate" : move === "special" ? "special" : "attack",
  });
}

// ── Battle Items (team-aware, reusing the existing item engine) ───────────────

function resolveItem(
  state: SiegeBattleState, actorSlot: number, itemId: string,
  targetSide: SideIdx, targetSlot: number,
): SiegeBattleEvent[] {
  const side = state.activeSide;
  const team = teamOf(state, side);
  const actor = actorAt(team, actorSlot)!;
  const item = getBattleItem(itemId, state.settings.guildId)!;
  const target = actorAt(teamOf(state, targetSide), targetSlot)!;

  const outcome = applyItemUse(item, actor, target);
  team.itemUsesLeft--;
  return tag(outcome.events, {
    actorSide: side, actorSlot, targetSide, targetSlot, event: "item", damage: outcome.damage,
  });
}

// ── Direct LP ────────────────────────────────────────────────────────────────

/**
 * The breakthrough. With nothing left to stop them, the WHOLE surviving
 * formation pours through the breach — each living card lands its own blow, and
 * each blow removes life points equal to that card's attack (a 200-attack card
 * takes 6,100 LP to 5,900). One card chipping alone would leave the endgame
 * grinding for thirty turns; the army that broke the wall is what finishes it.
 */
function resolveDirectLp(state: SiegeBattleState, actorSlot: number): SiegeBattleEvent[] {
  const side = state.activeSide;
  const foeSide = otherSide(side);
  const team = teamOf(state, side);
  const foes = teamOf(state, foeSide);
  const events: SiegeBattleEvent[] = [];

  // The chosen card leads the charge; the rest of the line follows it in.
  const order = livingSlots(team).sort((a, b) => (a.index === actorSlot ? -1 : b.index === actorSlot ? 1 : 0));
  for (const slot of order) {
    if (foes.lp <= 0) break;
    const unit = slot.unit!;
    const dmg = Math.max(1, Math.round(unit.stats.attack));
    foes.lp = Math.max(0, foes.lp - dmg);
    events.push({
      text: `🎯 **${unit.cardName}** strikes **${foes.name}** directly for **${dmg}** LP!`,
      flash: "combo", event: "direct_lp",
      actorSide: side, actorSlot: slot.index, targetSide: foeSide, lpDamage: dmg,
    });
  }
  return events;
}

// ── Siege Battle Cards ───────────────────────────────────────────────────────

function resolveSiegeCard(
  state: SiegeBattleState, actorSlot: number, cardId: string, targetSlot?: number,
): SiegeBattleEvent[] {
  const side = state.activeSide;
  const team = teamOf(state, side);
  const foeSide = otherSide(side);
  const foes = teamOf(state, foeSide);
  const actor = actorAt(team, actorSlot)!;
  const card = getSiegeCard(cardId)!;

  // Pay for it and move it out of the hand, whatever it does.
  actor.energy -= card.energyCost;
  const idx = team.hand.findIndex(c => c.id === card.id);
  if (idx >= 0) team.hand.splice(idx, 1);
  team.discardPile.push(card);
  if (card.cooldown > 0) team.cardCooldowns[card.id] = card.cooldown;

  const meta = { actorSide: side, actorSlot, event: "siege_card" as const };
  const events: SiegeBattleEvent[] = [{
    text: `${card.emoji} **${actor.cardName}** plays **${card.name}**!`,
    flash: card.animation, ...meta,
  }];

  const tslot = targetSlot ?? defaultTargetSlot(card.target === "ally_unit" ? team : foes);
  const target = card.target === "ally_unit" ? actorAt(team, tslot) : actorAt(foes, tslot);
  const hitMeta = { ...meta, targetSide: foeSide, targetSlot: tslot };

  switch (card.effect) {
    case "multi_strike": {
      const hits = Math.max(1, card.hits ?? 1);
      for (let i = 0; i < hits; i++) {
        if (!target || target.hp <= 0) break;
        const r = strikeWith(state.settings, actor, target, {
          powerPct: card.power, label: `${card.name}${hits > 1 ? ` (${i + 1}/${hits})` : ""}`,
          guaranteedHit: hits === 1,
        });
        events.push(...tag(r.events, hitMeta));
      }
      break;
    }
    case "execute": {
      if (!target) break;
      // Scales from `power` at full HP up to `secondary` at death's door.
      const missing = 1 - target.hp / target.stats.maxHealth;
      const pct = card.power + (card.secondary ?? card.power) * missing;
      const r = strikeWith(state.settings, actor, target, {
        powerPct: pct, label: card.name, guaranteedHit: true,
      });
      events.push(...tag(r.events, hitMeta));
      break;
    }
    case "cleave": {
      for (const slot of livingSlots(foes)) {
        const unit = slot.unit!;
        const isFocus = slot.index === tslot;
        const r = strikeWith(state.settings, actor, unit, {
          powerPct: isFocus ? card.power : (card.secondary ?? Math.round(card.power / 2)),
          label: isFocus ? card.name : `${card.name} (splash)`, guaranteedHit: true,
        });
        events.push(...tag(r.events, { ...meta, targetSide: foeSide, targetSlot: slot.index }));
      }
      break;
    }
    case "focus_fire": {
      if (!target) break;
      for (const slot of livingSlots(team)) {
        if (target.hp <= 0) break;
        const ally = slot.unit!;
        const r = strikeWith(state.settings, ally, target, {
          powerPct: card.power, label: `${ally.cardName}'s volley`, guaranteedHit: true,
        });
        events.push(...tag(r.events, { ...hitMeta, actorSlot: slot.index }));
      }
      break;
    }
    case "drain": {
      if (!target) break;
      const hpBefore = target.hp;
      const r = strikeWith(state.settings, actor, target, {
        powerPct: card.power, label: card.name,
      });
      events.push(...tag(r.events, hitMeta));
      const dealt = Math.max(0, hpBefore - target.hp);
      const heal = Math.round(dealt * (card.secondary ?? 50) / 100);
      if (heal > 0) {
        const was = actor.hp;
        actor.hp = Math.min(actor.stats.maxHealth, actor.hp + heal);
        events.push({
          text: `💚 **${actor.cardName}** drains **${actor.hp - was}** HP.`,
          flash: "heal", ...meta,
        });
      }
      break;
    }
    case "breakthrough": {
      const dmg = Math.max(1, Math.round(actor.stats.attack * card.power / 100));
      foes.lp = Math.max(0, foes.lp - dmg);
      events.push({
        text: `🏴 **${card.name}** smashes through for **${dmg}** LP!`,
        flash: "ultimate", ...meta, targetSide: foeSide, lpDamage: dmg, event: "direct_lp",
      });
      break;
    }
    case "rally": {
      for (const slot of livingSlots(team)) {
        slot.unit!.status.push({
          kind: "buff", turns: card.duration ?? 3, magnitude: card.power,
          label: card.name, emoji: "⬆️",
        });
      }
      events.push({
        text: `📣 The whole line gains **+${card.power}%** attack for ${card.duration ?? 3} turn(s).`,
        flash: "combo", ...meta,
      });
      break;
    }
    case "counter_order": {
      actor.status.push({
        kind: "reflect", turns: card.duration ?? 2, magnitude: card.power,
        label: card.name, emoji: "🪞",
      });
      events.push({
        text: `↩️ **${actor.cardName}** reflects **${card.power}%** of incoming damage.`,
        flash: "counter", ...meta,
      });
      break;
    }
    case "guard_order": {
      const ally = target ?? actor;
      const shield = Math.max(1, Math.round(ally.stats.maxHealth * card.power / 100));
      ally.shield += shield;
      events.push({
        text: `🛡️ **${ally.cardName}** gains a **${shield}** HP shield.`,
        flash: "shield", ...meta, targetSide: side, targetSlot: tslot,
      });
      break;
    }
    case "redeploy": {
      const slot = emptySlots(team)[0];
      const next = team.reserves.find(c => c.hp > 0);
      if (slot && next) {
        team.reserves.splice(team.reserves.indexOf(next), 1);
        slot.unit = next;
        events.push({
          text: `🚁 **${next.cardName}** is rushed onto the line!`,
          flash: "shield", ...meta, event: "deploy", actorSlot: slot.index,
        });
      }
      break;
    }
    case "overload": {
      // Trades the actor's whole ultimate meter for a multiplied blow.
      if (!target) break;
      const stacks = Math.max(1, Math.round((actor.ultimate / Math.max(1, actor.stats.ultimateMax)) * (card.secondary ?? 2)));
      actor.ultimate = 0;
      const r = strikeWith(state.settings, actor, target, {
        powerPct: card.power * stacks, label: card.name, guaranteedHit: true, ultimate: true,
      });
      events.push(...tag(r.events, hitMeta));
      break;
    }
    case "disrupt": {
      if (!target) break;
      if (target.shield > 0) {
        events.push({
          text: `💥 **${target.cardName}**'s shield is torn away.`, flash: "shield_break", ...hitMeta,
        });
        target.shield = 0;
      }
      target.status.push({
        kind: "weaken", turns: card.duration ?? 2, magnitude: card.power,
        label: card.name, emoji: "🔻",
      });
      target.specialCooldownRemaining = Math.max(target.specialCooldownRemaining, 1);
      events.push({
        text: `📉 **${target.cardName}** is suppressed — **-${card.power}%** attack.`,
        flash: "freeze", ...hitMeta,
      });
      break;
    }
  }

  return events;
}
