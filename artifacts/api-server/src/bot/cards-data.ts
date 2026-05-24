// DN Cards — DarkNight Military Card Roster
// Themed around military vehicles, aircraft, ships, bosses, and community exclusives.
//
// Drop weights (higher = more common):
//   Common:    60   worth:   10  burn:   5
//   Uncommon:  25   worth:   50  burn:  25
//   Rare:      10   worth:  200  burn: 100
//   Epic:       4   worth:  750  burn: 375
//   Legendary:  1   worth: 2500  burn: 1250

export type Rarity = "common" | "uncommon" | "rare" | "epic" | "legendary";
export type CardType = "tank" | "aircraft" | "ship" | "vehicle" | "infantry" | "boss" | "community" | "event" | "achievement" | "limited";

export const RARITY_WEIGHTS: Record<Rarity, number> = {
  common: 60,
  uncommon: 25,
  rare: 10,
  epic: 4,
  legendary: 1,
};

export const RARITY_WORTH: Record<Rarity, number> = {
  common: 10,
  uncommon: 50,
  rare: 200,
  epic: 750,
  legendary: 2500,
};

export const RARITY_BURN: Record<Rarity, number> = {
  common: 5,
  uncommon: 25,
  rare: 100,
  epic: 375,
  legendary: 1250,
};

export const RARITY_COLORS: Record<Rarity, number> = {
  common: 0x95a5a6,    // gray
  uncommon: 0x2ecc71,  // green
  rare: 0x3498db,      // blue
  epic: 0x9b59b6,      // purple
  legendary: 0xf39c12, // gold
};

export const RARITY_EMOJI: Record<Rarity, string> = {
  common: "⚪",
  uncommon: "🟢",
  rare: "🔵",
  epic: "🟣",
  legendary: "🌟",
};

export const RARITY_LABELS: Record<Rarity, string> = {
  common: "Common",
  uncommon: "Uncommon",
  rare: "Rare",
  epic: "Epic",
  legendary: "Legendary",
};

export const TYPE_EMOJI: Record<CardType, string> = {
  tank: "🪖",
  aircraft: "✈️",
  ship: "🚢",
  vehicle: "🚗",
  infantry: "👤",
  boss: "💀",
  community: "👑",
  event: "🎆",
  achievement: "🏅",
  limited: "💎",
};

// ── Collector Ranks (by unique cards owned) ───────────────────────────────────
export const COLLECTOR_RANKS = [
  { name: "Recruit",       emoji: "🪖",  min: 0   },
  { name: "Private",       emoji: "⭐",  min: 5   },
  { name: "Corporal",      emoji: "⭐⭐", min: 15  },
  { name: "Sergeant",      emoji: "🎖️",  min: 30  },
  { name: "Lieutenant",    emoji: "🔰",  min: 50  },
  { name: "Captain",       emoji: "🏅",  min: 75  },
  { name: "Colonel",       emoji: "🌟",  min: 100 },
  { name: "General",       emoji: "💎",  min: 150 },
  { name: "Dark Commander",emoji: "👑",  min: 200 },
];

export function getCollectorRank(uniqueCards: number) {
  let rank = COLLECTOR_RANKS[0];
  for (const r of COLLECTOR_RANKS) {
    if (uniqueCards >= r.min) rank = r;
    else break;
  }
  return rank;
}

export function getNextRank(uniqueCards: number) {
  for (const r of COLLECTOR_RANKS) {
    if (uniqueCards < r.min) return r;
  }
  return null;
}

// ── Default Card Roster ───────────────────────────────────────────────────────
export interface DefaultCard {
  name: string;
  description: string;
  flavor: string;
  rarity: Rarity;
  cardType: CardType;
  dropWeight: number;
  worthValue: number;
  burnValue: number;
  droppable: boolean;
}

export const DEFAULT_CARDS: DefaultCard[] = [
  // ────────── COMMON ──────────
  {
    name: "M4 Sherman",
    description: "WWII-era American medium tank. Mass-produced and dependable.",
    flavor: '"Not the best, but always there."',
    rarity: "common", cardType: "tank",
    dropWeight: 60, worthValue: 10, burnValue: 5, droppable: true,
  },
  {
    name: "Jeep Willys",
    description: "The iconic WWII military utility vehicle. Goes anywhere, does everything.",
    flavor: '"Every base runs on Jeeps."',
    rarity: "common", cardType: "vehicle",
    dropWeight: 60, worthValue: 10, burnValue: 5, droppable: true,
  },
  {
    name: "Dog Tags",
    description: "Standard military identification tags. Every soldier carries them.",
    flavor: '"Name, rank, serial number."',
    rarity: "common", cardType: "infantry",
    dropWeight: 60, worthValue: 10, burnValue: 5, droppable: true,
  },
  {
    name: "M1 Helmet",
    description: "Standard steel combat helmet. Basic but lifesaving.",
    flavor: '"Simple protection, maximum respect."',
    rarity: "common", cardType: "infantry",
    dropWeight: 60, worthValue: 10, burnValue: 5, droppable: true,
  },
  {
    name: "Radio Set AN/PRC",
    description: "Field communication radio. The backbone of battlefield coordination.",
    flavor: '"Comms up, troops move."',
    rarity: "common", cardType: "infantry",
    dropWeight: 60, worthValue: 10, burnValue: 5, droppable: true,
  },
  {
    name: "Supply Truck",
    description: "A reliable logistics truck keeping the frontline supplied.",
    flavor: '"Ammo, fuel, food — the silent warriors."',
    rarity: "common", cardType: "vehicle",
    dropWeight: 60, worthValue: 10, burnValue: 5, droppable: true,
  },
  {
    name: "Recon Drone",
    description: "Small tactical drone for battlefield surveillance.",
    flavor: '"Eyes in the sky."',
    rarity: "common", cardType: "aircraft",
    dropWeight: 60, worthValue: 10, burnValue: 5, droppable: true,
  },
  {
    name: "Sandbag Bunker",
    description: "A hastily built defensive position. Saved countless lives.",
    flavor: '"Dig in. Hold the line."',
    rarity: "common", cardType: "infantry",
    dropWeight: 60, worthValue: 10, burnValue: 5, droppable: true,
  },

  // ────────── UNCOMMON ──────────
  {
    name: "M1 Abrams",
    description: "The United States primary main battle tank. Heavily armored and lethal.",
    flavor: '"120mm of democracy."',
    rarity: "uncommon", cardType: "tank",
    dropWeight: 25, worthValue: 50, burnValue: 25, droppable: true,
  },
  {
    name: "AH-64 Apache",
    description: "American attack helicopter. The bane of armored columns worldwide.",
    flavor: '"Hellfire and thunder."',
    rarity: "uncommon", cardType: "aircraft",
    dropWeight: 25, worthValue: 50, burnValue: 25, droppable: true,
  },
  {
    name: "USS Arleigh Burke",
    description: "Guided-missile destroyer. One of the most capable surface combatants afloat.",
    flavor: '"Speed, stealth, and Tomahawks."',
    rarity: "uncommon", cardType: "ship",
    dropWeight: 25, worthValue: 50, burnValue: 25, droppable: true,
  },
  {
    name: "F-16 Fighting Falcon",
    description: "A legendary multirole fighter. Over 4,500 built across the world.",
    flavor: '"Lightweight, lethal, everywhere."',
    rarity: "uncommon", cardType: "aircraft",
    dropWeight: 25, worthValue: 50, burnValue: 25, droppable: true,
  },
  {
    name: "Bradley IFV",
    description: "M2 Bradley Infantry Fighting Vehicle. Bridges the gap between tank and transport.",
    flavor: '"Infantry and firepower as one."',
    rarity: "uncommon", cardType: "vehicle",
    dropWeight: 25, worthValue: 50, burnValue: 25, droppable: true,
  },
  {
    name: "T-80 Objekat",
    description: "Soviet cold war MBT. Gas turbine engine, fast and fearsome.",
    flavor: '"The Iron Curtain on treads."',
    rarity: "uncommon", cardType: "tank",
    dropWeight: 25, worthValue: 50, burnValue: 25, droppable: true,
  },

  // ────────── RARE ──────────
  {
    name: "F-22 Raptor",
    description: "America's premier air superiority stealth fighter. No equal in the sky.",
    flavor: '"You never see it coming."',
    rarity: "rare", cardType: "aircraft",
    dropWeight: 10, worthValue: 200, burnValue: 100, droppable: true,
  },
  {
    name: "USS Nimitz",
    description: "Nuclear-powered supercarrier. A floating city of airpower.",
    flavor: '"90,000 tons of American diplomacy."',
    rarity: "rare", cardType: "ship",
    dropWeight: 10, worthValue: 200, burnValue: 100, droppable: true,
  },
  {
    name: "Leopard 2A7",
    description: "Germany's finest MBT, upgraded for modern warfare. Precision personified.",
    flavor: '"German engineering at 1,500 horsepower."',
    rarity: "rare", cardType: "tank",
    dropWeight: 10, worthValue: 200, burnValue: 100, droppable: true,
  },
  {
    name: "T-14 Armata",
    description: "Russia's next-generation tank. Unmanned turret, cutting-edge systems.",
    flavor: '"The future of tank warfare."',
    rarity: "rare", cardType: "tank",
    dropWeight: 10, worthValue: 200, burnValue: 100, droppable: true,
  },
  {
    name: "B-2 Spirit",
    description: "Stealth strategic bomber. Invisible, intercontinental, unstoppable.",
    flavor: '"Two billion reasons to stay hidden."',
    rarity: "rare", cardType: "aircraft",
    dropWeight: 10, worthValue: 200, burnValue: 100, droppable: true,
  },
  {
    name: "USS Virginia",
    description: "Virginia-class nuclear attack submarine. Silent hunter of the deep.",
    flavor: '"The sea holds no secrets from her."',
    rarity: "rare", cardType: "ship",
    dropWeight: 10, worthValue: 200, burnValue: 100, droppable: true,
  },

  // ────────── EPIC ──────────
  {
    name: "SR-71 Blackbird",
    description: "The fastest aircraft ever built. Mach 3.3 and untouchable at 85,000 feet.",
    flavor: '"When a missile fired at it, the pilot simply accelerated."',
    rarity: "epic", cardType: "aircraft",
    dropWeight: 4, worthValue: 750, burnValue: 375, droppable: true,
  },
  {
    name: "USS Gerald R. Ford",
    description: "The most advanced aircraft carrier ever built. 13 billion dollars of raw power.",
    flavor: '"The crown jewel of American sea power."',
    rarity: "epic", cardType: "ship",
    dropWeight: 4, worthValue: 750, burnValue: 375, droppable: true,
  },
  {
    name: "F-35 Lightning II",
    description: "Next-gen stealth multirole fighter. Sees everything, goes everywhere.",
    flavor: '"One platform to rule them all."',
    rarity: "epic", cardType: "aircraft",
    dropWeight: 4, worthValue: 750, burnValue: 375, droppable: true,
  },
  {
    name: "Night Stalker",
    description: "Elite special operations unit. No rank, no record, no trace.",
    flavor: '"They were never there."',
    rarity: "epic", cardType: "infantry",
    dropWeight: 4, worthValue: 750, burnValue: 375, droppable: true,
  },

  // ────────── LEGENDARY ──────────
  {
    name: "Darknight Titan",
    description: "The ultimate guardian of the DarkNight community. Feared and respected by all.",
    flavor: '"Where shadow falls, the Titan rises."',
    rarity: "legendary", cardType: "boss",
    dropWeight: 1, worthValue: 2500, burnValue: 1250, droppable: true,
  },
  {
    name: "Operation Zero",
    description: "Classified. Mission parameters unknown. Outcome: decisive.",
    flavor: '"[REDACTED] — Level 5 clearance required."',
    rarity: "legendary", cardType: "event",
    dropWeight: 1, worthValue: 2500, burnValue: 1250, droppable: true,
  },
  {
    name: "The Warlord",
    description: "A commander without a nation, a legend without a name. Commands loyalty through fear.",
    flavor: '"Armies fall. The Warlord endures."',
    rarity: "legendary", cardType: "boss",
    dropWeight: 1, worthValue: 2500, burnValue: 1250, droppable: true,
  },
];
