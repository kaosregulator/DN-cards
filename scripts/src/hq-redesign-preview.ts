// Focused HQ redesign preview — outdoor atmosphere + furnished rooms.
//   pnpm --filter @workspace/scripts exec tsx src/hq-redesign-preview.ts [outDir]

import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { renderHq, renderBase, type HqRenderView, type HqBaseView } from "../../artifacts/api-server/src/bot/hq/render.js";
import { resolveTheme } from "../../artifacts/api-server/src/bot/hq/defs/themes.js";
import { resolveWall } from "../../artifacts/api-server/src/bot/hq/defs/walls.js";
import { resolveFloor } from "../../artifacts/api-server/src/bot/hq/defs/floors.js";
import { resolveSkybox, HQ_SKYBOXES } from "../../artifacts/api-server/src/bot/hq/defs/skyboxes.js";
import { HQ_ROOMS } from "../../artifacts/api-server/src/bot/hq/defs/rooms.js";
import { spriteForPrefix } from "../../artifacts/api-server/src/bot/hq/assets.js";

const outDir = resolve(process.argv[2] ?? "/opt/cursor/artifacts/hq-full-redesign");
mkdirSync(outDir, { recursive: true });

const theme = resolveTheme("command");
const header = {
  ownerAvatarUrl: null as string | null,
  theme,
  hqLevel: 10,
};

function save(name: string, buf: Buffer | null): void {
  if (!buf) { console.error(`  ✗ ${name}`); process.exitCode = 1; return; }
  writeFileSync(join(outDir, name), buf);
  console.log(`  ✓ ${name} — ${(buf.length / 1024).toFixed(0)} KiB`);
}

async function previewOutdoor(): Promise<void> {
  console.log("outdoor…");
  const base = (skyId: string, opts: Partial<HqBaseView> = {}): HqBaseView => ({
    ...header,
    ownerName: "pengu1n",
    displayTitle: "Kaos base",
    subtitle: opts.shieldActive ? "held by pengu1n · shield on" : "held by pengu1n",
    roomEmoji: "🏰", roomName: "Base",
    buildings: [{ role: "castle", spritePath: spriteForPrefix("building", "castle") }],
    defenders: [],
    visitors: 3,
    skybox: resolveSkybox(skyId),
    ...opts,
  });

  save("01-base-sunny-day.png", await renderBase(base("skybox-clouds", { shieldActive: true })));
  save("01b-base-no-shield.png", await renderBase(base("skybox-clouds")));
  save("02-base-edit-grid.png", await renderBase(base("skybox-clouds", {
    showGrid: true,
    cursor: { x: 3, y: 4, w: 2, h: 2, color: 0x2fd4d4, label: "Tree · 2×2", valid: true },
  })));
  save("03-base-night.png", await renderBase(base("skybox-night")));
  save("04-base-space.png", await renderBase(base("skybox-space")));
  save("05-base-volcano.png", await renderBase(base("skybox-volcano")));
  save("06-base-winter.png", await renderBase(base("skybox-winter")));
  save("07-base-desert.png", await renderBase(base("skybox-desert")));
  save("08-base-ocean.png", await renderBase(base("skybox-ocean")));
}

async function previewRooms(): Promise<void> {
  console.log("rooms…");
  const wallFor: Record<string, string> = {
    entrance: "castle",
    "trophy-hall": "marble-wall",
    atrium: "scifi",
    "hall-of-fame": "stone",
    armory: "bunker",
    barracks: "wood",
    treasury: "marble-wall",
    workshop: "wood",
    storage: "wood",
    "arcane-vault": "magical",
  };
  for (const room of HQ_ROOMS) {
    const view: HqRenderView = {
      ...header,
      ownerName: "pengu1n",
      displayTitle: "Kaos base",
      subtitle: `${room.name} · furnished blueprint`,
      roomEmoji: room.emoji,
      roomName: room.name,
      roomId: room.id,
      wall: resolveWall(wallFor[room.id] ?? "stone"),
      floor: resolveFloor(room.id === "treasury" || room.id === "arcane-vault" ? "marble" : "tile"),
      pedestals: room.pedestals > 0 ? Array.from({ length: room.pedestals }, () => null) : [],
      decorations: [],
      visitors: 2,
      skybox: resolveSkybox("skybox-clouds"),
    };
    save(`room-${room.id}.png`, await renderHq(view));
  }

  // Same room, different skyboxes — architecture unchanged.
  console.log("skybox-only atmosphere…");
  for (const id of ["skybox-clouds", "skybox-night", "skybox-volcano", "skybox-space"]) {
    const sb = resolveSkybox(id);
    save(`room-entrance-sky-${sb.id}.png`, await renderHq({
      ...header,
      ownerName: "pengu1n",
      displayTitle: "Kaos base",
      subtitle: `Command Center · skybox ${sb.name}`,
      roomEmoji: "🎛️", roomName: "Command Center", roomId: "entrance",
      wall: resolveWall("castle"),
      floor: resolveFloor("stone"),
      pedestals: [],
      decorations: [],
      visitors: 2,
      skybox: sb,
    }));
  }
}

async function main(): Promise<void> {
  console.log(`HQ full redesign preview → ${outDir}`);
  console.log(`(${HQ_SKYBOXES.length} skyboxes, ${HQ_ROOMS.length} rooms)`);
  await previewOutdoor();
  await previewRooms();
  console.log("done.");
}

void main();
