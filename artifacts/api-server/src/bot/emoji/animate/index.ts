// ─────────────────────────────────────────────────────────────────────────────
// /animate — the Noto motion-composition engine. Public surface.
//
// A new command that ADDS to /emoji without touching it. It harvests the real
// keyframed MOVEMENTS out of Noto's animated emoji (blink, yawn, nod, tears…),
// generalizes them into a combinable motion library, and re-composes chosen
// pieces onto the user's OWN target — a custom server emoji, a photo, a meme, an
// animal, any Unicode emoji — rendering a few candidates to pick between.
//
// Crucially: only MOTION is borrowed. The renderer animates the user's image and
// never draws Noto artwork, so the output is their emoji, moving. Import from
// here, not from subfolders.
// ─────────────────────────────────────────────────────────────────────────────

// ── types ────────────────────────────────────────────────────────────────────
export type {
  Region, MotionCategory, EffectKind, Intensity, Channel, Keyframe, Curve,
  MotionTrack, Recipe, Candidate, MotionLibrary, MotionLibraryFile, GesturePreset,
  Features, FracBox, FracEllipse,
} from "./types.js";
export { REGIONS, MOTION_CATEGORIES, INTENSITIES } from "./types.js";

// ── library ──────────────────────────────────────────────────────────────────
export {
  loadMotionLibrary, reloadMotionLibrary, tracksInRegion,
} from "./library/motion-library.js";
export { BUILTIN_TRACKS } from "./library/builtin-tracks.js";
export { GESTURES, UNIVERSAL_GESTURE } from "./library/gestures.js";
export { tagsFromName, regionForLayer } from "./library/tags.js";

// ── planner ──────────────────────────────────────────────────────────────────
export {
  planCandidates, buildRecipe, planFromPicks, matchGestures, tokenize,
} from "./planner/planner.js";

// ── engine ───────────────────────────────────────────────────────────────────
export { renderCandidate, renderCandidates } from "./engine/render.js";
export { compose } from "./engine/compositor.js";
export { sampleTrack, sampleCurve, measureIntensity, REST } from "./engine/sampler.js";
export { explain, credit, isAllNoto } from "./engine/explain.js";
export { LEVELS, levelFor } from "./engine/intensity.js";
export { DEFAULT_ANCHORS, envelope } from "./engine/regions.js";
export { meshWarp, GRID } from "./engine/warp-mesh.js";

// ── target feature detection (adapts motion to the target's own geometry) ─────
export {
  detectFeatures, setFeatureDetector, heuristicDetector, type FeatureDetector,
} from "./engine/detect.js";
export { renderDebugOverlay, describeMapping } from "./engine/debug.js";
export {
  cacheKey, hashImage, recipeSignature, cacheStats as animateCacheStats,
  clearCache as clearAnimateCache,
} from "./engine/cache.js";
export {
  setRenderer, getRenderer, hasRenderer,
  type AnimationRenderer,
} from "./engine/renderer.js";
