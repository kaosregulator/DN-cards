// Public animation API.
// Pack and battle renderers are exposed here so the rest of the bot can treat
// animation as an optional, best-effort layer: if the native libraries are not
// installed or encoding fails, the returned `null` is silently ignored and the
// old static embeds still work.

export { renderPackOpening } from "./pack.js";
export { renderBattleTurn, renderBattleVictory, renderBattleIdle } from "./battle.js";
export {
  renderPackCover, renderCardReveal, renderAttackFrame,
  REVEAL_COVER, REVEAL_CARD, REVEAL_ATTACK,
} from "./reveal.js";
export type {
  PackCoverInput, CardRevealInput, RevealStats, RevealInfo, AttackFrameInput, AttackScene,
} from "./reveal.js";
export { renderSpawnReveal, revealModeForRarity } from "./spawn-reveal.js";
export type { SpawnRevealInput, RevealMode } from "./spawn-reveal.js";
export type { AnimationSettings, AnimationSpeed, AnimationResult } from "./types.js";
export type { PackAnimationInput, BattleAnimationInput, VictoryAnimationInput } from "./types.js";
