// ─────────────────────────────────────────────────────────────────────────────
// Duel engine — the true Yu-Gi-Oh style ruleset.
//
// Ported in spirit from the reference duel projects (yugioh_web's phase/summon/
// battle model + YGOProUnity/ocgcore's mechanic protocol). Framework-free and
// fully client-side. Every mutating action returns a stream of DuelEvents the
// scene animates, so presentation and rules stay decoupled.
//
// Covers: phases, normal/tribute/flip/special summon, ATK/DEF combat with
// piercing & direct attacks, spells (draw/heal/boost/destroy/reborn/equip/
// continuous/field), traps via a chain response window (Mirror Force, Magic
// Cylinder, Sakuretsu, Negate Attack, Trap Hole, Call of the Haunted), targeted
// effects, negation, and continuous-modifier recomputation.
// ─────────────────────────────────────────────────────────────────────────────

import {
  ZONES,
  type DuelState, type DuelSetup, type DuelCard, type DuelEvent, type DuelEffect,
  type PlayerBoard, type PlayerId, type Phase, type MonsterPosition, type FieldMonster,
  type FieldSpellTrap, type TargetRef,
} from "./types";
import {
  targetSpecFor, isPersistentSpell, trapReactsToAttack, trapReactsToSummon, trapIsMainPhase,
} from "./effects";
import { shuffle, setSeed } from "./rng";

function makeBoard(id: PlayerId, name: string, deck: DuelCard[], startingLp: number, handSize: number): PlayerBoard {
  // Fusion monsters never sit in the main Deck — they wait in the Extra Deck.
  const extraDeck = deck.filter((c) => c.fusionMinLevelSum != null);
  const main = deck.filter((c) => c.fusionMinLevelSum == null);
  const shuffled = shuffle(main);
  const hand = shuffled.splice(0, handSize);
  return {
    id, name, lp: startingLp, deck: shuffled, extraDeck, hand,
    monsters: Array<FieldMonster | null>(ZONES).fill(null),
    spellTraps: Array<FieldSpellTrap | null>(ZONES).fill(null),
    graveyard: [], hasNormalSummoned: false,
  };
}

/**
 * Build a fresh duel. Pass a `seed` to make every shuffle deterministic — online
 * duels do, so both clients derive the identical opening state from one setup.
 */
export function createDuel(setup: DuelSetup, seed?: number): DuelState {
  if (seed !== undefined) setSeed(seed);
  const player = makeBoard("player", setup.player.name, setup.player.deck, setup.startingLp, setup.handSize);
  const opponent = makeBoard("opponent", setup.opponent.name, setup.opponent.deck, setup.startingLp, setup.handSize);
  return {
    player, opponent, turn: "player", phase: "MAIN1", turnCount: 1,
    startingLp: setup.startingLp, winner: null, log: [],
    chain: [], pending: null, awaiting: null,
  };
}

export function boardOf(state: DuelState, id: PlayerId): PlayerBoard {
  return id === "player" ? state.player : state.opponent;
}
export function foeOf(state: DuelState, id: PlayerId): PlayerBoard {
  return id === "player" ? state.opponent : state.player;
}
export function otherId(id: PlayerId): PlayerId { return id === "player" ? "opponent" : "player"; }

function log(state: DuelState, events: DuelEvent[], text: string): void {
  state.log.push(text);
  events.push({ t: "log", text });
}

export function effAtk(m: FieldMonster): number { return Math.max(0, m.card.atk + m.atkMod); }
export function effDef(m: FieldMonster): number { return Math.max(0, m.card.def + m.defMod); }

function dealDamage(state: DuelState, events: DuelEvent[], who: PlayerId, amount: number, reason: string): void {
  if (amount <= 0) return;
  const b = boardOf(state, who);
  b.lp = Math.max(0, b.lp - amount);
  events.push({ t: "damage", who, amount, reason });
  checkWin(state, events);
}
function heal(state: DuelState, events: DuelEvent[], who: PlayerId, amount: number): void {
  if (amount <= 0) return;
  boardOf(state, who).lp += amount;
  events.push({ t: "heal", who, amount });
}
function checkWin(state: DuelState, events: DuelEvent[]): void {
  if (state.winner) return;
  if (state.player.lp <= 0) { state.winner = "opponent"; events.push({ t: "win", who: "opponent" }); }
  else if (state.opponent.lp <= 0) { state.winner = "player"; events.push({ t: "win", who: "player" }); }
}

// ── Continuous modifier recomputation ─────────────────────────────────────────
// atkMod/defMod are fully DERIVED: self gainAtk, continuous ally auras, field
// attribute auras, equip spells, and the turn-scoped boost. Call after any field
// change so effAtk/effDef always reflect the live board.
export function recomputeContinuous(state: DuelState): void {
  for (const id of ["player", "opponent"] as PlayerId[]) {
    const b = boardOf(state, id);
    // Precompute this side's auras.
    let allyAtk = 0;
    const fieldByAttr: Record<string, number> = {};
    for (const st of b.spellTraps) {
      if (!st || !st.faceUp || !st.card.effect) continue;
      const e = st.card.effect;
      if (e.kind === "continuous:allyAtk") allyAtk += e.amount;
      if (e.kind === "field:attrBoost") fieldByAttr[e.attribute] = (fieldByAttr[e.attribute] ?? 0) + e.amount;
    }
    b.monsters.forEach((m, zone) => {
      if (!m) return;
      let atk = 0, def = 0;
      if (m.faceUp && m.card.effect?.kind === "gainAtk") atk += m.card.effect.amount;
      atk += allyAtk;
      atk += fieldByAttr[m.card.attribute] ?? 0;
      // Equip spells attached to this monster (from either side's zones).
      for (const pid of ["player", "opponent"] as PlayerId[]) {
        for (const st of boardOf(state, pid).spellTraps) {
          if (st?.faceUp && st.card.effect?.kind === "equip:atk"
            && st.equipTarget && st.equipTarget.side === id && st.equipTarget.zone === zone) {
            atk += st.card.effect.atk;
            def += st.card.effect.def ?? 0;
          }
        }
      }
      atk += m.turnBoost;
      m.atkMod = atk;
      m.defMod = def;
    });
  }
}

// ── Draw / phases / turns ─────────────────────────────────────────────────────

export function drawCards(state: DuelState, who: PlayerId, count: number, events: DuelEvent[]): void {
  const b = boardOf(state, who);
  for (let i = 0; i < count; i++) {
    const card = b.deck.shift();
    if (!card) {
      events.push({ t: "deckout", who });
      if (!state.winner) { state.winner = otherId(who); events.push({ t: "win", who: state.winner }); }
      return;
    }
    b.hand.push(card);
    events.push({ t: "draw", who, card });
  }
}

const PHASE_ORDER: Phase[] = ["DRAW", "STANDBY", "MAIN1", "BATTLE", "MAIN2", "END"];

export function nextPhase(state: DuelState): DuelEvent[] {
  const events: DuelEvent[] = [];
  if (state.winner || state.awaiting) return events;
  if (state.phase === "END") return endTurn(state);
  const next = PHASE_ORDER[PHASE_ORDER.indexOf(state.phase) + 1]!;
  state.phase = next;
  events.push({ t: "phase", phase: next, who: state.turn });
  if (next === "END") clearTurnBoosts(state, state.turn, events);
  return events;
}

function clearTurnBoosts(state: DuelState, who: PlayerId, events: DuelEvent[]): void {
  const b = boardOf(state, who);
  let any = false;
  for (const m of b.monsters) if (m && m.turnBoost) { m.turnBoost = 0; any = true; }
  if (any) { recomputeContinuous(state); events.push({ t: "buff", who, text: "Temporary boosts fade." }); }
}

export function endTurn(state: DuelState): DuelEvent[] {
  const events: DuelEvent[] = [];
  if (state.winner || state.awaiting) return events;
  clearTurnBoosts(state, state.turn, events);
  const next = otherId(state.turn);
  state.turn = next;
  state.turnCount++;
  const b = boardOf(state, next);
  b.hasNormalSummoned = false;
  for (const m of b.monsters) if (m) { m.hasAttacked = 0; m.summonedThisTurn = false; }
  events.push({ t: "turn", who: next, turnCount: state.turnCount });
  state.phase = "DRAW";
  events.push({ t: "phase", phase: "DRAW", who: next });
  drawCards(state, next, 1, events);
  if (!state.winner) { state.phase = "MAIN1"; events.push({ t: "phase", phase: "MAIN1", who: next }); }
  return events;
}

// ── Summoning ─────────────────────────────────────────────────────────────────

export function tributesNeeded(level: number): number {
  if (level >= 7) return 2;
  if (level >= 5) return 1;
  return 0;
}
export function emptyMonsterZone(b: PlayerBoard): number { return b.monsters.findIndex((m) => m === null); }
export function emptySpellZone(b: PlayerBoard): number { return b.spellTraps.findIndex((s) => s === null); }

export function canNormalSummon(state: DuelState, who: PlayerId, handIndex: number): { ok: boolean; reason?: string } {
  const b = boardOf(state, who);
  if (state.turn !== who) return { ok: false, reason: "Not your turn." };
  if (state.awaiting) return { ok: false, reason: "Resolve the current effect first." };
  if (state.phase !== "MAIN1" && state.phase !== "MAIN2") return { ok: false, reason: "Summon only in a Main Phase." };
  if (b.hasNormalSummoned) return { ok: false, reason: "You already Normal Summoned this turn." };
  const card = b.hand[handIndex];
  if (!card || card.kind !== "monster") return { ok: false, reason: "That isn't a monster." };
  const need = tributesNeeded(card.level);
  const onField = b.monsters.filter((m) => m !== null).length;
  if (need > onField) return { ok: false, reason: `Needs ${need} tribute${need > 1 ? "s" : ""}.` };
  if (need === 0 && onField >= ZONES) return { ok: false, reason: "Monster Zones are full." };
  return { ok: true };
}

export function summonMonster(
  state: DuelState, who: PlayerId, handIndex: number, position: MonsterPosition, tributeZones: number[],
): DuelEvent[] {
  const events: DuelEvent[] = [];
  const check = canNormalSummon(state, who, handIndex);
  if (!check.ok) { log(state, events, check.reason!); return events; }
  const b = boardOf(state, who);
  const card = b.hand[handIndex]!;
  const need = tributesNeeded(card.level);
  if (tributeZones.length !== need) { log(state, events, `Select ${need} tribute(s).`); return events; }
  for (const z of tributeZones) if (!b.monsters[z]) { log(state, events, "Invalid tribute."); return events; }
  for (const z of tributeZones) destroyMonster(state, who, z, events);
  const zone = emptyMonsterZone(b);
  if (zone < 0) { log(state, events, "No open Monster Zone."); return events; }
  b.hand.splice(handIndex, 1);
  const faceUp = position !== "set";
  b.monsters[zone] = {
    card, position, atkMod: 0, defMod: 0, turnBoost: 0, hasAttacked: 0, summonedThisTurn: true, faceUp,
  };
  b.hasNormalSummoned = true;
  events.push({ t: "summon", who, zone, card, position, tributes: need });
  log(state, events, `${b.name} ${faceUp ? "Summons" : "Sets"} ${card.name}.`);
  recomputeContinuous(state);
  if (faceUp) applyOnSummon(state, who, zone, events);
  return events;
}

/** Special Summon a monster onto an open zone (from GY, hand, etc.). */
export function specialSummon(state: DuelState, who: PlayerId, card: DuelCard, position: MonsterPosition, events: DuelEvent[]): number {
  const b = boardOf(state, who);
  const zone = emptyMonsterZone(b);
  if (zone < 0) { log(state, events, "No open Monster Zone."); return -1; }
  b.monsters[zone] = {
    card, position, atkMod: 0, defMod: 0, turnBoost: 0, hasAttacked: 0, summonedThisTurn: true, faceUp: position !== "set",
  };
  events.push({ t: "specialSummon", who, zone, card });
  recomputeContinuous(state);
  return zone;
}

/** On-summon monster effects, then open a Trap-Hole response window if any. */
function applyOnSummon(state: DuelState, who: PlayerId, zone: number, events: DuelEvent[]): void {
  const b = boardOf(state, who);
  const m = b.monsters[zone];
  if (!m) return;
  const eff = m.card.effect;
  if (eff?.kind === "drawOnSummon") {
    events.push({ t: "activate", who, card: m.card, text: `${m.card.name}: draw ${eff.count}.` });
    drawCards(state, who, eff.count, events);
  } else if (eff?.kind === "burn") {
    events.push({ t: "activate", who, card: m.card, text: `${m.card.name}: burn ${eff.amount}.` });
    dealDamage(state, events, otherId(who), eff.amount, "effect burn");
  }
  recomputeContinuous(state);
  // Open a summon response window for the opponent (Trap Hole).
  const foe = foeOf(state, who);
  const canRespond = !trapsNegated(state) && foe.spellTraps.some((st) =>
    st && !st.faceUp && trapReactsToSummon(st.card.effect) && summonTrapThresholdMet(st.card.effect, effAtk(m)));
  if (canRespond) {
    state.pending = { type: "summonTrigger", who, zone };
    state.awaiting = { responder: foe.id, passes: 0 };
    events.push({ t: "window", responder: foe.id });
  }
}
function summonTrapThresholdMet(effect: DuelEffect | null, atk: number): boolean {
  return effect?.kind === "trap:trapHole" ? atk >= effect.threshold : false;
}

// ── Position changes ──────────────────────────────────────────────────────────

export function changePosition(state: DuelState, who: PlayerId, zone: number): DuelEvent[] {
  const events: DuelEvent[] = [];
  const b = boardOf(state, who);
  const m = b.monsters[zone];
  if (!m || state.awaiting) return events;
  if (state.turn !== who || (state.phase !== "MAIN1" && state.phase !== "MAIN2")) {
    log(state, events, "Change position in a Main Phase."); return events;
  }
  if (m.summonedThisTurn) { log(state, events, "Can't change the turn it was summoned."); return events; }
  if (m.hasAttacked > 0) { log(state, events, "It already attacked."); return events; }
  if (!m.faceUp) {
    m.faceUp = true; m.position = "attack";
    events.push({ t: "flip", who, zone });
    applyFlipEffect(state, who, zone, events);
  } else {
    m.position = m.position === "attack" ? "defense" : "attack";
  }
  events.push({ t: "positionChange", who, zone, position: m.position });
  recomputeContinuous(state);
  return events;
}

/** Flip effect trigger (e.g. flip:destroy). Targets are auto-picked (weakest foe). */
function applyFlipEffect(state: DuelState, who: PlayerId, zone: number, events: DuelEvent[]): void {
  const m = boardOf(state, who).monsters[zone];
  if (m?.card.effect?.kind !== "flip:destroy") return;
  const foe = foeOf(state, who);
  const target = weakestMonsterZone(foe);
  if (target < 0) return;
  const t = foe.monsters[target]!;
  events.push({ t: "activate", who, card: m.card, text: `${m.card.name} flip: destroy ${t.card.name}.` });
  destroyMonster(state, foe.id, target, events);
}
function weakestMonsterZone(b: PlayerBoard): number {
  let best = -1, bestAtk = Infinity;
  b.monsters.forEach((m, z) => { if (m && effAtk(m) < bestAtk) { bestAtk = effAtk(m); best = z; } });
  return best;
}

// ── Spell / Trap set & activation ─────────────────────────────────────────────

export function setSpellTrap(state: DuelState, who: PlayerId, handIndex: number): DuelEvent[] {
  const events: DuelEvent[] = [];
  const b = boardOf(state, who);
  if (state.awaiting) return events;
  if (state.turn !== who || (state.phase !== "MAIN1" && state.phase !== "MAIN2")) {
    log(state, events, "Set cards in a Main Phase."); return events;
  }
  const card = b.hand[handIndex];
  if (!card || card.kind === "monster") { log(state, events, "That isn't a Spell/Trap."); return events; }
  const zone = emptySpellZone(b);
  if (zone < 0) { log(state, events, "No open Spell/Trap Zone."); return events; }
  b.hand.splice(handIndex, 1);
  b.spellTraps[zone] = { card, faceUp: false };
  events.push({ t: "setSpellTrap", who, zone, card });
  log(state, events, `${b.name} sets a card.`);
  return events;
}

export function canActivateFromHand(state: DuelState, who: PlayerId, handIndex: number): { ok: boolean; reason?: string } {
  const b = boardOf(state, who);
  if (state.awaiting) return { ok: false, reason: "Resolve the current effect first." };
  if (state.turn !== who) return { ok: false, reason: "Activate Spells on your turn." };
  const card = b.hand[handIndex];
  if (!card || card.kind !== "spell" || !card.effect) return { ok: false, reason: "That isn't a Spell." };
  // Normal Spells are Main-Phase only; Quick-Play Spells also fire in the
  // Battle Phase (spell speed 2), so you can pump an attacker or clear a
  // threat mid-combat.
  const inMain = state.phase === "MAIN1" || state.phase === "MAIN2";
  const quickInBattle = state.phase === "BATTLE" && card.sub === "Quick-Play";
  if (!inMain && !quickInBattle) {
    return { ok: false, reason: "Activate Spells in a Main Phase (Quick-Play also in Battle)." };
  }
  return { ok: true };
}

/** Activate a Spell from the hand. `targets` are required for targeting spells. */
export function activateSpellFromHand(
  state: DuelState, who: PlayerId, handIndex: number, targets: TargetRef[] = [],
): DuelEvent[] {
  const events: DuelEvent[] = [];
  const check = canActivateFromHand(state, who, handIndex);
  if (!check.ok) { log(state, events, check.reason!); return events; }
  const b = boardOf(state, who);
  const card = b.hand[handIndex]!;
  const spec = targetSpecFor(card.effect);
  if (spec && targets.length !== spec.count) { log(state, events, `Select ${spec.count} target(s).`); return events; }

  b.hand.splice(handIndex, 1);
  events.push({ t: "activate", who, card, text: card.name });

  if (isPersistentSpell(card.effect)) {
    // Equip / Continuous / Field: place face-up in a Spell/Trap zone and stay.
    const zone = emptySpellZone(b);
    if (zone < 0) { log(state, events, "No open Spell/Trap Zone."); b.graveyard.push(card); return events; }
    const st: FieldSpellTrap = { card, faceUp: true };
    if (card.effect!.kind === "equip:atk") {
      const tgt = targets[0];
      if (tgt && tgt.kind === "monster") st.equipTarget = { side: tgt.side, zone: tgt.zone };
      events.push({ t: "equip", who, card, zone });
    }
    b.spellTraps[zone] = st;
    recomputeContinuous(state);
    return events;
  }

  resolveEffect(state, who, card.effect!, targets, events);
  b.graveyard.push(card);
  recomputeContinuous(state);
  return events;
}

/** Activate a set Spell/Trap that the CONTROLLER plays on their own turn (slow). */
export function activateSetCard(
  state: DuelState, who: PlayerId, zone: number, targets: TargetRef[] = [],
): DuelEvent[] {
  const events: DuelEvent[] = [];
  const b = boardOf(state, who);
  const st = b.spellTraps[zone];
  if (state.awaiting || !st || st.faceUp) return events;
  const eff = st.card.effect;
  if (!eff) return events;
  const isSlowTrap = trapIsMainPhase(eff);
  const isSpell = st.card.kind === "spell";
  if (!isSlowTrap && !isSpell) { log(state, events, "That Trap can only respond to an action."); return events; }
  if (st.card.kind === "trap" && trapsNegated(state)) { log(state, events, "Trap Cards cannot be activated."); return events; }
  if (state.turn !== who) { log(state, events, "Activate on your turn."); return events; }
  const spec = targetSpecFor(eff);
  if (spec && targets.length !== spec.count) { log(state, events, `Select ${spec.count} target(s).`); return events; }
  events.push({ t: "activate", who, card: st.card, text: st.card.name });
  if (isPersistentSpell(eff)) {
    st.faceUp = true;
    if (eff.kind === "equip:atk" && targets[0]?.kind === "monster") st.equipTarget = { side: targets[0].side, zone: targets[0].zone };
    recomputeContinuous(state);
    return events;
  }
  b.spellTraps[zone] = null;
  resolveEffect(state, who, eff, targets, events);
  b.graveyard.push(st.card);
  recomputeContinuous(state);
  return events;
}

// ── Effect resolution (spells + targeted effects) ─────────────────────────────
export function resolveEffect(
  state: DuelState, who: PlayerId, effect: DuelEffect, targets: TargetRef[], events: DuelEvent[],
): void {
  const me = boardOf(state, who);
  const foe = foeOf(state, who);
  switch (effect.kind) {
    case "spell:draw": drawCards(state, who, effect.count, events); break;
    case "spell:heal": heal(state, events, who, effect.amount); break;
    case "spell:boost":
      for (const m of me.monsters) if (m && m.faceUp) m.turnBoost += effect.amount;
      recomputeContinuous(state);
      events.push({ t: "buff", who, text: `All monsters +${effect.amount} ATK this turn.` });
      break;
    case "spell:destroyAll":
      for (const pid of ["player", "opponent"] as PlayerId[]) destroyAllMonsters(state, pid, events);
      break;
    case "spell:destroyAllOpp": destroyAllMonsters(state, foe.id, events); break;
    case "spell:fissure": {
      const z = weakestFaceUpZone(foe);
      if (z >= 0) destroyMonster(state, foe.id, z, events);
      break;
    }
    case "spell:destroyTarget": {
      const t = targets[0];
      if (t?.kind === "monster") destroyMonster(state, t.side, t.zone, events);
      break;
    }
    case "spell:destroySpellTrap": {
      const t = targets[0];
      if (t?.kind === "spellTrap") destroySpellTrap(state, t.side, t.zone, events);
      break;
    }
    case "spell:flipTarget": {
      const t = targets[0];
      if (t?.kind === "monster") {
        const m = boardOf(state, t.side).monsters[t.zone];
        if (m) { m.faceUp = false; m.position = "set"; m.turnBoost = 0; events.push({ t: "positionChange", who: t.side, zone: t.zone, position: "set" }); }
      }
      break;
    }
    case "spell:fusion": {
      // Polymerization: send the two targeted monsters you control to the GY,
      // then Fusion Summon the best Extra Deck monster their Levels allow.
      const mats = targets
        .filter((t): t is Extract<TargetRef, { kind: "monster" }> => t.kind === "monster" && t.side === who)
        .map((t) => ({ t, m: me.monsters[t.zone] }))
        .filter((x) => x.m);
      if (mats.length < 2) { log(state, events, "Fusion needs 2 monsters you control."); break; }
      const levelSum = mats.reduce((n, x) => n + x.m!.card.level, 0);
      const pick = bestExtraDeckFusion(me, levelSum);
      if (!pick) { log(state, events, "No Fusion Monster matches those materials."); break; }
      const materialCards = mats.map((x) => x.m!.card);
      for (const x of mats) {
        me.graveyard.push(x.m!.card);
        events.push({ t: "destroy", who, zone: x.t.zone, card: x.m!.card });
        me.monsters[x.t.zone] = null;
      }
      me.extraDeck.splice(me.extraDeck.indexOf(pick), 1);
      const zone = specialSummon(state, who, pick, "attack", events);
      if (zone >= 0) events.push({ t: "fusion", who, zone, card: pick, materials: materialCards });
      break;
    }
    case "spell:reborn":
    case "trap:reborn": {
      const t = targets[0];
      if (t?.kind === "grave") {
        const g = boardOf(state, t.side).graveyard;
        const card = g[t.index];
        if (card && card.kind === "monster") {
          g.splice(t.index, 1);
          specialSummon(state, who, card, "attack", events);
        }
      }
      break;
    }
    default: break; // equip/continuous handled at activation; traps handled in windows
  }
  checkWin(state, events);
}

function destroyMonster(state: DuelState, side: PlayerId, zone: number, events: DuelEvent[]): void {
  const b = boardOf(state, side);
  const m = b.monsters[zone];
  if (!m) return;
  b.graveyard.push(m.card);
  events.push({ t: "destroy", who: side, zone, card: m.card });
  b.monsters[zone] = null;
  onSentToGrave(state, side, m.card, events);
  recomputeContinuous(state);
}

/** Death triggers — Sangan / Witch search the Deck when sent to the Graveyard. */
export function onSentToGrave(state: DuelState, side: PlayerId, card: DuelCard, events: DuelEvent[]): void {
  const eff = card.effect;
  if (eff?.kind !== "searchOnDeath") return;
  const b = boardOf(state, side);
  const idx = b.deck.findIndex((c) => c.kind === "monster" && c.atk <= eff.maxAtk);
  if (idx < 0) return;
  const found = b.deck.splice(idx, 1)[0]!;
  b.hand.push(found);
  events.push({ t: "activate", who: side, card, text: `${card.name}: search ${found.name}` });
  events.push({ t: "search", who: side, card: found });
}
function destroyAllMonsters(state: DuelState, side: PlayerId, events: DuelEvent[]): void {
  const b = boardOf(state, side);
  b.monsters.forEach((m, z) => { if (m) destroyMonster(state, side, z, events); });
}
function destroySpellTrap(state: DuelState, side: PlayerId, zone: number, events: DuelEvent[]): void {
  const b = boardOf(state, side);
  const st = b.spellTraps[zone];
  if (!st) return;
  b.graveyard.push(st.card);
  events.push({ t: "destroy", who: side, zone, card: st.card });
  b.spellTraps[zone] = null;
  recomputeContinuous(state);
}
/** Strongest Extra Deck Fusion this material Level sum can summon. */
export function bestExtraDeckFusion(b: PlayerBoard, levelSum: number): DuelCard | null {
  const legal = b.extraDeck.filter((c) => levelSum >= (c.fusionMinLevelSum ?? 99));
  if (!legal.length) return null;
  return legal.reduce((a, c) => (c.atk > a.atk ? c : a));
}

function weakestFaceUpZone(b: PlayerBoard): number {
  let best = -1, bestAtk = Infinity;
  b.monsters.forEach((m, z) => { if (m && m.faceUp && effAtk(m) < bestAtk) { bestAtk = effAtk(m); best = z; } });
  return best;
}

// ── Battle ─────────────────────────────────────────────────────────────────────

export function monstersThatCanAttack(state: DuelState, who: PlayerId): number[] {
  if (state.turn !== who || state.phase !== "BATTLE" || state.awaiting) return [];
  const b = boardOf(state, who);
  const out: number[] = [];
  b.monsters.forEach((m, z) => {
    if (m && m.faceUp && m.position === "attack") {
      const max = m.card.effect?.kind === "doubleAttack" ? 2 : 1;
      if (m.hasAttacked < max) out.push(z);
    }
  });
  return out;
}
export function hasAnyMonster(b: PlayerBoard): boolean { return b.monsters.some((m) => m !== null); }

/**
 * Declare an attack. Opens a defender response window if they hold a battle
 * trap; otherwise resolves immediately. When a window opens the caller must
 * drive it with respondToWindow / passWindow (see below).
 */
export function declareAttack(
  state: DuelState, who: PlayerId, fromZone: number, target: number | "direct",
): DuelEvent[] {
  const events: DuelEvent[] = [];
  if (state.winner || state.awaiting) return events;
  if (state.turn !== who || state.phase !== "BATTLE") { log(state, events, "Attack in the Battle Phase."); return events; }
  const b = boardOf(state, who);
  const foe = foeOf(state, who);
  const attacker = b.monsters[fromZone];
  if (!attacker || !attacker.faceUp || attacker.position !== "attack") { log(state, events, "That can't attack."); return events; }
  const maxAtk = attacker.card.effect?.kind === "doubleAttack" ? 2 : 1;
  if (attacker.hasAttacked >= maxAtk) { log(state, events, "It already attacked."); return events; }
  if (target === "direct" && hasAnyMonster(foe)) { log(state, events, "Can't attack directly — monsters block."); return events; }

  events.push({ t: "attackDeclare", who, fromZone, toZone: target });
  attacker.hasAttacked++;
  state.pending = { type: "battle", attackerSide: who, attacker: fromZone, target, negated: false };

  // Defender's response window (battle traps) — blocked entirely while a
  // "Trap Cards cannot be activated" monster (Jinzo) is face-up.
  const canRespond = !trapsNegated(state)
    && foe.spellTraps.some((st) => st && !st.faceUp && trapReactsToAttack(st.card.effect));
  if (canRespond) {
    state.awaiting = { responder: foe.id, passes: 0 };
    events.push({ t: "window", responder: foe.id });
    return events;
  }
  continuePending(state, events);
  return events;
}

// ── Chain / response window ────────────────────────────────────────────────────

export interface ResponseOption { zone: number; card: DuelCard; effect: DuelEffect; }

/** True if either player controls a face-up "Trap Cards cannot be activated"
 *  monster (Jinzo). Traps are then unusable for BOTH players, as in the real game. */
export function trapsNegated(state: DuelState): boolean {
  for (const id of ["player", "opponent"] as PlayerId[]) {
    for (const m of boardOf(state, id).monsters) {
      if (m && m.faceUp && m.card.effect?.kind === "negateTraps") return true;
    }
  }
  return false;
}

/** Set cards the awaiting responder can legally activate right now. */
export function responseOptions(state: DuelState): ResponseOption[] {
  if (!state.awaiting || !state.pending) return [];
  if (trapsNegated(state)) return [];
  const b = boardOf(state, state.awaiting.responder);
  const out: ResponseOption[] = [];
  b.spellTraps.forEach((st, zone) => {
    if (!st || st.faceUp || !st.card.effect) return;
    if (state.pending!.type === "battle" && trapReactsToAttack(st.card.effect)) out.push({ zone, card: st.card, effect: st.card.effect });
    if (state.pending!.type === "summonTrigger" && trapReactsToSummon(st.card.effect)) {
      const summoned = boardOf(state, state.pending!.who).monsters[state.pending!.zone];
      if (summoned && summonTrapThresholdMet(st.card.effect, effAtk(summoned))) out.push({ zone, card: st.card, effect: st.card.effect });
    }
  });
  return out;
}

/** The awaiting responder activates a set card in response (single-link chain). */
export function respondToWindow(state: DuelState, zone: number, _targets: TargetRef[] = []): DuelEvent[] {
  const events: DuelEvent[] = [];
  if (!state.awaiting || !state.pending) return events;
  const responder = state.awaiting.responder;
  const b = boardOf(state, responder);
  const st = b.spellTraps[zone];
  if (!st || st.faceUp || !st.card.effect) return events;
  const eff = st.card.effect;

  events.push({ t: "activate", who: responder, card: st.card, text: st.card.name });
  events.push({ t: "chainResolve", who: responder, card: st.card });
  state.chain.push({ who: responder, card: st.card, effect: eff, targets: [] });
  b.spellTraps[zone] = null;
  b.graveyard.push(st.card);

  applyTrapResponse(state, responder, eff, events);

  state.awaiting = null;
  state.chain = [];
  continuePending(state, events);
  return events;
}

/** The awaiting responder declines to respond; the pending action continues. */
export function passWindow(state: DuelState): DuelEvent[] {
  const events: DuelEvent[] = [];
  if (!state.awaiting) return events;
  state.awaiting = null;
  state.chain = [];
  continuePending(state, events);
  return events;
}

function applyTrapResponse(state: DuelState, responder: PlayerId, eff: DuelEffect, events: DuelEvent[]): void {
  const pending = state.pending;
  if (!pending) return;
  if (pending.type === "battle") {
    const atkBoard = boardOf(state, pending.attackerSide);
    const attacker = atkBoard.monsters[pending.attacker];
    switch (eff.kind) {
      case "trap:mirror":
        events.push({ t: "negate", text: "Mirror Force!" });
        atkBoard.monsters.forEach((m, z) => {
          if (m && m.faceUp && m.position === "attack") destroyMonster(state, pending.attackerSide, z, events);
        });
        pending.negated = true; recomputeContinuous(state); break;
      case "trap:sakuretsu":
        if (attacker) destroyMonster(state, pending.attackerSide, pending.attacker, events);
        pending.negated = true; recomputeContinuous(state); break;
      case "trap:cylinder":
        if (attacker) { events.push({ t: "negate", text: "Magic Cylinder!" }); dealDamage(state, events, pending.attackerSide, effAtk(attacker), "reflected attack"); }
        pending.negated = true; break;
      case "trap:negateAttack":
        events.push({ t: "negate", text: "Negate Attack!" });
        pending.negated = true; pending.endBattlePhase = true; break;
      default: break;
    }
  } else if (pending.type === "summonTrigger") {
    if (eff.kind === "trap:trapHole") {
      const b = boardOf(state, pending.who);
      const m = b.monsters[pending.zone];
      if (m) destroyMonster(state, pending.who, pending.zone, events);
    }
  }
}

/** Resume the suspended action once its response window closes. */
function continuePending(state: DuelState, events: DuelEvent[]): void {
  const pending = state.pending;
  state.pending = null;
  if (!pending || state.winner) return;
  if (pending.type === "summonTrigger") return; // summon already stands (or was Trap-Holed)
  // Battle resolution.
  if (pending.endBattlePhase && !state.winner) {
    state.phase = "MAIN2";
    events.push({ t: "phase", phase: "MAIN2", who: state.turn });
  }
  if (pending.negated) return;
  resolveBattle(state, pending.attackerSide, pending.attacker, pending.target, events);
}

function resolveBattle(state: DuelState, who: PlayerId, fromZone: number, target: number | "direct", events: DuelEvent[]): void {
  const b = boardOf(state, who);
  const foe = foeOf(state, who);
  const attacker = b.monsters[fromZone];
  if (!attacker) return; // destroyed during the window
  events.push({ t: "clash", who, fromZone, toZone: target });

  if (target === "direct" || !hasAnyMonster(foe)) {
    dealDamage(state, events, foe.id, effAtk(attacker), "direct attack");
    return;
  }
  const defender = typeof target === "number" ? foe.monsters[target] : null;
  if (!defender) { dealDamage(state, events, foe.id, effAtk(attacker), "direct attack"); return; }

  const atkVal = effAtk(attacker);
  if (!defender.faceUp) {
    defender.faceUp = true;
    events.push({ t: "flip", who: foe.id, zone: target as number });
    applyFlipEffect(state, foe.id, target as number, events);
    recomputeContinuous(state);
  }

  if (defender.position === "attack") {
    const defVal = effAtk(defender);
    if (atkVal > defVal) {
      destroyMonster(state, foe.id, target as number, events);
      dealDamage(state, events, foe.id, atkVal - defVal, "battle damage");
    } else if (atkVal < defVal) {
      destroyMonster(state, who, fromZone, events);
      dealDamage(state, events, who, defVal - atkVal, "battle damage");
    } else {
      destroyMonster(state, foe.id, target as number, events);
      destroyMonster(state, who, fromZone, events);
    }
  } else {
    const defVal = effDef(defender);
    if (atkVal > defVal) {
      destroyMonster(state, foe.id, target as number, events);
      if (attacker.card.effect?.kind === "pierce") dealDamage(state, events, foe.id, atkVal - defVal, "piercing damage");
    } else if (atkVal < defVal) {
      dealDamage(state, events, who, defVal - atkVal, "battle damage");
    }
  }
  recomputeContinuous(state);
}
