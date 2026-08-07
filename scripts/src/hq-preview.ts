// ─────────────────────────────────────────────────────────────────────────────
// HQ visual preview harness.
//
// Renders every HQ canvas — the campaign world map, the siege cinematic, a
// wallpapered room, a landscaped room and the outdoor grounds with the build
// cursor — straight to PNG/GIF files, with no database and no Discord.
//
//   pnpm --filter @workspace/scripts run hq:preview [outDir]
//
// This is how you iterate on the art: change a registry or a painter, re-run,
// look at the files. It exercises the real renderers, so if it produces a good
// frame the bot will too.
// ─────────────────────────────────────────────────────────────────────────────

import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { renderWorldMap, type WorldMarker } from "../../artifacts/api-server/src/bot/hq/render-world.js";
import { renderSiegeCinematic, renderCinematicStill } from "../../artifacts/api-server/src/bot/hq/cinematic.js";
import { renderHq, renderBase, type HqRenderView, type HqBaseView } from "../../artifacts/api-server/src/bot/hq/render.js";
import { resolveTheme } from "../../artifacts/api-server/src/bot/hq/defs/themes.js";
import { resolveWall } from "../../artifacts/api-server/src/bot/hq/defs/walls.js";
import { resolveFloor } from "../../artifacts/api-server/src/bot/hq/defs/floors.js";
import { resolveWallpaper, HQ_WALLPAPERS } from "../../artifacts/api-server/src/bot/hq/defs/wallpapers.js";
import {
  HQ_TERRITORIES, HQ_ROUTES, resolveFaction, PLAYER_BASE_ANCHORS,
} from "../../artifacts/api-server/src/bot/hq/defs/world.js";
import type { HqTerrainFeature } from "../../artifacts/api-server/src/bot/hq/render-terrain.js";

const outDir = resolve(process.argv[2] ?? "./hq-preview");
mkdirSync(outDir, { recursive: true });

const theme = resolveTheme("command");
const header = {
  ownerAvatarUrl: null,
  theme,
  hqLevel: 14,
};

function save(name: string, buf: Buffer | null): void {
  if (!buf) { console.error(`  ✗ ${name} — renderer returned null`); process.exitCode = 1; return; }
  const path = join(outDir, name);
  writeFileSync(path, buf);
  console.log(`  ✓ ${name} — ${(buf.length / 1024).toFixed(0)} KiB`);
}

// ── World map: mostly AI-held, two territories taken by members ───────────────
async function previewWorld(): Promise<void> {
  console.log("world map…");
  // Pretend the viewer took the two easiest territories and a rival took a third.
  const mine = new Set(["millford-post", "greenhollow"]);
  const theirs = new Set(["harrow-watch"]);
  const markers: WorldMarker[] = HQ_TERRITORIES.map(t => {
    const faction = resolveFaction(t.factionId);
    const heldByYou = mine.has(t.id);
    const held = heldByYou || theirs.has(t.id);
    return {
      nodeId: t.id,
      name: t.name,
      factionShort: faction.short,
      color: heldByYou ? 0x4fd06a : held ? 0x4aa3ff : faction.color,
      tier: t.tier,
      biome: t.biome,
      u: t.u, v: t.v,
      structure: t.structure,
      garrison: t.garrison,
      kind: "territory",
      held,
      heldByYou,
      shielded: t.id === "coldgate",
    };
  });
  // A few member bases on the southern coast.
  ["Ironvale", "Duskhaven", "Redmoor"].forEach((name, i) => {
    const a = PLAYER_BASE_ANCHORS[i]!;
    markers.push({
      nodeId: `base:${i}`, name, factionShort: "Member base",
      color: [0x3f78c8, 0x9b59b6, 0xe67e22][i]!, tier: 3, biome: "plains",
      u: a.u, v: a.v, structure: "houses", garrison: 3 + i,
      kind: "base", held: false, heldByYou: false, shielded: false,
    });
  });

  save("world-map.png", await renderWorldMap({
    ...header,
    displayTitle: "World Map",
    subtitle: `${HQ_TERRITORIES.length - mine.size - theirs.size} AI territories · 3 member bases`,
    roomEmoji: "🗺️", roomName: "World",
    markers, routes: HQ_ROUTES,
  }));
}

// ── Siege cinematic ───────────────────────────────────────────────────────────
async function previewCinematic(): Promise<void> {
  console.log("siege cinematic…");
  const cards = [
    { name: "Vanguard Rook", artUrl: null, rarityColor: 0xf1c40f },
    { name: "Ash Lieutenant", artUrl: null, rarityColor: 0x9b59b6 },
    { name: "Ironclad", artUrl: null, rarityColor: 0x3498db },
    { name: "Sable Scout", artUrl: null, rarityColor: 0x2ecc71 },
  ];
  const ashen: Parameters<typeof renderSiegeCinematic>[0] = {
    targetName: "Cinderhal Citadel",
    holderName: "The Ashen Legion",
    defenderColor: 0xc0392b,
    attackerColor: 0xb7a24a,
    attackerName: "Darknight",
    cards,
    garrison: 5,
    structure: "castle",
    mood: "ash",
    tagline: "The Legion's forward capital. Smoke visible for three days' ride.",
  };
  save("siege-cinematic-dusk.gif", await renderSiegeCinematic(ashen));
  // One still per beat, so each stage of the film can be checked frame by frame.
  const beats: [string, number][] = [
    ["1-arrival", 0.12], ["2-muster", 0.32], ["3-cards", 0.55],
    ["4-deploy", 0.76], ["5-engage", 0.95],
  ];
  for (const [name, t] of beats) {
    save(`cinematic-beat-${name}.png`, await renderCinematicStill(ashen, t));
  }
  save("siege-cinematic-snow.gif", await renderSiegeCinematic({
    targetName: "Rimewall Bastion",
    holderName: "Frostbound Clans",
    defenderColor: 0x5dade2,
    attackerColor: 0x9b59b6,
    attackerName: "Darknight",
    cards: cards.slice(0, 3),
    garrison: 5,
    structure: "castle",
    mood: "snow",
    tagline: "Ice-clad curtain walls, never breached in winter.",
  }));
}

// ── Rooms: real wallpaper + built terrain + the build cursor ──────────────────
function roomView(overrides: Partial<HqRenderView>): HqRenderView {
  return {
    ...header,
    ownerName: "Darknight",
    displayTitle: "Darknight's HQ",
    subtitle: "Trophy Hall · 3/5 featured",
    roomEmoji: "🏆", roomName: "Trophy Hall",
    wall: resolveWall("plaster"),
    floor: resolveFloor("wood"),
    pedestals: [null, null, null],
    decorations: [],
    ...overrides,
  };
}

async function previewRooms(): Promise<void> {
  console.log("rooms…");
  // One image per wallpaper is overkill; render a representative spread.
  for (const id of ["royal-damask", "rose-floral", "red-brick", "neon-hex"]) {
    const wp = resolveWallpaper(id);
    save(`room-wallpaper-${id}.png`, await renderHq(roomView({
      wallpaper: wp,
      subtitle: `Wallpaper · ${wp.name}`,
    })));
  }

  // A landscaped room: a carpet runner, a raised plinth and an indoor pond.
  const terrain: HqTerrainFeature[] = [
    { id: 1, materialId: "marble-inlay", x: 1, y: 1, w: 6, h: 6, elevation: 0, z: 1 },
    { id: 2, materialId: "red-carpet", x: 3, y: 0, w: 2, h: 8, elevation: 0, z: 2 },
    { id: 3, materialId: "pond", x: 1, y: 5, w: 2, h: 2, elevation: 1, z: 3 },
    { id: 4, materialId: "stone-plinth", x: 5, y: 5, w: 2, h: 2, elevation: 2, z: 4 },
  ];
  save("room-terrain.png", await renderHq(roomView({
    wallpaper: resolveWallpaper("sage-panel"),
    floor: resolveFloor("tile"),
    terrain,
    subtitle: "Built surfaces · marble, carpet, pond, plinth",
  })));

  save("room-build-cursor.png", await renderHq(roomView({
    wallpaper: resolveWallpaper("harlequin"),
    floor: resolveFloor("tile"),
    terrain,
    cursor: { x: 4, y: 2, w: 3, h: 2, color: 0x2fd4d4, label: "💧 Pond · 3×2 @ (4,2)", valid: true },
    subtitle: "Build mode",
  })));
}

// ── Outdoor grounds: hills, water and paths on the base lattice ───────────────
async function previewBase(): Promise<void> {
  console.log("base grounds…");
  const terrain: HqTerrainFeature[] = [
    { id: 1, materialId: "grass-hill", x: 1, y: 5, w: 3, h: 3, elevation: 3, z: 1 },
    { id: 2, materialId: "deep-water", x: 6, y: 5, w: 3, h: 3, elevation: 2, z: 2 },
    { id: 3, materialId: "stone-path", x: 4, y: 4, w: 2, h: 5, elevation: 0, z: 3 },
    { id: 4, materialId: "dirt-bump", x: 2, y: 2, w: 2, h: 2, elevation: 1, z: 4 },
    { id: 5, materialId: "wood-deck", x: 6, y: 1, w: 3, h: 2, elevation: 1, z: 5 },
  ];
  const base: HqBaseView = {
    ...header,
    ownerName: "Darknight",
    displayTitle: "Darknight's Hold",
    subtitle: "Base · landscaped grounds",
    roomEmoji: "🏰", roomName: "Base",
    buildings: [{ role: "castle", spritePath: null }],
    defenders: [],
    terrain,
  };
  save("base-terrain.png", await renderBase(base));
  save("base-build-cursor.png", await renderBase({
    ...base,
    subtitle: "Base · build mode",
    cursor: { x: 3, y: 7, w: 3, h: 2, color: 0x2fd4d4, label: "⛰️ Grass Hill · 3×2 @ (3,7)", valid: true },
  }));
}

async function main(): Promise<void> {
  console.log(`HQ preview → ${outDir}`);
  console.log(`(${HQ_WALLPAPERS.length} wallpapers, ${HQ_TERRITORIES.length} territories registered)`);
  await previewWorld();
  await previewRooms();
  await previewBase();
  await previewCinematic();
  console.log("done.");
}

void main();
