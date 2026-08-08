// ─────────────────────────────────────────────────────────────────────────────
// HQ — prop kind → bundled sprite path.
//
 // Blueprints and procedural fallbacks ask here first so furnished rooms prefer
 // real Kenney art over drawn placeholders whenever a sprite exists.
 // ─────────────────────────────────────────────────────────────────────────────

import { spriteForPrefix } from "./assets.js";
import type { PropKind } from "./props.js";

const PROP_KEYS: Partial<Record<PropKind, string>> = {
  chair: "chair",
  table: "table",
  rug: "rug",
  chest: "chest",
  npc: "npc",
  statue: "statue",
  monument: "monument",
  case: "case",
  trophy: "trophy",
  emblem: "emblem",
  tree: "tree",
  rock: "rock",
  fence: "fence",
  // Indoor plants stay procedural (forest bush previews are outdoor-scale).
};

const NPC_IDS = [
  "npc-aide", "npc-scout", "figure-knight", "figure-mage",
  "figure-ranger", "figure-barbarian", "figure-wizard", "figure-imp",
];

const RUG_IDS = [
  "welcome-rug", "woven-rug", "plush-rug", "command-rug", "vault-rug", "royal-runner",
];

/** Absolute path to art for a prop kind, or null → draw procedurally. */
export function spriteForProp(kind: PropKind, seed = 0): string | null {
  if (kind === "npc") {
    return spriteForPrefix("deco", NPC_IDS[Math.abs(seed) % NPC_IDS.length]!);
  }
  if (kind === "rug") {
    return spriteForPrefix("deco", RUG_IDS[Math.abs(seed) % RUG_IDS.length]!);
  }
  const key = PROP_KEYS[kind];
  if (!key) return null;
  return spriteForPrefix("prop", key);
}
