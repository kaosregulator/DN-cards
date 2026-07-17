// Shared visual effects for the animation system.
// All drawing helpers assume an HTMLCanvasContext2D from @napi-rs/canvas and are
// frame-agnostic (they take a normalized time t ∈ [0,1] to drive motion).

import type { Rarity } from "../cards-data.js";
import {
  hexToRgba, roundRectPath, lerp, easeOutBack, easeInOutCubic, easeOutElastic,
  clamp01, type CanvasMod, type Ctx, type TextAlign,
} from "./engine.js";
import { ObjectStorageService } from "../../lib/objectStorage.js";
import { logger } from "../../lib/logger.js";

export interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;     // 0 → 1
  size: number;
  color: string;
  drag: number;
}

export function createBurst(
  x: number, y: number, color: number, count: number, spread = 120,
): Particle[] {
  const particles: Particle[] = [];
  for (let i = 0; i < count; i++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = 2 + Math.random() * 6;
    particles.push({
      x, y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      life: 1,
      size: 2 + Math.random() * 5,
      color: hexToRgba(color, 1),
      drag: 0.92 + Math.random() * 0.05,
    });
  }
  return particles;
}

export function updateParticles(particles: Particle[]): Particle[] {
  const alive: Particle[] = [];
  for (const p of particles) {
    p.x += p.vx;
    p.y += p.vy;
    p.vx *= p.drag;
    p.vy *= p.drag;
    p.life -= 0.015;
    if (p.life > 0) alive.push(p);
  }
  return alive;
}

export function drawParticles(ctx: Ctx, particles: Particle[]): void {
  for (const p of particles) {
    ctx.globalAlpha = Math.max(0, p.life);
    ctx.fillStyle = p.color;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

export function drawRarityGlow(
  ctx: Ctx,
  x: number, y: number, w: number, h: number,
  color: number, intensity: number,
): void {
  ctx.save();
  ctx.shadowColor = hexToRgba(color, intensity);
  ctx.shadowBlur = 40 + intensity * 60;
  ctx.strokeStyle = hexToRgba(color, intensity);
  ctx.lineWidth = 4;
  roundRectPath(ctx, x, y, w, h, 18);
  ctx.stroke();
  ctx.restore();
}

export function drawFoilOverlay(
  ctx: Ctx,
  x: number, y: number, w: number, h: number,
  t: number,
): void {
  // Subtle diagonal rainbow sheen that sweeps across the card.
  ctx.save();
  roundRectPath(ctx, x, y, w, h, 18);
  ctx.clip();
  const offset = (t * 2.5 - 0.5) * (w + h);
  const g = ctx.createLinearGradient(
    x + offset - h, y,
    x + offset, y + h,
  );
  g.addColorStop(0, "rgba(255,255,255,0)");
  g.addColorStop(0.3, "rgba(255,255,255,0.12)");
  g.addColorStop(0.5, "rgba(180,255,255,0.16)");
  g.addColorStop(0.7, "rgba(255,255,255,0.12)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(x, y, w, h);
  ctx.restore();
}

export function drawHoloSparkles(
  ctx: Ctx,
  x: number, y: number, w: number, h: number,
  t: number, density = 12,
): void {
  ctx.save();
  roundRectPath(ctx, x, y, w, h, 18);
  ctx.clip();
  const seed = (n: number) => ((Math.sin(n * 127.1) * 43758.5453) % 1 + 1) % 1;
  for (let i = 0; i < density; i++) {
    const sx = x + seed(i) * w;
    const sy = y + seed(i + 100) * h;
    const twinkle = Math.sin(t * Math.PI * 2 + i * 1.3) * 0.5 + 0.5;
    ctx.globalAlpha = twinkle * 0.8;
    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    ctx.arc(sx, sy, 1.5 + twinkle * 2, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
  ctx.globalAlpha = 1;
}

export function drawDamageNumber(
  ctx: Ctx,
  amount: number, x: number, y: number,
  t: number, crit = false, miss = false,
): void {
  const popT = clamp01(t * 3);
  const fadeT = clamp01((t - 0.5) * 2);
  const scale = 1 + easeOutBack(popT) * (crit ? 1.2 : 0.6);
  const yOff = -popT * 60 * (crit ? 1.3 : 1);
  ctx.save();
  ctx.translate(x, y + yOff);
  ctx.scale(scale, scale);
  ctx.globalAlpha = 1 - fadeT;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = `bold ${crit ? 52 : 38}px "DejaVu Sans", Arial, sans-serif`;
  ctx.lineWidth = 6; ctx.strokeStyle = "rgba(0,0,0,0.8)";
  const text = miss ? "MISS" : (crit ? `${amount.toLocaleString()}!` : `-${amount.toLocaleString()}`);
  ctx.strokeText(text, 0, 0);
  ctx.fillStyle = miss ? "#95a5a6" : (crit ? "#ff3333" : "#ffffff");
  ctx.fillText(text, 0, 0);
  ctx.restore();
  ctx.globalAlpha = 1;
}

export function drawHealthBar(
  ctx: Ctx,
  x: number, y: number, width: number, height: number,
  current: number, max: number, color: number,
  t: number, previousCurrent: number,
): void {
  const pct = Math.max(0, Math.min(1, current / Math.max(1, max)));
  const prevPct = Math.max(0, Math.min(1, previousCurrent / Math.max(1, max)));
  const animatedPct = lerp(prevPct, pct, easeInOutCubic(t));
  const barW = width * animatedPct;
  ctx.save();
  ctx.fillStyle = "rgba(20,20,24,0.85)";
  roundRectPath(ctx, x, y, width, height, height / 2);
  ctx.fill();
  if (barW > 0) {
    ctx.fillStyle = hexToRgba(color, 1);
    roundRectPath(ctx, x, y, barW, height, height / 2);
    ctx.fill();
  }
  ctx.lineWidth = 2; ctx.strokeStyle = "rgba(255,255,255,0.25)";
  roundRectPath(ctx, x, y, width, height, height / 2);
  ctx.stroke();
  ctx.restore();
}

export function drawScreenFlash(
  ctx: Ctx,
  width: number, height: number,
  t: number, color: number,
): void {
  const peak = 0.15;
  const a = t < peak ? t / peak : 1 - (t - peak) / (1 - peak);
  ctx.fillStyle = hexToRgba(color, Math.max(0, a) * 0.35);
  ctx.fillRect(0, 0, width, height);
}

export function drawShineSweep(
  ctx: Ctx,
  x: number, y: number, w: number, h: number,
  t: number, color: number,
): void {
  ctx.save();
  roundRectPath(ctx, x, y, w, h, 18);
  ctx.clip();
  const sweep = (t * 1.8 - 0.4) * (w + h);
  const g = ctx.createLinearGradient(x + sweep - h, y, x + sweep, y + h);
  g.addColorStop(0, "rgba(255,255,255,0)");
  g.addColorStop(0.5, hexToRgba(color, 0.35));
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(x, y, w, h);
  ctx.restore();
}

export function fitText(
  ctx: Ctx,
  text: string,
  maxWidth: number,
  maxPx: number,
  minPx = 12,
): number {
  ctx.font = `bold ${maxPx}px "DejaVu Sans", Arial, sans-serif`;
  const w = ctx.measureText(text).width;
  if (w <= maxWidth || maxPx <= minPx) return maxPx;
  return Math.max(minPx, maxPx * (maxWidth / w));
}

export function drawTextWithShadow(
  ctx: Ctx,
  text: string,
  x: number, y: number,
  color: string, fontSize: number, align: TextAlign = "center",
): void {
  ctx.save();
  ctx.textAlign = align;
  ctx.textBaseline = "middle";
  ctx.font = `bold ${fontSize}px "DejaVu Sans", Arial, sans-serif`;
  ctx.lineWidth = 5; ctx.strokeStyle = "rgba(0,0,0,0.85)";
  ctx.strokeText(text, x, y);
  ctx.fillStyle = color;
  ctx.fillText(text, x, y);
  ctx.restore();
}

// Small LRU-ish cache of decoded card art. Every animation frame draws the same
// handful of card images, so without this we'd re-download + re-decode the same
// URL dozens of times per GIF. Keyed by URL; capped so it can't grow unbounded.
type LoadedImage = import("@napi-rs/canvas").Image;
const ART_CACHE_MAX = 128;
const artCache = new Map<string, Promise<LoadedImage | null>>();

const storage = new ObjectStorageService();

function extractObjectStoragePath(url: string): string | null {
  if (url.startsWith("/objects/")) return url;
  try {
    const u = new URL(url);
    const prefix = "/api/storage/objects/";
    const idx = u.pathname.indexOf(prefix);
    if (idx !== -1) return u.pathname.slice(idx + "/api/storage".length);
  } catch {
    // not a URL
  }
  return null;
}

async function loadObjectStorageImage(objectPath: string): Promise<Buffer | null> {
  try {
    const file = await storage.getObjectEntityFile(objectPath);
    const [buffer] = await file.download();
    return buffer;
  } catch (err) {
    logger.warn({ err, objectPath }, "Failed to download object-storage image for canvas");
    return null;
  }
}

export async function loadArt(mod: CanvasMod, url: string | null | undefined): Promise<LoadedImage | null> {
  if (!url) return null;
  const cached = artCache.get(url);
  if (cached) return cached;

  const promise = (async (): Promise<LoadedImage | null> => {
    // If the URL is one of our object-storage paths, load it directly from GCS
    // so server-side canvas rendering doesn't depend on the public HTTP domain.
    const objectPath = extractObjectStoragePath(url);
    if (objectPath) {
      const buffer = await loadObjectStorageImage(objectPath);
      if (buffer) {
        try {
          return await mod.loadImage(buffer);
        } catch (err) {
          logger.warn({ err, objectPath }, "Canvas failed to decode object-storage image");
        }
      }
      // Fall back to the public URL if direct download fails.
    }
    try {
      return await mod.loadImage(url);
    } catch (err) {
      logger.warn({ err, url }, "Canvas failed to load image by URL");
      return null;
    }
  })();

  artCache.set(url, promise);
  // Evict oldest insertion once over capacity (Map preserves insertion order).
  if (artCache.size > ART_CACHE_MAX) {
    const oldest = artCache.keys().next().value;
    if (oldest !== undefined) artCache.delete(oldest);
  }
  return promise;
}

export async function drawCardArt(
  ctx: Ctx,
  mod: CanvasMod,
  x: number, y: number, w: number, h: number,
  artUrl: string | null | undefined,
): Promise<void> {
  const img = await loadArt(mod, artUrl);
  ctx.save();
  roundRectPath(ctx, x, y, w, h, 14);
  ctx.clip();
  ctx.fillStyle = "#0e0e12";
  ctx.fillRect(x, y, w, h);
  if (img) {
    const s = Math.max(w / img.width, h / img.height);
    const dw = img.width * s, dh = img.height * s;
    ctx.drawImage(img, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
  }
  ctx.restore();
}

export function drawCardFrame(
  ctx: Ctx,
  x: number, y: number, w: number, h: number,
  color: number, thickness = 6,
): void {
  ctx.save();
  ctx.lineWidth = thickness;
  ctx.strokeStyle = hexToRgba(color, 1);
  roundRectPath(ctx, x, y, w, h, 18);
  ctx.stroke();
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = "rgba(255,255,255,0.25)";
  roundRectPath(ctx, x + thickness, y + thickness, w - thickness * 2, h - thickness * 2, 14);
  ctx.stroke();
  ctx.restore();
}

export function drawRarityBadge(
  ctx: Ctx,
  x: number, y: number, label: string, color: number,
): void {
  ctx.save();
  ctx.font = 'bold 16px "DejaVu Sans", Arial, sans-serif';
  const bw = Math.max(76, ctx.measureText(label).width + 22);
  ctx.fillStyle = "rgba(20,20,24,0.85)";
  roundRectPath(ctx, x - bw, y, bw, 30, 6);
  ctx.fill();
  ctx.lineWidth = 1.5; ctx.strokeStyle = hexToRgba(color, 1);
  ctx.stroke();
  ctx.fillStyle = "#ffffff";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(label, x - bw / 2, y + 15);
  ctx.restore();
}

export function getRarityEffectColor(rarity: Rarity): number {
  switch (rarity) {
    case "common": return 0x95a5a6;
    case "uncommon": return 0x2ecc71;
    case "rare": return 0x3498db;
    case "epic": return 0x9b59b6;
    case "legendary": return 0xf39c12;
    case "mythic": return 0xff2d92;
  }
}

export function rarityBurstCount(rarity: Rarity): number {
  switch (rarity) {
    case "common": return 20;
    case "uncommon": return 35;
    case "rare": return 55;
    case "epic": return 80;
    case "legendary": return 120;
    case "mythic": return 180;
  }
}
