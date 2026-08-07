// ─────────────────────────────────────────────────────────────────────────────
// HQ — world-map blueprint (data-only).
//
// The shared map every member of a server sees. Before this the map only showed
// other players' bases, so an empty or new server had nothing to attack. Now the
// world ships PRE-CONQUERED: six AI factions already hold a ring of territories,
// each one a real castle a member can march on, take, and then hold for tribute
// (or lose again to a rival who takes it off them).
//
// The blueprint is static data — positions, biomes, tiers, garrison sizes. The
// mutable half (who holds what, when, shields) lives in `hq_world_nodes`, one
// row per (guild, node) created on first view by bot/hq/world.ts. Adding a
// territory = append to HQ_TERRITORIES; existing guilds pick it up on next view.
// ─────────────────────────────────────────────────────────────────────────────

import type { HqBuildingRole } from "../render.js";

export interface HqFaction {
  id: string;
  name: string;
  short: string;      // banner text / compact label
  emoji: string;
  color: number;      // banner + embed accent
  crest: "star" | "skull" | "wolf" | "sun" | "leaf" | "cog" | "moon";
  blurb: string;
}

export const HQ_FACTIONS: HqFaction[] = [
  { id: "ashen", name: "The Ashen Legion", short: "Ashen", emoji: "🔥", color: 0xc0392b, crest: "skull",
    blurb: "Burned their way across the lowlands and never left." },
  { id: "frost", name: "Frostbound Clans", short: "Frost", emoji: "❄️", color: 0x5dade2, crest: "wolf",
    blurb: "Highland raiders who fortify the passes each winter." },
  { id: "sunspire", name: "Sunspire Order", short: "Sunspire", emoji: "☀️", color: 0xf1c40f, crest: "sun",
    blurb: "Zealot knights who claim every hill is holy ground." },
  { id: "verdant", name: "Verdant Coven", short: "Verdant", emoji: "🌿", color: 0x2ecc71, crest: "leaf",
    blurb: "Witches of the deep wood; their walls are living timber." },
  { id: "syndicate", name: "Iron Syndicate", short: "Syndicate", emoji: "⚙️", color: 0x95a5a6, crest: "cog",
    blurb: "Mercenary engineers who sell the same fort twice." },
  { id: "duskwatch", name: "The Duskwatch", short: "Duskwatch", emoji: "🌙", color: 0x9b59b6, crest: "moon",
    blurb: "Night sentinels holding the ruins nobody else will." },
];

const FACTION_BY_ID = new Map(HQ_FACTIONS.map(f => [f.id, f]));
export function resolveFaction(id: string | null | undefined): HqFaction {
  return (id && FACTION_BY_ID.get(id)) || HQ_FACTIONS[0]!;
}

export type WorldBiome = "plains" | "forest" | "hills" | "desert" | "snow" | "marsh" | "volcanic";

export interface HqTerritory {
  id: string;
  name: string;
  factionId: string;
  // 1 (a lone watchpost) … 6 (a faction capital). Drives garrison strength,
  // reward, tribute rate and the structure drawn on the map.
  tier: number;
  biome: WorldBiome;
  // Position on the world landmass in normalised island space; |u| + |v| stays
  // under ~0.85 so the marker lands on the top face, not a cliff.
  u: number;
  v: number;
  garrison: number;         // defender count (2…6)
  structure: HqBuildingRole;
  blurb: string;
}

// A ring of territories that escalates outward: soft targets near the player's
// own holdings, faction capitals at the far edges.
export const HQ_TERRITORIES: HqTerritory[] = [
  { id: "millford-post", name: "Millford Post", factionId: "syndicate", tier: 1, biome: "plains",
    u: -0.14, v: 0.30, garrison: 2, structure: "camp",
    blurb: "A toll camp on the river road. Lightly held, heavily resented." },
  { id: "harrow-watch", name: "Harrow Watchtower", factionId: "duskwatch", tier: 1, biome: "marsh",
    u: 0.24, v: 0.34, garrison: 2, structure: "tower",
    blurb: "One tower, one bell, and a garrison that never sleeps." },
  { id: "greenhollow", name: "Greenhollow Grove", factionId: "verdant", tier: 2, biome: "forest",
    u: -0.44, v: 0.12, garrison: 3, structure: "hut",
    blurb: "The trees themselves were grown into a palisade." },
  { id: "emberfen", name: "Emberfen Redoubt", factionId: "ashen", tier: 2, biome: "volcanic",
    u: 0.52, v: 0.10, garrison: 3, structure: "wall",
    blurb: "Built on a vent field. The stones are still warm." },
  { id: "coldgate", name: "Coldgate Keep", factionId: "frost", tier: 3, biome: "snow",
    u: -0.06, v: -0.04, garrison: 4, structure: "keep",
    blurb: "The pass gate. Whoever holds it decides who trades." },
  { id: "gilded-chapel", name: "Gilded Chapel", factionId: "sunspire", tier: 3, biome: "hills",
    u: 0.34, v: -0.14, garrison: 4, structure: "cathedral",
    blurb: "Gold leaf on the spire, crossbows behind every window." },
  { id: "rustworks", name: "The Rustworks", factionId: "syndicate", tier: 4, biome: "plains",
    u: -0.40, v: -0.20, garrison: 4, structure: "village",
    blurb: "Foundry town. Every wall is a machine that shoots back." },
  { id: "thornmarch", name: "Thornmarch Hold", factionId: "verdant", tier: 4, biome: "forest",
    u: 0.06, v: -0.34, garrison: 5, structure: "houses",
    blurb: "Thorn hedges thirty feet deep, and something living in them." },
  { id: "cinderhal", name: "Cinderhal Citadel", factionId: "ashen", tier: 5, biome: "volcanic",
    u: 0.46, v: -0.40, garrison: 5, structure: "castle",
    blurb: "The Legion's forward capital. Smoke visible for three days' ride." },
  { id: "rimewall", name: "Rimewall Bastion", factionId: "frost", tier: 5, biome: "snow",
    u: -0.34, v: -0.48, garrison: 5, structure: "castle",
    blurb: "Ice-clad curtain walls that have never been breached in winter." },
  { id: "solmarch", name: "Solmarch Cathedral", factionId: "sunspire", tier: 6, biome: "desert",
    u: 0.14, v: -0.56, garrison: 6, structure: "cathedral",
    blurb: "The Order's seat. Taking it would end an age." },
  { id: "nightspire", name: "Nightspire", factionId: "duskwatch", tier: 6, biome: "hills",
    u: -0.58, v: -0.06, garrison: 6, structure: "castle",
    blurb: "A black tower older than every banner flying on this map." },
];

const TERRITORY_BY_ID = new Map(HQ_TERRITORIES.map(t => [t.id, t]));
export function getTerritory(id: string): HqTerritory | undefined {
  return TERRITORY_BY_ID.get(id);
}

// Where MEMBER bases sit on the same continent. Kept clear of the AI ring (which
// occupies the interior and the northern edge) so player holdings read as the
// settled southern coast the factions are pressing in on.
export const PLAYER_BASE_ANCHORS: { u: number; v: number }[] = [
  { u: -0.62, v: 0.44 }, { u: -0.30, v: 0.66 }, { u: 0.02, v: 0.72 }, { u: 0.34, v: 0.62 },
  { u: 0.62, v: 0.42 }, { u: -0.72, v: 0.20 }, { u: 0.72, v: 0.16 }, { u: 0.18, v: 0.14 },
];

// Trade roads drawn between holdings, so the continent reads as connected
// territory rather than scattered pins. Pairs are blueprint ids.
export const HQ_ROUTES: [string, string][] = [
  ["millford-post", "harrow-watch"],
  ["millford-post", "greenhollow"],
  ["harrow-watch", "emberfen"],
  ["greenhollow", "coldgate"],
  ["emberfen", "gilded-chapel"],
  ["coldgate", "gilded-chapel"],
  ["coldgate", "rustworks"],
  ["gilded-chapel", "thornmarch"],
  ["rustworks", "rimewall"],
  ["thornmarch", "cinderhal"],
  ["thornmarch", "solmarch"],
  ["rimewall", "solmarch"],
  ["rustworks", "nightspire"],
  ["cinderhal", "gilded-chapel"],
];

// ── Tier economics ────────────────────────────────────────────────────────────
// One place to tune how hard a territory is and what it pays, so the whole
// ladder moves together.

export interface TierProfile {
  label: string;
  /** Level the AI garrison's cards fight at (feeds the real battle engine). */
  cardLevel: number;
  /** Star rank granted to the AI garrison on top of level scaling. */
  starRank: number;
  /** Minimum rarity ladder rank the AI garrison draws from (0 = commons). */
  minRarityRank: number;
  /** Shards minted to the attacker on capture. */
  bounty: number;
  /** Passive shards per hour while the territory is held. */
  tributePerHour: number;
}

export const TIER_PROFILES: Record<number, TierProfile> = {
  1: { label: "Outpost",  cardLevel: 8,  starRank: 0, minRarityRank: 0, bounty: 120,  tributePerHour: 4 },
  2: { label: "Redoubt",  cardLevel: 18, starRank: 1, minRarityRank: 1, bounty: 220,  tributePerHour: 6 },
  3: { label: "Keep",     cardLevel: 30, starRank: 2, minRarityRank: 2, bounty: 360,  tributePerHour: 9 },
  4: { label: "Stronghold", cardLevel: 45, starRank: 3, minRarityRank: 2, bounty: 540, tributePerHour: 13 },
  5: { label: "Citadel",  cardLevel: 62, starRank: 4, minRarityRank: 3, bounty: 780,  tributePerHour: 18 },
  6: { label: "Capital",  cardLevel: 80, starRank: 5, minRarityRank: 4, bounty: 1100, tributePerHour: 25 },
};

export function tierProfile(tier: number): TierProfile {
  return TIER_PROFILES[Math.max(1, Math.min(6, Math.round(tier)))] ?? TIER_PROFILES[1]!;
}

/** ⭐ difficulty pips for a tier, for embeds and select descriptions. */
export function tierStars(tier: number): string {
  const n = Math.max(1, Math.min(6, Math.round(tier)));
  return "★".repeat(n) + "☆".repeat(6 - n);
}
