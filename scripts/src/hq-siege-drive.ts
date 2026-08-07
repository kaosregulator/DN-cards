// ─────────────────────────────────────────────────────────────────────────────
// Drive a whole turn-for-turn siege, headlessly.
//
//   DATABASE_URL=… pnpm --filter @workspace/scripts run drive:siege [outDir]
//
// The siege runtime talks to Discord through exactly four calls (`editReply`,
// `fetchReply`, `deferUpdate` and `Message#edit`), so a small stand-in for those
// is enough to play a real assault from muster to result: the combat engine, the
// AI, the castle renderer and the two-embed board are all the production ones.
//
// It plays the siege, checks every board against Discord's payload limits, and
// writes the rendered castle frames out so the fight can be eyeballed.
// ─────────────────────────────────────────────────────────────────────────────

import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

import {
  startSiege, handleSiegeComponent, isSiegeTargetActive,
  type SiegeOutcome, type SiegeResultView,
} from "../../artifacts/api-server/src/bot/hq/siege-runtime.js";
import { buildSiegeSquad } from "../../artifacts/api-server/src/bot/hq/siege-battle.js";
import { getSiegeConfig, updateSiegeConfig } from "../../artifacts/api-server/src/bot/hq/settings.js";
import { getBattleSettings, updateBattleSettings } from "../../artifacts/api-server/src/bot/battle/config-engine.js";
import { getRarityContext } from "../../artifacts/api-server/src/bot/db.js";
import { resolveTheme } from "../../artifacts/api-server/src/bot/hq/defs/themes.js";
import type { HqBaseView } from "../../artifacts/api-server/src/bot/hq/render.js";
import type { OwnedBattleCard } from "../../artifacts/api-server/src/bot/battle/db.js";
import { BUILTIN_RARITIES } from "../../artifacts/api-server/src/bot/cards-data.js";

const GUILD = process.env["SIEGE_DRIVE_GUILD"] ?? "siege-drive-guild";
const ATTACKER = "cmdr-attacker";
const OUT = resolve(process.argv[2] ?? "/tmp/siege-drive");
mkdirSync(OUT, { recursive: true });

// ── Discord stand-ins ─────────────────────────────────────────────────────────
// Only the members the runtime actually touches. Every payload is captured so
// the checks below can inspect exactly what a player would have seen.

interface Payload {
  embeds?: unknown[];
  components?: unknown[];
  files?: { attachment: Buffer; name: string }[];
  content?: string | null;
}

const boards: Payload[] = [];
let ephemeralReplies = 0;

const fakeMessage = {
  async edit(payload: Payload) { boards.push(payload); return fakeMessage; },
};

function makeInteraction(userId = ATTACKER) {
  return {
    user: { id: userId, username: "Commander" },
    guildId: GUILD,
    async editReply(payload: Payload) { boards.push(payload); return fakeMessage; },
    async fetchReply() { return fakeMessage; },
    async deferUpdate() { /* no-op */ },
    async reply() { ephemeralReplies++; },
    async update(payload: Payload) { boards.push(payload); },
    guild: null,
    client: { users: { async fetch() { throw new Error("no DMs in the harness"); } } },
  };
}

// A button press: the runtime only reads `customId` and `user`, plus the
// deferUpdate/reply methods above.
async function press(customId: string): Promise<void> {
  const it = { ...makeInteraction(), customId, isButton: () => true, isStringSelectMenu: () => false };
  await handleSiegeComponent(it as never);
}

// ── Payload validation (the same limits smoke:hq enforces) ────────────────────
function checkBoard(label: string, p: Payload): void {
  const embeds = (p.embeds ?? []) as { toJSON(): Record<string, unknown> }[];
  assert.ok(embeds.length >= 1, `${label}: no embeds`);
  assert.ok(embeds.length <= 10, `${label}: too many embeds`);
  for (const e of embeds) {
    const j = e.toJSON() as {
      title?: string; description?: string;
      fields?: { name: string; value: string }[]; image?: { url: string };
    };
    assert.ok(!j.title || j.title.length <= 256, `${label}: embed title too long`);
    assert.ok(!j.description || j.description.length <= 4096, `${label}: embed description too long`);
    for (const f of j.fields ?? []) {
      assert.ok(f.name.length <= 256, `${label}: field name too long`);
      assert.ok(f.value.length <= 1024, `${label}: field "${f.name}" over 1024 chars`);
    }
    // Every attachment:// reference must have a matching file on the message.
    if (j.image?.url?.startsWith("attachment://")) {
      const want = j.image.url.slice("attachment://".length);
      assert.ok((p.files ?? []).some(f => f.name === want),
        `${label}: embed points at ${want} but it wasn't attached`);
    }
  }
  const rows = (p.components ?? []) as { toJSON(): { components: { type: number; custom_id?: string; options?: unknown[] }[] } }[];
  assert.ok(rows.length <= 5, `${label}: ${rows.length} action rows`);
  for (const r of rows) {
    const j = r.toJSON();
    assert.ok(j.components.length >= 1 && j.components.length <= 5, `${label}: bad row size`);
    for (const c of j.components) {
      if (c.type === 3) assert.ok((c.options ?? []).length >= 1, `${label}: empty select`);
      if (c.custom_id) assert.ok(c.custom_id.length <= 100, `${label}: custom_id too long`);
    }
  }
}

function embedJson(p: Payload, i: number) {
  const e = (p.embeds ?? [])[i] as { toJSON(): Record<string, unknown> } | undefined;
  return e?.toJSON() as {
    title?: string; description?: string; footer?: { text: string };
    fields?: { name: string; value: string }[]; image?: { url: string };
  } | undefined;
}

// ── A synthetic squad ─────────────────────────────────────────────────────────
function cards(prefix: string, n: number, level: number): OwnedBattleCard[] {
  return Array.from({ length: n }, (_, i) => ({
    id: (prefix === "atk" ? 100 : 200) + i,
    name: `${prefix === "atk" ? "Vanguard" : "Warden"} ${i + 1}`,
    rarity: BUILTIN_RARITIES[Math.min(BUILTIN_RARITIES.length - 1, 2 + (i % 3))]!,
    cardType: "attack",
    worthValue: 400 + i * 120,
    imageUrl: null,
    owned: 1,
    level,
    starRank: 1,
    config: null,
  }));
}

function baseView(): HqBaseView {
  return {
    ownerName: "Warden Keep",
    displayTitle: "Warden Keep",
    ownerAvatarUrl: null,
    theme: resolveTheme("command"),
    roomEmoji: "🏰", roomName: "Base", hqLevel: 12,
    subtitle: "Under siege",
    buildings: [{ role: "castle", spritePath: null }],
    defenders: [],
  };
}

// ── The run ───────────────────────────────────────────────────────────────────
async function main(): Promise<void> {
  // Keep the harness quick: no per-frame sleeps, no GIF encoding by default.
  await updateBattleSettings(GUILD, {
    enabled: true, frameDelayMs: 120,
    battleAnimationEnabled: true, battleSceneAnimated: false,
  });
  await updateSiegeConfig(GUILD, { mode: "turn", turnSeconds: 120, itemUses: 2, maxTurns: 40 });

  const settings = await getBattleSettings(GUILD);
  const siege = await getSiegeConfig(GUILD);
  const ctx = await getRarityContext(GUILD);
  assert.equal(siege.mode, "turn", "the guild should be configured for turn-for-turn sieges");

  // The attacker is stronger, so the assault should generally get there — but
  // the engine still decides it.
  const attackers = buildSiegeSquad(cards("atk", 4, 60), settings, GUILD, ctx, 0, ATTACKER, "Commander");
  const defenders = buildSiegeSquad(cards("def", 3, 34), settings, GUILD, ctx, 1, "warden", "Warden Keep", 20);

  let outcome: SiegeOutcome | null = null;
  const targetKey = `hq:base:${GUILD}:warden`;

  console.log("Muster");
  await startSiege(makeInteraction() as never, {
    guildId: GUILD, targetKey,
    starterId: ATTACKER, attackerName: "Commander",
    targetName: "Warden Keep", holderName: "Warden Keep · +20% fortified",
    accent: 0xc0392b,
    attackers, defenders, settings, siege,
    baseView: baseView(),
    champion: { slot: 0, cardId: 100, name: "Vanguard 1", artUrl: null, rarityColor: 0xf1c40f, basePath: null },
    applyOutcome: async (o: SiegeOutcome): Promise<SiegeResultView> => {
      outcome = o;
      return {
        title: o.attackerWon ? "⚔️ Base Captured!" : "🛡️ Base Defended!",
        description: o.attackerWon ? "The keep is yours." : "The walls held.",
        color: o.attackerWon ? 0x4fd06a : 0xc0392b,
        fields: [{ name: "💠 Loot", value: "**+220** shards", inline: true }],
      };
    },
  } as never);

  assert.ok(boards.length >= 1, "the muster board was never posted");
  const muster = boards[boards.length - 1]!;
  checkBoard("muster", muster);
  const musterEmbed = embedJson(muster, 0)!;
  assert.match(musterEmbed.title ?? "", /Muster/, "the first board should be the muster screen");
  assert.ok((muster.files ?? []).some(f => f.name === "siege-castle.png"), "muster should show the castle");
  assert.ok(isSiegeTargetActive(targetKey), "the target should be locked while the siege is open");
  writeFileSync(join(OUT, "01-muster.png"), muster.files![0]!.attachment);
  console.log(`  ✓ muster board — ${(muster.components ?? []).length} row(s), castle attached`);

  console.log("Assault");
  const beforeBegin = boards.length;
  await press(`hq-hub:ls:begin:${sessionId(muster)}`);
  assert.ok(boards.length > beforeBegin, "Begin Assault produced no board");

  // Play it out: attack every turn until the runtime clears its controls.
  let clicks = 0;
  let firstAssaultSaved = false;
  while (!outcome && clicks < 120) {
    const last = boards[boards.length - 1]!;
    const rows = (last.components ?? []) as { toJSON(): { components: { custom_id?: string }[] } }[];
    const ids = rows.flatMap(r => r.toJSON().components.map(c => c.custom_id ?? ""));
    const move = ids.find(id => id.endsWith(":attack"));
    if (!move) break;                       // controls cleared = the fight is over
    if (!firstAssaultSaved) {
      checkBoard("first assault turn", last);
      const top = embedJson(last, 0)!, bottom = embedJson(last, 1)!;
      assert.match(top.title ?? "", /Warden Keep/, "top embed should be the castle");
      assert.match(top.description ?? "", /destruction/, "top embed should carry the destruction meter");
      assert.ok((bottom.fields ?? []).some(f => /Turn \d/.test(f.name)), "bottom embed should show the turn");
      writeFileSync(join(OUT, "02-assault.png"), last.files![0]!.attachment);
      firstAssaultSaved = true;
      console.log(`  ✓ two-embed board — top "${top.title}", bottom shows ${(bottom.fields ?? []).length} field(s)`);
    }
    await press(move);
    clicks++;
  }

  assert.ok(outcome, `the siege never resolved after ${clicks} moves`);
  const o = outcome as SiegeOutcome;
  console.log(`  ✓ played ${clicks} commander move(s) over ${o.turns} turns`);

  // Every board along the way must have been a legal payload.
  boards.forEach((b, i) => checkBoard(`board ${i}`, b));
  console.log(`  ✓ all ${boards.length} boards are valid Discord payloads`);

  // Begin Assault first plays the heads/tails coin toss (same flow as /battle):
  // a couple of single-embed 🪙 boards deciding who strikes first, then combat.
  const postBegin = boards.slice(beforeBegin, -1).filter(b => (b.embeds ?? []).length > 0);
  const isCoinBoard = (b: Payload) => /🪙/.test(embedJson(b, 0)?.title ?? "");
  assert.ok(postBegin.some(isCoinBoard), "the coin toss never played before the assault");
  console.log("  ✓ coin toss played before the first exchange");

  // The two-embed layout must hold for the whole assault (coin-toss intro aside).
  const assaultBoards = postBegin.filter(b => !isCoinBoard(b));
  const twoEmbed = assaultBoards.filter(b => (b.embeds ?? []).length === 2).length;
  assert.ok(twoEmbed >= assaultBoards.length - 1,
    `expected the castle+battle pair on every assault board, got ${twoEmbed}/${assaultBoards.length}`);
  console.log(`  ✓ castle + battle embeds on ${twoEmbed}/${assaultBoards.length} assault boards`);

  // Destruction must be monotonic — a rank can never un-break.
  const pcts = assaultBoards
    .map(b => /(\d+)%/.exec(embedJson(b, 0)?.title ?? "")?.[1])
    .filter((v): v is string => !!v).map(Number);
  for (let i = 1; i < pcts.length; i++) {
    assert.ok(pcts[i]! >= pcts[i - 1]!, `destruction went backwards: ${pcts[i - 1]}% → ${pcts[i]}%`);
  }
  console.log(`  ✓ destruction rose monotonically ${pcts[0] ?? 0}% → ${pcts[pcts.length - 1] ?? 0}%`);

  console.log("Result");
  const final = boards[boards.length - 1]!;
  checkBoard("result", final);
  assert.equal((final.components ?? []).length, 0, "the result board should have no controls left");
  const resultEmbed = embedJson(final, 0)!;
  assert.ok((resultEmbed.description ?? "").includes("destruction"), "the result should report destruction");
  writeFileSync(join(OUT, "03-result.png"), final.files![0]!.attachment);
  console.log(`  ✓ "${resultEmbed.title}" — ${o.destructionPct}% · ${"★".repeat(o.stars)}${"☆".repeat(3 - o.stars)} · ` +
    `${o.defenderCardsLost}/${defenders.length} ranks broken · ${o.attackerCardsLost} card(s) lost`);

  // Sanity on the outcome itself.
  assert.ok(o.turns >= 1, "no turns were counted");
  assert.ok(o.destructionPct >= 0 && o.destructionPct <= 100, "destruction out of range");
  assert.ok(o.stars >= 0 && o.stars <= 3, "stars out of range");
  if (o.attackerWon) {
    assert.equal(o.destructionPct, 100, "a capture must be 100% destruction");
    assert.ok(o.stars >= 2, "a capture is worth at least two stars");
    assert.equal(o.defenderCardsLost, defenders.length, "a capture must break every rank");
  } else {
    assert.ok(o.stars <= 1, "a failed assault can't earn more than one star");
  }
  assert.ok(!isSiegeTargetActive(targetKey), "the target lock should be released when the siege ends");
  console.log("  ✓ outcome is self-consistent and the target lock was released");
  console.log(`  ✓ ${ephemeralReplies} ephemeral reply(ies) — no stray error paths`);

  // ── Send them in (skip / auto-resolve) ──────────────────────────────────────
  // The other muster exit: hand the whole assault to the AI. It must resolve in
  // ONE press (no move loop, no board renders) and end on a controls-free result.
  console.log("Send-off (skip)");
  const pool = buildSiegeSquad(cards("atk", 6, 60), settings, GUILD, ctx, 0, ATTACKER, "Commander");
  const skipDefenders = buildSiegeSquad(cards("def", 3, 30), settings, GUILD, ctx, 1, "warden2", "Outpost", 10);
  const skipKey = `hq:base:${GUILD}:warden2`;
  let skipOutcome: SiegeOutcome | null = null;
  await startSiege(makeInteraction() as never, {
    guildId: GUILD, targetKey: skipKey,
    starterId: ATTACKER, attackerName: "Commander",
    targetName: "Outpost", holderName: "Outpost",
    accent: 0xc0392b,
    attackers: pool.slice(0, skipDefenders.length), attackerPool: pool, defenders: skipDefenders, settings, siege,
    baseView: baseView(),
    champion: { slot: 0, cardId: 100, name: "Vanguard 1", artUrl: null, rarityColor: 0xf1c40f, basePath: null },
    applyOutcome: async (o: SiegeOutcome): Promise<SiegeResultView> => {
      skipOutcome = o;
      return { title: o.attackerWon ? "⚔️ Captured!" : "🛡️ Held!", description: `${o.destructionPct}% destruction.`, color: 0x4fd06a };
    },
  } as never);
  const skipMuster = boards[boards.length - 1]!;
  const skipIds = ((skipMuster.components ?? []) as { toJSON(): { components: { custom_id?: string }[] } }[])
    .flatMap(r => r.toJSON().components.map(c => c.custom_id ?? ""));
  assert.ok(skipIds.some(id => id.includes(":skip:")), "the muster should offer a Send-them-in button");
  assert.ok(skipIds.some(id => id.includes(":column:")), "the muster should offer a Choose-column button when a roster is available");
  const beforeSkip = boards.length;
  await press(`hq-hub:ls:skip:${sessionId(skipMuster)}`);
  assert.ok(skipOutcome, "the send-off never resolved");
  const so = skipOutcome as SiegeOutcome;
  assert.ok(so.turns >= 1, "the send-off counted no turns");
  // Headless: it resolves without walking the board turn-by-turn.
  assert.ok(boards.length - beforeSkip <= 3, `a headless siege should not render every turn (produced ${boards.length - beforeSkip} boards)`);
  const skipFinal = boards[boards.length - 1]!;
  assert.equal((skipFinal.components ?? []).length, 0, "the send-off result should have no controls");
  assert.ok(!isSiegeTargetActive(skipKey), "the send-off should release its target lock");
  console.log(`  ✓ resolved in one press over ${so.turns} turns → "${embedJson(skipFinal, 0)?.title}" (${so.destructionPct}%)`);

  console.log(`\nSiege played end to end. Boards written to ${OUT}`);
  process.exit(0);
}

// The runtime stamps its session id into every customId; read it back off the
// muster board rather than reaching into the module's private state.
function sessionId(p: Payload): string {
  const rows = (p.components ?? []) as { toJSON(): { components: { custom_id?: string }[] } }[];
  for (const r of rows) {
    for (const c of r.toJSON().components) {
      const m = /^hq-hub:ls:[a-z]+:([0-9a-f]+)/.exec(c.custom_id ?? "");
      if (m) return m[1]!;
    }
  }
  throw new Error("could not find a siege session id on the muster board");
}

void main();
