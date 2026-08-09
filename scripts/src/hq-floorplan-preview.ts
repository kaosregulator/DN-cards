// Floorplan preview — connected HQ layout.
//   pnpm --filter @workspace/scripts exec tsx src/hq-floorplan-preview.ts [outDir]

import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { renderFloorplan } from "../../artifacts/api-server/src/bot/hq/render-floorplan.js";
import { createDefaultFloorplan, FLOORPLAN_EXPANSIONS } from "../../artifacts/api-server/src/bot/hq/defs/floorplan.js";
import { claimExpansion, placeOpening, placeWall, focusZone } from "../../artifacts/api-server/src/bot/hq/floorplan.js";
import { resolveTheme } from "../../artifacts/api-server/src/bot/hq/defs/themes.js";
import { resolveSkybox } from "../../artifacts/api-server/src/bot/hq/defs/skyboxes.js";
import { vEdge } from "../../artifacts/api-server/src/bot/hq/defs/floorplan.js";

const outDir = resolve(process.argv[2] ?? "/opt/cursor/artifacts/hq-floorplan");
mkdirSync(outDir, { recursive: true });

const theme = resolveTheme("command");
const header = {
  ownerName: "pengu1n",
  ownerAvatarUrl: null as string | null,
  displayTitle: "Kaos base",
  theme,
  hqLevel: 10,
  roomEmoji: "🚪",
  roomName: "HQ Floorplan",
};

function save(name: string, buf: Buffer | null): void {
  if (!buf) { console.error(`  ✗ ${name}`); process.exitCode = 1; return; }
  writeFileSync(join(outDir, name), buf);
  console.log(`  ✓ ${name} — ${(buf.length / 1024).toFixed(0)} KiB`);
}

async function main(): Promise<void> {
  console.log(`Floorplan preview → ${outDir}`);

  const starter = createDefaultFloorplan();
  save("01-starter-floorplan.png", await renderFloorplan({
    ...header,
    subtitle: "Starter · Command Center ↔ Hallway ↔ Trophy Hall",
    floorplan: starter,
    skybox: resolveSkybox("skybox-clouds"),
    statusLine: "Connected HQ — expand wings as you progress",
  }));

  let expanded = starter;
  for (const id of ["exp-barracks", "exp-treasury"]) {
    expanded = claimExpansion(expanded, id);
  }
  expanded = focusZone(expanded, "barracks");
  save("02-expanded-wings.png", await renderFloorplan({
    ...header,
    subtitle: "Expanded · Barracks and Treasury connected",
    floorplan: expanded,
    skybox: resolveSkybox("skybox-night"),
    showGrid: false,
    statusLine: "Doors auto-link adjacent wings",
  }));

  let divided = claimExpansion(createDefaultFloorplan(), "exp-barracks");
  // Interior divider in command center
  for (let y = 6; y <= 11; y++) {
    divided = placeWall(divided, vEdge(6, y), { kind: "interior", styleId: "wood" });
  }
  divided = placeOpening(divided, vEdge(6, 8), "door", "entrance", "entrance");
  divided = focusZone(divided, "entrance");
  save("03-interior-walls.png", await renderFloorplan({
    ...header,
    subtitle: "Interior walls + doorway inside Command Center",
    floorplan: divided,
    skybox: resolveSkybox("skybox-clouds"),
    showGrid: true,
    statusLine: "Walls snap · corners auto-merge · doors punch openings",
  }));

  let full = createDefaultFloorplan();
  for (const e of FLOORPLAN_EXPANSIONS) full = claimExpansion(full, e.id);
  save("04-full-hq.png", await renderFloorplan({
    ...header,
    subtitle: "Full headquarters — every wing unlocked",
    floorplan: full,
    skybox: resolveSkybox("skybox-outside"),
    statusLine: "One continuous HQ floorplan",
  }));

  console.log("done.");
}

void main();
