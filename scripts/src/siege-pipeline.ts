// Siege Battle — end-to-end pipeline check.
//
// Drives a real battle through EVERY layer in order and renders both screens
// from the resulting state:
//
//   Card Data → Siege Adapter → Battle State → Action Resolver → Events → Renderer
//
// This is the integration counterpart to sim:siege (which stresses the rules
// headlessly): it proves the projections compile against real state, that the
// renderer draws from measured engine numbers, and that both screens produce an
// image. Writes previews next to the repo for eyeballing.
//
// Run:  pnpm --filter @workspace/scripts run sim:pipeline
process.env.DATABASE_URL ||= "postgres://siege-pipeline";
process.env.HQ_ASSETS_DIR ||= new URL("../../artifacts/api-server/assets/hq", import.meta.url).pathname;

import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";

const base = "../../artifacts/api-server/src/bot";
const { deriveStats, applyStatOverrides } = await import(`${base}/battle/stat-engine.js`) as any;
const { inferSpecialEffect } = await import(`${base}/battle/special-cards.js`) as any;
const siege = await import(`${base}/siege/index.js`) as any;
const { renderCardClashStill } = await import(`${base}/animations/card-clash.js`) as any;
const { renderSiegeFieldStill } = await import(`${base}/animations/siege-field.js`) as any;

const {
  buildSiegeBattle, startTurn, endTurn, resolveAction, chooseSiegeAction,
  toSiegeRoster, toFieldInput, toClashInput, toHandCards, summariseResult,
  describeAction, describeMove, otherSide,
} = siege;

type Any = any;
const OUT = new URL("../../", import.meta.url).pathname;

function settings(): Any {
  return {
    id: 1, guildId: "pipeline", enabled: true, setupComplete: true,
    battleChannelId: null, logChannelId: null, turnTimerSeconds: 45, aiOfferSeconds: 60,
    hpBase: 750, hpPerRarity: 220, hpWorthDivisor: 40,
    attackBase: 85, attackPerRarity: 28, defenseBase: 55, defensePerRarity: 18, speedBase: 50,
    critChancePct: 12, critMultiplierPct: 180, missChancePct: 8, dodgeChancePct: 10, counterChancePct: 10,
    energyGainPerTurn: 20, chargeEnergyGain: 45, specialCost: 40, shieldStrengthPct: 40,
    ultimateChargePerTurn: 14, ultimateThreshold: 100, ultimateDamagePct: 260,
    minRarity: "common", maxRarity: "mythic", allowedTypes: null,
    specialCardsEnabled: true, stakingEnabled: true, aiEnabled: true,
    createdAt: new Date(), updatedAt: new Date(),
  };
}

const NAMES = ["Ronin Vega", "Iron Wake", "Ash Vanguard", "Null Seraph", "Grim Aurora", "Pale Lance", "Void Reaper"];
let seq = 0;
function combatant(side: 0 | 1, s: Any, rarity: string): Any {
  const card = { id: ++seq, name: NAMES[seq % NAMES.length], rarity, cardType: "tank", worthValue: 2500 };
  const stats = applyStatOverrides(deriveStats(card, s), null);
  return {
    userId: `p${side}`, displayName: `P${side}`, isAi: side === 1, side,
    cardId: card.id, cardName: card.name, cardRarity: rarity, cardType: "tank",
    cardImageUrl: null, stats, hp: stats.maxHealth, shield: 0, energy: 60, ultimate: 0, status: [],
    specialCardId: null, specialCardName: null, specialEffect: inferSpecialEffect("tank", rarity),
    specialCooldownMax: 3, specialCooldownRemaining: 0,
    itemId: "med_kit", itemChargesRemaining: 2, itemCooldownRemaining: 0,
    defending: false, nextAttackBoostPct: 0, doubleNextAttack: false,
    frozenTurns: 0, lastStandUsed: false,
  };
}

async function main(): Promise<void> {
  const s = settings();

  // ── Layer 1: Card Data → Siege Adapter ───────────────────────────────────
  const raw0 = ["rare", "legendary", "common", "epic", "uncommon", "rare"].map(r => combatant(0, s, r));
  const raw1 = ["epic", "rare", "legendary", "common", "uncommon"].map(r => combatant(1, s, r));
  const roster0 = toSiegeRoster(raw0), roster1 = toSiegeRoster(raw1);
  assert.equal(roster0.length, raw0.length, "adapter must not drop cards");
  const power = (c: Any) => c.stats.attack + c.stats.defense + c.stats.maxHealth / 10;
  for (let i = 1; i < roster0.length; i++) {
    assert.ok(power(roster0[i - 1]) >= power(roster0[i]), "roster must be strongest-first");
  }
  console.log(`✅ adapter: ${roster0.length} + ${roster1.length} cards ordered strongest-first`);

  // ── Layer 2: Battle State ────────────────────────────────────────────────
  const state = buildSiegeBattle({
    attacker: { name: "KaosRegulator", userId: "u0", isAi: false, roster: roster0, lp: 6100 },
    defender: { name: "Wraith King", userId: "AI", isAi: true, roster: roster1, lp: 5200 },
    settings: s,
  });
  assert.equal(state.teams[0].slots.length, 4, "board is four squares");
  assert.equal(state.teams[0].reserves.length, roster0.length - 4, "the rest go to reserve");
  assert.equal(state.teams[0].hand.length, 5, "commander draws an opening hand");
  console.log(`✅ state: 4 on the board, ${state.teams[0].reserves.length} in reserve, ${state.teams[0].hand.length} cards in hand, ${state.teams[0].lp} LP`);

  // ── Layer 3+4: Resolver → Events, over a full battle ─────────────────────
  let renderedClash = false, renderedField = false;
  let actions = 0, guard = 0;
  let firstHit: Any = null;

  while (state.phase !== "ended" && guard++ < 400) {
    startTurn(state);
    const action = chooseSiegeAction(state, "hard");
    if (action) {
      const foeSide = otherSide(state.activeSide);
      const result = resolveAction(state, action);
      actions++;

      // Every damaging event must carry a MEASURED number, not a parsed one.
      for (const hit of result.struck) {
        assert.ok(Number.isFinite(hit.before) && Number.isFinite(hit.damage), "struck deltas must be real numbers");
      }
      const sum = summariseResult(result, foeSide);
      assert.equal(sum.damage, result.damageDealt, "summary must report the engine's damage");

      if (!firstHit && sum.damage > 0 && action.kind !== "reinforce") {
        firstHit = { action, result, sum, foeSide, actorSlot: (action as Any).actorSlot };
      }
    }
    endTurn(state);
  }
  assert.ok(state.phase === "ended", "battle must terminate");
  assert.ok(actions > 10, "battle should take a meaningful number of actions");
  console.log(`✅ resolver: battle ran ${state.turn} turns / ${actions} actions → winner: ${state.teams[state.winner ?? 0].name}`);

  // ── Layer 5: Renderer, projected from a REAL resolved beat ───────────────
  assert.ok(firstHit, "expected at least one damaging action to render");
  const { sum, foeSide, actorSlot } = firstHit;

  // Rebuild a live board to project (the finished one is wiped).
  const live = buildSiegeBattle({
    attacker: { name: "KaosRegulator", userId: "u0", isAi: false, roster: toSiegeRoster(["rare","legendary","common","epic","uncommon"].map(r => combatant(0, s, r))), lp: 6100 },
    defender: { name: "Wraith King", userId: "AI", isAi: true, roster: toSiegeRoster(["epic","rare","legendary","common"].map(r => combatant(1, s, r))), lp: 5200 },
    settings: s,
  });
  startTurn(live);
  const liveAction = chooseSiegeAction(live, "hard");
  const liveResult = resolveAction(live, liveAction);
  const liveSum = summariseResult(liveResult, otherSide(live.activeSide));
  const proj = {
    actingSide: live.activeSide,
    actorSlot: (liveAction as Any).actorSlot ?? 0,
    targetSlot: liveSum.struckSlot ?? (liveAction as Any).targetSlot ?? 0,
    moveName: describeMove(live, liveAction),
    damage: liveSum.damage,
    isHit: liveSum.isHit,
    isCrit: liveSum.isCrit,
    ko: liveSum.ko,
    aoe: liveSum.aoe,
    struckBefore: liveSum.struckBefore,
    accent: 0x3d7fd6,
    arenaName: "Warzone Ruins",
    playingCardId: liveAction.kind === "siege_card" ? liveAction.cardId : undefined,
  };

  const hand = toHandCards(live, proj.actorSlot);
  assert.equal(hand.length, live.teams[live.activeSide].hand.length, "hand projection must cover the whole hand");
  console.log(`✅ bridge: hand projected (${hand.filter((h: Any) => !h.disabled).length}/${hand.length} playable under the resolver's own gate)`);

  const fieldInput = toFieldInput(live, proj);
  assert.equal(fieldInput.attackerLineup?.length, 4, "field projection draws all four blue squares");
  assert.equal(fieldInput.defenderLineup?.length, 4, "field projection draws all four red squares");

  const clashInput = toClashInput(live, proj);
  assert.ok(clashInput, "clash projection must build");
  assert.equal(clashInput!.attackerCommander.lp, live.teams[0].lp, "clash must show live LP");

  const fieldPng = await renderSiegeFieldStill(fieldInput);
  const clashPng = await renderCardClashStill(clashInput);
  renderedField = !!fieldPng; renderedClash = !!clashPng;
  if (fieldPng) writeFileSync(`${OUT}/siege-formation.png`, fieldPng);
  if (clashPng) writeFileSync(`${OUT}/siege-clash.png`, clashPng);

  assert.ok(renderedField, "formation battlefield failed to render");
  assert.ok(renderedClash, "card clash screen failed to render");
  console.log(`✅ renderer: formation (${fieldPng!.length} bytes) + clash (${clashPng!.length} bytes) both drew from live state`);
  console.log("\n✅ Full pipeline verified: Card Data → Adapter → State → Resolver → Events → Renderer");
}

await main();
