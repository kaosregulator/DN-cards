// ─────────────────────────────────────────────────────────────────────────────
// Animated arena backgrounds — draws a looping pixel-art atmospheric backdrop
// behind the battle scene. Frames come from a bundled horizontal strip
// (assets/arenas/<key>.png, FRAMES tiles of FRAME_W×FRAME_H) built by
// scripts/build-arenas.mjs. The strip is decoded ONCE per arena and cached; each
// GIF frame just blits the current tile scaled to fill, so it adds negligible
// cost on top of the existing battle render.
//
// Every helper degrades gracefully: unknown key, missing file, or canvas-off →
// returns false so the caller keeps the procedural atmosphere fallback. It never
// throws and never blocks a battle.
// ─────────────────────────────────────────────────────────────────────────────

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { CanvasMod, Ctx } from "./engine.js";
import { logger } from "../../lib/logger.js";

type LoadedImage = import("@napi-rs/canvas").Image;

interface ArenaManifest { frameW: number; frameH: number; frames: number; }

// Resolve the bundled arenas dir across dev (tsx from src) and prod (bundled
// dist), mirroring engine.ts resolveFontsDir.
function resolveArenasDir(): string | null {
  const candidates = [
    fileURLToPath(new URL("../../../assets/arenas/", import.meta.url)),
    join(process.cwd(), "assets/arenas"),
    join(process.cwd(), "artifacts/api-server/assets/arenas"),
  ];
  for (const dir of candidates) {
    if (existsSync(join(dir, "manifest.json"))) return dir;
  }
  return null;
}

let _manifest: ArenaManifest | null | undefined;
function manifest(): ArenaManifest | null {
  if (_manifest !== undefined) return _manifest;
  const dir = resolveArenasDir();
  if (!dir) { _manifest = null; return null; }
  try {
    _manifest = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8")) as ArenaManifest;
  } catch (err) {
    logger.debug({ err }, "arena-bg: failed to read manifest");
    _manifest = null;
  }
  return _manifest;
}

// Decoded strip image per arena key (promise cached so concurrent renders share
// one decode). null = unavailable → caller falls back.
const stripCache = new Map<string, Promise<LoadedImage | null>>();

function loadStrip(mod: CanvasMod, key: string): Promise<LoadedImage | null> {
  const cached = stripCache.get(key);
  if (cached) return cached;
  const p = (async (): Promise<LoadedImage | null> => {
    const dir = resolveArenasDir();
    if (!dir) return null;
    const file = join(dir, `${key}.png`);
    if (!existsSync(file)) return null;
    try {
      return await mod.loadImage(readFileSync(file));
    } catch (err) {
      logger.debug({ err, key }, "arena-bg: failed to decode arena strip");
      return null;
    }
  })();
  stripCache.set(key, p);
  return p;
}

/**
 * Draw the arena's looping backdrop for phase t∈[0,1], cover-fit to (width,
 * height), with a dark readability wash on top. Returns false if the arena
 * couldn't be drawn (caller should fall back to the procedural atmosphere).
 */
export async function drawArenaBackground(
  ctx: Ctx, mod: CanvasMod, key: string | null | undefined, t: number, width: number, height: number,
): Promise<boolean> {
  if (!key) return false;
  const m = manifest();
  const strip = await loadStrip(mod, key);
  if (!m || !strip) return false;

  const frame = Math.min(m.frames - 1, Math.max(0, Math.floor((t % 1) * m.frames)));
  const sx = frame * m.frameW;

  // Cover-fit the single tile to fill the canvas.
  const s = Math.max(width / m.frameW, height / m.frameH);
  const dw = m.frameW * s, dh = m.frameH * s;
  const dx = (width - dw) / 2, dy = (height - dh) / 2;

  ctx.save();
  // Keep the pixel art crisp when upscaled. `imageSmoothingEnabled` exists on the
  // Skia context at runtime but is under-declared on the project's Ctx type.
  (ctx as unknown as { imageSmoothingEnabled: boolean }).imageSmoothingEnabled = false;
  // @napi-rs/canvas supports the 9-arg source-rect drawImage.
  (ctx as unknown as {
    drawImage(img: LoadedImage, sx: number, sy: number, sw: number, sh: number, dx: number, dy: number, dw: number, dh: number): void;
  }).drawImage(strip, sx, 0, m.frameW, m.frameH, dx, dy, dw, dh);
  // Readability wash so foreground cards + HUD stay legible over any backdrop.
  ctx.fillStyle = "rgba(6,8,14,0.42)";
  ctx.fillRect(0, 0, width, height);
  ctx.restore();
  return true;
}

/** True if the bundled arena assets are present (used to gate UI/features). */
export function arenaAssetsAvailable(): boolean {
  return manifest() !== null;
}
