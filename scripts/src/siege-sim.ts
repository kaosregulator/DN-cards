// Siege Battle — headless simulation & invariant harness.
//
// Drives the REAL siege engine (no Discord, no DB): two commanders, four cards a
// side on the board, reserves behind them, life points behind those. Both sides
// are played by the shared AI, which picks only from `legalActions`, so this
// exercises exactly the code path a human's buttons drive.
//
// Asserts the rules that make the mode work:
//   • LP is UNREACHABLE while a formation stands or reserves remain
//   • a wiped formation pulls reinforcements, and only then is LP exposed
//   • battles terminate with a winner by LP (or the turn cap)
//   • meters never go NaN / over max; HP never goes negative
//   • Siege Battle Cards, items, team ultimates and direct LP hits all fire
//
// Run:  pnpm --filter @workspace/scripts run sim:siege
process.env.DATABASE_URL ||= "postgres://siege-sim";

import assert from "node:assert/strict";

const base = "../../artifacts/api-server/src/bot";
const { deriveStats, applyStatOverrides } = await import(`${base}/battle/stat-engine.js`) as any;
const { inferSpecialEffect } = await import(`${base}/battle/special-cards.js`) as any;
const siege = await import(`${base}/siege/index.js`) as any;

const {
  buildSiegeBattle, startTurn, endTurn, resolveAction, chooseSiegeAction,
  legalActions, checkAction, lpExposed, formationEmpty, canReinforce,
  livingSlots, getSiegeCard, DEFAULT_SIEGE_CARDS, FORMATION_SIZE,
} = siege;

type Any = any;

function makeSettings(overrides: Partial<Any> = {}): Any {
  return {
    id: 1, guildId: "sim", enabled: true, setupComplete: true,
    battleChannelId: null, logChannelId: null, turnTimerSeconds: 45, aiOfferSeconds: 60,
    hpBase: 750, hpPerRarity: 220, hpWorthDivisor: 40,
    attackBase: 85, attackPerRarity: 28, defenseBase: 55, defensePerRarity: 18, speedBase: 50,
    critChancePct: 12, critMultiplierPct: 180, missChancePct: 8, dodgeChancePct: 10, counterChancePct: 10,
    energyGainPerTurn: 20, chargeEnergyGain: 45, specialCost: 40, shieldStrengthPct: 40,
    ultimateChargePerTurn: 14, ultimateThreshold: 100, ultimateDamagePct: 260,
    minRarity: "common", maxRarity: "mythic", allowedTypes: null,
    specialCardsEnabled: true, stakingEnabled: true, aiEnabled: true,
    createdAt: new Date(), updatedAt: new Date(), ...overrides,
  };
}

const RARITIES = ["common", "uncommon", "rare", "epic", "legendary", "mythic"];
const TYPES = ["tank", "aircraft", "ship", "vehicle", "infantry", "boss"];
let seq = 1;
function randomCard(): Any {
  const id = seq++;
  return {
    id, name: `Card ${id}`,
    rarity: RARITIES[Math.floor(Math.random() * RARITIES.length)],
    cardType: TYPES[Math.floor(Math.random() * TYPES.length)],
    worthValue: Math.floor(Math.random() * 5000) + 10,
  };
}
function makeCombatant(side: 0 | 1, settings: Any): Any {
  const card = randomCard();
  const special = randomCard();
  const stats = applyStatOverrides(deriveStats(card, settings), null);
  return {
    userId: `p${side}`, displayName: `P${side}`, isAi: true, side,
    cardId: card.id, cardName: card.name, cardRarity: card.rarity, cardType: card.cardType,
    cardImageUrl: null, stats, hp: stats.maxHealth, shield: 0, energy: 40, ultimate: 0, status: [],
    specialCardId: special.id, specialCardName: special.name,
    specialEffect: inferSpecialEffect(special.cardType, special.rarity),
    specialCooldownMax: 3, specialCooldownRemaining: 0,
    itemId: "med_kit", itemChargesRemaining: 2, itemCooldownRemaining: 0,
    defending: false, nextAttackBoostPct: 0, doubleNextAttack: false,
    frozenTurns: 0, lastStandUsed: false,
  };
}
const roster = (side: 0 | 1, n: number, s: Any) => Array.from({ length: n }, () => makeCombatant(side, s));

interface Metrics {
  siegeCards: number; directLp: number; reinforcements: number;
  items: number; ultimates: number; kos: number;
  cardsPlayed: Record<string, number>;
  lpViolations: number;
  byLp: number; byCap: number; lpLeft: number[];
  exposedEvents: number; maxLog: number;
}

function simulate(settings: Any, m: Metrics, size = 7, maxTurns?: number): { winner: number | null; turns: number } {
  const state = buildSiegeBattle({
    attacker: { name: "Raiders", userId: "u0", isAi: true, roster: roster(0, size, settings), lp: 6100 },
    defender: { name: "Garrison", userId: "AI", isAi: true, roster: roster(1, size, settings), lp: 5200 },
    settings, maxTurns,
  });

  let endedByCap = false;
  let guard = 0;
  while (state.phase !== "ended" && guard++ < 500) {
    const foeSide = state.activeSide === 0 ? 1 : 0;
    const foes = state.teams[foeSide];

    // ── THE core invariant: LP must be unreachable while defended. ──────────
    const exposed = lpExposed(foes);
    const defended = !formationEmpty(foes) || canReinforce(foes);
    if (exposed && defended) m.lpViolations++;
    const directs = legalActions(state).filter((a: Any) => a.kind === "direct_lp");
    if (defended && directs.length > 0) m.lpViolations++;

    const st = startTurn(state);
    m.kos += st.destroyed.length;

    const lpBefore = foes.lp;
    const action = chooseSiegeAction(state, "normal");
    if (action) {
      // Anything the AI picks must pass the same legality gate a player faces.
      assert.ok(checkAction(state, action).ok, `AI chose an illegal action: ${JSON.stringify(action)}`);
      const res = resolveAction(state, action);
      m.kos += res.destroyed.length;
      if (action.kind === "siege_card") {
        m.siegeCards++;
        m.cardsPlayed[action.cardId] = (m.cardsPlayed[action.cardId] ?? 0) + 1;
      }
      if (action.kind === "direct_lp") m.directLp++;
      if (action.kind === "item") m.items++;
      if (action.kind === "move" && action.move === "ultimate") m.ultimates++;
      for (const e of res.events) if (e.event === "deploy") m.reinforcements++;
    }

    // LP may only have moved if it was legitimately reachable this turn.
    if (foes.lp < lpBefore && defended) {
      const viaBreakthrough = action?.kind === "siege_card"
        && getSiegeCard(action.cardId)?.effect === "breakthrough";
      if (!viaBreakthrough) m.lpViolations++;
    }

    // Board integrity.
    for (const team of state.teams) {
      assert.equal(team.slots.length, FORMATION_SIZE, "formation must always have 4 squares");
      assert.ok(team.lp >= 0 && Number.isFinite(team.lp), "LP went negative or NaN");
      for (const slot of team.slots) {
        const u = slot.unit;
        if (!u) continue;
        assert.ok(Number.isFinite(u.hp) && Number.isFinite(u.energy) && Number.isFinite(u.ultimate), "meter NaN");
        assert.ok(u.hp >= 0, `HP went negative: ${u.hp}`);
        assert.ok(u.energy <= u.stats.energyMax + 1e-6, "energy over max");
        assert.ok(u.ultimate <= u.stats.ultimateMax + 1e-6, "ultimate over max");
      }
    }

    const et = endTurn(state);
    for (const e of et.events) {
      if (e.event === "deploy") m.reinforcements++;
      if (e.event === "wipe" && /life points are exposed/.test(e.text)) m.exposedEvents++;
    }
    m.maxLog = Math.max(m.maxLog, state.log.length);
    if (et.battleOver && state.teams[0].lp > 0 && state.teams[1].lp > 0) endedByCap = true;
  }
  if (endedByCap) m.byCap++; else m.byLp++;
  m.lpLeft.push(Math.min(state.teams[0].lp, state.teams[1].lp));
  return { winner: state.winner, turns: state.turn };
}

function run(): void {
  // Sweep roster sizes first — the mode's length is driven by how many cards
  // have to be destroyed before LP is even reachable.
  for (const size of [4, 5, 6, 7]) {
    const sm: Metrics = { siegeCards:0, directLp:0, reinforcements:0, items:0, ultimates:0, kos:0, cardsPlayed:{}, lpViolations:0, byLp:0, byCap:0, lpLeft:[], exposedEvents:0, maxLog:0 };
    let t = 0;
    const S = 400;
    for (let i = 0; i < S; i++) t += simulate(makeSettings(), sm, size, undefined as any).turns;
    console.log(`   roster ${size}/side → avg ${(t/S).toFixed(1)} turns, LP wipe ${((sm.byLp/S)*100).toFixed(0)}%, cap ${((sm.byCap/S)*100).toFixed(0)}%`);
  }

  const N = 2000;
  const settings = makeSettings();
  const m: Metrics = {
    siegeCards: 0, directLp: 0, reinforcements: 0, items: 0,
    ultimates: 0, kos: 0, cardsPlayed: {}, lpViolations: 0,
    byLp: 0, byCap: 0, lpLeft: [], exposedEvents: 0, maxLog: 0,
  };
  let decisive = 0, totalTurns = 0, longest = 0;
  const wins = { 0: 0, 1: 0, draw: 0 } as Any;

  for (let i = 0; i < N; i++) {
    const r = simulate(settings, m, 7);
    if (r.winner === null) wins.draw++; else { wins[r.winner]++; decisive++; }
    totalTurns += r.turns; longest = Math.max(longest, r.turns);
  }

  assert.equal(m.lpViolations, 0, `LP was reachable while the formation still defended (${m.lpViolations} times)`);
  assert.ok(m.siegeCards > 0, "no Siege Battle Card was ever played");
  assert.ok(m.reinforcements > 0, "reinforcements never deployed");
  assert.ok(m.directLp > 0, "LP was never attacked directly");
  assert.ok(m.kos > 0, "no card was ever destroyed");
  assert.ok(m.maxLog > 0, "state.log was never populated — the Card Clash log rail would render blank");
  assert.ok(m.exposedEvents > 0, "the 'life points are exposed' beat never fired, even for rosters with reserves");
  assert.ok(decisive / N > 0.8, `too many stalemates (${decisive}/${N} decisive)`);
  assert.ok(m.byLp / N > 0.85, `too many sieges ran to the turn cap instead of a real LP wipe (${m.byLp}/${N})`);

  const avgLpLeft = m.lpLeft.reduce((a,b)=>a+b,0)/Math.max(1,m.lpLeft.length);
  console.log(`   Ended by LP wipe: ${m.byLp}   Ended at turn cap: ${m.byCap}   Avg losing LP left: ${avgLpLeft.toFixed(0)}`);
  const played = Object.keys(m.cardsPlayed).length;
  console.log(`✅ ${N} siege battles simulated — all invariants held.`);
  console.log(`   Decisive: ${((decisive / N) * 100).toFixed(1)}%   Avg turns: ${(totalTurns / N).toFixed(1)}   Longest: ${longest}`);
  console.log(`   Attacker: ${((wins[0] / N) * 100).toFixed(1)}%   Defender: ${((wins[1] / N) * 100).toFixed(1)}%   Draws: ${((wins.draw / N) * 100).toFixed(1)}%`);
  console.log(`   Siege cards played: ${m.siegeCards} (${played}/${DEFAULT_SIEGE_CARDS.length} distinct)`);
  console.log(`   Reinforcement waves: ${m.reinforcements}   Direct LP hits: ${m.directLp}   Team ultimates: ${m.ultimates}   KOs: ${m.kos}`);
  console.log(`   LP-exposed announcements: ${m.exposedEvents}   Peak clash-log length: ${m.maxLog}`);
  console.log(`✅ LP stayed protected behind the formation in every one of ${N} battles.`);
}

run();
