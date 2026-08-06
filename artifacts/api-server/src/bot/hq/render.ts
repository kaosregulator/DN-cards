// ─────────────────────────────────────────────────────────────────────────────
// HQ renderer — composites a player's Headquarters to a PNG.
//
// Built as a "stack of pure layer functions" (the doctrine from
// battle/image/render.ts and raid/canvas.ts): renderHq only iterates the layers.
// Everything is PROCEDURAL — walls, floor, lighting, glass display cases,
// pedestals and decorations are drawn on the canvas so the feature ships with
// zero art. Each visual first asks the asset manager (spriteFor); a bundled/
// uploaded PNG transparently replaces the procedural drawing with no code
// change. This renderer is a LEAF: it does its own createCanvas + encode and is
// queued once, so it must never call another queued renderer (deadlock rule in
// render-queue.ts).
//
// The hub builds the HqRenderView (resolving card art URLs, rarity display via
// getCardDisplayRarity, and any sprite paths); this file never touches the DB.
// ─────────────────────────────────────────────────────────────────────────────

import {
  getCanvas, roundRectPath, hexToRgba, drawGradientBackground,
  type Ctx, type CanvasMod,
} from "../animations/engine.js";
import {
  loadArt, drawCardArt, drawCardFrame, drawRarityGlow,
  drawTextWithShadow, drawTitle, fitText, TITLE_FONT,
} from "../animations/effects.js";
import { drawAtmosphere, atmospherePreset } from "../animations/atmosphere.js";
import { queueRender } from "../animations/render-queue.js";
import { loadSprite } from "./assets.js";
import type { HqTheme } from "./defs/themes.js";
import type { DecoCategory } from "./defs/decorations.js";

const W = 1000, H = 560;
const HEADER_H = 66;
const FLOOR_TOP = 336;

// `ellipse` exists on the Skia 2D context at runtime but is under-declared on
// the project's Ctx type (same as drawImage's source-rect overload).
type EllipseCtx = { ellipse(x: number, y: number, rx: number, ry: number, rot: number, a0: number, a1: number): void };
function ellipse(ctx: Ctx, x: number, y: number, rx: number, ry: number, rot = 0): void {
  (ctx as unknown as EllipseCtx).ellipse(x, y, rx, ry, rot, 0, Math.PI * 2);
}

export interface HqRenderCard {
  cardId: number;
  name: string;
  artUrl: string | null;
  rarityLabel: string;
  rarityColor: number;
}

export interface HqRenderDeco {
  slot: number;
  category: DecoCategory;
  name: string;
  rarityColor: number;
  spritePath: string | null;
}

export interface HqRenderView {
  ownerName: string;
  // The banner name shown in the header. Defaults to "<ownerName>'s HQ" but a
  // player may set a custom HQ name (personalization) — the hub resolves it.
  displayTitle: string;
  ownerAvatarUrl: string | null;
  theme: HqTheme;
  roomName: string;
  roomEmoji: string;
  hqLevel: number;
  subtitle: string;
  pedestals: (HqRenderCard | null)[]; // length = room.pedestals
  decorations: HqRenderDeco[];        // placed decorations (with slot index)
}

// Fixed decoration anchors per slot index. `mount` only tips the procedural
// drawing (a wall mount hangs; a floor mount stands); the shape is self-
// contained so any category is valid at any anchor. Rooms with more slots than
// anchors wrap harmlessly.
interface Anchor { x: number; y: number; mount: "wall" | "floor"; scale: number }
const ANCHORS: Anchor[] = [
  { x: 130, y: 150, mount: "wall", scale: 1 },
  { x: 870, y: 150, mount: "wall", scale: 1 },
  { x: 500, y: 116, mount: "wall", scale: 0.9 },
  { x: 96,  y: 458, mount: "floor", scale: 1 },
  { x: 904, y: 458, mount: "floor", scale: 1 },
  { x: 500, y: 522, mount: "floor", scale: 0.8 },
];

export async function renderHq(view: HqRenderView): Promise<Buffer | null> {
  return queueRender("hq", async () => {
    const mod = await getCanvas();
    if (!mod) return null;
    try {
      const canvas = mod.createCanvas(W, H);
      const ctx = canvas.getContext("2d") as unknown as Ctx;

      layerRoom(ctx, view.theme);
      layerFloor(ctx, view.theme);
      layerLighting(ctx, view.theme);
      await layerDecorations(ctx, mod, view);
      await layerPedestals(ctx, mod, view);
      await layerHeader(ctx, mod, view);

      return await canvas.encode("png");
    } catch {
      return null;
    }
  });
}

// ── Layers ────────────────────────────────────────────────────────────────────

function layerRoom(ctx: Ctx, theme: HqTheme): void {
  // Back wall.
  const g = ctx.createLinearGradient(0, 0, 0, FLOOR_TOP);
  g.addColorStop(0, theme.palette.wallTop);
  g.addColorStop(1, theme.palette.wallBottom);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, FLOOR_TOP);

  // Faint wall paneling for texture.
  ctx.save();
  ctx.strokeStyle = hexToRgba(theme.palette.accent, 0.06);
  ctx.lineWidth = 2;
  for (let x = 120; x < W; x += 160) {
    ctx.beginPath(); ctx.moveTo(x, 24); ctx.lineTo(x, FLOOR_TOP - 12); ctx.stroke();
  }
  ctx.restore();
}

function layerFloor(ctx: Ctx, theme: HqTheme): void {
  // Perspective floor: inset back edge, full-width front edge.
  const inset = 150;
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(inset, FLOOR_TOP);
  ctx.lineTo(W - inset, FLOOR_TOP);
  ctx.lineTo(W, H);
  ctx.lineTo(0, H);
  ctx.closePath();
  const fg = ctx.createLinearGradient(0, FLOOR_TOP, 0, H);
  fg.addColorStop(0, theme.palette.floorFar);
  fg.addColorStop(1, theme.palette.floorNear);
  ctx.fillStyle = fg;
  ctx.fill();

  // Converging floor lines for depth.
  ctx.clip();
  ctx.strokeStyle = hexToRgba(theme.palette.accent, theme.lighting === "neon" ? 0.28 : 0.12);
  ctx.lineWidth = 1.5;
  const cx = W / 2;
  for (let i = -6; i <= 6; i++) {
    const frontX = cx + i * 120;
    ctx.beginPath(); ctx.moveTo(cx + i * 26, FLOOR_TOP); ctx.lineTo(frontX, H); ctx.stroke();
  }
  // A couple of horizontal depth bands.
  for (const [y, a] of [[FLOOR_TOP + 60, 0.10], [FLOOR_TOP + 140, 0.06]] as const) {
    ctx.strokeStyle = hexToRgba(theme.palette.accent, a);
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
  }
  ctx.restore();

  // Baseboard where wall meets floor.
  ctx.fillStyle = hexToRgba(theme.palette.accent, 0.18);
  ctx.fillRect(0, FLOOR_TOP - 3, W, 3);
}

function layerLighting(ctx: Ctx, theme: HqTheme): void {
  // Key light from above-centre.
  const r = ctx.createRadialGradient(W / 2, 60, 40, W / 2, 260, 720);
  r.addColorStop(0, theme.palette.light);
  r.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = r;
  ctx.fillRect(0, 0, W, H);

  // Ambient particles for depth (static frame → fixed phase).
  try {
    drawAtmosphere(ctx, W, H, atmospherePreset(theme.atmosphere), {
      seed: `hq-${theme.id}`, t: 0.35, color: theme.palette.accent, density: 0.5,
    });
  } catch { /* never break a render on ambience */ }

  // Vignette to focus the centre.
  const v = ctx.createRadialGradient(W / 2, H / 2, H * 0.35, W / 2, H / 2, W * 0.72);
  v.addColorStop(0, "rgba(0,0,0,0)");
  v.addColorStop(1, "rgba(0,0,0,0.5)");
  ctx.fillStyle = v;
  ctx.fillRect(0, 0, W, H);
}

async function layerDecorations(ctx: Ctx, mod: CanvasMod, view: HqRenderView): Promise<void> {
  for (const deco of view.decorations) {
    const a = ANCHORS[deco.slot % ANCHORS.length]!;
    if (deco.spritePath) {
      const img = await loadSprite(mod, deco.spritePath).catch(() => null);
      if (img) {
        const size = 96 * a.scale;
        (ctx as unknown as { drawImage(i: unknown, x: number, y: number, w: number, h: number): void })
          .drawImage(img, a.x - size / 2, a.y - size / 2, size, size);
        continue;
      }
    }
    drawDecoration(ctx, a, deco);
  }
}

async function layerPedestals(ctx: Ctx, mod: CanvasMod, view: HqRenderView): Promise<void> {
  const n = view.pedestals.length;
  if (n === 0) return;
  const cardW = 140, cardH = 182;
  const gap = (W - n * cardW) / (n + 1);
  for (let i = 0; i < n; i++) {
    const cx = gap * (i + 1) + cardW * i + cardW / 2;
    await drawPedestal(ctx, mod, cx, view.pedestals[i]!, view.theme, cardW, cardH);
  }
}

async function drawPedestal(
  ctx: Ctx, mod: CanvasMod, cx: number, card: HqRenderCard | null,
  theme: HqTheme, cardW: number, cardH: number,
): Promise<void> {
  const cardTop = 286;
  const cardX = cx - cardW / 2;
  const plinthTop = cardTop + cardH - 2;

  // Plinth (base the card stands on).
  ctx.save();
  const pw = cardW + 26, ph = 44;
  const px = cx - pw / 2, py = plinthTop;
  const pg = ctx.createLinearGradient(0, py, 0, py + ph);
  pg.addColorStop(0, hexToRgba(theme.palette.accent, 0.35));
  pg.addColorStop(1, hexToRgba(theme.palette.accent, 0.08));
  ctx.fillStyle = pg;
  roundRectPath(ctx, px, py, pw, ph, 8); ctx.fill();
  ctx.strokeStyle = hexToRgba(theme.palette.accent, 0.6); ctx.lineWidth = 1.5;
  roundRectPath(ctx, px, py, pw, ph, 8); ctx.stroke();
  // Soft floor shadow under the plinth.
  ctx.fillStyle = "rgba(0,0,0,0.35)";
  ctx.beginPath(); ellipse(ctx, cx, py + ph + 6, pw / 2, 10); ctx.fill();
  ctx.restore();

  if (!card) {
    // Empty glass case with a pin hint.
    drawGlassCase(ctx, cardX, cardTop, cardW, cardH, theme, 0x808895);
    ctx.save();
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    drawTitle(ctx, "+", cx, cardTop + cardH / 2 - 10, hexToRgba(theme.palette.accent, 0.8), 44);
    drawTextWithShadow(ctx, "Pin a card", cx, cardTop + cardH / 2 + 26, "rgba(230,230,235,0.75)", 14);
    ctx.restore();
    return;
  }

  // Rarity glow, card art, frame — reusing the card primitives.
  drawRarityGlow(ctx, cardX, cardTop, cardW, cardH, card.rarityColor, 0.55);
  await drawCardArt(ctx, mod, cardX, cardTop, cardW, cardH, card.artUrl);
  drawCardFrame(ctx, cardX, cardTop, cardW, cardH, card.rarityColor, 5);
  drawGlassCase(ctx, cardX, cardTop, cardW, cardH, theme, card.rarityColor);

  // Nameplate below the plinth.
  ctx.save();
  ctx.textAlign = "center"; ctx.textBaseline = "middle";
  const nameY = plinthTop + 44 + 20;
  const nameSize = fitText(ctx, card.name, cardW + 40, 18, 12, TITLE_FONT);
  drawTitle(ctx, card.name, cx, nameY, "#ffffff", nameSize);
  drawTextWithShadow(ctx, card.rarityLabel.toUpperCase(), cx, nameY + 18, hexToRgba(card.rarityColor, 1), 12);
  ctx.restore();
}

// A glass display case: subtle tinted fill + rim highlight + a diagonal sheen.
function drawGlassCase(ctx: Ctx, x: number, y: number, w: number, h: number, theme: HqTheme, tint: number): void {
  ctx.save();
  roundRectPath(ctx, x - 6, y - 6, w + 12, h + 12, 14);
  ctx.clip();
  ctx.fillStyle = theme.palette.glass;
  ctx.fillRect(x - 6, y - 6, w + 12, h + 12);
  // Diagonal sheen.
  const s = ctx.createLinearGradient(x - 6, y - 6, x + w, y + h);
  s.addColorStop(0, "rgba(255,255,255,0.14)");
  s.addColorStop(0.45, "rgba(255,255,255,0.03)");
  s.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = s;
  ctx.fillRect(x - 6, y - 6, w + 12, h + 12);
  ctx.restore();
  // Rim.
  ctx.save();
  ctx.strokeStyle = hexToRgba(tint, 0.5); ctx.lineWidth = 2;
  roundRectPath(ctx, x - 6, y - 6, w + 12, h + 12, 14); ctx.stroke();
  ctx.restore();
}

async function layerHeader(ctx: Ctx, mod: CanvasMod, view: HqRenderView): Promise<void> {
  // Header band.
  ctx.save();
  const g = ctx.createLinearGradient(0, 0, W, 0);
  g.addColorStop(0, "rgba(0,0,0,0.62)");
  g.addColorStop(1, "rgba(0,0,0,0.32)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, HEADER_H);
  ctx.fillStyle = hexToRgba(view.theme.palette.accent, 0.8);
  ctx.fillRect(0, HEADER_H, W, 2);
  ctx.restore();

  // Avatar.
  const av = 46, ax = 18, ay = (HEADER_H - av) / 2;
  if (view.ownerAvatarUrl) {
    const img = await loadArt(mod, view.ownerAvatarUrl).catch(() => null);
    if (img) {
      ctx.save();
      ctx.beginPath(); ctx.arc(ax + av / 2, ay + av / 2, av / 2, 0, Math.PI * 2); ctx.clip();
      const iw = (img as { width: number }).width, ih = (img as { height: number }).height;
      const sc = Math.max(av / iw, av / ih);
      (ctx as unknown as { drawImage(i: unknown, x: number, y: number, w: number, h: number): void })
        .drawImage(img, ax + (av - iw * sc) / 2, ay + (av - ih * sc) / 2, iw * sc, ih * sc);
      ctx.restore();
      ctx.save();
      ctx.strokeStyle = hexToRgba(view.theme.palette.accent, 1); ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(ax + av / 2, ay + av / 2, av / 2, 0, Math.PI * 2); ctx.stroke();
      ctx.restore();
    }
  }

  // Owner name + subtitle.
  ctx.save();
  ctx.textAlign = "left"; ctx.textBaseline = "middle";
  const tx = ax + av + 14;
  // Left-align the banner name (drawTitle centres by default) so it starts at the
  // avatar and a long/custom HQ name grows rightward instead of clipping the edge.
  drawTitle(ctx, view.displayTitle, tx, 24, "#ffffff", fitText(ctx, view.displayTitle, 520, 22, 14, TITLE_FONT), "left");
  drawTextWithShadow(ctx, view.subtitle, tx, 46, "rgba(225,225,230,0.85)", 13, "left");
  ctx.restore();

  // Right side: theme name + HQ level chip.
  ctx.save();
  ctx.textAlign = "right"; ctx.textBaseline = "middle";
  drawTextWithShadow(ctx, `${view.roomEmoji} ${view.roomName}`, W - 18, 22, "rgba(235,235,240,0.9)", 14, "right");
  const chip = `HQ LV ${view.hqLevel}`;
  ctx.font = `bold 13px "${TITLE_FONT}", "DejaVu Sans", Arial, sans-serif`;
  const cw = ctx.measureText(chip).width + 22;
  const cxp = W - 18 - cw, cyp = 38;
  ctx.fillStyle = hexToRgba(view.theme.palette.accent, 0.22);
  roundRectPath(ctx, cxp, cyp, cw, 20, 10); ctx.fill();
  ctx.strokeStyle = hexToRgba(view.theme.palette.accent, 0.8); ctx.lineWidth = 1;
  roundRectPath(ctx, cxp, cyp, cw, 20, 10); ctx.stroke();
  ctx.textAlign = "center";
  drawTextWithShadow(ctx, chip, cxp + cw / 2, cyp + 10, "#ffffff", 12);
  ctx.restore();
}

// ── Procedural decorations ────────────────────────────────────────────────────
// Each category draws a compact, self-contained glyph tinted by the decoration's
// rarity colour with a soft glow, so a placed decoration always reads as
// intentional. An asset pack later replaces these per-category/​per-id.
function drawDecoration(ctx: Ctx, a: Anchor, deco: HqRenderDeco): void {
  const s = 60 * a.scale;
  const col = deco.rarityColor;
  ctx.save();
  ctx.translate(a.x, a.y);
  // Glow.
  ctx.shadowColor = hexToRgba(col, 0.7);
  ctx.shadowBlur = 18;

  switch (deco.category) {
    case "banner": {
      ctx.fillStyle = hexToRgba(col, 0.9);
      ctx.beginPath();
      ctx.moveTo(-s * 0.3, -s * 0.55); ctx.lineTo(s * 0.3, -s * 0.55);
      ctx.lineTo(s * 0.3, s * 0.4); ctx.lineTo(0, s * 0.55); ctx.lineTo(-s * 0.3, s * 0.4);
      ctx.closePath(); ctx.fill();
      ctx.shadowBlur = 0;
      ctx.fillStyle = "rgba(255,255,255,0.85)";
      ctx.beginPath(); ctx.arc(0, -s * 0.05, s * 0.13, 0, Math.PI * 2); ctx.fill();
      break;
    }
    case "emblem": {
      ctx.fillStyle = hexToRgba(col, 0.9);
      ctx.beginPath(); ctx.arc(0, 0, s * 0.42, 0, Math.PI * 2); ctx.fill();
      ctx.shadowBlur = 0;
      ctx.strokeStyle = "rgba(255,255,255,0.85)"; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(0, 0, s * 0.24, 0, Math.PI * 2); ctx.stroke();
      break;
    }
    case "trophy": {
      ctx.fillStyle = hexToRgba(col, 0.95);
      ctx.beginPath();
      ctx.moveTo(-s * 0.28, -s * 0.4); ctx.lineTo(s * 0.28, -s * 0.4);
      ctx.quadraticCurveTo(s * 0.28, s * 0.05, 0, s * 0.12);
      ctx.quadraticCurveTo(-s * 0.28, s * 0.05, -s * 0.28, -s * 0.4);
      ctx.closePath(); ctx.fill();
      ctx.shadowBlur = 0;
      ctx.fillRect(-s * 0.06, s * 0.12, s * 0.12, s * 0.2);      // stem
      ctx.fillRect(-s * 0.22, s * 0.32, s * 0.44, s * 0.1);       // base
      break;
    }
    case "statue": {
      ctx.fillStyle = hexToRgba(col, 0.5);
      ctx.fillRect(-s * 0.26, s * 0.2, s * 0.52, s * 0.28);       // pedestal
      ctx.shadowBlur = 0;
      ctx.fillStyle = hexToRgba(col, 0.95);
      ctx.beginPath(); ctx.arc(0, -s * 0.16, s * 0.14, 0, Math.PI * 2); ctx.fill(); // head
      ctx.beginPath();
      ctx.moveTo(0, -s * 0.02); ctx.lineTo(s * 0.16, s * 0.2); ctx.lineTo(-s * 0.16, s * 0.2);
      ctx.closePath(); ctx.fill();                                // body
      break;
    }
    case "monument": {
      ctx.fillStyle = hexToRgba(col, 0.9);
      ctx.beginPath();
      ctx.moveTo(-s * 0.12, s * 0.5); ctx.lineTo(-s * 0.06, -s * 0.55);
      ctx.lineTo(s * 0.06, -s * 0.55); ctx.lineTo(s * 0.12, s * 0.5);
      ctx.closePath(); ctx.fill();
      ctx.shadowBlur = 0;
      ctx.fillStyle = hexToRgba(col, 0.5);
      ctx.fillRect(-s * 0.22, s * 0.5, s * 0.44, s * 0.12);       // base
      break;
    }
    case "plant": {
      ctx.shadowBlur = 0;
      ctx.fillStyle = hexToRgba(0xc58b4a, 0.95);
      ctx.beginPath();
      ctx.moveTo(-s * 0.2, s * 0.12); ctx.lineTo(s * 0.2, s * 0.12);
      ctx.lineTo(s * 0.14, s * 0.5); ctx.lineTo(-s * 0.14, s * 0.5);
      ctx.closePath(); ctx.fill();                                // pot
      ctx.shadowColor = hexToRgba(0x2ecc71, 0.6); ctx.shadowBlur = 12;
      ctx.fillStyle = hexToRgba(0x2ecc71, 0.95);
      for (const dx of [-0.16, 0, 0.16]) {
        ctx.beginPath();
        ellipse(ctx, dx * s, -s * 0.08, s * 0.08, s * 0.24, dx); ctx.fill();
      }
      break;
    }
    case "light": {
      ctx.shadowColor = hexToRgba(col, 0.9); ctx.shadowBlur = 26;
      ctx.fillStyle = hexToRgba(col, 0.95);
      ctx.beginPath();
      ctx.moveTo(0, -s * 0.42);
      ctx.quadraticCurveTo(s * 0.24, 0, 0, s * 0.42);
      ctx.quadraticCurveTo(-s * 0.24, 0, 0, -s * 0.42);
      ctx.closePath(); ctx.fill();
      ctx.shadowBlur = 0;
      ctx.fillStyle = "rgba(255,255,255,0.9)";
      ctx.beginPath(); ctx.arc(0, 0, s * 0.1, 0, Math.PI * 2); ctx.fill();
      break;
    }
    case "case": {
      ctx.strokeStyle = hexToRgba(col, 0.9); ctx.lineWidth = 3;
      roundRectPath(ctx, -s * 0.3, -s * 0.42, s * 0.6, s * 0.84, 6); ctx.stroke();
      ctx.shadowBlur = 0;
      ctx.fillStyle = hexToRgba(col, 0.16);
      roundRectPath(ctx, -s * 0.3, -s * 0.42, s * 0.6, s * 0.84, 6); ctx.fill();
      ctx.fillStyle = "rgba(255,255,255,0.5)";
      ctx.fillRect(-s * 0.22, -s * 0.34, s * 0.12, s * 0.68);     // sheen
      break;
    }
    case "crystal": {
      // Faceted gem: two mirrored triangles with a bright inner core.
      ctx.shadowColor = hexToRgba(col, 0.9); ctx.shadowBlur = 24;
      ctx.fillStyle = hexToRgba(col, 0.95);
      ctx.beginPath();
      ctx.moveTo(0, -s * 0.5); ctx.lineTo(s * 0.3, -s * 0.05);
      ctx.lineTo(0, s * 0.5); ctx.lineTo(-s * 0.3, -s * 0.05);
      ctx.closePath(); ctx.fill();
      ctx.shadowBlur = 0;
      ctx.fillStyle = "rgba(255,255,255,0.65)";
      ctx.beginPath();
      ctx.moveTo(0, -s * 0.5); ctx.lineTo(s * 0.12, -s * 0.05);
      ctx.lineTo(0, s * 0.18); ctx.lineTo(-s * 0.12, -s * 0.05);
      ctx.closePath(); ctx.fill();
      break;
    }
    case "rug": {
      // A flat floor rug drawn in perspective (wider at the front) with a border.
      ctx.shadowBlur = 0;
      ctx.fillStyle = hexToRgba(col, 0.85);
      ctx.beginPath();
      ctx.moveTo(-s * 0.34, s * 0.14); ctx.lineTo(s * 0.34, s * 0.14);
      ctx.lineTo(s * 0.5, s * 0.5); ctx.lineTo(-s * 0.5, s * 0.5);
      ctx.closePath(); ctx.fill();
      ctx.strokeStyle = "rgba(255,255,255,0.7)"; ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(-s * 0.26, s * 0.2); ctx.lineTo(s * 0.26, s * 0.2);
      ctx.lineTo(s * 0.38, s * 0.44); ctx.lineTo(-s * 0.38, s * 0.44);
      ctx.closePath(); ctx.stroke();
      break;
    }
  }
  ctx.restore();
}
