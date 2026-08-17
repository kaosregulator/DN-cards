// ─────────────────────────────────────────────────────────────────────────────
// Duel engine — the true Yu-Gi-Oh style ruleset.
//
// Ported in spirit from the reference duel projects (phases, summon tributing,
// attack/defense combat math, spell/trap timing) into a compact, framework-free
// engine that runs entirely client-side. Every mutating action returns a stream
// of DuelEvents the scene animates, so presentation and rules stay decoupled.
//
// Turn structure:  DRAW → STANDBY → MAIN1 → BATTLE → MAIN2 → END → (pass turn)
// Summon costs:     Lv ≤4 → 0 tributes · Lv 5–6 → 1 · Lv 7+ → 2
// Combat:           attacker ATK vs target ATK (attack pos) / DEF (defense pos),
//                   with pierce, and Mirror / Cylinder / Ambush-Pit trap timing.
// ─────────────────────────────────────────────────────────────────────────────

import {
  ZONES,
  type DuelState, type DuelSetup, type DuelCard, type DuelEvent,
  type PlayerBoard, type PlayerId, type Phase, type MonsterPosition, type FieldMonster,
  type FieldSpellTrap,
} from "./types";

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

function makeBoard(id: PlayerId, name: string, deck: DuelCard[], startingLp: number, handSize: number): PlayerBoard {
  const shuffled = shuffle(deck);
  const hand = shuffled.splice(0, handSize);
  return {
    id, name, lp: startingLp, deck: shuffled, hand,
    monsters: Array<FieldMonster | null>(ZONES).fill(null),
    spellTraps: Array<FieldSpellTrap | null>(ZONES).fill(null),
    graveyard: [], hasNormalSummoned: false,
  };
}

export function createDuel(setup: DuelSetup): DuelState {
  const player = makeBoard("player", setup.player.name, setup.player.deck, setup.startingLp, setup.handSize);
  const opponent = makeBoard("opponent", setup.opponent.name, setup.opponent.deck, setup.startingLp, setup.handSize);
  // Player always goes first (they pressed the button).
  return {
    player, opponent, turn: "player", phase: "MAIN1", turnCount: 1,
    startingLp: setup.startingLp, winner: null, log: [],
  };
}

export function boardOf(state: DuelState, id: PlayerId): PlayerBoard {
  return id === "player" ? state.player : state.opponent;
}
export function foeOf(state: DuelState, id: PlayerId): PlayerBoard {
  return id === "player" ? state.opponent : state.player;
}

function log(state: DuelState, events: DuelEvent[], text: string): void {
  state.log.push(text);
  events.push({ t: "log", text });
}

/** Effective ATK/DEF including continuous modifiers. */
export function effAtk(m: FieldMonster): number { return Math.max(0, m.card.atk + m.atkMod); }
export function effDef(m: FieldMonster): number { return Math.max(0, m.card.def + m.defMod); }

function dealDamage(state: DuelState, events: DuelEvent[], who: PlayerId, amount: number, reason: string): void {
  if (amount <= 0) return;
  const b = boardOf(state, who);
  b.lp = Math.max(0, b.lp - amount);
  events.push({ t: "damage", who, amount, reason });
  if (b.lp <= 0 && !state.winner) {
    state.winner = who === "player" ? "opponent" : "player";
    events.push({ t: "win", who: state.winner });
  }
}

function heal(state: DuelState, events: DuelEvent[], who: PlayerId, amount: number): void {
  if (amount <= 0) return;
  boardOf(state, who).lp += amount;
  events.push({ t: "heal", who, amount });
}

// ── Draw / phases / turns ─────────────────────────────────────────────────────

export function drawCards(state: DuelState, who: PlayerId, count: number, events: DuelEvent[]): void {
  const b = boardOf(state, who);
  for (let i = 0; i < count; i++) {
    const card = b.deck.shift();
    if (!card) {
      events.push({ t: "deckout", who });
      if (!state.winner) {
        state.winner = who === "player" ? "opponent" : "player";
        events.push({ t: "win", who: state.winner });
      }
      return;
    }
    b.hand.push(card);
    events.push({ t: "draw", who, card });
  }
}

const PHASE_ORDER: Phase[] = ["DRAW", "STANDBY", "MAIN1", "BATTLE", "MAIN2", "END"];

/** Advance to the next phase; wraps END → next player's turn. */
export function nextPhase(state: DuelState): DuelEvent[] {
  const events: DuelEvent[] = [];
  if (state.winner) return events;
  const idx = PHASE_ORDER.indexOf(state.phase);
  if (state.phase === "END") { return endTurn(state); }
  const next = PHASE_ORDER[idx + 1]!;
  state.phase = next;
  events.push({ t: "phase", phase: next, who: state.turn });
  if (next === "END") {
    // Continuous turn-scoped boosts (Rush Command) wear off at End Phase.
    clearTurnBoosts(state, state.turn, events);
  }
  return events;
}

/** Jump straight to a chosen phase (only forwards within the same turn). */
export function goToPhase(state: DuelState, target: Phase): DuelEvent[] {
  const events: DuelEvent[] = [];
  if (state.winner) return events;
  while (state.phase !== target && PHASE_ORDER.indexOf(state.phase) < PHASE_ORDER.indexOf(target)) {
    events.push(...nextPhase(state));
    if (state.winner) break;
    if (state.turn !== boardOf(state, state.turn).id) break;
  }
  return events;
}

function clearTurnBoosts(state: DuelState, who: PlayerId, events: DuelEvent[]): void {
  const b = boardOf(state, who);
  let any = false;
  for (const m of b.monsters) {
    if (m && m.turnBoost) { m.atkMod -= m.turnBoost; m.turnBoost = 0; any = true; }
  }
  if (any) events.push({ t: "buff", who, text: "Temporary boosts fade." });
}

export function endTurn(state: DuelState): DuelEvent[] {
  const events: DuelEvent[] = [];
  if (state.winner) return events;
  clearTurnBoosts(state, state.turn, events);
  const nextPlayer: PlayerId = state.turn === "player" ? "opponent" : "player";
  state.turn = nextPlayer;
  state.turnCount++;
  const b = boardOf(state, nextPlayer);
  b.hasNormalSummoned = false;
  for (const m of b.monsters) { if (m) { m.hasAttacked = 0; m.summonedThisTurn = false; } }
  // Opponent's monsters also reset attack counters at the start of your turn.
  events.push({ t: "turn", who: nextPlayer, turnCount: state.turnCount });
  // Draw Phase.
  state.phase = "DRAW";
  events.push({ t: "phase", phase: "DRAW", who: nextPlayer });
  drawCards(state, nextPlayer, 1, events);
  // Auto-progress into Main Phase 1 (Standby has no player choices here).
  if (!state.winner) {
    state.phase = "MAIN1";
    events.push({ t: "phase", phase: "MAIN1", who: nextPlayer });
  }
  return events;
}

// ── Summoning ─────────────────────────────────────────────────────────────────

export function tributesNeeded(level: number): number {
  if (level >= 7) return 2;
  if (level >= 5) return 1;
  return 0;
}

export function emptyMonsterZone(b: PlayerBoard): number {
  return b.monsters.findIndex((m) => m === null);
}
export function emptySpellZone(b: PlayerBoard): number {
  return b.spellTraps.findIndex((s) => s === null);
}

export function canNormalSummon(state: DuelState, who: PlayerId, handIndex: number): { ok: boolean; reason?: string } {
  const b = boardOf(state, who);
  if (state.turn !== who) return { ok: false, reason: "Not your turn." };
  if (state.phase !== "MAIN1" && state.phase !== "MAIN2") return { ok: false, reason: "Summon only in a Main Phase." };
  if (b.hasNormalSummoned) return { ok: false, reason: "You already Normal Summoned this turn." };
  const card = b.hand[handIndex];
  if (!card || card.kind !== "monster") return { ok: false, reason: "That isn't a monster." };
  const need = tributesNeeded(card.level);
  const onField = b.monsters.filter((m) => m !== null).length;
  if (onField - need >= ZONES) return { ok: false, reason: "No open Monster Zone." };
  if (onField >= ZONES && need === 0) return { ok: false, reason: "Monster Zones are full." };
  if (need > onField) return { ok: false, reason: `Needs ${need} tribute${need > 1 ? "s" : ""}.` };
  return { ok: true };
}

/**
 * Normal Summon / Set a monster. `tributeZones` are indices of your own
 * monsters to send to the Graveyard as tribute (must match tributesNeeded).
 */
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

  // Pay tributes.
  for (const z of tributeZones) {
    const m = b.monsters[z];
    if (!m) { log(state, events, "Invalid tribute."); return events; }
  }
  for (const z of tributeZones) {
    const m = b.monsters[z]!;
    b.graveyard.push(m.card);
    events.push({ t: "destroy", who, zone: z, card: m.card });
    b.monsters[z] = null;
  }

  const zone = emptyMonsterZone(b);
  if (zone < 0) { log(state, events, "No open Monster Zone."); return events; }
  b.hand.splice(handIndex, 1);
  const faceUp = position !== "set";
  const mon: FieldMonster = {
    card, position, atkMod: 0, defMod: 0, hasAttacked: 0, summonedThisTurn: true, faceUp, turnBoost: 0,
  };
  b.monsters[zone] = mon;
  b.hasNormalSummoned = true;
  events.push({ t: "summon", who, zone, card, position, tributes: need });
  log(state, events, `${b.name} ${faceUp ? "Summons" : "Sets"} ${card.name}.`);

  if (faceUp) applyOnSummon(state, who, zone, events);
  return events;
}

/** On-summon (and on-flip) triggered effects. */
function applyOnSummon(state: DuelState, who: PlayerId, zone: number, events: DuelEvent[]): void {
  const b = boardOf(state, who);
  const m = b.monsters[zone];
  if (!m) return;
  const eff = m.card.effect;
  if (eff) {
    if (eff.kind === "gainAtk") {
      m.atkMod += eff.amount;
      events.push({ t: "buff", who, text: `${m.card.name} gains ${eff.amount} ATK.` });
    } else if (eff.kind === "drawOnSummon") {
      events.push({ t: "activate", who, card: m.card, text: `${m.card.name}: draw ${eff.count}.` });
      drawCards(state, who, eff.count, events);
    } else if (eff.kind === "burn") {
      events.push({ t: "activate", who, card: m.card, text: `${m.card.name}: burn ${eff.amount}.` });
      dealDamage(state, events, who === "player" ? "opponent" : "player", eff.amount, "effect burn");
    }
  }
  // Opponent's face-down Ambush Pit (Trap Hole) may answer the summon.
  const foe = foeOf(state, who);
  for (let z = 0; z < ZONES; z++) {
    const st = foe.spellTraps[z];
    if (st && !st.faceUp && st.card.kind === "trap" && st.card.effect?.kind === "trap:trapHole") {
      if (effAtk(m) >= st.card.effect.threshold) {
        events.push({ t: "activate", who: foe.id, card: st.card, text: `${st.card.name} destroys ${m.card.name}!` });
        foe.graveyard.push(st.card);
        foe.spellTraps[z] = null;
        b.graveyard.push(m.card);
        events.push({ t: "destroy", who, zone, card: m.card });
        b.monsters[zone] = null;
        return;
      }
    }
  }
}

// ── Position changes ──────────────────────────────────────────────────────────

export function changePosition(state: DuelState, who: PlayerId, zone: number): DuelEvent[] {
  const events: DuelEvent[] = [];
  const b = boardOf(state, who);
  const m = b.monsters[zone];
  if (!m) return events;
  if (state.turn !== who || (state.phase !== "MAIN1" && state.phase !== "MAIN2")) {
    log(state, events, "Change position in a Main Phase."); return events;
  }
  if (m.summonedThisTurn) { log(state, events, "Can't change the turn it was summoned."); return events; }
  if (m.hasAttacked > 0) { log(state, events, "It already attacked."); return events; }
  if (!m.faceUp) { // flip set → face-up attack
    m.faceUp = true; m.position = "attack";
    events.push({ t: "flip", who, zone });
    applyOnSummon(state, who, zone, events);
  } else {
    m.position = m.position === "attack" ? "defense" : "attack";
  }
  events.push({ t: "positionChange", who, zone, position: m.position });
  return events;
}

// ── Spell / Trap ──────────────────────────────────────────────────────────────

export function setSpellTrap(state: DuelState, who: PlayerId, handIndex: number): DuelEvent[] {
  const events: DuelEvent[] = [];
  const b = boardOf(state, who);
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

/** Activate a Spell straight from the hand (Normal Spell timing). */
export function activateSpellFromHand(state: DuelState, who: PlayerId, handIndex: number): DuelEvent[] {
  const events: DuelEvent[] = [];
  const b = boardOf(state, who);
  if (state.turn !== who || (state.phase !== "MAIN1" && state.phase !== "MAIN2")) {
    log(state, events, "Activate Spells in a Main Phase."); return events;
  }
  const card = b.hand[handIndex];
  if (!card || card.kind !== "spell" || !card.effect) { log(state, events, "That isn't a Spell."); return events; }
  b.hand.splice(handIndex, 1);
  resolveSpell(state, who, card, events);
  b.graveyard.push(card);
  return events;
}

function resolveSpell(state: DuelState, who: PlayerId, card: DuelCard, events: DuelEvent[]): void {
  const eff = card.effect!;
  events.push({ t: "activate", who, card, text: card.name });
  if (eff.kind === "spell:draw") {
    drawCards(state, who, eff.count, events);
  } else if (eff.kind === "spell:heal") {
    heal(state, events, who, eff.amount);
  } else if (eff.kind === "spell:boost") {
    const b = boardOf(state, who);
    for (const m of b.monsters) {
      if (m && m.faceUp) { m.atkMod += eff.amount; m.turnBoost += eff.amount; }
    }
    events.push({ t: "buff", who, text: `All monsters +${eff.amount} ATK this turn.` });
  }
}

// ── Battle ─────────────────────────────────────────────────────────────────────

export function monstersThatCanAttack(state: DuelState, who: PlayerId): number[] {
  if (state.turn !== who || state.phase !== "BATTLE") return [];
  const b = boardOf(state, who);
  const out: number[] = [];
  b.monsters.forEach((m, z) => {
    if (m && m.faceUp && m.position === "attack") {
      const max = m.card.effect?.kind === "doubleAttack" ? 2 : 1;
      // A monster summoned this turn may still attack (standard Yu-Gi-Oh rule).
      if (m.hasAttacked < max) out.push(z);
    }
  });
  return out;
}

export function hasAnyMonster(b: PlayerBoard): boolean {
  return b.monsters.some((m) => m !== null);
}

/** Try to auto-activate a defender trap in response to an attack declaration.
 *  Returns true if the attack was fully answered (negated / attacker cleared). */
function respondWithTrap(
  state: DuelState, attacker: PlayerId, fromZone: number, events: DuelEvent[],
): boolean {
  const foe = foeOf(state, attacker);
  const atkBoard = boardOf(state, attacker);
  const attackerMon = atkBoard.monsters[fromZone];
  if (!attackerMon) return true;
  for (let z = 0; z < ZONES; z++) {
    const st = foe.spellTraps[z];
    if (!st || st.faceUp || st.card.kind !== "trap" || !st.card.effect) continue;
    const eff = st.card.effect;
    if (eff.kind === "trap:mirror") {
      events.push({ t: "activate", who: foe.id, card: st.card, text: `${st.card.name}!` });
      foe.graveyard.push(st.card); foe.spellTraps[z] = null;
      // Destroy all attacker-side attack-position monsters.
      atkBoard.monsters.forEach((m, mz) => {
        if (m && m.position === "attack" && m.faceUp) {
          atkBoard.graveyard.push(m.card);
          events.push({ t: "destroy", who: attacker, zone: mz, card: m.card });
          atkBoard.monsters[mz] = null;
        }
      });
      return true;
    }
    if (eff.kind === "trap:cylinder") {
      events.push({ t: "activate", who: foe.id, card: st.card, text: `${st.card.name}!` });
      foe.graveyard.push(st.card); foe.spellTraps[z] = null;
      dealDamage(state, events, attacker, effAtk(attackerMon), "reflected attack");
      return true;
    }
  }
  return false;
}

export function declareAttack(
  state: DuelState, who: PlayerId, fromZone: number, target: number | "direct",
): DuelEvent[] {
  const events: DuelEvent[] = [];
  if (state.winner) return events;
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

  // Defender's trap window.
  if (respondWithTrap(state, who, fromZone, events)) return events;
  if (!b.monsters[fromZone]) return events; // attacker got destroyed by the trap

  events.push({ t: "clash", who, fromZone, toZone: target });

  if (target === "direct") {
    dealDamage(state, events, foe.id, effAtk(attacker), "direct attack");
    return events;
  }

  const defender = foe.monsters[target];
  if (!defender) { // target vanished; treat as direct if now open
    dealDamage(state, events, foe.id, effAtk(attacker), "direct attack");
    return events;
  }

  const atkVal = effAtk(attacker);
  // Flip a face-down defender face-up on contact.
  if (!defender.faceUp) {
    defender.faceUp = true;
    events.push({ t: "flip", who: foe.id, zone: target });
    applyOnSummon(state, foe.id, target, events); // flip triggers, if any
  }

  if (defender.position === "attack") {
    const defVal = effAtk(defender);
    if (atkVal > defVal) {
      foe.graveyard.push(defender.card);
      events.push({ t: "destroy", who: foe.id, zone: target, card: defender.card });
      foe.monsters[target] = null;
      dealDamage(state, events, foe.id, atkVal - defVal, "battle damage");
    } else if (atkVal < defVal) {
      b.graveyard.push(attacker.card);
      events.push({ t: "destroy", who, zone: fromZone, card: attacker.card });
      b.monsters[fromZone] = null;
      dealDamage(state, events, who, defVal - atkVal, "battle damage");
    } else {
      foe.graveyard.push(defender.card); b.graveyard.push(attacker.card);
      events.push({ t: "destroy", who: foe.id, zone: target, card: defender.card });
      events.push({ t: "destroy", who, zone: fromZone, card: attacker.card });
      foe.monsters[target] = null; b.monsters[fromZone] = null;
    }
  } else {
    // Defense / set: compare ATK vs DEF.
    const defVal = effDef(defender);
    if (atkVal > defVal) {
      foe.graveyard.push(defender.card);
      events.push({ t: "destroy", who: foe.id, zone: target, card: defender.card });
      foe.monsters[target] = null;
      if (attacker.card.effect?.kind === "pierce") {
        dealDamage(state, events, foe.id, atkVal - defVal, "piercing damage");
      }
    } else if (atkVal < defVal) {
      dealDamage(state, events, who, defVal - atkVal, "battle damage");
    }
  }
  return events;
}
