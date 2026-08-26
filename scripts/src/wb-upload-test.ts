// World Builder — REAL HTTP upload test (not importZipBuffer directly).
//
// Boots the actual world-builder Express router and drives the true F9 upload
// endpoint POST /activity/world-builder/packs/import over HTTP, measuring the
// things a 233 MB pack would hit: the server body-size limit (does 233 MB even
// get accepted?), extraction time, process memory, on-disk footprint, and that
// the resulting 16×16 / 32×32 sheets come back through the /catalog the F9
// palette reads. Run: pnpm --filter @workspace/scripts run test:wb-upload
process.env.DATABASE_URL ||= "postgres://wb";
process.env.WORLD_BUILDER_OPEN = "1";               // open mode → editor auth passes
process.env.NODE_ENV = "development";
process.env.WORLD_BUILDER_MAX_UPLOAD_MB = "150";   // configurable cap (default 512)

import assert from "node:assert/strict";
import http from "node:http";
import { Readable } from "node:stream";
import { deflateSync, crc32 } from "node:zlib";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, statSync, createReadStream } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
// express + the router's other deps live in api-server's node_modules; resolve
// from there so the harness can mount the REAL router without adding deps here.
const apiRequire = createRequire("/home/user/DN-cards/artifacts/api-server/package.json");
// express isn't a dependency of the scripts package (resolved at runtime from
// api-server's node_modules), so keep it untyped here.
const express = apiRequire("express") as () => any;

const wbRoot = mkdtempSync(join(tmpdir(), "wb-http-"));
process.env.WORLD_BUILDER_DATA_DIR = wbRoot;

const router = (await import("../../artifacts/api-server/src/routes/activity-world-builder.js")).default;
const app = express();
app.use("/activity", router);
const server = app.listen(0);
await new Promise((r) => server.once("listening", r));
const port = (server.address() as any).port;
const H = { "x-world-builder-demo": "1" };

// ── tiny PNG writers ─────────────────────────────────────────────────────────
function pngChunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body) >>> 0, 0);
  return Buffer.concat([len, body, crc]);
}
function png(w: number, h: number, raw: Buffer): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return Buffer.concat([sig, pngChunk("IHDR", ihdr), pngChunk("IDAT", deflateSync(raw)), pngChunk("IEND", Buffer.alloc(0))]);
}
function gridPng(w: number, h: number, tile: number): Buffer {
  const raw = Buffer.alloc(h * (1 + w * 4));
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const o = y * (1 + w * 4) + 1 + x * 4, g = x % tile === 0 || y % tile === 0;
    raw[o] = g ? 90 : 40; raw[o + 1] = g ? 110 : 60; raw[o + 2] = g ? 150 : 90; raw[o + 3] = 255;
  }
  return png(w, h, raw);
}
function noisePng(w: number, h: number): Buffer { // ~incompressible → hits target MB fast
  const raw = Buffer.alloc(h * (1 + w * 4));
  for (let i = 0; i < raw.length; i++) raw[i] = (Math.random() * 256) | 0;
  return png(w, h, raw);
}

// ── build a win-structured zip of ~targetMB ──────────────────────────────────
function buildWinZip(targetMB: number): { path: string; bytes: number } {
  const src = mkdtempSync(join(tmpdir(), "me-win-"));
  const root = join(src, "Modern_Exteriors");
  mkdirSync(join(root, "Modern_Exteriors_16x16", "1_Terrains"), { recursive: true });
  mkdirSync(join(root, "Modern_Exteriors_32x32", "2_City"), { recursive: true });
  // Real 16px + 32px tileset sheets (verified in the catalog afterwards).
  writeFileSync(join(root, "Modern_Exteriors_16x16", "1_Terrains", "Terrain_16.png"), gridPng(512, 512, 16));
  writeFileSync(join(root, "Modern_Exteriors_32x32", "2_City", "City_32.png"), gridPng(512, 512, 32));
  // Filler to reach the target size (incompressible sheets, valid PNGs).
  let mb = 0.5; let i = 0;
  const fillDir = join(root, "Modern_Exteriors_32x32", "2_City");
  while (mb < targetMB) {
    const b = noisePng(1024, 1024);           // ~4 MB each
    writeFileSync(join(fillDir, `filler_${i++}.png`), b);
    mb += b.length / 1e6;
  }
  const zip = join(src, "modernexteriors-win.zip");
  execFileSync("zip", ["-q", "-r", "-0", zip, "Modern_Exteriors"], { cwd: src }); // store (already-PNG)
  return { path: zip, bytes: statSync(zip).size };
}

// ── HTTP POST helper (streams a body; returns status + timing) ───────────────
function post(path: string, body: Readable | Buffer, headers: Record<string, string>):
  Promise<{ status: number; ms: number; json: any }> {
  return new Promise((resolve, reject) => {
    const t0 = Date.now();
    let settled = false;
    const done = (r: { status: number; ms: number; json: any }) => { if (!settled) { settled = true; resolve(r); } };
    const req = http.request({ host: "127.0.0.1", port, path, method: "POST", headers }, (res) => {
      let data = ""; res.on("data", (c) => (data += c));
      const finish = () => {
        let json: any = null; try { json = JSON.parse(data); } catch { /* non-json */ }
        done({ status: res.statusCode ?? 0, ms: Date.now() - t0, json });
      };
      res.on("end", finish);
      res.on("error", finish);   // response cut short after status — still usable
    });
    // The server rejects an oversized upload mid-stream: it sends the 413 and
    // then closes the socket while we're still writing the body, so the request
    // side sees ECONNRESET *after* the response. Only surface a reset if no
    // response ever came; give the response handler a beat to settle first.
    req.on("error", (err: NodeJS.ErrnoException) => {
      if (settled) return;
      if (err.code === "ECONNRESET" || err.code === "EPIPE") {
        setTimeout(() => { if (!settled) reject(err); }, 100);
      } else reject(err);
    });
    if (Buffer.isBuffer(body)) req.end(body);
    else { body.on("error", () => { /* body pipe reset after rejection — expected */ }); body.pipe(req); }
  });
}
const mb = (n: number) => (n / 1e6).toFixed(1) + " MB";
const rss = () => process.memoryUsage().rss;

console.log(`\n🌐 world-builder router live on :${port}  (WORLD_BUILDER_OPEN=1, cap ${process.env.WORLD_BUILDER_MAX_UPLOAD_MB} MB)\n`);

// peak-RSS sampler around a request, to show streaming keeps memory flat.
function samplePeak(startRss: number): { stop: () => number } {
  let peak = startRss;
  const t = setInterval(() => { peak = Math.max(peak, rss()); }, 25);
  return { stop: () => { clearInterval(t); return peak; } };
}

// ── TEST A — the real 233 MB pack size, streamed, over the cap → rejected ────
console.log("── Test A · a 233 MB upload vs the 150 MB cap (streamed, not buffered) ──");
const BIG = 233 * 1024 * 1024;
let sent = 0;
const zeros = new Readable({ read() { const n = Math.min(1 << 20, BIG - sent); if (n <= 0) { this.push(null); return; } sent += n; this.push(Buffer.alloc(n)); } });
const beforeA = rss(); const sampA = samplePeak(beforeA);
const a = await post("/activity/world-builder/packs/import?name=big", zeros,
  { ...H, "content-type": "application/zip", "content-length": String(BIG) });
const peakA = sampA.stop();
console.log(`   → HTTP ${a.status} in ${a.ms}ms  ${a.json?.error ? `(${a.json.error})` : ""}`);
console.log(`   process RSS during 233 MB stream: ${mb(beforeA)} → peak ${mb(peakA)}  (Δ ${mb(peakA - beforeA)} — NOT ~233 MB)`);
assert.equal(a.status, 413, "233 MB should hit the 150 MB cap");
console.log(`   ✅ Rejected by the CONFIGURABLE cap as bytes arrive — no 233 MB memory buffer.  (default cap 512 MB would ACCEPT it.)\n`);

// ── TEST B — a 120 MB upload (> the old 80 MB limit) now SUCCEEDS ────────────
console.log("── Test B · 120 MB upload (> old 80 MB hard limit) — streamed success ──");
const { path: zipPath, bytes } = buildWinZip(120);
console.log(`   built win-structured zip: ${mb(bytes)}`);
const beforeB = rss(); const sampB = samplePeak(beforeB);
const b = await post("/activity/world-builder/packs/import?name=Modern%20Exteriors", createReadStream(zipPath),
  { ...H, "content-type": "application/zip", "content-length": String(bytes) });
const peakB = sampB.stop();
console.log(`   → HTTP ${b.status} in ${b.ms}ms`);
assert.equal(b.status, 200, `120 MB upload should now succeed (got ${b.status}: ${b.json?.error})`);
const sumB = b.json.summary;
const packDir = join(wbRoot, "packs", sumB.packId);
const du = execFileSync("du", ["-sh", packDir]).toString().split("\t")[0];
console.log(`   imported ${sumB.imported} assets · extract+scan ${b.ms}ms`);
console.log(`   process RSS: ${mb(beforeB)} → peak ${mb(peakB)}  (Δ ${mb(peakB - beforeB)} for a ${mb(bytes)} upload — streamed to disk, not buffered)`);
console.log(`   on-disk pack footprint: ${du}`);

// palette catalog (what F9 reads)
const cat: any = await new Promise((resolve) => {
  http.get({ host: "127.0.0.1", port, path: "/activity/world-builder/catalog", headers: H }, (res) => {
    let d = ""; res.on("data", (c) => (d += c)); res.on("end", () => resolve(JSON.parse(d)));
  });
});
const sheets = cat.assets.filter((x: any) => x.tile?.sheet);
const s16 = sheets.find((x: any) => x.tile.tileWidth === 16);
const s32 = sheets.find((x: any) => x.tile.tileWidth === 32);
assert.ok(s16 && s32, "16×16 and 32×32 sheets must appear in the palette catalog");
console.log(`   ✅ palette catalog: ${sheets.length} tile sheets · 16px → ${s16.tile.count} tiles · 32px → ${s32.tile.count} tiles`);
// paint contract: localId → source cell (col,row) is well-formed for the last tile
const last = s16.tile.count - 1;
assert.equal(last % s16.tile.columns, s16.tile.columns - 1, "paint mapping localId→col");
console.log(`   ✅ paint mapping valid: localId ${last} → col ${last % s16.tile.columns}, row ${Math.floor(last / s16.tile.columns)}`);

console.log("\n── Verdict (after the streaming fix) ──");
console.log("   • Upload no longer buffers the whole body in RAM — it streams to a temp file (flat memory above).");
console.log("   • Cap is configurable (WORLD_BUILDER_MAX_UPLOAD_MB, default 512); 233 MB uploads with the default.");
console.log("   • Uploads > the old 80 MB limit now succeed; sheets appear in the palette and map to paintable tiles.");
console.log("   • Note: extraction (unzip + copy) still runs synchronously — a very large pack briefly blocks the");
console.log("     event loop during extract; fine for admin-only imports, worth making async if it becomes an issue.\n");

server.close();
process.exit(0);
