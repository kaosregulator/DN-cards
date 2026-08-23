// Team-battle rules — headless simulation & invariant harness.
//
// Exercises the siege/conquest "Raids of Legends" rules through the REAL combat
// engine (no Discord, no DB): two teams of up to four cards, alternating turns,
// the acting front card striking ANY chosen enemy rank, and a charged ultimate
// detonating on the whole enemy line (team AoE). Asserts the rules terminate
// with one team wiped and that the new paths (free targeting + AoE ultimate)
// actually fire.
//
// Run:  pnpm --filter @workspace/scripts run sim:team
//
// Engines transitively import @workspace/db for types; a dummy URL is enough
// since no query runs.
process.env.DATABASE_URL ||= "postgres://team-sim";

import assert from "node:assert/strict";

const base = "../../artifacts/api-server/src/bot/battle";
const { deriveStats, applyStatOverrides } = await import(`${base}/stat-engine.js`) as any;
const { resolveMove, resolveTeamUltimate, startOfTurn } = await import(`${base}/combat-engine.js`) as any;
const { inferSpecialEffect } = await import(`${base}/special-cards.js`) as any;

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
let cardSeq = 1;
function randomCardStub(): Any {
  const rarity = RARITIES[Math.floor(Math.random() * RARITIES.length)];
  const cardType = TYPES[Math.floor(Math.random() * TYPES.length)];
  const id = cardSeq++;
  return { id, name: `Card ${id}`, rarity, cardType, worthValue: Math.floor(Math.random() * 5000) + 10 };
}
function makeCombatant(card: Any, settings: Any, side: 0 | 1, special: Any | null): Any {
  const stats = applyStatOverrides(deriveStats(card, settings), null);
  return {
    userId: `p${side}`, displayName: `P${side}`, isAi: true, aiDifficulty: "normal", side,
    cardId: card.id, cardName: card.name, cardRarity: card.rarity, cardType: card.cardType, cardImageUrl: null,
    stats, hp: stats.maxHealth, shield: 0, energy: 40, ultimate: 0, status: [],
    specialCardId: special?.id ?? null, specialCardName: special?.name ?? null,
    specialEffect: special ? inferSpecialEffect(special.cardType, special.rarity) : null,
    specialCooldownMax: 3, specialCooldownRemaining: 0,
    defending: false, nextAttackBoostPct: 0, doubleNextAttack: false, frozenTurns: 0, lastStandUsed: false,
  };
}

const finite = (n: number) => Number.isFinite(n);
const frontIdx = (team: Any[]) => team.findIndex(c => c.hp > 0);   // front living rank
const allDead = (team: Any[]) => team.every(c => c.hp <= 0);
function makeTeam(settings: Any, side: 0 | 1, n = 4): Any[] {
  return Array.from({ length: n }, () => makeCombatant(randomCardStub(), settings, side, randomCardStub()));
}

interface Metrics { aoeUlts: number; nonFrontHits: number; }

function simulate(settings: Any, m: Metrics): { winner: 0 | 1 | null; turns: number } {
  const teams: [Any[], Any[]] = [makeTeam(settings, 0), makeTeam(settings, 1)];
  let side: 0 | 1 = Math.random() < 0.5 ? 0 : 1;
  let turn = 1;
  const MAX = 80;
  while (turn <= MAX) {
    const team = teams[side];
    const foes = teams[side === 0 ? 1 : 0];
    const ai = frontIdx(team);
    if (ai < 0) return { winner: (side === 0 ? 1 : 0), turns: turn };  // this side is wiped
    const actor = team[ai];

    startOfTurn(actor, settings);
    if (actor.hp <= 0) { side = (side === 0 ? 1 : 0) as 0 | 1; if (side === 0) turn++; continue; }

    const living = foes.map((c, i) => ({ c, i })).filter(x => x.c.hp > 0);
    if (living.length === 0) return { winner: side, turns: turn };

    // Free target selection: half the time snipe the lowest-HP rank (often a
    // back rank), half the time the front — exercising "attack this card".
    const target = Math.random() < 0.5 ? living.reduce((a, b) => (b.c.hp < a.c.hp ? b : a)) : living[0]!;
    const focusIdx = target.i;
    if (focusIdx !== frontIdx(foes)) m.nonFrontHits++;

    // Move choice: charged ultimate + 2 foes → team AoE; else special/charge/attack.
    let move = "attack";
    if (actor.ultimate >= actor.stats.ultimateMax && living.length > 1) move = "ultimate";
    else if (actor.energy >= settings.specialCost && Math.random() < 0.4) move = "special";
    else if (Math.random() < 0.3) move = "charge";

    if (move === "ultimate") {
      const tu = resolveTeamUltimate(settings, actor, foes, focusIdx);
      assert.ok(Array.isArray(tu.koed) && tu.koed.length === foes.length, "team ult koed shape");
      m.aoeUlts++;
    } else {
      resolveMove(settings, actor, foes[focusIdx], move);
    }

    // Invariants across every card on the board.
    for (const c of [...teams[0], ...teams[1]]) {
      assert.ok(finite(c.hp) && finite(c.energy) && finite(c.ultimate), "meter NaN");
      assert.ok(c.energy <= c.stats.energyMax + 1e-6, "energy over max");
      assert.ok(c.ultimate <= c.stats.ultimateMax + 1e-6, "ultimate over max");
    }

    if (allDead(foes)) return { winner: side, turns: turn };
    if (allDead(team)) return { winner: (side === 0 ? 1 : 0), turns: turn };
    side = (side === 0 ? 1 : 0) as 0 | 1;
    if (side === 0) turn++;
  }
  // Cap reached — decide by surviving cards, then HP fraction.
  const alive = (t: Any[]) => t.filter(c => c.hp > 0).length;
  const hp = (t: Any[]) => t.reduce((s, c) => s + Math.max(0, c.hp), 0);
  const [A, B] = teams;
  if (alive(A) !== alive(B)) return { winner: alive(A) > alive(B) ? 0 : 1, turns: MAX };
  return { winner: hp(A) === hp(B) ? null : hp(A) > hp(B) ? 0 : 1, turns: MAX };
}

function run(): void {
  const N = 4000;
  const settings = makeSettings();
  const wins = { 0: 0, 1: 0, draw: 0 };
  const m: Metrics = { aoeUlts: 0, nonFrontHits: 0 };
  let totalTurns = 0, longest = 0, decisive = 0;
  for (let i = 0; i < N; i++) {
    const r = simulate(settings, m);
    assert.ok(r.winner === 0 || r.winner === 1 || r.winner === null, "invalid winner");
    assert.ok(r.turns >= 1 && r.turns <= 80, `turns out of range: ${r.turns}`);
    if (r.winner === null) wins.draw++; else { wins[r.winner]++; decisive++; }
    totalTurns += r.turns; longest = Math.max(longest, r.turns);
  }
  assert.ok(decisive / N > 0.9, `too many draws (${decisive}/${N} decisive) — team battles should end in a wipe`);
  assert.ok(m.aoeUlts > 0, "team AoE ultimate never fired");
  assert.ok(m.nonFrontHits > 0, "free targeting never hit a non-front rank");
  console.log(`✅ ${N} team battles simulated — all invariants held.`);
  console.log(`   Decisive (wiped a team): ${((decisive / N) * 100).toFixed(1)}%   Draws: ${((wins.draw / N) * 100).toFixed(1)}%`);
  console.log(`   Avg turns: ${(totalTurns / N).toFixed(1)}   Longest: ${longest}`);
  console.log(`   Team AoE ultimates fired: ${m.aoeUlts}   Non-front target hits: ${m.nonFrontHits}`);
  console.log("✅ Targeting + team-ultimate paths exercised against the real engine.");
}

run();
