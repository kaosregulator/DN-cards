// ─────────────────────────────────────────────────────────────────────────────
// Activity read-models — assemble REAL data for the Battle / Raid / Pack scenes
// from the existing systems, WITHOUT mutating anything. The Activity presents;
// authoritative resolution (spending currency, granting cards, recording wins)
// stays in the bot. These are read-only projections.
// ─────────────────────────────────────────────────────────────────────────────

import { getUserCollection, getOrCreateGuildSettings } from "../db.js";
import { getCampaignProgress } from "../raid/db.js";
import { RARITY_COLORS, RARITY_LABELS, RARITY_WEIGHTS, getRarityOrder, type Rarity } from "../cards-data.js";
import { PACK_TIERS, PACK_TIER_META, resolveTierConfig, tierLabel } from "../commands/pack.js";

// Local iso figures used to represent combatants (real sprites, no external art
// → no Discord CSP issues). Chosen by rough "power" so stronger cards look it.
const FIGHTER_SPRITES = [
  "deco/figure-ranger", "deco/figure-knight", "deco/figure-barbarian",
  "deco/figure-mage", "deco/figure-wizard", "deco/figure-imp",
];
const BOSS_SPRITES = ["building/keep", "building/castle", "building/tower", "building/cathedral"];
const BACKDROPS = ["backdrop/castles", "backdrop/forest", "backdrop/desert", "backdrop/fall", "backdrop/grass"];

const RARITY_RANK: Record<Rarity, number> = {
  common: 0, uncommon: 1, rare: 2, epic: 3, legendary: 4, mythic: 5,
};

export interface Combatant {
  name: string;
  rarity: string;
  color: number;   // rarity color (0xRRGGBB)
  hp: number;
  atk: number;
  sprite: string;
}

function statsFor(worth: number, rarity: Rarity): { hp: number; atk: number } {
  const rank = RARITY_RANK[rarity] ?? 0;
  const hp = 420 + rank * 160 + Math.min(600, Math.round(worth / 4));
  const atk = 60 + rank * 22 + Math.min(120, Math.round(worth / 20));
  return { hp, atk };
}

function toCombatant(name: string, rarity: string, worth: number, idx: number): Combatant {
  const r = (rarity in RARITY_RANK ? rarity : "common") as Rarity;
  const { hp, atk } = statsFor(worth, r);
  return {
    name, rarity: RARITY_LABELS[r] ?? rarity, color: RARITY_COLORS[r] ?? 0x8899aa,
    hp, atk, sprite: FIGHTER_SPRITES[Math.min(FIGHTER_SPRITES.length - 1, RARITY_RANK[r] ?? idx)]!,
  };
}

/** Battle preview: the player's strongest cards vs a mirrored rival line-up. */
export async function battleReadModel(guildId: string, userId: string) {
  const coll = await getUserCollection(guildId, userId);
  const top = [...coll].sort((a, b) => b.worthValue - a.worthValue).slice(0, 3);

  const team = top.length
    ? top.map((c, i) => toCombatant(c.name, c.rarity, c.worthValue, i))
    : [toCombatant("Rookie Recruit", "common", 40, 0)];

  // A rival team scaled to the player's, so the preview fight is competitive.
  const rival = team.map((c, i) => ({
    ...c,
    name: ["Iron Marauder", "Ashen Vanguard", "Storm Reaver"][i] ?? "Rival",
    hp: Math.round(c.hp * 0.95), atk: Math.round(c.atk * 1.02),
    sprite: FIGHTER_SPRITES[(FIGHTER_SPRITES.indexOf(c.sprite) + 3) % FIGHTER_SPRITES.length]!,
  }));

  return { backdrops: BACKDROPS, player: team, opponent: rival };
}

/** Raid campaign: real bosses in ladder order + this player's clear progress. */
export async function raidReadModel(guildId: string, userId: string) {
  const [progress, coll] = await Promise.all([
    getCampaignProgress(guildId, userId),
    getUserCollection(guildId, userId),
  ]);
  const bosses = progress.ordered.map((b, i) => ({
    id: b.id,
    name: b.name,
    rarity: b.rarity,
    color: RARITY_COLORS[(b.rarity as Rarity) in RARITY_RANK ? (b.rarity as Rarity) : "mythic"] ?? 0xff2d92,
    maxHealth: b.baseHealth,
    enrageTurn: b.enrageTurn,
    sprite: BOSS_SPRITES[i % BOSS_SPRITES.length]!,
    defeated: progress.defeatedIds.has(b.id),
  }));
  const team = [...coll].sort((a, b) => b.worthValue - a.worthValue).slice(0, 3)
    .map((c, i) => toCombatant(c.name, c.rarity, c.worthValue, i));

  return {
    backdrops: BACKDROPS,
    bosses,
    progress: { defeated: progress.defeated, total: progress.total, nextName: progress.next?.name ?? null, complete: progress.isComplete },
    team: team.length ? team : [toCombatant("Rookie Recruit", "common", 40, 0)],
  };
}

/** Pack preview: real tiers + real rarity odds. Rolls display rarities client-
 *  side from these weights; grants NOTHING (authoritative opening stays in bot). */
export async function packReadModel(guildId: string) {
  const settings = await getOrCreateGuildSettings(guildId);
  const order = getRarityOrder(settings);
  const rarities = order.map((r) => ({
    key: r, label: RARITY_LABELS[r], color: RARITY_COLORS[r],
    weight: (settings[`rarityWeight${r[0]!.toUpperCase()}${r.slice(1)}` as keyof typeof settings] as number | null) ?? RARITY_WEIGHTS[r],
  }));
  const tiers = PACK_TIERS.map((t) => {
    const cfg = resolveTierConfig(settings, t);
    return { id: t, label: tierLabel(settings, t), cost: cfg.cost, size: cfg.size, emoji: PACK_TIER_META[t].emoji };
  });
  return { tiers, rarities };
}
