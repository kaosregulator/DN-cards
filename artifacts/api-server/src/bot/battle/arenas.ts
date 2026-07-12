// Battle Arena progression — replaces the old Easy…Nightmare AI difficulties.
//
// Each arena is a LEVEL BAND. The player picks any arena (nothing is locked),
// but the AI card is scaled to the arena's level, so bringing an under-levelled
// card to a high arena is a quick wipe. The grind to Lv 100 lets you breeze the
// Ascended arena — and by Lv 100 the card is also 5⭐, the boss-raid entry gate.
// Higher arenas pay out proportionally more XP / shards / loot.
//
// Defaults live here; the level-scaling curve and reward economy are tunable in
// battle_settings (level_max_bonus_pct, reward*), and the /edituser Battle
// Profile view can force a user's card to any level for testing/fixes.

export type ArenaKey = "beginner" | "rookie" | "veteran" | "elite" | "champion" | "ascended";

export interface Arena {
  key: ArenaKey;
  name: string;
  emoji: string;
  minLevel: number;
  maxLevel: number;
  /** Level the AI card is scaled to in this arena (top of the band). */
  aiLevel: number;
  /** AI tactical skill 0..1 (card pick + move choice sharpness). */
  aiSkill: number;
  /** Multiplier applied to XP / shard / loot payouts for this arena. */
  rewardMult: number;
}

export const ARENAS: Record<ArenaKey, Arena> = {
  beginner: { key: "beginner", name: "Beginner Arena", emoji: "🟢", minLevel: 1, maxLevel: 6, aiLevel: 6, aiSkill: 0.2, rewardMult: 1.0 },
  rookie: { key: "rookie", name: "Rookie Arena", emoji: "🔵", minLevel: 7, maxLevel: 20, aiLevel: 20, aiSkill: 0.42, rewardMult: 1.4 },
  veteran: { key: "veteran", name: "Veteran Arena", emoji: "🟡", minLevel: 21, maxLevel: 40, aiLevel: 40, aiSkill: 0.6, rewardMult: 2.0 },
  elite: { key: "elite", name: "Elite Arena", emoji: "🟠", minLevel: 41, maxLevel: 70, aiLevel: 70, aiSkill: 0.78, rewardMult: 2.8 },
  champion: { key: "champion", name: "Champion Arena", emoji: "🔴", minLevel: 71, maxLevel: 99, aiLevel: 99, aiSkill: 0.9, rewardMult: 3.8 },
  ascended: { key: "ascended", name: "Ascended Arena", emoji: "💀", minLevel: 100, maxLevel: 100, aiLevel: 100, aiSkill: 0.98, rewardMult: 5.0 },
};

export const ARENA_KEYS = Object.keys(ARENAS) as ArenaKey[];

export function isArenaKey(v: string): v is ArenaKey {
  return v in ARENAS;
}

export function getArena(key: string | null | undefined): Arena {
  return (key && isArenaKey(key) ? ARENAS[key] : ARENAS.beginner);
}

/** The arena whose band contains `level` (used to recommend the player's tier). */
export function arenaForLevel(level: number): Arena {
  for (const a of Object.values(ARENAS)) {
    if (level >= a.minLevel && level <= a.maxLevel) return a;
  }
  return level >= 100 ? ARENAS.ascended : ARENAS.beginner;
}

export function arenaLabel(key: string | null | undefined): string {
  const a = getArena(key);
  return `${a.emoji} ${a.name}`;
}
