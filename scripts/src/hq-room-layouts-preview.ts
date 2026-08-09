// ─────────────────────────────────────────────────────────────────────────────
// Render every room LAYOUT (4 rooms × Small/Medium/Large) under a chosen theme,
// so the new "pick a room, pick a size" mini-worlds can be eyeballed without a
// Discord client — and hard-fail if any layout's geometry is invalid.
//
//   pnpm --filter @workspace/scripts run hq:layouts [outDir] [themeId]
// ─────────────────────────────────────────────────────────────────────────────

import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { renderRoomSuite } from "../../artifacts/api-server/src/bot/hq/render-room-suite.js";
import {
  LAYOUT_ROOM_IDS, roomLayout, validateAllLayouts, type RoomSizeId,
} from "../../artifacts/api-server/src/bot/hq/defs/room-layouts.js";
import { resolveTheme } from "../../artifacts/api-server/src/bot/hq/defs/themes.js";

const OUT = resolve(process.argv[2] ?? "/tmp/hq-layouts");
const THEME = process.argv[3] ?? "dungeon";
mkdirSync(OUT, { recursive: true });

function save(name: string, buf: Buffer | null): void {
  if (!buf) { console.log("  ✗", name, "— renderer returned null"); return; }
  writeFileSync(join(OUT, name), buf);
  console.log(`  ✓ ${name} — ${Math.round(buf.length / 1024)} KiB`);
}

async function main(): Promise<void> {
  console.log("Room layout preview →", OUT, "· theme:", THEME);

  const invalid = validateAllLayouts();
  if (invalid.length) {
    console.error("Invalid layouts:");
    for (const { key, errors } of invalid) {
      console.error(`  ✗ ${key}`);
      for (const e of errors) console.error("      -", e);
    }
    process.exit(1);
  }
  console.log("  all 12 layouts valid ✓");

  const theme = resolveTheme(THEME);
  const sizes: RoomSizeId[] = ["small", "medium", "large"];
  for (const roomId of LAYOUT_ROOM_IDS) {
    for (const size of sizes) {
      const layout = roomLayout(roomId, size);
      save(`${roomId}-${size}.png`, await renderRoomSuite({
        ownerAvatarUrl: null,
        displayTitle: "Kaos Base",
        subtitle: `${layout.emoji} ${layout.name} — ${layout.blurb}`,
        theme,
        roomEmoji: layout.emoji,
        roomName: layout.name,
        hqLevel: 10,
        layout,
        showLabels: true,
      }));
    }
  }

  // One editor-overlay shot, since that's the state a decorating player sees.
  save("editor-command-medium.png", await renderRoomSuite({
    ownerAvatarUrl: null, displayTitle: "Kaos Base",
    subtitle: "🛠️ Edit mode — pick a tile to place or move an item",
    theme, roomEmoji: "🎛️", roomName: "Command Center", hqLevel: 10,
    layout: roomLayout("entrance", "medium"), showGrid: true, cursor: { x: 3, y: 2 },
  }));

  console.log("done.");
}

main().catch(err => { console.error(err); process.exit(1); });
