// ─────────────────────────────────────────────────────────────────────────────
// HQ — companion registry (data-only).
//
// A companion is an EARNED little creature that stands in your Headquarters and
// follows you between the room and the base — a pet, purely cosmetic. Like every
// other HQ cosmetic it's data-driven: `kind` picks the procedural creature the
// renderer draws, `body`/`accent` colour it, and `unlock` is the only way in.
// A future asset pack can supply real sprites keyed by `kind` with no code change.
//
// Mirrors defs/decorations.ts + defs/themes.ts (flat list + Map index + resolve).
// ─────────────────────────────────────────────────────────────────────────────

import { BUILTIN_RARITIES, type Rarity } from "../../cards-data.js";
import type { UnlockRule } from "./unlock-rules.js";

// Silhouettes the procedural renderer knows how to draw. New art can map 1:1.
export type CompanionKind = "wolf" | "drake" | "sprite" | "golem" | "cat" | "owl" | "slime";

export interface HqCompanion {
  id: string;
  name: string;
  emoji: string;
  kind: CompanionKind;
  rarity: Rarity;
  body: string;    // primary body colour (hex)
  accent: string;  // secondary/detail colour (hex)
  unlock: UnlockRule;
  story: string;
}

export const HQ_COMPANIONS: HqCompanion[] = [
  { id: "scout-pup", name: "Scout Pup", emoji: "🐺", kind: "wolf", rarity: "uncommon",
    body: "#8a94a6", accent: "#e6ecf5", unlock: { kind: "battleWins", n: 10 },
    story: "A loyal pup that joined you after 10 battle wins." },
  { id: "shop-cat", name: "Shop Cat", emoji: "🐈", kind: "cat", rarity: "uncommon",
    body: "#d79a5b", accent: "#3a2a1c", unlock: { kind: "dailyStreak", n: 7 },
    story: "Wandered in during a 7-day streak and never left." },
  { id: "wise-owl", name: "Wise Owl", emoji: "🦉", kind: "owl", rarity: "rare",
    body: "#9c7b52", accent: "#f2e2c4", unlock: { kind: "collectionUnique", n: 50 },
    story: "Keeps watch over a 50-card collection." },
  { id: "arcane-sprite", name: "Arcane Sprite", emoji: "🧚", kind: "sprite", rarity: "rare",
    body: "#b58cff", accent: "#efe3ff", unlock: { kind: "accountLevel", n: 10 },
    story: "A mote of magic drawn to account level 10." },
  { id: "shiny-slime", name: "Shiny Slime", emoji: "🫧", kind: "slime", rarity: "epic",
    body: "#4fd6c8", accent: "#eafffb", unlock: { kind: "shinyOwned", n: 5 },
    story: "Congealed from the glow of five shiny cards." },
  { id: "stone-sentinel", name: "Stone Sentinel", emoji: "🗿", kind: "golem", rarity: "epic",
    body: "#7d8a86", accent: "#c9d6cf", unlock: { kind: "totalCards", n: 100 },
    story: "A guardian roused by a hundred-card hoard." },
  { id: "ember-drake", name: "Ember Drake", emoji: "🐉", kind: "drake", rarity: "legendary",
    body: "#e0603a", accent: "#ffd27a", unlock: { kind: "raidBoss" },
    story: "A hatchling claimed from a fallen raid boss." },
];

export const COMPANION_NONE = "none";

const COMPANION_BY_ID = new Map<string, HqCompanion>(HQ_COMPANIONS.map(c => [c.id, c]));

// Resolve a companion id. Returns undefined for "none"/unknown — the renderer
// simply draws no companion, so a removed id never substitutes a different pet.
export function resolveCompanion(id: string | null | undefined): HqCompanion | undefined {
  return id && id !== COMPANION_NONE ? COMPANION_BY_ID.get(id) : undefined;
}

const RARITY_RANK: Record<Rarity, number> =
  Object.fromEntries(BUILTIN_RARITIES.map((r, i) => [r, i])) as Record<Rarity, number>;

// Companions the player owns, rarest-first (for pickers).
export function companionsByRarityDesc(ids: Iterable<string>): HqCompanion[] {
  const out: HqCompanion[] = [];
  for (const id of ids) {
    const c = COMPANION_BY_ID.get(id);
    if (c) out.push(c);
  }
  return out.sort((a, b) => RARITY_RANK[b.rarity] - RARITY_RANK[a.rarity] || a.name.localeCompare(b.name));
}
