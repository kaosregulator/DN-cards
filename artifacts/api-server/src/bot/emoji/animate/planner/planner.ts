// ─────────────────────────────────────────────────────────────────────────────
// The planner — words (or manual picks) → ranked, explainable recipes.
//
// Given "make him yawn" it finds the yawn gesture preset, then for each region
// the preset asks for it searches the WHOLE track pool for the best-matching
// borrowed movement — eyes from one emoji, mouth from another — assembling a
// recipe. It returns several candidates (different track picks, a calmer/wilder
// take, and always one faceless "works on anything" fallback) so the user is
// handed a few renders to choose between, never a single guess.
//
// Nothing here renders or reads artwork; it only chooses motion data. The result
// is fully explainable via engine/explain.ts.
// ─────────────────────────────────────────────────────────────────────────────

import type {
  GesturePreset, Intensity, MotionLibrary, MotionTrack, Recipe, Region,
} from "../types.js";
import { INTENSITIES } from "../types.js";
import { GESTURES, UNIVERSAL_GESTURE } from "../library/gestures.js";
import { levelFor } from "../engine/intensity.js";
import { recipeSignature } from "../engine/cache.js";

type WarpRegion = Exclude<Region, "effect">;
const WARP_REGIONS: WarpRegion[] = ["global", "brows", "eyes", "cheeks", "mouth"];

/** Tokenize a free-text prompt into lowercase words. */
export function tokenize(prompt: string): string[] {
  return prompt.toLowerCase().split(/[^a-z0-9]+/).filter(w => w.length > 1);
}

/** Score how well a preset matches the prompt tokens. */
function scoreGesture(preset: GesturePreset, tokens: Set<string>): number {
  let score = 0;
  for (const m of preset.match) if (tokens.has(m)) score += 5;
  // Partial credit for a part-tag appearing verbatim ("blink", "shake").
  for (const region of WARP_REGIONS) {
    for (const tag of preset.parts[region] ?? []) if (tokens.has(tag)) score += 1;
  }
  return score;
}

/** Presets the prompt names, best first. Empty prompt → []. */
export function matchGestures(prompt: string): GesturePreset[] {
  const tokens = new Set(tokenize(prompt));
  if (tokens.size === 0) return [];
  return GESTURES
    .map(g => ({ g, s: scoreGesture(g, tokens) }))
    .filter(x => x.s > 0)
    .sort((a, b) => b.s - a.s)
    .map(x => x.g);
}

/** Rank tracks in a region by how well their tags cover `wanted`. */
function rankTracks(
  lib: MotionLibrary, region: Region, wanted: string[], effectKinds?: string[],
): MotionTrack[] {
  const wantSet = new Set(wanted);
  const scored: Array<{ t: MotionTrack; s: number }> = [];
  for (const t of lib.tracks) {
    if (t.region !== region) continue;
    if (region === "effect" && effectKinds && t.effect && !effectKinds.includes(t.effect)) continue;
    let s = 0;
    for (const tag of t.tags) if (wantSet.has(tag)) s += 2;
    // Prefer real harvested Noto motion, then punchier movements.
    if (t.source.origin === "noto") s += 1.5;
    s += t.intensity * 0.5;
    if (s > 0 || wanted.length === 0) scored.push({ t, s });
  }
  return scored.sort((a, b) => b.s - a.s).map(x => x.t);
}

/** Merge a preset's base parts with the escalations active at `intensity`. */
function resolveParts(preset: GesturePreset, intensity: Intensity): {
  parts: Partial<Record<WarpRegion, string[]>>;
  effects: string[];
} {
  const rank = INTENSITIES.indexOf(intensity);
  const parts: Partial<Record<WarpRegion, string[]>> = {};
  for (const region of WARP_REGIONS) {
    const base = preset.parts[region];
    if (base) parts[region] = [...base];
  }
  const effects = new Set(preset.effects ?? []);
  for (const level of INTENSITIES) {
    if (INTENSITIES.indexOf(level) > rank) continue;
    const esc = preset.escalate?.[level];
    if (!esc) continue;
    for (const region of WARP_REGIONS) {
      const add = esc.parts?.[region];
      if (add) parts[region] = [...(parts[region] ?? []), ...add];
    }
    for (const e of esc.effects ?? []) effects.add(e);
  }
  return { parts, effects: [...effects] };
}

export interface TimingInput {
  intensity: Intensity;
  /** slow/normal/fast → 1.4 / 1.0 / 0.7 etc. */
  speedFactor: number;
}

/** Frames + per-frame delay for a preset's base duration at the chosen level. */
function timingFor(preset: GesturePreset, t: TimingInput): { frames: number; delayMs: number } {
  const level = levelFor(t.intensity);
  const duration = preset.timingMs * level.timing * t.speedFactor;
  const frames = Math.max(8, Math.min(22, Math.round(duration / 75)));
  const delayMs = Math.max(30, Math.min(140, Math.round(duration / frames)));
  return { frames, delayMs };
}

/**
 * Build one recipe from a preset. `variant` shifts every region's pick down the
 * ranked list (0 = best, 1 = second choice) to produce a genuinely different
 * take rather than a re-render of the same one.
 */
export function buildRecipe(
  preset: GesturePreset, lib: MotionLibrary, t: TimingInput, variant = 0,
): Recipe {
  const { parts, effects } = resolveParts(preset, t.intensity);
  const tracks: Recipe["tracks"] = {};
  for (const region of WARP_REGIONS) {
    const wanted = parts[region];
    if (!wanted) continue;
    const ranked = rankTracks(lib, region, wanted);
    if (ranked.length === 0) continue;
    tracks[region] = ranked[Math.min(variant, ranked.length - 1)]!;
  }
  const effectTracks: MotionTrack[] = [];
  for (const kind of effects) {
    const ranked = rankTracks(lib, "effect", [kind], [kind]);
    if (ranked[0]) effectTracks.push(ranked[0]);
  }
  const { frames, delayMs } = timingFor(preset, t);
  const takeLabel = variant > 0 ? ` · take ${variant + 1}` : "";
  return {
    label: `${preset.name}${takeLabel}`,
    tracks,
    effects: effectTracks,
    intensity: t.intensity,
    frames,
    delayMs,
  };
}

export interface PlanInput {
  prompt: string;
  library: MotionLibrary;
  intensity: Intensity;
  speedFactor: number;
  /** How many candidates to return. */
  count?: number;
}

/**
 * Plan several candidates for a prompt. Always includes at least one faceless
 * "works on anything" fallback, so a target with no recognizable regions still
 * animates — that is fallback (A) from the design, made concrete.
 */
export function planCandidates(input: PlanInput): Recipe[] {
  const { library, intensity, speedFactor } = input;
  const t: TimingInput = { intensity, speedFactor };
  const count = input.count ?? 4;

  const matched = matchGestures(input.prompt);
  const recipes: Recipe[] = [];
  const seen = new Set<string>();
  const add = (r: Recipe) => {
    const sig = recipeSignature(r);
    if (seen.has(sig)) return;
    seen.add(sig);
    recipes.push(r);
  };

  if (matched.length > 0) {
    // Best preset: a primary take and a second-choice-tracks variant.
    add(buildRecipe(matched[0]!, library, t, 0));
    add(buildRecipe(matched[0]!, library, t, 1));
    // A different matched preset, if the prompt was ambiguous ("sad" → cry/sigh).
    if (matched[1]) add(buildRecipe(matched[1]!, library, t, 0));
  } else {
    // No named gesture: treat prompt tokens as free tags across every region.
    add(buildFreeform(input.prompt, library, t));
  }

  // Always offer the universal, faceless fallback last.
  add(buildRecipe(UNIVERSAL_GESTURE, library, t, 0));

  return recipes.slice(0, count);
}

/**
 * A recipe assembled purely from prompt tokens as tags, when no preset matched.
 * Picks the best track in each region whose tags the words touch; if nothing
 * touches a region, that region stays still. Guarantees motion by falling back
 * to a global bob.
 */
function buildFreeform(prompt: string, lib: MotionLibrary, t: TimingInput): Recipe {
  const tags = tokenize(prompt);
  const tracks: Recipe["tracks"] = {};
  for (const region of WARP_REGIONS) {
    const ranked = rankTracks(lib, region, tags);
    // Only take a region when a word actually selected something (score-bearing).
    const best = ranked[0];
    if (best && best.tags.some(tag => tags.includes(tag))) tracks[region] = best;
  }
  if (Object.keys(tracks).length === 0) {
    const bob = rankTracks(lib, "global", ["bob", "bounce"])[0];
    if (bob) tracks.global = bob;
  }
  const effectTracks: MotionTrack[] = [];
  for (const kind of ["tears", "hearts", "sparkles", "steam", "sweat", "anger", "dizzy"]) {
    if (tags.includes(kind) || (kind === "hearts" && tags.includes("love"))) {
      const e = rankTracks(lib, "effect", [kind], [kind])[0];
      if (e) effectTracks.push(e);
    }
  }
  const { frames, delayMs } = timingFor(UNIVERSAL_GESTURE, t);
  const label = prompt.trim() ? prompt.trim().slice(0, 24) : "Freeform";
  return { label, tracks, effects: effectTracks, intensity: t.intensity, frames, delayMs };
}

/**
 * Build a recipe from explicit per-region track ids (the manual piece-picker).
 * Missing regions stay still; unknown ids are ignored.
 */
export function planFromPicks(
  picks: { region: WarpRegion; trackId: string }[],
  effectIds: string[],
  lib: MotionLibrary, t: TimingInput, label = "Custom",
): Recipe {
  const byId = new Map(lib.tracks.map(tr => [tr.id, tr] as const));
  const tracks: Recipe["tracks"] = {};
  for (const { region, trackId } of picks) {
    const tr = byId.get(trackId);
    if (tr && tr.region === region) tracks[region] = tr;
  }
  const effects: MotionTrack[] = [];
  for (const id of effectIds) {
    const tr = byId.get(id);
    if (tr && tr.region === "effect") effects.push(tr);
  }
  const { frames, delayMs } = timingFor(UNIVERSAL_GESTURE, t);
  return { label, tracks, effects, intensity: t.intensity, frames, delayMs };
}
