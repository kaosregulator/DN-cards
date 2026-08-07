// ─────────────────────────────────────────────────────────────────────────────
// HQ runtime validation.
//
//   pnpm --filter @workspace/scripts run validate:hq
//
// Asserts the invariants the HQ code relies on but TypeScript can't express:
// globally unique cosmetic ids (they all share one unlock ledger), a world
// blueprint that actually fits on the rendered landmass, a monotonic tier
// ladder, deterministic AI garrisons, and a build cursor that can never leave
// its grid. Mirrors scripts/src/rarity-runtime-validation.ts — plain Node
// asserts against the real runtime modules, no test framework.
// ─────────────────────────────────────────────────────────────────────────────

import assert from "node:assert/strict";

import {
  HQ_FACTIONS, HQ_TERRITORIES, HQ_ROUTES, PLAYER_BASE_ANCHORS,
  resolveFaction, getTerritory, tierProfile, tierStars,
} from "../../artifacts/api-server/src/bot/hq/defs/world.js";
import { HQ_WALLPAPERS, resolveWallpaper, DEFAULT_WALLPAPER_ID } from "../../artifacts/api-server/src/bot/hq/defs/wallpapers.js";
import { HQ_SURFACES, resolveSurface, surfacesFor } from "../../artifacts/api-server/src/bot/hq/defs/surfaces.js";
import { HQ_DECORATIONS } from "../../artifacts/api-server/src/bot/hq/defs/decorations.js";
import { HQ_WALLS } from "../../artifacts/api-server/src/bot/hq/defs/walls.js";
import { HQ_FLOORS } from "../../artifacts/api-server/src/bot/hq/defs/floors.js";
import { HQ_THEMES } from "../../artifacts/api-server/src/bot/hq/defs/themes.js";
import { HQ_ROOMS } from "../../artifacts/api-server/src/bot/hq/defs/rooms.js";
import { HQ_BACKDROPS } from "../../artifacts/api-server/src/bot/hq/defs/backdrops.js";
import { HQ_COMPANIONS } from "../../artifacts/api-server/src/bot/hq/defs/companions.js";
import { HQ_SKYBOXES, resolveSkybox, DEFAULT_SKYBOX_ID } from "../../artifacts/api-server/src/bot/hq/defs/skyboxes.js";
import { createDefaultFloorplan, sharedEdges } from "../../artifacts/api-server/src/bot/hq/defs/floorplan.js";
import { buildGarrison, territoryTributeOwed, WORLD_TRIBUTE_CAP_HOURS } from "../../artifacts/api-server/src/bot/hq/world.js";
import { readCursor, clampCursor, cursorLabel } from "../../artifacts/api-server/src/bot/hq/build-state.js";
import { MAX_RECT_SPAN, MAX_ELEVATION } from "../../artifacts/api-server/src/bot/hq/terrain.js";
import {
  SIEGE_MODES, SIEGE_LIMITS, DEFAULT_SIEGE_MODE, DEFAULT_SIEGE_CONFIG,
  resolveSiegeMode, siegeModeMeta,
} from "../../artifacts/api-server/src/bot/hq/settings.js";
import { HQ_GRID, HQ_BASE_GRID } from "../../artifacts/api-server/src/bot/hq/grid.js";
import { buildRarityRankMap, type RarityContext } from "../../artifacts/api-server/src/bot/rarity-runtime.js";
import { BUILTIN_RARITIES } from "../../artifacts/api-server/src/bot/cards-data.js";

let checks = 0;
function check(label: string, fn: () => void): void {
  fn();
  checks++;
  console.log(`  ✓ ${label}`);
}

console.log("HQ registries");

// Every cosmetic id lands in the SAME hq_unlocks ledger, keyed only by item_id.
// Two GATED items sharing an id would therefore cross-wire: earning one would
// silently grant the other. Two items that are both `always` share nothing but
// a name, so those are reported and allowed (floor "grass" and backdrop "grass"
// have collided harmlessly since before this ledger had more than one kind).
check("no two GATED cosmetics share an id across registries", () => {
  interface Entry { registry: string; gated: boolean }
  const seen = new Map<string, Entry>();
  const benign: string[] = [];
  const add = (list: { id: string; unlock: { kind: string } }[], registry: string) => {
    for (const item of list) {
      const gated = item.unlock.kind !== "always";
      const prev = seen.get(item.id);
      if (prev) {
        assert.ok(
          !prev.gated && !gated,
          `id "${item.id}" is in both ${prev.registry} and ${registry}, and at least one is gated — ` +
          "earning one would unlock the other",
        );
        benign.push(`${item.id} (${prev.registry} + ${registry})`);
        continue;
      }
      seen.set(item.id, { registry, gated });
    }
  };
  add(HQ_DECORATIONS, "decorations");
  add(HQ_ROOMS, "rooms");
  add(HQ_THEMES, "themes");
  add(HQ_WALLS, "walls");
  add(HQ_FLOORS, "floors");
  add(HQ_BACKDROPS, "backdrops");
  add(HQ_COMPANIONS, "companions");
  add(HQ_WALLPAPERS, "wallpapers");
  add(HQ_SURFACES, "surfaces");
  add(HQ_SKYBOXES, "skyboxes");
  if (benign.length > 0) console.log(`    (harmless always-unlocked id reuse: ${benign.join(", ")})`);
});

check("every registry resolves an unknown id to its default instead of throwing", () => {
  assert.equal(resolveWallpaper("does-not-exist").id, DEFAULT_WALLPAPER_ID);
  assert.equal(resolveWallpaper(null).id, DEFAULT_WALLPAPER_ID);
  assert.ok(resolveSurface("does-not-exist").id);
  assert.ok(resolveSurface(undefined).id);
  assert.equal(resolveSkybox("does-not-exist").id, DEFAULT_SKYBOX_ID);
  assert.equal(resolveSkybox(null).id, DEFAULT_SKYBOX_ID);
});

check("every room declares a purpose, bonuses, and category", () => {
  for (const r of HQ_ROOMS) {
    assert.ok(r.blurb.length > 10, `${r.id} missing description`);
    assert.ok(r.bonuses.length >= 1, `${r.id} needs at least one bonus`);
    assert.ok(r.category, `${r.id} missing category`);
    assert.ok(r.sizeLabel, `${r.id} missing sizeLabel`);
  }
});

check("skyboxes are optional open atmosphere, not room walls", () => {
  for (const s of HQ_SKYBOXES) {
    assert.match(s.skyTop, /^#[0-9a-f]{6}$/i, `${s.id} skyTop`);
    assert.match(s.skyHorizon, /^#[0-9a-f]{6}$/i, `${s.id} skyHorizon`);
    assert.ok(s.spriteKey.startsWith("skybox/"), `${s.id} spriteKey should be under skybox/`);
  }
});

check("default floorplan is connected (doors join starter zones)", () => {
  const fp = createDefaultFloorplan();
  assert.ok(fp.zones.filter(z => z.unlocked).length >= 3, "starter has multiple unlocked zones");
  assert.ok(fp.openings.some(o => o.kind === "door"), "starter has at least one door");
  const cc = fp.zones.find(z => z.id === "entrance")!;
  const hall = fp.zones.find(z => z.id === "hallway-main")!;
  assert.ok(sharedEdges(cc.rect, hall.rect).length > 0, "CC shares an edge with hallway");
});

check("wallpapers declare sane repeats and a default that stays plain", () => {
  for (const w of HQ_WALLPAPERS) {
    assert.ok(w.repeatX >= 1 && w.repeatX <= 24, `${w.id} repeatX out of range`);
    assert.ok(w.repeatY >= 1 && w.repeatY <= 24, `${w.id} repeatY out of range`);
    assert.match(w.base, /^#[0-9a-f]{6}$/i, `${w.id} base is not a hex colour`);
    assert.match(w.accent, /^#[0-9a-f]{6}$/i, `${w.id} accent is not a hex colour`);
  }
  assert.equal(resolveWallpaper(DEFAULT_WALLPAPER_ID).motif, "plain");
});

check("every build material is usable somewhere and fits the lattice", () => {
  const indoor = new Set(surfacesFor("indoor").map(s => s.id));
  const outdoor = new Set(surfacesFor("outdoor").map(s => s.id));
  for (const s of HQ_SURFACES) {
    assert.ok(indoor.has(s.id) || outdoor.has(s.id), `${s.id} is usable in neither space`);
    assert.ok(s.height >= 0 && s.height <= MAX_ELEVATION, `${s.id} default height exceeds the cap`);
    assert.match(s.base, /^#[0-9a-f]{6}$/i, `${s.id} base is not a hex colour`);
    assert.match(s.shade, /^#[0-9a-f]{6}$/i, `${s.id} shade is not a hex colour`);
  }
});

console.log("World blueprint");

check("territory ids are unique and every faction reference resolves", () => {
  const ids = new Set<string>();
  for (const t of HQ_TERRITORIES) {
    assert.ok(!ids.has(t.id), `duplicate territory id "${t.id}"`);
    ids.add(t.id);
    assert.equal(getTerritory(t.id)?.id, t.id);
    const faction = HQ_FACTIONS.find(f => f.id === t.factionId);
    assert.ok(faction, `territory "${t.id}" references unknown faction "${t.factionId}"`);
    assert.equal(resolveFaction(t.factionId).id, t.factionId);
  }
});

// The renderer places a marker at (u,v) on a normalised island; anything much
// past |u|+|v| ≈ 1 falls into the sea.
check("every territory and base anchor lands on the landmass", () => {
  for (const t of HQ_TERRITORIES) {
    assert.ok(Math.abs(t.u) <= 0.8, `${t.id} u=${t.u} is off the map`);
    assert.ok(Math.abs(t.v) <= 0.8, `${t.id} v=${t.v} is off the map`);
  }
  for (const [i, a] of PLAYER_BASE_ANCHORS.entries()) {
    assert.ok(Math.abs(a.u) <= 0.8 && Math.abs(a.v) <= 0.8, `base anchor ${i} is off the map`);
  }
});

check("every trade route joins two real territories", () => {
  const ids = new Set(HQ_TERRITORIES.map(t => t.id));
  for (const [a, b] of HQ_ROUTES) {
    assert.ok(ids.has(a), `route references unknown territory "${a}"`);
    assert.ok(ids.has(b), `route references unknown territory "${b}"`);
    assert.notEqual(a, b, "a route must join two different territories");
  }
});

check("tiers span the whole ladder and difficulty rises monotonically", () => {
  const tiers = new Set(HQ_TERRITORIES.map(t => t.tier));
  for (let tier = 1; tier <= 6; tier++) {
    assert.ok(tiers.has(tier), `no territory at tier ${tier} — the ladder has a gap`);
  }
  for (let tier = 2; tier <= 6; tier++) {
    const prev = tierProfile(tier - 1), cur = tierProfile(tier);
    assert.ok(cur.cardLevel > prev.cardLevel, `tier ${tier} garrison is not stronger than tier ${tier - 1}`);
    assert.ok(cur.bounty > prev.bounty, `tier ${tier} pays no more than tier ${tier - 1}`);
    assert.ok(cur.tributePerHour > prev.tributePerHour, `tier ${tier} tribute is not higher`);
  }
  // Out-of-range tiers clamp instead of returning undefined.
  assert.equal(tierProfile(0).label, tierProfile(1).label);
  assert.equal(tierProfile(99).label, tierProfile(6).label);
  assert.equal(tierStars(3), "★★★☆☆☆");
});

check("garrison sizes stay inside what the siege renderer can draw", () => {
  for (const t of HQ_TERRITORIES) {
    assert.ok(t.garrison >= 1 && t.garrison <= 6, `${t.id} garrison of ${t.garrison} is out of range`);
  }
});

console.log("AI garrisons");

// A minimal rarity context on the default built-in ladder — enough for the
// garrison builder, which only reads `rankByKey`.
const rarityCtx: RarityContext = {
  guildId: "validation",
  profile: new Map(),
  customByCard: new Map(),
  customBySlug: new Map(),
  customs: [],
  order: [...BUILTIN_RARITIES],
  rankByKey: buildRarityRankMap([...BUILTIN_RARITIES], []),
  maxRank: BUILTIN_RARITIES.length - 1,
};
const pool = Array.from({ length: 24 }, (_, i) => ({
  id: i + 1,
  name: `Card ${i + 1}`,
  rarity: ["common", "uncommon", "rare", "epic", "legendary", "mythic"][i % 6]!,
  cardType: "attack",
  worthValue: 100 + i * 37,
  imageUrl: null,
}));

check("a garrison is deterministic per territory", () => {
  const t = getTerritory("cinderhal")!;
  const a = buildGarrison(t, pool, rarityCtx).map(c => c.id);
  const b = buildGarrison(t, pool, rarityCtx).map(c => c.id);
  assert.deepEqual(a, b, "the same castle fielded different defenders on two calls");
  assert.equal(a.length, t.garrison);
});

check("different territories field different garrisons", () => {
  const a = buildGarrison(getTerritory("cinderhal")!, pool, rarityCtx).map(c => c.id).join(",");
  const b = buildGarrison(getTerritory("nightspire")!, pool, rarityCtx).map(c => c.id).join(",");
  assert.notEqual(a, b, "two territories produced an identical garrison");
});

check("garrison strength scales with tier", () => {
  const low = buildGarrison(getTerritory("millford-post")!, pool, rarityCtx);
  const high = buildGarrison(getTerritory("solmarch")!, pool, rarityCtx);
  const avg = (cs: { level: number }[]) => cs.reduce((s, c) => s + c.level, 0) / cs.length;
  assert.ok(avg(high) > avg(low), "a capital's garrison is no stronger than an outpost's");
  assert.ok(high[0]!.starRank > low[0]!.starRank, "star rank does not rise with tier");
  for (const c of [...low, ...high]) {
    assert.ok(c.level >= 1 && c.level <= 100, `garrison card level ${c.level} is out of range`);
  }
});

check("an empty card pool yields an empty garrison rather than throwing", () => {
  assert.deepEqual(buildGarrison(getTerritory("cinderhal")!, [], rarityCtx), []);
});

console.log("Hold tribute");

check("tribute accrues by tier and is capped", () => {
  const now = new Date("2026-01-02T00:00:00Z");
  const oneHourAgo = new Date(now.getTime() - 3_600_000);
  assert.equal(territoryTributeOwed(1, oneHourAgo, now), tierProfile(1).tributePerHour);
  assert.equal(territoryTributeOwed(6, oneHourAgo, now), tierProfile(6).tributePerHour);
  // A base left uncollected for a month pays the cap, not a jackpot.
  const monthAgo = new Date(now.getTime() - 30 * 86_400_000);
  assert.equal(
    territoryTributeOwed(3, monthAgo, now),
    WORLD_TRIBUTE_CAP_HOURS * tierProfile(3).tributePerHour,
  );
  // A clock in the future can never pay out negative shards.
  assert.equal(territoryTributeOwed(3, new Date(now.getTime() + 3_600_000), now), 0);
});

console.log("Siege settings");

check("every siege mode resolves and an unknown one falls back to the default", () => {
  for (const m of SIEGE_MODES) {
    assert.equal(resolveSiegeMode(m.id), m.id, `mode "${m.id}" did not round-trip`);
    assert.ok(siegeModeMeta(m.id).label.length > 0, `mode "${m.id}" has no label`);
    // Discord caps a select option's description at 100 characters.
    assert.ok(m.blurb.length <= 100, `mode "${m.id}" blurb is too long for a select option`);
  }
  assert.equal(resolveSiegeMode("nonsense"), DEFAULT_SIEGE_MODE);
  assert.equal(resolveSiegeMode(null), DEFAULT_SIEGE_MODE);
  assert.equal(resolveSiegeMode(undefined), DEFAULT_SIEGE_MODE);
});

check("the default ruleset is the interactive assault and sits inside its own limits", () => {
  const d = DEFAULT_SIEGE_CONFIG;
  assert.equal(d.mode, "turn", "a fresh server should get the turn-for-turn siege");
  assert.ok(d.turnSeconds >= SIEGE_LIMITS.turnSeconds.min && d.turnSeconds <= SIEGE_LIMITS.turnSeconds.max);
  assert.ok(d.itemUses >= SIEGE_LIMITS.itemUses.min && d.itemUses <= SIEGE_LIMITS.itemUses.max);
  assert.ok(d.maxTurns >= SIEGE_LIMITS.maxTurns.min && d.maxTurns <= SIEGE_LIMITS.maxTurns.max);
});

console.log("Build cursor");

check("a stored cursor is clamped onto whichever grid it is read against", () => {
  // A cursor saved on the big outdoor grid, re-read against a small room.
  const cur = readCursor({ x: 9, y: 9, w: 8, h: 8, materialId: "pond", elevation: 9 }, "entrance", HQ_GRID);
  assert.ok(cur.x + cur.w <= HQ_GRID, "cursor runs off the room grid in X");
  assert.ok(cur.y + cur.h <= HQ_GRID, "cursor runs off the room grid in Y");
  assert.ok(cur.w <= MAX_RECT_SPAN && cur.h <= MAX_RECT_SPAN, "cursor exceeds the max span");
  assert.ok(cur.elevation <= MAX_ELEVATION, "cursor exceeds the max lift");
});

check("an unknown or missing material falls back to a real one", () => {
  const cur = readCursor({ materialId: "no-such-material" }, "base", HQ_BASE_GRID);
  assert.ok(HQ_SURFACES.some(s => s.id === cur.materialId), "cursor kept an unknown material");
  const empty = readCursor(undefined, "base", HQ_BASE_GRID);
  assert.ok(HQ_SURFACES.some(s => s.id === empty.materialId));
});

check("nudging past an edge clamps instead of going negative", () => {
  const base = readCursor({ x: 0, y: 0, w: 3, h: 2, materialId: "pond", elevation: 1 }, "base", HQ_BASE_GRID);
  const left = clampCursor({ ...base, x: base.x - 5 }, HQ_BASE_GRID);
  assert.equal(left.x, 0);
  const right = clampCursor({ ...base, x: HQ_BASE_GRID + 5 }, HQ_BASE_GRID);
  assert.equal(right.x, HQ_BASE_GRID - base.w);
  assert.ok(cursorLabel(base).includes("@ (0,0)"), `unexpected label: ${cursorLabel(base)}`);
});

console.log(`\nAll ${checks} HQ checks passed.`);
