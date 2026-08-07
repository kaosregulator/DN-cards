// ─────────────────────────────────────────────────────────────────────────────
// HQ — world map renderer.
//
// The campaign map: an ocean, a hand-drawn-feeling continent with real biomes
// (forest, snowcap, dune sea, marsh, volcanic scar), rivers, a lake, roads
// linking the holdings, and a castle at every territory flying whoever's banner
// currently owns it. AI faction castles ship already-conquered so a brand-new
// server has somewhere to march; a territory a member has taken flips to their
// colours with a 🚩 pennant.
//
// Everything is procedural so the map works with zero art, and every castle
// still asks the asset manager first — dropping `building/<role>.png` into the
// pack upgrades the whole map at once.
//
// This is a LEAF renderer: it does its own createCanvas + encode inside a single
// queueRender, so it must never call another queued renderer.
// ─────────────────────────────────────────────────────────────────────────────

import { getCanvas, roundRectPath, hexToRgba, type Ctx, type CanvasMod } from "../animations/engine.js";
import { drawTextWithShadow, TITLE_FONT } from "../animations/effects.js";
import { queueRender } from "../animations/render-queue.js";
import { loadSprite, spriteForPrefix } from "./assets.js";
import {
  ellipse, blit, imgSize, polyPath, seededRng, hashString, shiftColor, stripEmoji,
  drawPine, drawRock, drawHqHeader, drawBar, type Pt, type HqHeaderInfo,
} from "./paint.js";
import type { WorldBiome } from "./defs/world.js";

const W = 1120, H = 680;

// One castle on the map, already resolved by the hub.
export interface WorldMarker {
  nodeId: string;
  name: string;
  /** Faction/owner tag drawn under the name. Emoji are stripped when painted. */
  factionShort: string;
  color: number;         // banner colour (faction, or the holder's when taken)
  tier: number;          // 1…6 — drives castle size
  biome: WorldBiome;
  u: number;             // normalised island coords
  v: number;
  structure: string;     // building role, for the sprite lookup
  garrison: number;
  /** An AI faction territory, or a member's own base pinned on the coast. */
  kind: "territory" | "base";
  held: boolean;         // taken by a member (vs still AI-held)
  heldByYou: boolean;
  shielded: boolean;
}

export interface HqWorldView extends HqHeaderInfo {
  markers: WorldMarker[];
  // Roads are drawn between these node-id pairs; the hub derives them from the
  // blueprint order so the continent reads as connected territory.
  routes?: [string, string][];
}

// The landmass. Markers are positioned in normalised (u,v) space against these
// half-extents so the blueprint stays resolution-independent.
const IX = W / 2, IY = 372, IHW = 500, IHH = 258;

function toScreen(u: number, v: number): Pt {
  return { x: IX + u * IHW, y: IY + v * IHH };
}

export async function renderWorldMap(view: HqWorldView): Promise<Buffer | null> {
  return queueRender("hq-world", async () => {
    const mod = await getCanvas();
    if (!mod) return null;
    try {
      const canvas = mod.createCanvas(W, H);
      const ctx = canvas.getContext("2d") as unknown as Ctx;

      drawOcean(ctx);
      drawContinent(ctx);
      drawBiomes(ctx, view.markers);
      drawWaterways(ctx);
      drawRoads(ctx, view);

      // Two passes: every castle first (depth-sorted so nearer ones overlap),
      // then every name plate — otherwise a castle in front buries the label of
      // the territory behind it, which is what makes a busy map unreadable.
      const sprites = await loadStructureSprites(mod, view.markers);
      const sorted = view.markers
        .map(m => ({ m, p: toScreen(m.u, m.v) }))
        .sort((a, b) => a.p.y - b.p.y);
      for (const { m, p } of sorted) drawTerritory(ctx, p.x, p.y, m, sprites.get(m.structure) ?? null);
      drawPlates(ctx, sorted);

      drawCompassAndLegend(ctx, view);

      const lg = ctx.createRadialGradient(W / 2, 130, 60, W / 2, 320, 720);
      lg.addColorStop(0, "rgba(255,244,214,0.09)");
      lg.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = lg; ctx.fillRect(0, 0, W, H);

      await drawHqHeader(ctx, mod, view, W);
      return await canvas.encode("png");
    } catch {
      return null;
    }
  });
}

async function loadStructureSprites(
  mod: CanvasMod, markers: WorldMarker[],
): Promise<Map<string, unknown>> {
  const out = new Map<string, unknown>();
  for (const role of new Set(markers.map(m => m.structure))) {
    const path = spriteForPrefix("building", role);
    if (!path) continue;
    const img = await loadSprite(mod, path).catch(() => null);
    if (img) out.set(role, img);
  }
  return out;
}

// ── Terrain ───────────────────────────────────────────────────────────────────

function drawOcean(ctx: Ctx): void {
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, "#123c5c");
  g.addColorStop(0.55, "#0d2739");
  g.addColorStop(1, "#07131f");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);

  // Swell lines so the sea isn't a flat field.
  const rnd = seededRng(0x5EA);
  ctx.save();
  ctx.strokeStyle = "rgba(255,255,255,0.05)";
  ctx.lineWidth = 2;
  for (let i = 0; i < 44; i++) {
    const y = 40 + rnd() * (H - 60);
    const x = rnd() * W;
    const len = 26 + rnd() * 52;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.quadraticCurveTo(x + len / 2, y - 4, x + len, y);
    ctx.stroke();
  }
  ctx.restore();
}

// The coastline: a lumpy closed curve around the island's normalised extents,
// with a shelf glow and a beach rim so the land reads as land.
function coastPoints(inset = 0): Pt[] {
  const rnd = seededRng(0xC0A57);
  const pts: Pt[] = [];
  const steps = 46;
  for (let i = 0; i < steps; i++) {
    const th = (i / steps) * Math.PI * 2;
    // Base radius is an ellipse; the sin terms give bays and headlands.
    const wobble = 0.90
      + 0.10 * Math.sin(th * 3 + 0.6)
      + 0.07 * Math.sin(th * 5 - 1.1)
      + 0.04 * Math.sin(th * 8 + 2.2)
      + (rnd() - 0.5) * 0.03;
    const r = wobble * (1 - inset);
    pts.push({ x: IX + Math.cos(th) * IHW * r, y: IY + Math.sin(th) * IHH * r });
  }
  return pts;
}

function coastPath(ctx: Ctx, pts: Pt[]): void {
  ctx.beginPath();
  const first = pts[0]!;
  ctx.moveTo(first.x, first.y);
  for (let i = 1; i <= pts.length; i++) {
    const p = pts[i % pts.length]!;
    const prev = pts[i - 1]!;
    ctx.quadraticCurveTo(prev.x, prev.y, (prev.x + p.x) / 2, (prev.y + p.y) / 2);
  }
  ctx.closePath();
}

function drawContinent(ctx: Ctx): void {
  const outer = coastPoints(0);

  // Continental shelf halo.
  ctx.save();
  for (const [grow, alpha] of [[0.055, 0.10], [0.03, 0.14]] as const) {
    coastPath(ctx, coastPoints(-grow));
    ctx.fillStyle = `rgba(120,190,220,${alpha})`;
    ctx.fill();
  }
  ctx.restore();

  // Beach rim, then the land body.
  ctx.save();
  coastPath(ctx, outer);
  ctx.fillStyle = "#d9c79a";
  ctx.fill();
  ctx.restore();

  ctx.save();
  coastPath(ctx, coastPoints(0.035));
  const g = ctx.createLinearGradient(0, IY - IHH, 0, IY + IHH);
  g.addColorStop(0, "#6aa04f");
  g.addColorStop(0.5, "#578f43");
  g.addColorStop(1, "#3f6f34");
  ctx.fillStyle = g;
  ctx.fill();
  ctx.restore();

  // Grass grain.
  ctx.save();
  coastPath(ctx, coastPoints(0.035));
  ctx.clip();
  const rnd = seededRng(0x6A455);
  ctx.strokeStyle = "rgba(255,255,255,0.05)";
  ctx.lineWidth = 1;
  for (let i = 0; i < 260; i++) {
    const x = IX + (rnd() * 2 - 1) * IHW, y = IY + (rnd() * 2 - 1) * IHH;
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + 6, y - 3); ctx.stroke();
  }
  ctx.restore();
}

// Paint a soft biome blob around each territory so the continent has regions,
// then scatter matching props (pines, dunes, crags, ash).
function drawBiomes(ctx: Ctx, markers: WorldMarker[]): void {
  ctx.save();
  coastPath(ctx, coastPoints(0.035));
  ctx.clip();

  for (const m of markers) {
    const p = toScreen(m.u, m.v);
    const tint = biomeTint(m.biome);
    if (!tint) continue;
    const r = 120 + m.tier * 16;
    const g = ctx.createRadialGradient(p.x, p.y, 10, p.x, p.y, r);
    g.addColorStop(0, hexToRgba(tint, 0.55));
    g.addColorStop(1, hexToRgba(tint, 0));
    ctx.fillStyle = g;
    ctx.beginPath(); ellipse(ctx, p.x, p.y, r, r * 0.72); ctx.fill();
  }

  for (const m of markers) {
    const p = toScreen(m.u, m.v);
    const rnd = seededRng(hashString(`biome:${m.nodeId}`));
    const n = 9 + m.tier;
    for (let i = 0; i < n; i++) {
      const a = rnd() * Math.PI * 2;
      const rad = 46 + rnd() * (74 + m.tier * 8);
      const x = p.x + Math.cos(a) * rad;
      const y = p.y + Math.sin(a) * rad * 0.62;
      // Keep props clear of the castle footprint itself.
      if (Math.hypot(x - p.x, (y - p.y) * 1.6) < 52) continue;
      drawBiomeProp(ctx, m.biome, x, y, 0.55 + rnd() * 0.45, rnd);
    }
  }
  ctx.restore();
}

function biomeTint(b: WorldBiome): number | null {
  switch (b) {
    case "forest": return 0x2d5f2c;
    case "snow": return 0xdce9f2;
    case "desert": return 0xe0cb92;
    case "marsh": return 0x4e6b4a;
    case "volcanic": return 0x6d2a1c;
    case "hills": return 0x7d9a4e;
    default: return null;
  }
}

function drawBiomeProp(ctx: Ctx, b: WorldBiome, x: number, y: number, s: number, rnd: () => number): void {
  switch (b) {
    case "forest":
      drawPine(ctx, x, y, s * 0.85, "#28572b");
      break;
    case "snow":
      if (rnd() < 0.5) drawPine(ctx, x, y, s * 0.8, "#2f5a4c");
      else drawSnowcap(ctx, x, y, s);
      break;
    case "desert":
      drawDune(ctx, x, y, s);
      break;
    case "marsh":
      drawReeds(ctx, x, y, s);
      break;
    case "volcanic":
      if (rnd() < 0.6) drawRock(ctx, x, y, s * 0.8);
      else drawAshVent(ctx, x, y, s);
      break;
    case "hills":
      drawHillock(ctx, x, y, s);
      break;
    default:
      if (rnd() < 0.35) drawRock(ctx, x, y, s * 0.6); else drawPine(ctx, x, y, s * 0.7);
      break;
  }
}

function drawSnowcap(ctx: Ctx, x: number, y: number, s: number): void {
  ctx.save();
  ctx.fillStyle = "rgba(0,0,0,0.2)"; ctx.beginPath(); ellipse(ctx, x, y, 20 * s, 7 * s); ctx.fill();
  ctx.fillStyle = "#8d97a4";
  ctx.beginPath(); ctx.moveTo(x - 20 * s, y); ctx.lineTo(x, y - 30 * s); ctx.lineTo(x + 20 * s, y); ctx.closePath(); ctx.fill();
  ctx.fillStyle = "#eef4fa";
  ctx.beginPath(); ctx.moveTo(x - 8 * s, y - 18 * s); ctx.lineTo(x, y - 30 * s); ctx.lineTo(x + 8 * s, y - 18 * s);
  ctx.lineTo(x + 3 * s, y - 20 * s); ctx.lineTo(x - 2 * s, y - 16 * s); ctx.closePath(); ctx.fill();
  ctx.restore();
}

function drawDune(ctx: Ctx, x: number, y: number, s: number): void {
  ctx.save();
  ctx.fillStyle = "#e0cb92";
  ctx.beginPath();
  ctx.moveTo(x - 26 * s, y);
  ctx.bezierCurveTo(x - 14 * s, y - 14 * s, x + 8 * s, y - 16 * s, x + 26 * s, y);
  ctx.closePath(); ctx.fill();
  ctx.fillStyle = "rgba(180,150,95,0.55)";
  ctx.beginPath();
  ctx.moveTo(x + 2 * s, y - 12 * s);
  ctx.bezierCurveTo(x + 12 * s, y - 8 * s, x + 20 * s, y - 3 * s, x + 26 * s, y);
  ctx.lineTo(x + 2 * s, y); ctx.closePath(); ctx.fill();
  ctx.restore();
}

function drawReeds(ctx: Ctx, x: number, y: number, s: number): void {
  ctx.save();
  ctx.fillStyle = "rgba(30,50,40,0.35)"; ctx.beginPath(); ellipse(ctx, x, y, 15 * s, 5 * s); ctx.fill();
  ctx.strokeStyle = "#6f8a52"; ctx.lineWidth = 2 * s;
  for (let i = -2; i <= 2; i++) {
    ctx.beginPath();
    ctx.moveTo(x + i * 4 * s, y);
    ctx.quadraticCurveTo(x + i * 5 * s, y - 12 * s, x + i * 8 * s, y - 18 * s);
    ctx.stroke();
  }
  ctx.restore();
}

function drawAshVent(ctx: Ctx, x: number, y: number, s: number): void {
  ctx.save();
  ctx.fillStyle = "#3b2620";
  ctx.beginPath(); ellipse(ctx, x, y, 16 * s, 6 * s); ctx.fill();
  ctx.fillStyle = "#e2542a";
  ctx.beginPath(); ellipse(ctx, x, y - 1 * s, 8 * s, 3 * s); ctx.fill();
  ctx.fillStyle = "rgba(220,200,190,0.22)";
  ctx.beginPath(); ellipse(ctx, x + 2 * s, y - 16 * s, 10 * s, 12 * s); ctx.fill();
  ctx.restore();
}

function drawHillock(ctx: Ctx, x: number, y: number, s: number): void {
  ctx.save();
  ctx.fillStyle = "#6f9142";
  ctx.beginPath();
  ctx.moveTo(x - 24 * s, y);
  ctx.bezierCurveTo(x - 12 * s, y - 18 * s, x + 12 * s, y - 18 * s, x + 24 * s, y);
  ctx.closePath(); ctx.fill();
  ctx.fillStyle = "rgba(255,255,255,0.10)";
  ctx.beginPath();
  ctx.moveTo(x - 24 * s, y);
  ctx.bezierCurveTo(x - 14 * s, y - 16 * s, x - 2 * s, y - 17 * s, x - 2 * s, y);
  ctx.closePath(); ctx.fill();
  ctx.restore();
}

// Rivers running from the interior to the coast, plus an inland lake.
function drawWaterways(ctx: Ctx): void {
  ctx.save();
  coastPath(ctx, coastPoints(0.035));
  ctx.clip();

  const riverCourses: [number, number][][] = [
    [[-0.02, -0.62], [0.04, -0.28], [-0.06, 0.04], [0.02, 0.40], [-0.04, 0.86]],
    [[0.62, -0.22], [0.42, 0.02], [0.30, 0.34], [0.36, 0.72]],
    [[-0.72, 0.10], [-0.48, 0.20], [-0.24, 0.40], [-0.14, 0.74]],
  ];
  const rivers: Pt[][] = riverCourses.map(course => course.map(([u, v]) => toScreen(u, v)));

  ctx.lineCap = "round"; ctx.lineJoin = "round";
  for (const pts of rivers) {
    for (const [width, color] of [[16, "#2f5d86"], [10, "#4a86bd"], [3, "rgba(200,230,255,0.5)"]] as const) {
      ctx.strokeStyle = color; ctx.lineWidth = width;
      ctx.beginPath(); ctx.moveTo(pts[0]!.x, pts[0]!.y);
      for (let i = 1; i < pts.length; i++) {
        const p = pts[i]!, pv = pts[i - 1]!;
        ctx.quadraticCurveTo(pv.x, (pv.y + p.y) / 2, p.x, p.y);
      }
      ctx.stroke();
    }
  }

  // Inland lake with a beach ring.
  const lake = toScreen(-0.30, 0.52);
  ctx.fillStyle = "#c9b98d";
  ctx.beginPath(); ellipse(ctx, lake.x, lake.y, 62, 30); ctx.fill();
  ctx.fillStyle = "#2f5d86";
  ctx.beginPath(); ellipse(ctx, lake.x, lake.y, 56, 26); ctx.fill();
  ctx.fillStyle = "#4a86bd";
  ctx.beginPath(); ellipse(ctx, lake.x, lake.y - 2, 50, 21); ctx.fill();
  ctx.strokeStyle = "rgba(220,240,255,0.45)"; ctx.lineWidth = 2;
  for (const dy of [-8, 0, 8]) {
    ctx.beginPath();
    ctx.moveTo(lake.x - 22, lake.y + dy);
    ctx.quadraticCurveTo(lake.x, lake.y + dy - 4, lake.x + 22, lake.y + dy);
    ctx.stroke();
  }
  ctx.restore();
}

// Dusty trade roads between neighbouring holdings.
function drawRoads(ctx: Ctx, view: HqWorldView): void {
  const routes = view.routes ?? [];
  if (routes.length === 0) return;
  const byId = new Map(view.markers.map(m => [m.nodeId, toScreen(m.u, m.v)]));
  ctx.save();
  coastPath(ctx, coastPoints(0.035));
  ctx.clip();
  ctx.lineCap = "round";
  for (const [a, b] of routes) {
    const pa = byId.get(a), pb = byId.get(b);
    if (!pa || !pb) continue;
    // Bow the road so the network looks travelled rather than surveyed.
    const mx = (pa.x + pb.x) / 2 + (pb.y - pa.y) * 0.10;
    const my = (pa.y + pb.y) / 2 - (pb.x - pa.x) * 0.05;
    ctx.strokeStyle = "rgba(60,44,26,0.35)"; ctx.lineWidth = 8;
    ctx.beginPath(); ctx.moveTo(pa.x, pa.y); ctx.quadraticCurveTo(mx, my, pb.x, pb.y); ctx.stroke();
    ctx.strokeStyle = "rgba(212,190,145,0.75)"; ctx.lineWidth = 4;
    ctx.beginPath(); ctx.moveTo(pa.x, pa.y); ctx.quadraticCurveTo(mx, my, pb.x, pb.y); ctx.stroke();
    ctx.setLineDash([7, 9]);
    ctx.strokeStyle = "rgba(90,70,40,0.35)"; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(pa.x, pa.y); ctx.quadraticCurveTo(mx, my, pb.x, pb.y); ctx.stroke();
    ctx.setLineDash([]);
  }
  ctx.restore();
}

// ── Territory markers ─────────────────────────────────────────────────────────

function drawTerritory(ctx: Ctx, cx: number, feetY: number, m: WorldMarker, img: unknown): void {
  const scale = 0.52 + m.tier * 0.065;   // tier 1 reads as a hut, tier 6 as a capital
  const bodyH = 62 * scale;

  ctx.save();
  ctx.fillStyle = "rgba(0,0,0,0.32)";
  ctx.beginPath(); ellipse(ctx, cx, feetY, 38 * scale, 11 * scale); ctx.fill();
  ctx.restore();

  if (img) {
    const { w: iw, h: ih } = imgSize(img);
    const h = bodyH * 1.7, w = h * (iw / ih);
    blit(ctx, img, cx - w / 2, feetY - h, w, h);
  } else {
    drawKeep(ctx, cx, feetY, scale, m);
  }

  // A banner pole PLANTED beside the castle rather than floating above it —
  // sprite art has unpredictable headroom, so anchoring to the ground is the
  // only way every marker's flag reads as belonging to its keep.
  drawPennant(ctx, cx + 30 * scale, feetY, m, 46 * scale + 18);

  if (m.shielded) {
    const sx = cx - 32 * scale, sy = feetY - 14;
    ctx.save();
    ctx.fillStyle = "rgba(10,20,32,0.88)";
    ctx.beginPath(); ellipse(ctx, sx, sy, 12, 12); ctx.fill();
    ctx.strokeStyle = "#9fd8ff"; ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(sx, sy - 8); ctx.lineTo(sx + 6, sy - 4);
    ctx.lineTo(sx, sy + 8); ctx.lineTo(sx - 6, sy - 4);
    ctx.closePath(); ctx.stroke();
    ctx.restore();
  }
}

// Name plates for every marker, laid out after the castles and nudged apart so
// neighbouring holdings stay legible on a crowded continent.
function drawPlates(ctx: Ctx, entries: { m: WorldMarker; p: Pt }[]): void {
  const placed: { x: number; y: number; w: number; h: number }[] = [];
  const PLATE_H = 32;

  ctx.save();
  ctx.textAlign = "center"; ctx.textBaseline = "middle";
  for (const { m, p } of entries) {
    const name = stripEmoji(m.name);
    const tag = m.heldByYou ? "YOURS"
      : m.held ? (m.kind === "base" ? "HELD" : "CONQUERED")
      : m.kind === "base" ? "MEMBER BASE"
      : stripEmoji(m.factionShort).toUpperCase();
    const sub = `${tag} · T${m.tier} · ${m.garrison} DEF`;

    ctx.font = `bold 13px "${TITLE_FONT}", "DejaVu Sans", Arial, sans-serif`;
    const nameW = ctx.measureText(name).width;
    ctx.font = `bold 10px "DejaVu Sans", Arial, sans-serif`;
    const subW = ctx.measureText(sub).width;
    const w = Math.max(nameW, subW, 76) + 18;

    // Slide the plate down (then up) until it stops colliding.
    let y = p.y + 8;
    const x = Math.max(w / 2 + 6, Math.min(W - w / 2 - 6, p.x));
    for (const offset of [0, PLATE_H + 4, -(PLATE_H + 46), 2 * (PLATE_H + 4), -(2 * PLATE_H + 50)]) {
      y = p.y + 8 + offset;
      const box = { x: x - w / 2, y, w, h: PLATE_H };
      if (!placed.some(q => overlaps(q, box))) break;
    }
    placed.push({ x: x - w / 2, y, w, h: PLATE_H });

    ctx.fillStyle = "rgba(0,0,0,0.78)";
    roundRectPath(ctx, x - w / 2, y, w, PLATE_H, 8); ctx.fill();
    ctx.strokeStyle = hexToRgba(m.color, m.heldByYou ? 1 : 0.6);
    ctx.lineWidth = m.heldByYou ? 2.5 : 1.4;
    roundRectPath(ctx, x - w / 2, y, w, PLATE_H, 8); ctx.stroke();
    // Owner colour chip on the left edge of the plate.
    ctx.fillStyle = hexToRgba(m.color, 0.95);
    roundRectPath(ctx, x - w / 2 + 2, y + 6, 4, PLATE_H - 12, 2); ctx.fill();
    drawTextWithShadow(ctx, name, x, y + 10, m.heldByYou ? "#9fe6b0" : "#ffffff", 13);
    drawTextWithShadow(ctx, sub, x, y + 22, "rgba(214,214,224,0.86)", 10);
    // Garrison strength, as a hairline under the plate — attached to the label,
    // so it can never drift away from the castle it describes.
    drawBar(ctx, x, y + PLATE_H - 4, w - 16, 4, Math.min(1, m.garrison / 6),
      m.heldByYou ? "#4fd06a" : m.held ? "#4aa3ff" : undefined);
  }
  ctx.restore();
}

function overlaps(
  a: { x: number; y: number; w: number; h: number },
  b: { x: number; y: number; w: number; h: number },
): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

// A procedural keep whose mass grows with tier: a hut at T1, a walled castle
// with corner towers and a gatehouse at T6. Returns the roofline Y.
function drawKeep(ctx: Ctx, cx: number, feetY: number, scale: number, m: WorldMarker): number {
  const stoneL = "#d8d2c0", stone = "#c3bca7", stoneD = "#9a927c", dark = "#2a2620";
  const roof = shiftColor(`#${m.color.toString(16).padStart(6, "0")}`, -40);

  const crenel = (x: number, w: number, topY: number) => {
    ctx.fillStyle = stone;
    const teeth = Math.max(3, Math.floor(w / (9 * scale)));
    const tw = w / (teeth * 2 - 1);
    for (let i = 0; i < teeth; i++) ctx.fillRect(x + i * tw * 2, topY, tw, 6 * scale);
  };
  const tower = (tx: number, tw: number, th: number, conical: boolean) => {
    const g = ctx.createLinearGradient(tx, 0, tx + tw, 0);
    g.addColorStop(0, stoneL); g.addColorStop(0.5, stone); g.addColorStop(1, stoneD);
    ctx.fillStyle = g; ctx.fillRect(tx, feetY - th, tw, th);
    if (conical) {
      ctx.fillStyle = roof;
      ctx.beginPath();
      ctx.moveTo(tx - 3 * scale, feetY - th);
      ctx.lineTo(tx + tw / 2, feetY - th - 18 * scale);
      ctx.lineTo(tx + tw + 3 * scale, feetY - th);
      ctx.closePath(); ctx.fill();
    } else {
      crenel(tx - 2 * scale, tw + 4 * scale, feetY - th - 6 * scale);
    }
    ctx.fillStyle = dark;
    for (const wy of [0.7, 0.45]) ctx.fillRect(tx + tw * 0.4, feetY - th * wy, tw * 0.2, th * 0.13);
  };

  const bodyW = 92 * scale;
  const keepW = bodyW * 0.36, keepH = 78 * scale;
  tower(cx - keepW / 2, keepW, keepH, m.tier >= 4);

  // Curtain wall grows in from tier 2.
  if (m.tier >= 2) {
    const wallW = bodyW * 0.9, wallH = keepH * 0.5;
    const wg = ctx.createLinearGradient(cx - wallW / 2, 0, cx + wallW / 2, 0);
    wg.addColorStop(0, stoneL); wg.addColorStop(1, stoneD);
    ctx.fillStyle = wg; ctx.fillRect(cx - wallW / 2, feetY - wallH, wallW, wallH);
    crenel(cx - wallW / 2, wallW, feetY - wallH - 6 * scale);
    // Gate.
    ctx.fillStyle = dark;
    ctx.beginPath();
    ctx.moveTo(cx - wallW * 0.09, feetY);
    ctx.lineTo(cx - wallW * 0.09, feetY - wallH * 0.5);
    ctx.arc(cx, feetY - wallH * 0.5, wallW * 0.09, Math.PI, 0);
    ctx.lineTo(cx + wallW * 0.09, feetY);
    ctx.closePath(); ctx.fill();
    if (m.tier >= 3) {
      const ctw = bodyW * 0.19, cth = keepH * 0.72;
      tower(cx - wallW / 2 - ctw * 0.3, ctw, cth, m.tier >= 5);
      tower(cx + wallW / 2 - ctw * 0.7, ctw, cth, m.tier >= 5);
    }
  } else {
    // A lone outpost gets a palisade instead of stone.
    ctx.strokeStyle = "#8a6a3f"; ctx.lineWidth = 3 * scale;
    for (let i = -3; i <= 3; i++) {
      const px = cx + i * 11 * scale;
      ctx.beginPath(); ctx.moveTo(px, feetY); ctx.lineTo(px, feetY - 20 * scale); ctx.stroke();
    }
  }
  return feetY - keepH - 20 * scale;
}

// A banner planted at (cx, groundY), rising `height` pixels.
function drawPennant(ctx: Ctx, cx: number, groundY: number, m: WorldMarker, height: number): void {
  const poleTop = groundY - height;
  const flagW = Math.max(16, height * 0.42);
  ctx.save();
  ctx.fillStyle = "rgba(0,0,0,0.28)";
  ctx.beginPath(); ellipse(ctx, cx, groundY, 5, 2); ctx.fill();
  ctx.strokeStyle = "#c9c1a8"; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(cx, groundY); ctx.lineTo(cx, poleTop); ctx.stroke();
  ctx.fillStyle = hexToRgba(m.color, 1);
  ctx.beginPath();
  ctx.moveTo(cx, poleTop);
  ctx.lineTo(cx + flagW, poleTop + flagW * 0.28);
  ctx.lineTo(cx, poleTop + flagW * 0.56);
  ctx.closePath(); ctx.fill();
  ctx.fillStyle = "rgba(255,255,255,0.85)";
  ctx.beginPath(); ellipse(ctx, cx + flagW * 0.32, poleTop + flagW * 0.26, 2.2, 2.2); ctx.fill();
  if (m.heldByYou) {
    ctx.strokeStyle = "#9fe6b0"; ctx.lineWidth = 1.6;
    polyPath(ctx, [
      { x: cx, y: poleTop },
      { x: cx + flagW, y: poleTop + flagW * 0.28 },
      { x: cx, y: poleTop + flagW * 0.56 },
    ]);
    ctx.stroke();
  }
  ctx.restore();
}

// ── Chrome ────────────────────────────────────────────────────────────────────

function drawCompassAndLegend(ctx: Ctx, view: HqWorldView): void {
  // Compass rose, bottom-left.
  const cx = 74, cy = H - 74, r = 30;
  ctx.save();
  ctx.fillStyle = "rgba(0,0,0,0.45)";
  ctx.beginPath(); ellipse(ctx, cx, cy, r + 8, r + 8); ctx.fill();
  ctx.strokeStyle = "rgba(226,210,170,0.85)"; ctx.lineWidth = 2;
  ctx.beginPath(); ellipse(ctx, cx, cy, r, r); ctx.stroke();
  for (const [dx, dy, col] of [[0, -1, "#e8dcb8"], [0, 1, "#9a9282"], [1, 0, "#9a9282"], [-1, 0, "#9a9282"]] as const) {
    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.moveTo(cx + dx * r, cy + dy * r);
    ctx.lineTo(cx + dy * 7, cy + dx * 7);
    ctx.lineTo(cx - dy * 7, cy - dx * 7);
    ctx.closePath(); ctx.fill();
  }
  ctx.textAlign = "center"; ctx.textBaseline = "middle";
  drawTextWithShadow(ctx, "N", cx, cy - r - 14, "#e8dcb8", 13);
  ctx.restore();

  // Holdings tally, bottom-right. Counted over TERRITORIES only — member bases
  // are pins on the same map, not part of the conquest ledger.
  const territories = view.markers.filter(m => m.kind === "territory");
  const yours = territories.filter(m => m.heldByYou).length;
  const rivals = territories.filter(m => m.held && !m.heldByYou).length;
  const ai = territories.length - yours - rivals;
  const bases = view.markers.length - territories.length;
  const lines = [
    { swatch: "#4fd06a", text: `Yours: ${yours}` },
    { swatch: "#4aa3ff", text: `Rivals: ${rivals}` },
    { swatch: "#c0392b", text: `Faction-held: ${ai}` },
    { swatch: "#e8dcb8", text: `Member bases: ${bases}` },
  ];
  const bw = 168, bh = 20 + lines.length * 20;
  const bx = W - bw - 20, by = H - bh - 20;
  ctx.save();
  ctx.fillStyle = "rgba(0,0,0,0.62)";
  roundRectPath(ctx, bx, by, bw, bh, 12); ctx.fill();
  ctx.strokeStyle = "rgba(226,210,170,0.4)"; ctx.lineWidth = 1;
  roundRectPath(ctx, bx, by, bw, bh, 12); ctx.stroke();
  ctx.textAlign = "left"; ctx.textBaseline = "middle";
  lines.forEach((l, i) => {
    const ly = by + 20 + i * 20;
    ctx.fillStyle = l.swatch;
    roundRectPath(ctx, bx + 14, ly - 5, 10, 10, 3); ctx.fill();
    drawTextWithShadow(ctx, l.text, bx + 32, ly, "rgba(238,238,242,0.94)", 12, "left");
  });
  ctx.restore();
}
