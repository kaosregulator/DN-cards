// Fresh HQ miniverse preview — outdoor giant walls + tactical rooms.
//   pnpm --filter @workspace/scripts exec tsx src/hq-redesign-preview.ts [outDir]

import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { renderHq, renderBase, type HqRenderView, type HqBaseView } from "../../artifacts/api-server/src/bot/hq/render.js";
import { resolveTheme } from "../../artifacts/api-server/src/bot/hq/defs/themes.js";
import { resolveWall } from "../../artifacts/api-server/src/bot/hq/defs/walls.js";
import { resolveFloor } from "../../artifacts/api-server/src/bot/hq/defs/floors.js";
import { resolveSkybox } from "../../artifacts/api-server/src/bot/hq/defs/skyboxes.js";
import { HQ_ROOMS } from "../../artifacts/api-server/src/bot/hq/defs/rooms.js";
import { spriteForPrefix } from "../../artifacts/api-server/src/bot/hq/assets.js";

const outDir = resolve(process.argv[2] ?? "/opt/cursor/artifacts/hq-miniverse");
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
  console.log("outdoor miniverse…");
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

  // Mockup matches: giant walls ON (sky diorama) + giant walls OFF (void) + shield
  save("01-outdoor-giant-walls-clouds.png", await renderBase(base("skybox-clouds")));
  save("02-outdoor-giant-walls-off-shield.png", await renderBase(base("skybox-clouds", {
    giantWallsOff: true, shieldActive: true,
  })));
  save("03-outdoor-empty-platform.png", await renderBase(base("skybox-clouds", {
    visitors: 0, emptyPlatform: true,
  })));
  save("04-outdoor-edit-grid.png", await renderBase(base("skybox-clouds", {
    showGrid: true,
    cursor: { x: 3, y: 4, w: 2, h: 2, color: 0x2fd4d4, label: "Tree · 2×2", valid: true },
  })));
  save("05-outdoor-night.png", await renderBase(base("skybox-night")));
  save("06-outdoor-desert.png", await renderBase(base("skybox-desert")));
  save("07-outdoor-space.png", await renderBase(base("skybox-space", { giantWallsOff: false })));
  save("08-outdoor-void-no-shield.png", await renderBase(base("skybox-clouds", { giantWallsOff: true })));
}

async function previewRooms(): Promise<void> {
  console.log("tactical rooms…");
  const wallFor: Record<string, string> = {
    entrance: "stone",
    "trophy-hall": "castle",
    barracks: "wood",
    treasury: "castle",
  };
  for (const room of HQ_ROOMS) {
    const view: HqRenderView = {
      ...header,
      ownerName: "pengu1n",
      displayTitle: "Kaos base",
      subtitle: `${room.name} · furnished default`,
      roomEmoji: room.emoji,
      roomName: room.name,
      roomId: room.id,
      wall: resolveWall(wallFor[room.id] ?? "stone"),
      floor: resolveFloor(room.id === "treasury" ? "marble" : "tile"),
      pedestals: room.pedestals > 0 ? Array.from({ length: room.pedestals }, () => null) : [],
      decorations: [],
      visitors: 0,
    };
    save(`room-${room.id}.png`, await renderHq(view));
  }
}

async function main(): Promise<void> {
  console.log(`HQ miniverse preview → ${outDir}`);
  await previewOutdoor();
  await previewRooms();
  console.log("done.");
}

main().catch(err => { console.error(err); process.exit(1); });
