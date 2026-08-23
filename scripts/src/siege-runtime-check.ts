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
  "buildSiegeBattle", "startTurn", "endTurn", "resolveAction", "checkAction",
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

console.log(`✅ runtime module loaded — ${cards.length} siege cards, all exports present.`);
console.log("✅ engine, adapter, renderer and runtime surfaces intact.");
