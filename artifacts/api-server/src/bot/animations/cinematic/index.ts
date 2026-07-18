// Public Cinematic API — a reusable timeline GIF compositor + effect library.
// Fatality is the first scene built on it; pack openings, boss intros, and raid
// victories can adopt the same engine later without touching the battle system.
export { renderCinematic, keyframes, ease, mixHex, applyCamera } from "./engine.js";
export type { CinematicLayer, CinematicFrame, CinematicOptions, Keyframe, CameraState } from "./engine.js";
export {
  arenaBackdrop, dynamicLighting, flashes, bigTitle, cardSpotlight, defeatEffect,
} from "./effects.js";
export type { DefeatKind } from "./effects.js";
export { renderFatalityCinematic } from "./fatality.js";
export type { FatalityInput } from "./fatality.js";
