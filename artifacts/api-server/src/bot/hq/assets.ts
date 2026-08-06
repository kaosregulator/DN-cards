// ─────────────────────────────────────────────────────────────────────────────
// HQ — asset manager.
//
// The ONLY bridge between the HQ renderer and any bundled/uploaded art. The
// renderer never reads files or knows about themes' art directly; it asks
// `spriteFor(theme, key)` and, if it gets a path back, blits it — otherwise it
// draws the element procedurally. That single seam is what lets a future theme
// pack (Military, Anime, Fantasy, …) replace the procedural look with zero code
// changes, and it means Phase 1 ships with no art at all.
//
// Directory resolution copies the dev/prod pattern from
// animations/arena-bg.ts:resolveArenasDir (assets ship from the repo tree, not
// the esbuild bundle, so cwd-relative fallbacks carry production).
// ─────────────────────────────────────────────────────────────────────────────

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { HqTheme } from "./defs/themes.js";
import { logger } from "../../lib/logger.js";

// manifest.json (when present) enumerates which sprite keys have art, so the
// renderer can decide procedural-vs-art without a filesystem stat per element.
interface HqManifest {
  // Map of "<themePrefix>/<key>" (and bare "<key>") → relative PNG file name.
  sprites?: Record<string, string>;
}

function resolveHqDir(): string | null {
  const candidates = [
    fileURLToPath(new URL("../../../assets/hq/", import.meta.url)),
    join(process.cwd(), "assets/hq"),
    join(process.cwd(), "artifacts/api-server/assets/hq"),
  ];
  for (const dir of candidates) {
    if (existsSync(join(dir, "manifest.json"))) return dir;
  }
  return null;
}

let _dir: string | null | undefined;
let _manifest: HqManifest | null | undefined;

function manifest(): { dir: string; manifest: HqManifest } | null {
  if (_dir === undefined) _dir = resolveHqDir();
  if (!_dir) return null;
  if (_manifest === undefined) {
    try {
      _manifest = JSON.parse(readFileSync(join(_dir, "manifest.json"), "utf8")) as HqManifest;
    } catch (err) {
      logger.debug({ err }, "hq-assets: failed to read manifest");
      _manifest = null;
    }
  }
  return _manifest ? { dir: _dir, manifest: _manifest } : null;
}

/** True when an HQ asset pack is bundled (gates any "art available" UI/feature). */
export function hqAssetsAvailable(): boolean {
  return manifest() !== null;
}

// Resolve a sprite for a theme. Tries the theme-specific key first
// ("<prefix>/<key>"), then a shared key ("<key>"). Returns an absolute file path
// or null. Phase 1 ships no manifest, so this always returns null → procedural.
export function spriteFor(theme: HqTheme, key: string): string | null {
  const m = manifest();
  if (!m) return null;
  const sprites = m.manifest.sprites ?? {};
  const rel = sprites[`${theme.spritePrefix}/${key}`] ?? sprites[key];
  if (!rel) return null;
  const path = join(m.dir, rel);
  return existsSync(path) ? path : null;
}

// Decoded-image cache shared across renders (a busy channel re-renders the same
// theme repeatedly). Keyed by absolute path; promise-cached so concurrent
// renders share one decode, matching arena-bg.ts:stripCache.
type LoadedImage = import("@napi-rs/canvas").Image;
const spriteCache = new Map<string, Promise<LoadedImage | null>>();
const SPRITE_CACHE_MAX = 128;

export function loadSprite(
  mod: typeof import("@napi-rs/canvas"), path: string,
): Promise<LoadedImage | null> {
  const cached = spriteCache.get(path);
  if (cached) return cached;
  const p = (async (): Promise<LoadedImage | null> => {
    try {
      return await mod.loadImage(readFileSync(path));
    } catch (err) {
      logger.debug({ err, path }, "hq-assets: failed to decode sprite");
      return null;
    }
  })();
  spriteCache.set(path, p);
  if (spriteCache.size > SPRITE_CACHE_MAX) {
    const oldest = spriteCache.keys().next().value;
    if (oldest !== undefined) spriteCache.delete(oldest);
  }
  return p;
}
