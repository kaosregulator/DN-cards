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

// ── Shiny cards ──────────────────────────────────────────────────────────────
// Fixed across all servers (not configurable): every successful acquisition
// (catch, pack, tradein reward) has a flat 0.5% chance to be Shiny. Shiny
// copies are tracked separately and count at 2× normal worth/burn value.
// Admin-given cards (/give) and trades never mint shinies.
export const SHINY_RATE = 0.005;
export const SHINY_MULTIPLIER = 2;
export const SHINY_EMOJI = "✨";

// Trade fairness: warn when one side's total value is more than 3× the
// other side's. Pure shards count 1:1 with shard value; cards use worthValue.
// Shinies are not tradeable in v1 so they don't enter this calc.
export const FAIRNESS_RATIO_THRESHOLD = 3;

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
  imageUrl?: string;
}

export const DEFAULT_CARDS: DefaultCard[] = [
  // ────────── COMMON ──────────
  {
    name: "M4 Sherman",
    description: "WWII-era American medium tank. Mass-produced and dependable.",
    flavor: '"Not the best, but always there."',
    rarity: "common", cardType: "tank",
    dropWeight: 60, worthValue: 10, burnValue: 5, imageUrl: "https://media.gettyimages.com/id/1320438797/vector/wwii-m4-sherman-tank-firing-weapons-on-omaha-beach.jpg?s=612x612&w=0&k=20&c=j7ICqItuepcVhH7unPCg6CWiROBPEyzYAT2QNXSjYsg=",
    droppable: true,
  },
  {
    name: "Jeep Willys",
    description: "The iconic WWII military utility vehicle. Goes anywhere, does everything.",
    flavor: '"Every base runs on Jeeps."',
    rarity: "common", cardType: "vehicle",
    dropWeight: 60, worthValue: 10, burnValue: 5, imageUrl: "https://hips.hearstapps.com/mtg-prod/65c40301c378ac0008577ec6/willys-mb-wwii-jeep-wrangler-predecessor-2.jpg?w=768&width=768&q=75&format=webp",
    droppable: true,
  },
  {
    name: "Dog Tags",
    description: "Standard military identification tags. Every soldier carries them.",
    flavor: '"Name, rank, serial number."',
    rarity: "common", cardType: "infantry",
    dropWeight: 60, worthValue: 10, burnValue: 5, imageUrl: "https://cdn11.bigcommerce.com/s-s3zvdrz9/images/stencil/500x659/products/630/2047/US_Army_Dogtags__50805.1664241006.jpg?c=2",
    droppable: true,
  },
  {
    name: "M1 Helmet",
    description: "Standard steel combat helmet. Basic but lifesaving.",
    flavor: '"Simple protection, maximum respect."',
    rarity: "common", cardType: "infantry",
    dropWeight: 60, worthValue: 10, burnValue: 5, imageUrl: "https://www.surplusandlost.co.uk/wp-content/uploads/2024/06/image426256087.jpg",
    droppable: true,
  },
  {
    name: "Radio Set AN/PRC",
    description: "Field communication radio. The backbone of battlefield coordination.",
    flavor: '"Comms up, troops move."',
    rarity: "common", cardType: "infantry",
    dropWeight: 60, worthValue: 10, burnValue: 5, imageUrl: "https://i.ebayimg.com/thumbs/images/g/Gv8AAOSw3E1lNOGX/s-l300.jpg",
    droppable: true,
  },
  {
    name: "Supply Truck",
    description: "A reliable logistics truck keeping the frontline supplied.",
    flavor: '"Ammo, fuel, food — the silent warriors."',
    rarity: "common", cardType: "vehicle",
    dropWeight: 60, worthValue: 10, burnValue: 5, imageUrl: "https://m.media-amazon.com/images/I/71yDGvnccuL.jpg",
    droppable: true,
  },
  {
    name: "Recon Drone",
    description: "Small tactical drone for battlefield surveillance.",
    flavor: '"Eyes in the sky."',
    rarity: "common", cardType: "aircraft",
    dropWeight: 60, worthValue: 10, burnValue: 5, imageUrl: "https://gagadget.com/media/post_big/1200px-RQ-11_Raven_1_3bBgn0E.jpg",
    droppable: true,
  },
  {
    name: "Sandbag Bunker",
    description: "A hastily built defensive position. Saved countless lives.",
    flavor: '"Dig in. Hold the line."',
    rarity: "common", cardType: "infantry",
    dropWeight: 60, worthValue: 10, burnValue: 5, imageUrl: "https://thumbs.dreamstime.com/b/wooden-house-wall-sandbags-military-fortification-place-targeted-shooting-sandbag-wall-shooting-hole-192222460.jpg",
    droppable: true,
  },

  // ────────── UNCOMMON ──────────
  {
    name: "M1 Abrams",
    description: "The United States primary main battle tank. Heavily armored and lethal.",
    flavor: '"120mm of democracy."',
    rarity: "uncommon", cardType: "tank",
    dropWeight: 25, worthValue: 50, burnValue: 25, imageUrl: "https://www.militaryfactory.com/armor/imgs/lrg/m1-abrams-main-battle-tank-united-states_9.jpg",
    droppable: true,
  },
  {
    name: "AH-64 Apache",
    description: "American attack helicopter. The bane of armored columns worldwide.",
    flavor: '"Hellfire and thunder."',
    rarity: "uncommon", cardType: "aircraft",
    dropWeight: 25, worthValue: 50, burnValue: 25, imageUrl: "https://www.armyrecognition.com/images/stories/north_america/united-states/helicopter/ah-64/AH-64_Apache_attack_helicopter_US_United_States_army_air_force_front_side_view_001.jpg",
    droppable: true,
  },
  {
    name: "USS Arleigh Burke",
    description: "Guided-missile destroyer. One of the most capable surface combatants afloat.",
    flavor: '"Speed, stealth, and Tomahawks."',
    rarity: "uncommon", cardType: "ship",
    dropWeight: 25, worthValue: 50, burnValue: 25, imageUrl: "https://seaforces.org/usnships/ddg/DDG-51_DAT/DDG-51-USS-Arleigh-Burke-098.jpg",
    droppable: true,
  },
  {
    name: "F-16 Fighting Falcon",
    description: "A legendary multirole fighter. Over 4,500 built across the world.",
    flavor: '"Lightweight, lethal, everywhere."',
    rarity: "uncommon", cardType: "aircraft",
    dropWeight: 25, worthValue: 50, burnValue: 25, imageUrl: "https://external-preview.redd.it/f-16-fighting-falcon-fighter-jet-its-history-and-current-v0-sYPMKMuVjmvGZmF7KRKt9Dkf7r6xECn1ny5oGRrdKkw.png?width=640&crop=smart&auto=webp&s=4d3738cb3369fd8e23993866d0ba6a0fc97131db",
    droppable: true,
  },
  {
    name: "Bradley IFV",
    description: "M2 Bradley Infantry Fighting Vehicle. Bridges the gap between tank and transport.",
    flavor: '"Infantry and firepower as one."',
    rarity: "uncommon", cardType: "vehicle",
    dropWeight: 25, worthValue: 50, burnValue: 25, imageUrl: "https://media.gettyimages.com/id/2229645777/photo/warsaw-poland-august-15-u-s-army-m2-bradley-an-american-infantry-fighting-vehicle-seen-taking.jpg?s=612x612&w=0&k=20&c=8E5hx1ibR0AUOXvor-ivP3KKIHbbAwMt98LiOWBzXCU=",
    droppable: true,
  },
  {
    name: "T-80 Objekat",
    description: "Soviet cold war MBT. Gas turbine engine, fast and fearsome.",
    flavor: '"The Iron Curtain on treads."',
    rarity: "uncommon", cardType: "tank",
    dropWeight: 25, worthValue: 50, burnValue: 25, imageUrl: "https://preview.redd.it/73v0atdn6gl81.png?auto=webp&s=3bcebb735f068eff6ddf52153196dfcc07cc8b59",
    droppable: true,
  },

  // ────────── RARE ──────────
  {
    name: "F-22 Raptor",
    description: "America's premier air superiority stealth fighter. No equal in the sky.",
    flavor: '"You never see it coming."',
    rarity: "rare", cardType: "aircraft",
    dropWeight: 10, worthValue: 200, burnValue: 100, imageUrl: "https://www.19fortyfive.com/wp-content/uploads/2026/03/U.S.-Air-Force-F-22-Raptor-Fighter-Stealth.jpg",
    droppable: true,
  },
  {
    name: "USS Nimitz",
    description: "Nuclear-powered supercarrier. A floating city of airpower.",
    flavor: '"90,000 tons of American diplomacy."',
    rarity: "rare", cardType: "ship",
    dropWeight: 10, worthValue: 200, burnValue: 100, imageUrl: "https://www.seaforces.org/usnships/cvn/CVN-76_DAT/CVN-76-USS-Ronald-Reagan-154.jpg",
    droppable: true,
  },
  {
    name: "Leopard 2A7",
    description: "Germany's finest MBT, upgraded for modern warfare. Precision personified.",
    flavor: '"German engineering at 1,500 horsepower."',
    rarity: "rare", cardType: "tank",
    dropWeight: 10, worthValue: 200, burnValue: 100, imageUrl: "https://www.armyrecognition.com/images/stories/europe/germany/main_battle_tank/leopard_2a7/Leopard_2A7_MBT_Main_Battle_Tank_Germany_German_army_KMW_defense_industry_left_side_view_002.jpg",
    droppable: true,
  },
  {
    name: "T-14 Armata",
    description: "Russia's next-generation tank. Unmanned turret, cutting-edge systems.",
    flavor: '"The future of tank warfare."',
    rarity: "rare", cardType: "tank",
    dropWeight: 10, worthValue: 200, burnValue: 100, imageUrl: "https://defensefeeds.com/wp-content/uploads/2025/05/russian-t-14-armata-tank-1024x683.webp",
    droppable: true,
  },
  {
    name: "B-2 Spirit",
    description: "Stealth strategic bomber. Invisible, intercontinental, unstoppable.",
    flavor: '"Two billion reasons to stay hidden."',
    rarity: "rare", cardType: "aircraft",
    dropWeight: 10, worthValue: 200, burnValue: 100, imageUrl: "https://i.ebayimg.com/images/g/qrYAAOSwRbpcUGLu/s-l960.webp",
    droppable: true,
  },
  {
    name: "USS Virginia",
    description: "Virginia-class nuclear attack submarine. Silent hunter of the deep.",
    flavor: '"The sea holds no secrets from her."',
    rarity: "rare", cardType: "ship",
    dropWeight: 10, worthValue: 200, burnValue: 100, imageUrl: "https://www.seaforces.org/usnships/ssn/SSN-774_DAT/SSN-774-USS-Virginia-062.jpg",
    droppable: true,
  },

  // ────────── EPIC ──────────
  {
    name: "SR-71 Blackbird",
    description: "The fastest aircraft ever built. Mach 3.3 and untouchable at 85,000 feet.",
    flavor: '"When a missile fired at it, the pilot simply accelerated."',
    rarity: "epic", cardType: "aircraft",
    dropWeight: 4, worthValue: 750, burnValue: 375, imageUrl: "https://render.fineartamerica.com/images/rendered/small/canvas-print/7/10/mirror/break/images-medium-5/sr-71-blackbird-reconnaissance-aircraft-us-air-forcescience-photo-library-canvas-print.jpg",
    droppable: true,
  },
  {
    name: "USS Gerald R. Ford",
    description: "The most advanced aircraft carrier ever built. 13 billion dollars of raw power.",
    flavor: '"The crown jewel of American sea power."',
    rarity: "epic", cardType: "ship",
    dropWeight: 4, worthValue: 750, burnValue: 375, imageUrl: "https://www.stripes.com/incoming/fzy6en-210426fordphoto01.jpg/alternates/LANDSCAPE_910/210426FORDphoto01.JPG",
    droppable: true,
  },
  {
    name: "F-35 Lightning II",
    description: "Next-gen stealth multirole fighter. Sees everything, goes everywhere.",
    flavor: '"One platform to rule them all."',
    rarity: "epic", cardType: "aircraft",
    dropWeight: 4, worthValue: 750, burnValue: 375, imageUrl: "https://cdn11.bigcommerce.com/s-621ae/product_images/uploaded_images/8014-action-shot-for-web.jpg",
    droppable: true,
  },
  {
    name: "Night Stalker",
    description: "Elite special operations unit. No rank, no record, no trace.",
    flavor: '"They were never there."',
    rarity: "epic", cardType: "infantry",
    dropWeight: 4, worthValue: 750, burnValue: 375, imageUrl: "https://media.gettyimages.com/id/1269772940/photo/us-special-forces-training.jpg?s=612x612&w=0&k=20&c=yr4kZU9t6nXn5r2abdIqhc9ipYHZIcC31qz1BlvyfyE=",
    droppable: true,
  },

  // ────────── LEGENDARY ──────────
  {
    name: "Darknight Titan",
    description: "The ultimate guardian of the DarkNight community. Feared and respected by all.",
    flavor: '"Where shadow falls, the Titan rises."',
    rarity: "legendary", cardType: "boss",
    dropWeight: 1, worthValue: 2500, burnValue: 1250, imageUrl: "https://i.pinimg.com/originals/31/ee/87/31ee873abab882cc81dfb22f112fa824.jpg",
    droppable: true,
  },
  {
    name: "Operation Zero",
    description: "Classified. Mission parameters unknown. Outcome: decisive.",
    flavor: '"[REDACTED] — Level 5 clearance required."',
    rarity: "legendary", cardType: "event",
    dropWeight: 1, worthValue: 2500, burnValue: 1250, imageUrl: "https://static.3dcrystalized.com/guide_20250314-ce107560-012f-11f0-8cd2-0fe0861bfec3.jpg.webp",
    droppable: true,
  },
  {
    name: "The Warlord",
    description: "A commander without a nation, a legend without a name. Commands loyalty through fear.",
    flavor: '"Armies fall. The Warlord endures."',
    rarity: "legendary", cardType: "boss",
    dropWeight: 1, worthValue: 2500, burnValue: 1250, imageUrl: "https://i.etsystatic.com/59334334/r/il/1d11f7/7999631048/il_300x300.7999631048_rnms.jpg",
    droppable: true,
  },
];
