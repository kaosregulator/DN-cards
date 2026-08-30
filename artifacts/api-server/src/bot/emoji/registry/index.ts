// ─────────────────────────────────────────────────────────────────────────────
// Effect registry.
//
// The single source of truth for which effects exist. Effects are contributed by
// category modules and merged here, so adding an effect is one array entry in a
// category file — no renderer, command or UI change. Ids are asserted unique at
// module load, because a duplicate would silently shadow an effect and route
// buttons to the wrong render.
// ─────────────────────────────────────────────────────────────────────────────

import type { EffectDef, EffectSummary } from "../types.js";
import { MOTION_EFFECTS } from "../effects/motion.js";
import { SCALE_EFFECTS } from "../effects/scale.js";
import { COLOR_EFFECTS } from "../effects/color.js";
import { DECORATED_EFFECTS } from "../effects/decorated.js";

const ALL: EffectDef[] = [
  ...MOTION_EFFECTS,
  ...SCALE_EFFECTS,
  ...COLOR_EFFECTS,
  ...DECORATED_EFFECTS,
];

const BY_ID = new Map<string, EffectDef>();
for (const e of ALL) {
  if (BY_ID.has(e.id)) throw new Error(`Duplicate emoji effect id: ${e.id}`);
  BY_ID.set(e.id, e);
}

/** Every effect, in registration order. */
export const EFFECTS: readonly EffectDef[] = Object.freeze(ALL);

/** Lightweight descriptors for the picker UI and the public API. */
export const EFFECT_SUMMARIES: readonly EffectSummary[] = Object.freeze(
  ALL.map(({ id, name, emoji, description, directional }) => ({
    id, name, emoji, description, directional,
  })),
);

/** The default effect offered when the user hasn't picked one. */
export const DEFAULT_EFFECT = "shake";

/** Look up an effect, or undefined when the id is unknown. */
export function getEffect(id: string): EffectDef | undefined {
  return BY_ID.get(id);
}

/** True when `id` names a registered effect. */
export function hasEffect(id: string): boolean {
  return BY_ID.has(id);
}

/** Registered effect ids, in registration order. */
export function effectIds(): string[] {
  return ALL.map(e => e.id);
}
