// ─────────────────────────────────────────────────────────────────────────────
// Convert the Harvest Moon (mimikim/harvest-moon-phaser3-game) Tiled levels into
// this project's world format. Each HM level is a full background PNG + a
// `blocked` collision layer + an `exits` object layer, which we turn into:
//   • public/world/hm/bg/<key>.png      the background art (copied as-is)
//   • public/world/hm/maps/<key>.tmj    a light collision map (start + collision)
//   • src/world/hmMaps.ts               a generated registry (dims, exits, bg)
// The overworld/interiors are then wired together by their reciprocal exits.
//
// Run from artifacts/activity, pointing at a local clone of the HM repo:
//   node scripts/convert-hm.mjs /path/to/harvest-moon-phaser3-game
// ─────────────────────────────────────────────────────────────────────────────
import sharp from 'sharp';
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, existsSync } from 'node:fs';
import { readdirSync } from 'node:fs';
import { join, basename } from 'node:path';

const HM = process.argv[2];
if (!HM) { console.error('usage: node scripts/convert-hm.mjs <hm-repo-path>'); process.exit(1); }
const PUB = new URL('../public/', import.meta.url).pathname;
const OUT_BG = PUB + 'world/hm/bg/';
const OUT_MAP = PUB + 'world/hm/maps/';
mkdirSync(OUT_BG, { recursive: true });
mkdirSync(OUT_MAP, { recursive: true });

// scene name (used in HM exit props) -> our map key
const SCENE = {
  sceneTown: 'town', sceneCrossRoads: 'crossroads', sceneMountains: 'mountains',
  sceneFarm: 'farm', sceneMountainHome: 'mountain-home', sceneCave1: 'cave1',
  sceneCave2: 'cave2', sceneHome: 'home', sceneCoop: 'coop', sceneToolShed: 'tool-shed',
  sceneCowShed: 'cow-shed', sceneFlorist: 'florist', sceneFortuneTeller: 'fortuneteller',
  sceneToolShop: 'tools', sceneRestaurant: 'restaurant', sceneBar: 'bar', sceneManor: 'manor',
  sceneChurch: 'church', sceneAnimalShop: 'animal-shop', sceneBedroomBar: 'bedroom-bar',
  sceneBedroomFlorist: 'bedroom-florist', sceneBedroomManor: 'bedroom-manor',
  sceneBedroomRestaurant: 'bedroom-restaurant', sceneBedroomTools: 'bedroom-tools',
  sceneManorHallway: 'manor-hallway',
};
const NAMES = {
  town: 'Harvest Town', crossroads: 'Crossroads', mountains: 'Mountains', farm: 'Homestead Farm',
  'mountain-home': "Mountain Cabin", cave1: 'Farm Cave', cave2: 'Mountain Cave', home: 'Farmhouse',
  coop: 'Chicken Coop', 'tool-shed': 'Tool Shed', 'cow-shed': 'Cow Shed', florist: 'Florist',
  fortuneteller: 'Fortune Teller', tools: 'Tool Shop', restaurant: 'Restaurant', bar: 'Bar',
  manor: 'Manor', church: 'Church', 'animal-shop': 'Animal Shop', 'bedroom-bar': 'Bar — Bedroom',
  'bedroom-florist': 'Florist — Bedroom', 'bedroom-manor': 'Manor — Bedroom',
  'bedroom-restaurant': 'Restaurant — Bedroom', 'bedroom-tools': 'Tool Shop — Bedroom',
  'manor-hallway': 'Manor Hallway',
};
const SUB = { town: 'Harvest Moon Village', crossroads: 'The Crossroads', mountains: 'Wild Mountains', farm: 'The Homestead' };

// find every level json
const dirs = ['public/levels/town', 'public/levels/mountains', 'public/levels/homestead'];
const files = [];
for (const d of dirs) for (const f of readdirSync(join(HM, d))) if (f.endsWith('.json')) files.push(join(HM, d, f));

const keyOf = (file) => basename(file).replace('-20px.json', '');
const collideTile = (v) => (v && v !== 0) ? 1 : 0;

const registry = [];
for (const file of files) {
  const t = JSON.parse(readFileSync(file, 'utf8'));
  const key = keyOf(file);
  const W = t.width, H = t.height, TS = t.tilewidth; // 20
  const bg = t.layers.find(l => l.name === 'background');
  const blocked = t.layers.find(l => l.name === 'blocked');
  const exitsL = t.layers.find(l => l.name === 'exits');
  const tsimg = (t.tilesets || [])[0]?.image?.replace(/^.*\//, '') || `${key}.png`;

  // copy background art. Slice oversized art (> MAX_TEX in any axis) into chunks
  // so it fits the WebGL texture limit some phones enforce (4096).
  const MAX_TEX = 4096, CHUNK = 2000;
  const bgSrc = join(HM, 'public/images/background', tsimg);
  let chunks = null;
  if (existsSync(bgSrc)) {
    const meta = await sharp(bgSrc).metadata();
    if (meta.width > MAX_TEX || meta.height > MAX_TEX) {
      chunks = [];
      mkdirSync(OUT_BG + key, { recursive: true });
      for (let y = 0; y < meta.height; y += CHUNK) {
        for (let x = 0; x < meta.width; x += CHUNK) {
          const cw = Math.min(CHUNK, meta.width - x), ch = Math.min(CHUNK, meta.height - y);
          const name = `${x}_${y}.png`;
          await sharp(bgSrc).extract({ left: x, top: y, width: cw, height: ch }).png().toFile(OUT_BG + key + '/' + name);
          chunks.push({ url: `world/hm/bg/${key}/${name}`, x, y, w: cw, h: ch });
        }
      }
    } else {
      copyFileSync(bgSrc, OUT_BG + `${key}.png`);
    }
    // a downscaled minimap picture (single image even when the bg is chunked)
    mkdirSync(OUT_BG + '../minimap', { recursive: true });
    const s = Math.min(1, 700 / Math.max(meta.width, meta.height));
    await sharp(bgSrc).resize(Math.round(meta.width * s), Math.round(meta.height * s)).jpeg({ quality: 82 }).toFile(PUB + `world/hm/minimap/${key}.jpg`);
  } else console.warn('  ! missing bg', tsimg, 'for', key);

  // collision grid from the blocked layer
  const col = new Array(W * H).fill(0);
  if (blocked?.data) for (let i = 0; i < blocked.data.length; i++) col[i] = collideTile(blocked.data[i]);

  // exits -> {to, tx, ty}
  const exits = [];
  if (exitsL) for (const o of exitsL.objects) {
    const scene = (o.properties || []).find(p => p.name === 'exit')?.value;
    const to = SCENE[scene];
    if (!to) continue;
    exits.push({ to, tx: Math.round(o.x / TS), ty: Math.round(o.y / TS), w: Math.max(1, Math.round((o.width || TS) / TS)), h: Math.max(1, Math.round((o.height || TS) / TS)) });
  }

  // default spawn: map centre (a direct load / first entry starts in the middle,
  // never on an edge door). Door arrivals override this with an explicit tile.
  const sx = Math.floor(W / 2), sy = Math.floor(H / 2);
  const start = new Array(W * H).fill(0);
  start[sy * W + sx] = 1;

  // emit collision tmj (start + collision only; bg drawn as an image)
  const layer = (name, data, id, visible) => ({ data, height: H, id, name, opacity: 1, type: 'tilelayer', visible, width: W, x: 0, y: 0 });
  const tmj = {
    compressionlevel: -1, height: H, infinite: false,
    layers: [layer('start', start, 1, false), layer('collision', col, 2, false)],
    nextlayerid: 3, nextobjectid: 1, orientation: 'orthogonal', renderorder: 'right-down',
    tiledversion: '1.10.2', tileheight: TS, tilewidth: TS, type: 'map', version: '1.10', width: W,
    tilesets: [{ columns: 1, firstgid: 1, image: '../collide.png', imageheight: TS, imagewidth: TS, margin: 0, name: 'collide', spacing: 0, tilecount: 1, tileheight: TS, tilewidth: TS }],
  };
  writeFileSync(OUT_MAP + `${key}.tmj`, JSON.stringify(tmj));

  registry.push({ key, name: NAMES[key] || key, subtitle: SUB[key] || 'Harvest Moon', w: W, h: H, tile: TS, bg: chunks ? null : `world/hm/bg/${key}.png`, chunks, mapImage: `world/hm/minimap/${key}.jpg`, spawn: { tx: sx, ty: sy }, exits });
  console.log('converted', key.padEnd(20), `${W}x${H}`, 'exits='+exits.length);
}

// a 20x20 opaque collision tile (invisible in game; used only for physics)
await sharp({ create: { width: 20, height: 20, channels: 4, background: { r: 255, g: 0, b: 255, alpha: 1 } } }).png().toFile(PUB + 'world/hm/collide.png');

// generated TS registry
const ts = `// AUTO-GENERATED by scripts/convert-hm.mjs — do not edit by hand.
// Harvest Moon world maps (backgrounds + collision + reciprocal exits).
export interface HmExit { to: string; tx: number; ty: number; w: number; h: number; }
export interface HmChunk { url: string; x: number; y: number; w: number; h: number; }
export interface HmMapDef {
  key: string; name: string; subtitle: string;
  w: number; h: number; tile: number;
  bg: string | null; chunks: HmChunk[] | null; mapImage: string;
  spawn: { tx: number; ty: number }; exits: HmExit[];
}
export const HM_MAPS: HmMapDef[] = ${JSON.stringify(registry, null, 2)};
`;
writeFileSync(new URL('../src/world/hmMaps.ts', import.meta.url).pathname, ts);
console.log('\nwrote', registry.length, 'maps + src/world/hmMaps.ts');

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
