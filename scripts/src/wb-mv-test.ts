// World Builder — RPG Maker MV tileset import test.
//
// Drives the REAL Asset Manager importer (importZipBuffer) against a ZIP of
// RPG Maker MV tileset sheets named exactly like the Modern Exteriors MV pack
// (Tileset_82_MV.png … A2_Floors_MV_TILESET.png), plus a couple of ordinary
// standalone object PNGs. Asserts that:
//   • each 48×48 MV sheet is catalogued as a paintable GRID (tile.sheet, real
//     columns/rows/count at 48px) — individual tiles, not one whole-PNG object
//   • ordinary sprites/objects still import as single assets (no tile grid)
//
// Run:  pnpm --filter @workspace/scripts run test:wb-mv
process.env.DATABASE_URL ||= "postgres://wb";
import assert from "node:assert/strict";
import { deflateSync } from "node:zlib";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { crc32 } from "node:zlib";

const wbRoot = mkdtempSync(join(tmpdir(), "wb-data-"));
process.env.WORLD_BUILDER_DATA_DIR = wbRoot;

const base = "../../artifacts/api-server/src/bot/world-builder";
const { importZipBuffer } = await import(`${base}/packs.js`) as any;
const { loadPackManifest } = await import(`${base}/store.js`) as any;

// Real-ZIP mode: point WB_TEST_ZIP at the actual Modern Exteriors MV zip to run
// the true importer against it and print every tileset it exposes.
//   WB_TEST_ZIP=/path/Modern_Exteriors_RPG_Maker_MV_v42.3.zip pnpm --filter @workspace/scripts run test:wb-mv
const realZip = process.env.WB_TEST_ZIP?.trim();
if (realZip) {
  // INSPECTOR MODE — import a real pack and print exactly what the World Editor
  // would get: how many assets, by category, which sheets became paintable tile
  // grids (and at what tile size), and how many import as single objects.
  const { readFileSync: rf } = await import("node:fs");
  const t0 = Date.now();
  const sum = importZipBuffer(rf(realZip), { name: realZip.split("/").pop() ?? "pack" });
  const m = loadPackManifest(sum.packId) as any[];
  const sheets = m.filter((a) => a.tile?.sheet);
  const objects = m.filter((a) => !a.tile);

  const byCat: Record<string, number> = {};
  for (const a of m) byCat[a.category] = (byCat[a.category] ?? 0) + 1;
  const bySize: Record<number, number> = {};
  for (const a of sheets) bySize[a.tile.tileWidth] = (bySize[a.tile.tileWidth] ?? 0) + 1;

  console.log(`\n📦  ${sum.name}`);
  console.log(`    imported ${sum.imported} assets in ${((Date.now() - t0) / 1000).toFixed(1)}s · ${sum.skipped} skipped`);
  console.log(`    ${sheets.length} paintable tile sheets · ${objects.length} single objects\n`);
  console.log(`    tile sizes:  ${Object.entries(bySize).map(([k, v]) => `${v}×${k}px`).join("  ") || "none"}`);
  console.log(`    categories:  ${Object.entries(byCat).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}:${v}`).join("  ")}\n`);
  console.log(`    sample tile sheets:`);
  for (const a of sheets.slice(0, 20)) {
    console.log(`      🧩 ${a.name.slice(0, 34).padEnd(34)} ${a.tile.columns}×${a.tile.rows} = ${String(a.tile.count).padStart(5)} tiles @ ${a.tile.tileWidth}px`);
  }
  console.log(`\n    sample single objects:`);
  for (const a of objects.slice(0, 12)) {
    console.log(`      ◆ ${a.name.slice(0, 34).padEnd(34)} ${a.category}/${a.kind}`);
  }
  if (sum.unsupported.length) {
    console.log(`\n    unsupported (first ${Math.min(10, sum.unsupported.length)}): ${sum.unsupported.slice(0, 10).join(", ")}`);
  }
  assert.ok(sum.imported > 0, "expected the real pack to import at least one asset");
  console.log(`\n✅ Real pack imported — ${sheets.length} sheets expose individual tiles, ${objects.length} objects placeable.\n`);
  process.exit(0);
}


// ── Minimal PNG writer: RGBA, a visible 48px grid, dependency-free. ───────────
function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body) >>> 0, 0);
  return Buffer.concat([len, body, crc]);
}
function gridPng(w: number, h: number, tile = 48): Buffer {
  // Raw RGBA scanlines, each prefixed with a 0 filter byte.
  const row = (y: number): Buffer => {
    const line = Buffer.alloc(1 + w * 4);
    for (let x = 0; x < w; x++) {
      const onGrid = x % tile === 0 || y % tile === 0;
      const cellX = Math.floor(x / tile), cellY = Math.floor(y / tile);
      const alt = (cellX + cellY) % 2 === 0;
      const o = 1 + x * 4;
      line[o] = onGrid ? 90 : alt ? 40 : 28;
      line[o + 1] = onGrid ? 110 : alt ? 60 : 44;
      line[o + 2] = onGrid ? 150 : alt ? 90 : 70;
      line[o + 3] = 255;
    }
    return line;
  };
  const raw = Buffer.concat(Array.from({ length: h }, (_, y) => row(y)));
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8-bit, RGBA
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return Buffer.concat([sig, chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

// ── Fixtures: exact Modern Exteriors MV names + MV (48px) dimensions. ─────────
const MV_SHEETS: { file: string; w: number; h: number }[] = [
  { file: "Tileset_82_MV.png",         w: 768, h: 384 }, // 16×8  = 128 tiles
  { file: "Tileset_83_MV.png",         w: 768, h: 384 },
  { file: "Tileset_84_MV.png",         w: 768, h: 384 },
  { file: "Tileset_170_MV.png",        w: 768, h: 432 }, // 16×9  = 144
  { file: "A2_Floors_MV_TILESET.png",  w: 768, h: 576 }, // 16×12 = 192
];
// Ordinary standalone assets that must NOT become tile grids.
const STANDALONE: { file: string; w: number; h: number }[] = [
  { file: "npc_guard.png",     w: 48, h: 64 },   // character sprite (h not ÷48)
  { file: "building_shop.png", w: 200, h: 200 }, // object (name+dims non-grid)
];

const src = mkdtempSync(join(tmpdir(), "me-mv-"));
const root = join(src, "Modern_Exteriors_RPG_Maker_MV");
mkdirSync(join(root, "Tilesets"), { recursive: true });
mkdirSync(join(root, "Characters"), { recursive: true });
for (const s of MV_SHEETS) writeFileSync(join(root, "Tilesets", s.file), gridPng(s.w, s.h));
writeFileSync(join(root, "Characters", "npc_guard.png"), gridPng(48, 64));
writeFileSync(join(root, "building_shop.png"), gridPng(200, 200));

// LimeZu / Modern Exteriors "win" pack ships 16×16 AND 32×32 trees — the size
// hint in the PATH must win so a 16px sheet is NOT sliced at 32 (merging tiles).
mkdirSync(join(root, "Modern_Exteriors_16x16", "1_Terrains"), { recursive: true });
mkdirSync(join(root, "Modern_Exteriors_32x32", "2_City"), { recursive: true });
writeFileSync(join(root, "Modern_Exteriors_16x16", "1_Terrains", "Terrain_sheet.png"), gridPng(512, 512, 16));
writeFileSync(join(root, "Modern_Exteriors_32x32", "2_City", "City_sheet.png"), gridPng(512, 512, 32));

// Zip it exactly like a user-supplied pack, then feed the real importer.
const zipPath = join(src, "Modern_Exteriors_RPG_Maker_MV_v42.3.zip");
execFileSync("zip", ["-q", "-r", zipPath, "Modern_Exteriors_RPG_Maker_MV"], { cwd: src });
const summary = importZipBuffer(readFileSync(zipPath), { name: "Modern Exteriors (RPG Maker MV)" });

const manifest = loadPackManifest(summary.packId) as any[];
const byFile = (needle: string) => manifest.find((a) => a.id.endsWith(needle) || a.name.toLowerCase().includes(needle.replace(/\.png$/i, "").replace(/_/g, " ").toLowerCase()));

console.log(`\n📦 Imported "${summary.name}" — ${summary.imported} assets, ${summary.skipped} skipped`);
console.log(`   categories: ${summary.categories.join(", ")}\n`);

let sheetCount = 0;
const expect48 = (file: string, w: number, h: number) => {
  const e = manifest.find((a) => a.name.replace(/\s+/g, "").toLowerCase().includes(file.replace(/_/g, "").replace(/\.png$/i, "").toLowerCase()))
    ?? manifest.find((a) => a.id.toLowerCase().includes(file.toLowerCase()));
  assert.ok(e, `catalog entry missing for ${file}`);
  assert.ok(e.tile, `${file}: expected a tile grid, got a single object`);
  assert.equal(e.tile.tileWidth, 48, `${file}: tileWidth should be 48 (RPG Maker MV)`);
  assert.equal(e.tile.tileHeight, 48, `${file}: tileHeight should be 48`);
  assert.equal(e.tile.columns, w / 48, `${file}: columns`);
  assert.equal(e.tile.rows, h / 48, `${file}: rows`);
  assert.equal(e.tile.count, (w / 48) * (h / 48), `${file}: count`);
  assert.equal(e.tile.sheet, true, `${file}: should be a sliceable sheet`);
  sheetCount++;
  console.log(`   ✅ ${file.padEnd(26)} → ${e.tile.columns}×${e.tile.rows} = ${e.tile.count} individual 48px tiles (paintable)`);
};
for (const s of MV_SHEETS) expect48(s.file, s.w, s.h);

// Standalone objects must remain single, non-grid assets.
for (const s of STANDALONE) {
  const e = manifest.find((a) => a.id.toLowerCase().includes(s.file.toLowerCase()));
  assert.ok(e, `standalone ${s.file} missing`);
  assert.ok(!e.tile, `${s.file}: must stay a single object, not a tile grid`);
  console.log(`   ✅ ${s.file.padEnd(26)} → single ${e.category}/${e.kind} object (unchanged)`);
}

// Win-pack size-hint: the 16×16 sheet slices at 16, the 32×32 at 32.
const win16 = manifest.find((a) => a.id.toLowerCase().includes("modern_exteriors_16x16"));
const win32 = manifest.find((a) => a.id.toLowerCase().includes("modern_exteriors_32x32"));
assert.ok(win16?.tile && win16.tile.tileWidth === 16, "16x16 sheet must slice at 16px (not the larger divisor)");
assert.ok(win32?.tile && win32.tile.tileWidth === 32, "32x32 sheet must slice at 32px");
console.log(`   ✅ Modern_Exteriors_16x16/…        → ${win16!.tile.columns}×${win16!.tile.rows} = ${win16!.tile.count} tiles @ 16px (path hint honoured)`);
console.log(`   ✅ Modern_Exteriors_32x32/…        → ${win32!.tile.columns}×${win32!.tile.rows} = ${win32!.tile.count} tiles @ 32px (path hint honoured)`);

assert.equal(sheetCount, MV_SHEETS.length, "all MV sheets must expose tile grids");
console.log(`\n✅ All ${MV_SHEETS.length} RPG Maker MV sheets expose individual 48×48 tiles; standalone assets unchanged.`);
console.log("✅ Existing importer behaviour preserved (single objects still import as objects).\n");
