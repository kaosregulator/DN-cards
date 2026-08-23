// HQ siege runtime — load & surface smoke test.
//
// The engine rules are covered by sim:siege and the full chain by sim:pipeline.
// This is the cheap guard that the RUNTIME module — which wires the engine into
// Discord — still imports cleanly (every import path resolves, no load-time
// throw) and exposes the surface the bot's command router calls. A broken import
// or a renamed export here would otherwise only surface at bot boot.
//
// Run:  pnpm --filter @workspace/scripts run sim:runtime
process.env.DATABASE_URL ||= "postgres://siege-runtime";
process.env.HQ_ASSETS_DIR ||= new URL("../../artifacts/api-server/assets/hq", import.meta.url).pathname;

import assert from "node:assert/strict";

const base = "../../artifacts/api-server/src/bot";

// The command router imports exactly these from the runtime.
const runtime = await import(`${base}/hq/siege-runtime.js`) as any;
for (const name of ["startSiege", "handleSiegeComponent", "isSiegeTargetActive"]) {
  assert.equal(typeof runtime[name], "function", `runtime must export ${name}()`);
}

// The siege engine surface the runtime and adapter depend on.
const siege = await import(`${base}/siege/index.js`) as any;
for (const name of [
  "buildSiegeBattle", "startTurn", "enterMainPhase", "endTurn", "resolveAction", "checkAction",
  "chooseSiegeAction", "legalActions", "toSiegeRoster", "toFieldInput",
  "toClashInput", "summariseResult", "describeAction", "getSiegeCard",
  "listSiegeCards", "buildSiegeDeck", "defaultMaxTurns",
]) {
  assert.equal(typeof siege[name], "function", `siege engine must export ${name}()`);
}

// The two renderers the runtime drives.
const anim = await import(`${base}/animations/index.js`) as any;
for (const name of ["renderSiegeField", "renderSiegeFieldStill", "renderCardClash", "renderCardClashStill"]) {
  assert.equal(typeof anim[name], "function", `animations must export ${name}()`);
}

// The card library is non-empty and every card is internally consistent.
const cards = siege.listSiegeCards();
assert.ok(cards.length >= 12, "expected a full Siege Battle Card library");
for (const c of cards) {
  assert.ok(c.id && c.name && c.effect && c.target, `malformed siege card: ${JSON.stringify(c)}`);
  assert.ok(c.energyCost >= 0 && c.copies >= 1, `bad card economy: ${c.id}`);
  assert.ok(["red","blue","green","yellow","purple"].includes(siege.schoolColor(c.school)), `bad school colour: ${c.id}`);
}

// isSiegeTargetActive is a safe query on an unknown key.
assert.equal(runtime.isSiegeTargetActive("nope"), false, "unknown target must read as inactive");

// Draw / Main phase contract: startTurn stays in DRAW; enterMainPhase opens MAIN.
{
  const { deriveStats, applyStatOverrides } = await import(`${base}/battle/stat-engine.js`) as any;
  const { inferSpecialEffect } = await import(`${base}/battle/special-cards.js`) as any;
  const settings = {
    id: 1, guildId: "phase", enabled: true, setupComplete: true,
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
  const mk = (side: 0 | 1) => {
    const card = { id: side + 1, name: `P${side}`, rarity: "rare", cardType: "tank", worthValue: 100 };
    const stats = applyStatOverrides(deriveStats(card, settings), null);
    return {
      userId: `u${side}`, displayName: `P${side}`, isAi: true, side,
      cardId: card.id, cardName: card.name, cardRarity: "rare", cardType: "tank",
      cardImageUrl: null, stats, hp: stats.maxHealth, shield: 0, energy: 40, ultimate: 0, status: [],
      specialCardId: null, specialCardName: null, specialEffect: inferSpecialEffect("tank", "rare"),
      specialCooldownMax: 3, specialCooldownRemaining: 0,
      itemId: null, itemChargesRemaining: 0, itemCooldownRemaining: 0,
      defending: false, nextAttackBoostPct: 0, doubleNextAttack: false,
      frozenTurns: 0, lastStandUsed: false,
    };
  };
  const roster = (side: 0 | 1) => Array.from({ length: 4 }, () => mk(side));
  const state = siege.buildSiegeBattle({
    attacker: { name: "A", userId: "u0", isAi: true, roster: roster(0) },
    defender: { name: "B", userId: "AI", isAi: true, roster: roster(1) },
    settings,
  });
  assert.equal(state.phase, "draw", "fresh battle starts in DRAW");
  const blocked = siege.checkAction(state, { kind: "move", actorSlot: 0, move: "attack", targetSlot: 0 });
  assert.equal(blocked.ok, false, "combat actions must be illegal during DRAW");
  const opening = siege.startTurn(state);
  assert.equal(state.phase, "draw", "startTurn must stay in DRAW for the draw beat");
  assert.ok(Array.isArray(opening.drawnCards), "startTurn must report drawnCards");
  assert.equal(siege.checkAction(state, { kind: "move", actorSlot: 0, move: "attack", targetSlot: 0 }).ok, false,
    "combat still illegal after draw refill");
  siege.enterMainPhase(state);
  assert.equal(state.phase, "main", "enterMainPhase must open MAIN");
  const legal = siege.legalActions(state);
  assert.ok(legal.length > 0, "MAIN phase must expose legal actions");
  console.log("✅ draw/main phase contract held.");
}

console.log(`✅ runtime module loaded — ${cards.length} siege cards, all exports present.`);
console.log("✅ engine, adapter, renderer and runtime surfaces intact.");
