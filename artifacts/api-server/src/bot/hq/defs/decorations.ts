// ─────────────────────────────────────────────────────────────────────────────
// HQ — decoration registry (data-only).
//
// Decorations are EARNED cosmetics. Each has a rarity (reusing the game's own
// rarity tiers/colours), a generic `category` the renderer knows how to draw
// procedurally, an `UnlockRule` describing how it's earned, and a one-line
// `story` so every decoration means something. No shop, no purchase — the
// `unlock` rule is the only way in. Add a decoration = append to HQ_DECORATIONS.
//
// Mirrors bot/cards/frames.ts: flat Map index + resolve, cosmetics only, never
// affects gameplay balance.
// ─────────────────────────────────────────────────────────────────────────────

import { BUILTIN_RARITIES, type Rarity } from "../../cards-data.js";
import type { UnlockRule } from "./unlock-rules.js";

// Generic shapes the procedural renderer can draw. A theme/asset pack may later
// supply real art per (theme, category|id) without changing this list.
export type DecoCategory =
  | "banner" | "statue" | "trophy" | "monument" | "plant" | "light" | "case" | "emblem"
  | "crystal" | "rug";

export interface HqDecoration {
  id: string;
  name: string;
  emoji: string;
  rarity: Rarity;
  category: DecoCategory;
  // Asset-manager key; combined with the theme prefix. Null art → procedural.
  spriteKey: string;
  unlock: UnlockRule;
  story: string;
}

export const HQ_DECORATIONS: HqDecoration[] = [
  // ── Always available ────────────────────────────────────────────────────────
  { id: "starter-plant", name: "Potted Fern", emoji: "🪴", rarity: "common", category: "plant",
    spriteKey: "deco/starter-plant", unlock: { kind: "always" }, story: "A little life in the corner." },

  // ── Battle milestones ───────────────────────────────────────────────────────
  { id: "banner-first-win", name: "First Blood Banner", emoji: "🚩", rarity: "uncommon", category: "banner",
    spriteKey: "deco/banner-first-win", unlock: { kind: "battleWins", n: 1 }, story: "Raised after your first battle victory." },
  { id: "veteran-medals", name: "Veteran Medals", emoji: "🎖️", rarity: "rare", category: "emblem",
    spriteKey: "deco/veteran-medals", unlock: { kind: "battleWins", n: 25 }, story: "Awarded for 25 hard-fought wins." },
  { id: "champion-banner", name: "Champion's Banner", emoji: "🏴", rarity: "legendary", category: "banner",
    spriteKey: "deco/champion-banner", unlock: { kind: "battleWins", n: 100 }, story: "Only true champions fly this — 100 battles won." },

  // ── Raids ───────────────────────────────────────────────────────────────────
  { id: "commander-trophy", name: "Commander's Trophy", emoji: "🏆", rarity: "epic", category: "trophy",
    spriteKey: "deco/commander-trophy", unlock: { kind: "raidBoss" }, story: "Claimed from a fallen raid boss." },
  { id: "hall-of-heroes", name: "Hall of Heroes Monument", emoji: "🗿", rarity: "mythic", category: "monument",
    spriteKey: "deco/hall-of-heroes", unlock: { kind: "raidCampaign" }, story: "Raised by those who cleared the entire raid campaign." },

  // ── Collection ──────────────────────────────────────────────────────────────
  { id: "curator-plinth", name: "Curator's Plinth", emoji: "🏛️", rarity: "rare", category: "case",
    spriteKey: "deco/curator-plinth", unlock: { kind: "collectionUnique", n: 50 }, story: "For a collection 50 cards strong." },
  { id: "collector-statue", name: "Collector's Statue", emoji: "🗽", rarity: "epic", category: "statue",
    spriteKey: "deco/collector-statue", unlock: { kind: "collectionUnique", n: 100 }, story: "Cast in gold for 100 unique cards." },
  { id: "set-display-case", name: "Set Display Case", emoji: "🗄️", rarity: "epic", category: "case",
    spriteKey: "deco/set-display-case", unlock: { kind: "setComplete", n: 1 }, story: "Awarded for completing a full card set." },
  { id: "shiny-prism", name: "Shiny Prism", emoji: "✨", rarity: "rare", category: "statue",
    spriteKey: "deco/shiny-prism", unlock: { kind: "shinyOwned", n: 1 }, story: "Refracts the light of a shiny card." },

  // ── Daily dedication ────────────────────────────────────────────────────────
  { id: "streak-lantern", name: "Streak Lantern", emoji: "🏮", rarity: "uncommon", category: "light",
    spriteKey: "deco/streak-lantern", unlock: { kind: "dailyStreak", n: 7 }, story: "Lit by a 7-day login streak." },
  { id: "dedication-brazier", name: "Dedication Brazier", emoji: "🔥", rarity: "rare", category: "light",
    spriteKey: "deco/dedication-brazier", unlock: { kind: "dailyStreak", n: 30 }, story: "Kept burning through a 30-day streak." },

  // ── Prestige / limited ──────────────────────────────────────────────────────
  { id: "founders-obelisk", name: "Founder's Obelisk", emoji: "🌟", rarity: "legendary", category: "monument",
    spriteKey: "deco/founders-obelisk", unlock: { kind: "accountLevel", n: 25 }, story: "Erected at account level 25." },
  { id: "limited-pedestal", name: "Limited Pedestal", emoji: "💎", rarity: "mythic", category: "case",
    spriteKey: "deco/limited-pedestal", unlock: { kind: "ownsLimited" }, story: "Reserved for owners of limited-edition cards." },

  // ── Wealth & scale (Phase 2 — reuses the derived snapshot) ────────────────────
  { id: "welcome-rug", name: "Welcome Rug", emoji: "🟥", rarity: "common", category: "rug",
    spriteKey: "deco/welcome-rug", unlock: { kind: "totalCards", n: 25 }, story: "Woven once your collection hit 25 cards." },
  { id: "archive-stacks", name: "Archive Stacks", emoji: "🗃️", rarity: "rare", category: "case",
    spriteKey: "deco/archive-stacks", unlock: { kind: "totalCards", n: 250 }, story: "Shelves groaning under 250 cards." },
  { id: "treasury-crystal", name: "Treasury Crystal", emoji: "🔮", rarity: "epic", category: "crystal",
    spriteKey: "deco/treasury-crystal", unlock: { kind: "netWorth", n: 25_000 }, story: "Condensed from a 25K-shard fortune." },
  { id: "sovereign-hoard", name: "Sovereign's Hoard", emoji: "💠", rarity: "mythic", category: "crystal",
    spriteKey: "deco/sovereign-hoard", unlock: { kind: "netWorth", n: 100_000 }, story: "The glittering proof of a 100K-shard collection." },
  { id: "shiny-constellation", name: "Shiny Constellation", emoji: "🌌", rarity: "legendary", category: "crystal",
    spriteKey: "deco/shiny-constellation", unlock: { kind: "shinyOwned", n: 10 }, story: "Ten shinies, arranged like stars." },

  // ── Deeper mastery ────────────────────────────────────────────────────────────
  { id: "warlord-standard", name: "Warlord's Standard", emoji: "⚔️", rarity: "mythic", category: "banner",
    spriteKey: "deco/warlord-standard", unlock: { kind: "battleWins", n: 250 }, story: "Flown by the winner of 250 battles." },
  { id: "eternal-flame", name: "Eternal Flame", emoji: "🕯️", rarity: "legendary", category: "light",
    spriteKey: "deco/eternal-flame", unlock: { kind: "dailyStreak", n: 100 }, story: "A hundred days without missing a dawn." },

  // ── Achievement-linked (mirrors the achievement registry keys) ─────────────────
  { id: "sovereign-crown", name: "Sovereign's Crown", emoji: "👑", rarity: "mythic", category: "emblem",
    spriteKey: "deco/sovereign-crown", unlock: { kind: "achievement", key: "all_legendaries" }, story: "Awarded to those who own every Legendary." },
  { id: "diplomat-seal", name: "Diplomat's Seal", emoji: "🤝", rarity: "uncommon", category: "emblem",
    spriteKey: "deco/diplomat-seal", unlock: { kind: "achievement", key: "trader" }, story: "Pressed after your first completed trade." },
  { id: "collectors-crest", name: "Collector's Crest", emoji: "💼", rarity: "epic", category: "emblem",
    spriteKey: "deco/collectors-crest", unlock: { kind: "achievement", key: "master" }, story: "Granted to Master Collectors." },
];

const DECO_BY_ID = new Map<string, HqDecoration>(HQ_DECORATIONS.map(d => [d.id, d]));

// Resolve a decoration id. Returns undefined for an unknown id — a missing
// decoration is simply not drawn/placed rather than substituted, so a removed
// item can never masquerade as a different one.
export function resolveDecoration(id: string | null | undefined): HqDecoration | undefined {
  return id ? DECO_BY_ID.get(id) : undefined;
}

const RARITY_RANK: Record<Rarity, number> =
  Object.fromEntries(BUILTIN_RARITIES.map((r, i) => [r, i])) as Record<Rarity, number>;

// Decorations sorted rarest-first, for owned-list displays.
export function decorationsByRarityDesc(ids: Iterable<string>): HqDecoration[] {
  const out: HqDecoration[] = [];
  for (const id of ids) {
    const d = DECO_BY_ID.get(id);
    if (d) out.push(d);
  }
  return out.sort((a, b) => RARITY_RANK[b.rarity] - RARITY_RANK[a.rarity] || a.name.localeCompare(b.name));
}
