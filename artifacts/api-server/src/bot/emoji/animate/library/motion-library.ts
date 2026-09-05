// ─────────────────────────────────────────────────────────────────────────────
// Motion library loader.
//
// The engine draws its movements from one flat pool of tracks. That pool is:
//
//   builtin tracks           always present (builtin-tracks.ts) — the offline
//                            default and safety net, one good piece per region
//        +
//   harvested Noto tracks    data/noto-motion-library.json, written by
//                            scripts/animate-harvest-noto.mjs from the real
//                            Lottie files — the "every emoji's movement" corpus
//
// Merged, with Noto tracks preferred (they come first, so the planner reaches
// for real borrowed motion and falls back to builtin only where Noto is thin).
// The data file is optional: if it is missing or unreadable the engine still
// works on the builtin set alone, and logs which it used.
// ─────────────────────────────────────────────────────────────────────────────

import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { logger } from "../../../../lib/logger.js";
import type { MotionLibrary, MotionLibraryFile, MotionTrack, Region } from "../types.js";
import { REGIONS } from "../types.js";
import { BUILTIN_TRACKS } from "./builtin-tracks.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FILE_NAME = "noto-motion-library.json";

/**
 * Candidate locations for the harvested file, in priority order. esbuild emits
 * only the JS graph, so the same probe-the-candidates trick the offline provider
 * uses (registry.ts) is needed: the file may sit in the source tree during dev,
 * or be copied next to the bundle in dist, or under the package's data/ dir.
 * The first that exists wins; none existing is a supported mode (builtin only).
 */
function dataFileCandidates(): string[] {
  // An explicit override is authoritative — no fallthrough, so pointing it at a
  // path that doesn't exist is a supported way to force the builtin-only set.
  if (process.env.ANIMATE_MOTION_LIBRARY) return [process.env.ANIMATE_MOTION_LIBRARY];
  return [
    // Next to the running module (dist bundle, or this source dir).
    path.resolve(HERE, FILE_NAME),
    path.resolve(HERE, "..", FILE_NAME),
    // The api-server data/ dir, from source and relative to cwd.
    path.resolve(HERE, "../../../../../data", FILE_NAME),
    path.resolve(process.cwd(), "data", FILE_NAME),
    path.resolve(process.cwd(), FILE_NAME),
  ];
}

function dataFilePath(): string | null {
  for (const p of dataFileCandidates()) {
    if (existsSync(p)) return p;
  }
  return null;
}

let cached: MotionLibrary | null = null;
let loading: Promise<MotionLibrary> | null = null;

/** Basic shape guard — a track must have an id, a known region and channels. */
function isValidTrack(t: unknown): t is MotionTrack {
  if (!t || typeof t !== "object") return false;
  const r = t as Partial<MotionTrack>;
  return (
    typeof r.id === "string" &&
    typeof r.region === "string" &&
    (REGIONS as readonly string[]).includes(r.region) &&
    typeof r.name === "string" &&
    !!r.channels && typeof r.channels === "object"
  );
}

async function readHarvested(): Promise<MotionTrack[] | null> {
  const file = dataFilePath();
  if (!file) return null; // absent is normal — builtin-only is a supported mode
  let raw: string;
  try {
    raw = await readFile(file, "utf8");
  } catch {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as MotionLibraryFile;
    const tracks = (parsed.tracks ?? []).filter(isValidTrack);
    if (tracks.length === 0) return null;
    logger.info(
      { file, tracks: tracks.length, emoji: parsed.emojiCount, builtAt: parsed.builtAt },
      "animate: loaded harvested Noto motion library",
    );
    return tracks;
  } catch (err) {
    logger.warn({ err, file }, "animate: harvested motion library unreadable — using builtin only");
    return null;
  }
}

function assemble(harvested: MotionTrack[] | null): MotionLibrary {
  if (!harvested || harvested.length === 0) {
    return { origin: "builtin", tracks: BUILTIN_TRACKS };
  }
  // Noto first so it wins ties in the planner; de-dupe ids defensively.
  const seen = new Set<string>();
  const tracks: MotionTrack[] = [];
  for (const t of [...harvested, ...BUILTIN_TRACKS]) {
    if (seen.has(t.id)) continue;
    seen.add(t.id);
    tracks.push(t);
  }
  return { origin: "merged", tracks };
}

/** Load (and cache) the motion library. */
export async function loadMotionLibrary(): Promise<MotionLibrary> {
  if (cached) return cached;
  if (loading) return loading;
  loading = (async () => {
    const lib = assemble(await readHarvested());
    cached = lib;
    loading = null;
    logger.info({ origin: lib.origin, tracks: lib.tracks.length }, "animate: motion library ready");
    return lib;
  })();
  return loading;
}

/** Drop the cache — used by the admin reload path and by tests. */
export function reloadMotionLibrary(): void {
  cached = null;
  loading = null;
}

/** Tracks for one region, from the current (or builtin) pool. */
export function tracksInRegion(lib: MotionLibrary, region: Region): MotionTrack[] {
  return lib.tracks.filter(t => t.region === region);
}
