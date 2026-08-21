// Pre-render each world map to a downscaled image used by the in-game minimap,
// so the compass / full map shows the real terrain instead of colored blocks.
// Run from artifacts/activity:  node scripts/render-minimaps.mjs
import sharp from 'sharp';
import { readFileSync, writeFileSync } from 'node:fs';

const PUB = new URL('../public/', import.meta.url).pathname;
const man = JSON.parse(readFileSync(PUB + 'world/maps/_manifest.json', 'utf8'));
const MASK = 0x1FFFFFFF;
const MAX_SIDE = 900; // downscaled output cap

for (const key of Object.keys(man)) {
  const entry = man[key];
  const tmj = JSON.parse(readFileSync(PUB + `world/maps/${key}.tmj`, 'utf8'));
  const TS = entry.tilesets.map(t => ({ ...t })).sort((a, b) => a.firstgid - b.firstgid);
  const raw = {};
  const loadTS = async (t) => {
    if (raw[t.name]) return raw[t.name];
    const { data, info } = await sharp(PUB + t.image).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    raw[t.name] = { data, info }; return raw[t.name];
  };
  const tsFor = (gid) => { let r = null; for (const t of TS) { if (gid >= t.firstgid) r = t; else break; } return r; };
  // Flatten the layer tree in draw order: maps built from the WA starter kit nest
  // terrain inside group layers (Floor/Wall/Details/Above). Skip logic-only layers.
  const SKIP = new Set(['start', 'collision', 'collisions']);
  const collect = (list, out = []) => {
    for (const l of list) {
      if (l.visible === false || SKIP.has(l.name)) continue;
      if (l.type === 'group') collect(l.layers || [], out);
      else if (l.type === 'tilelayer' && l.data) out.push(l);
    }
    return out;
  };
  const layers = collect(tmj.layers);
  const MW = tmj.width, MH = tmj.height, PW = MW * 32, PH = MH * 32;
  const buf = Buffer.alloc(PW * PH * 4, 0);
  for (const L of layers) {
    if (!L.data) continue;
    for (let my = 0; my < MH; my++) {
      for (let mx = 0; mx < MW; mx++) {
        let gid = L.data[my * MW + mx]; if (!gid) continue; gid &= MASK;
        const t = tsFor(gid); if (!t) continue;
        const r = await loadTS(t); const local = gid - t.firstgid;
        const sx = (local % t.columns) * 32, sy = Math.floor(local / t.columns) * 32;
        const { data, info } = r;
        for (let py = 0; py < 32; py++) {
          const dy = my * 32 + py;
          for (let px = 0; px < 32; px++) {
            const si = ((sy + py) * info.width + (sx + px)) * 4;
            const a = data[si + 3]; if (!a) continue;
            const di = (dy * PW + (mx * 32 + px)) * 4;
            const ia = a / 255, ib = 1 - ia;
            buf[di] = data[si] * ia + buf[di] * ib;
            buf[di + 1] = data[si + 1] * ia + buf[di + 1] * ib;
            buf[di + 2] = data[si + 2] * ia + buf[di + 2] * ib;
            buf[di + 3] = Math.min(255, a + buf[di + 3] * ib);
          }
        }
      }
    }
  }
  const scale = Math.min(1, MAX_SIDE / Math.max(PW, PH));
  const out = PUB + `world/maps/minimaps/${key}.jpg`;
  await sharp(buf, { raw: { width: PW, height: PH, channels: 4 } })
    .resize(Math.round(PW * scale), Math.round(PH * scale), { kernel: 'lanczos3' })
    .flatten({ background: '#1a2a1a' })
    .jpeg({ quality: 82 })
    .toFile(out);
  console.log('rendered', key, `${PW}x${PH} -> ${Math.round(PW*scale)}x${Math.round(PH*scale)}`);
  for (const k of Object.keys(raw)) delete raw[k];
}
