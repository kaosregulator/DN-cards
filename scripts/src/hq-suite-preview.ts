// ─────────────────────────────────────────────────────────────────────────────
// Render the three room-SUITE presets ("the mini hotel") to PNGs so the indoor
// look can be eyeballed without a Discord client.
//
//   pnpm --filter @workspace/scripts run hq:suite [outDir]
//
// Also renders the editor overlay (grid + cursor) and a focus view, since those
// are the states a player actually spends time in.
// ─────────────────────────────────────────────────────────────────────────────

import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { renderRoomSuite } from "../../artifacts/api-server/src/bot/hq/render-room-suite.js";
import { suitePreset, SUITE_PRESET_IDS, validateSuite } from "../../artifacts/api-server/src/bot/hq/defs/room-suites.js";
import { resolveTheme } from "../../artifacts/api-server/src/bot/hq/defs/themes.js";

const OUT = resolve(process.argv[2] ?? "/tmp/hq-suite");
mkdirSync(OUT, { recursive: true });

function header(title: string, sub: string) {
  return {
    ownerAvatarUrl: null,
    displayTitle: title,
    subtitle: sub,
    theme: resolveTheme("command"),
    roomEmoji: "🏨",
    roomName: "Rooms",
    hqLevel: 10,
  };
}

function save(name: string, buf: Buffer | null): void {
  if (!buf) { console.log("  ✗", name, "— renderer returned null"); return; }
  writeFileSync(join(OUT, name), buf);
  console.log(`  ✓ ${name} — ${Math.round(buf.length / 1024)} KiB`);
}

async function main(): Promise<void> {
  console.log("Room suite preview →", OUT);

  for (const id of SUITE_PRESET_IDS) {
    const layout = suitePreset(id);
    const errs = validateSuite(layout);
    if (errs.length) {
      console.log(`  ! preset "${id}" is invalid:`);
      for (const e of errs) console.log("     -", e);
    }
    save(`suite-${id}.png`, await renderRoomSuite({
      ...header("Kaos Base", `${layout.emoji} ${layout.name} — ${layout.blurb}`),
      layout,
    }));
  }

  // Editor mode: grid + a placement cursor.
  const rooms = suitePreset("rooms");
  save("suite-editor.png", await renderRoomSuite({
    ...header("Kaos Base", "🛠️ Edit mode — pick a tile to place or move an item"),
    layout: rooms, showGrid: true, cursor: { x: 3, y: 2 },
  }));

  // Focus mode: spotlight one sub-room, dim the rest.
  save("suite-focus-vault.png", await renderRoomSuite({
    ...header("Kaos Base", "🔎 Vault — the rest of the floor dims so one room reads"),
    layout: rooms, focusRoomId: "vault",
  }));

  console.log("done.");
}

main().catch(err => { console.error(err); process.exit(1); });
