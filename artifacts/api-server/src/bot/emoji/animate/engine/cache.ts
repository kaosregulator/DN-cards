// ─────────────────────────────────────────────────────────────────────────────
// Rendered-animation cache.
//
// Building a candidate means slicing and re-drawing the target across every
// frame and quantising a GIF — real CPU. If fifty people ask for 🐹 → sneeze at
// Normal, that should cost one render, not fifty. So a finished candidate is
// keyed by the SHA-256 of the target bytes plus everything that changes the
// output — the recipe signature (track ids per region, effects, intensity) and
// the size/speed — exactly like the /emoji result cache, and served from memory
// the second time.
//
// Bounded on count, total bytes and age, because it holds encoded GIF buffers.
// ─────────────────────────────────────────────────────────────────────────────

import { createHash } from "node:crypto";
import { logger } from "../../../../lib/logger.js";
import type { Candidate, Recipe } from "../types.js";

const TTL_MS = 30 * 60 * 1000;
const MAX_ENTRIES = 120;
const MAX_TOTAL_BYTES = 64 * 1024 * 1024;

interface Entry {
  key: string;
  candidate: Candidate;
  expiresAt: number;
  usedAt: number;
}

const entries = new Map<string, Entry>();
let totalBytes = 0;
let hits = 0;
let misses = 0;

/** The part of a recipe that changes the pixels — stable across equal recipes. */
export function recipeSignature(recipe: Recipe): string {
  const regions = (["global", "brows", "eyes", "cheeks", "mouth"] as const)
    .map(r => `${r}=${recipe.tracks[r]?.id ?? ""}`);
  const effects = recipe.effects.map(t => t.id).sort();
  const anchors = recipe.anchors
    ? Object.entries(recipe.anchors).map(([r, a]) => `${r}:${a!.y.toFixed(2)}/${a!.spread.toFixed(2)}`).sort()
    : [];
  const gain = recipe.gain
    ? Object.entries(recipe.gain).map(([r, g]) => `${r}:${g!.toFixed(2)}`).sort()
    : [];
  return JSON.stringify([
    regions, effects, recipe.intensity, recipe.frames, recipe.delayMs, anchors, gain,
  ]);
}

/** Full cache key: target content + recipe + output size. */
export function cacheKey(imageHash: string, recipe: Recipe, size: number): string {
  return createHash("sha256")
    .update(imageHash).update("\0").update(recipeSignature(recipe)).update("\0").update(String(size))
    .digest("hex");
}

/** SHA-256 of the target bytes — computed once per session and reused per recipe. */
export function hashImage(image: Buffer): string {
  return createHash("sha256").update(image).digest("hex");
}

function drop(e: Entry): void {
  if (entries.delete(e.key)) totalBytes -= e.candidate.bytes;
}

function enforceBounds(): void {
  const now = Date.now();
  for (const e of [...entries.values()]) if (e.expiresAt <= now) drop(e);
  if (entries.size <= MAX_ENTRIES && totalBytes <= MAX_TOTAL_BYTES) return;
  for (const e of [...entries.values()].sort((a, b) => a.usedAt - b.usedAt)) {
    if (entries.size <= MAX_ENTRIES && totalBytes <= MAX_TOTAL_BYTES) break;
    drop(e);
  }
}

export function getCached(key: string): Candidate | undefined {
  const e = entries.get(key);
  if (!e || e.expiresAt <= Date.now()) {
    if (e) drop(e);
    misses++;
    return undefined;
  }
  e.usedAt = Date.now();
  hits++;
  return e.candidate;
}

export function putCached(key: string, candidate: Candidate): void {
  if (candidate.bytes > MAX_TOTAL_BYTES / 4) return;
  const existing = entries.get(key);
  if (existing) drop(existing);
  entries.set(key, { key, candidate, expiresAt: Date.now() + TTL_MS, usedAt: Date.now() });
  totalBytes += candidate.bytes;
  enforceBounds();
}

/** Run `render` unless an identical candidate is already cached. */
export async function withCandidateCache(
  key: string,
  render: () => Promise<Candidate>,
): Promise<Candidate> {
  const cached = getCached(key);
  if (cached) {
    logger.debug({ key: key.slice(0, 12) }, "animate cache hit");
    return cached;
  }
  const candidate = await render();
  putCached(key, candidate);
  return candidate;
}

export interface AnimateCacheStats { entries: number; bytes: number; hits: number; misses: number }
export function cacheStats(): AnimateCacheStats {
  return { entries: entries.size, bytes: totalBytes, hits, misses };
}
export function clearCache(): void {
  entries.clear();
  totalBytes = 0;
  hits = 0;
  misses = 0;
}
