// DN Cards — DarkNight Military Card Roster
// Your custom 60-card default roster. Auto-seeded on first server join.
// Update via the dashboard or run `/loadset defaults:true` to re-add after `/unloadset`.
//
// Drop weights (higher = more common):
//   Common:    60   worth:   20  burn:   10
//   Uncommon:  25   worth:   50  burn:   25
//   Rare:      10   worth: 3000  burn: 1500
//   Epic:       4   worth: 1480-5000  burn: 740-2500
//   Legendary:  1   worth:  800-10000  burn: 400-5000

export type Rarity = "common" | "uncommon" | "rare" | "epic" | "legendary";
export type CardType = string; // free-form label — any text the admin types

// Rarity hierarchy (least → most rare):
//   Common → Uncommon → Exotic (epic key) → Legendary → Rare
// The DB enum keeps "epic" but it's labelled "Exotic" for users.
export const RARITY_WEIGHTS: Record<Rarity, number> = {
  common: 60,
  uncommon: 25,
  epic: 10,
  legendary: 4,
  rare: 1,
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
  epic: "Exotic",     // DB enum key stays "epic" — user-facing label is Exotic
  legendary: "Legendary",
  rare: "Rare",       // promoted to top tier (rarest)
};

export const TYPE_EMOJI: Record<string, string> = {
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

/** Safe emoji lookup — returns 🃏 for any unknown label so custom types don't crash. */
export function getTypeEmoji(cardType: string | undefined | null): string {
  if (!cardType) return "🃏";
  return TYPE_EMOJI[cardType.toLowerCase()] ?? "🃏";
}

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
// Your DN Cards roster — 60 cards, all tagged as "defaults" in the DB.
export interface DefaultCard {
  name: string;
  description?: string;
  flavor?: string;
  rarity: Rarity;
  cardType: CardType;
  dropWeight: number;
  worthValue: number;
  burnValue: number;
  droppable?: boolean;
  isLimitedEdition?: boolean;
  isEventExclusive?: boolean;
  maxCopies?: number;
  inPacks?: boolean;
  imageUrl?: string;
  previewAnimation?: string;
  previewBgColor?: string;
  displayOrientation?: string;
}

export const DEFAULT_CARDS: DefaultCard[] = [
  // ────────── COMMON ──────────
  {
        name: "ATV",
        rarity: "common", cardType: "vehicle",
        dropWeight: 60, worthValue: 20, burnValue: 10,
        imageUrl: "https://misu.nephbox.net/card_image/1363917781355069761/atv_00018117.jpg",
  },
  {
        name: "Armored Jeep",
        rarity: "common", cardType: "vehicle",
        dropWeight: 60, worthValue: 20, burnValue: 10,
        imageUrl: "https://misu.nephbox.net/card_image/1363917781355069761/armored_jeep_00018115.jpg",
  },
  {
        name: "Artillery Truck",
        rarity: "common", cardType: "vehicle",
        dropWeight: 60, worthValue: 20, burnValue: 10,
        imageUrl: "https://misu.nephbox.net/card_image/1363917781355069761/e4d6b06b7b384831ac2d4c1542b75563.jpg",
  },
  {
        name: "Biplane",
        rarity: "common", cardType: "vehicle",
        dropWeight: 60, worthValue: 20, burnValue: 10,
        imageUrl: "https://misu.nephbox.net/card_image/1363917781355069761/biplane_00018125.jpg",
  },
  {
        name: "Chinook",
        rarity: "common", cardType: "vehicle",
        dropWeight: 60, worthValue: 20, burnValue: 10,
        imageUrl: "https://misu.nephbox.net/card_image/1363917781355069761/chinook_00018124.jpg",
  },
  {
        name: "Hacker Soldier",
        rarity: "common", cardType: "vehicle",
        dropWeight: 60, worthValue: 20, burnValue: 10,
        imageUrl: "https://misu.nephbox.net/card_image/1363917781355069761/hacker_soldier_00018132.png",
  },
  {
        name: "Juggernaut",
        rarity: "common", cardType: "vehicle",
        dropWeight: 60, worthValue: 20, burnValue: 10,
        imageUrl: "https://misu.nephbox.net/card_image/1363917781355069761/18131.png",
  },
  {
        name: "Logistics Truck",
        rarity: "common", cardType: "vehicle",
        dropWeight: 60, worthValue: 20, burnValue: 10,
        imageUrl: "https://misu.nephbox.net/card_image/1363917781355069761/logistics_truck_00018116.jpg",
  },
  {
        name: "RPG Soldier",
        rarity: "common", cardType: "vehicle",
        dropWeight: 60, worthValue: 20, burnValue: 10,
        imageUrl: "https://misu.nephbox.net/card_image/1363917781355069761/rpg_soldier_00018139.png",
  },
  {
        name: "Toxic Trooper",
        rarity: "common", cardType: "vehicle",
        dropWeight: 60, worthValue: 20, burnValue: 10,
        imageUrl: "https://misu.nephbox.net/card_image/1363917781355069761/toxic_trooper_00018137.png",
  },
  {
        name: "Vault Raider",
        rarity: "common", cardType: "vehicle",
        dropWeight: 60, worthValue: 20, burnValue: 10,
        imageUrl: "https://misu.nephbox.net/card_image/1363917781355069761/vault_raider_00018136.png",
  },
  {
        name: "Abrams X",
        rarity: "uncommon", cardType: "vehicle",
        dropWeight: 25, worthValue: 50, burnValue: 25,
        imageUrl: "https://misu.nephbox.net/card_image/1363917781355069761/abrams_x_00018121.png",
  },
  {
        name: "Assassin",
        rarity: "uncommon", cardType: "infantry",
        dropWeight: 25, worthValue: 50, burnValue: 25,
        imageUrl: "https://misu.nephbox.net/card_image/1363917781355069761/5df0962379ae4ce9b06d2a336a7cfba3.png",
  },
  {
        name: "Assault Bike",
        rarity: "uncommon", cardType: "vehicle",
        dropWeight: 25, worthValue: 50, burnValue: 25,
        imageUrl: "https://misu.nephbox.net/card_image/1363917781355069761/assault_bike_00018119.png",
  },
  {
        name: "BOSS Soldier",
        rarity: "uncommon", cardType: "vehicle",
        dropWeight: 25, worthValue: 50, burnValue: 25,
        imageUrl: "https://misu.nephbox.net/card_image/1363917781355069761/boss_soldier_00018134.png",
  },
  {
        name: "Blackhawk Trooper",
        rarity: "uncommon", cardType: "vehicle",
        dropWeight: 25, worthValue: 50, burnValue: 25,
        imageUrl: "https://misu.nephbox.net/card_image/1363917781355069761/3dc888636536437293a845efd438aafe.png",
  },
  {
        name: "Calzone Cannon",
        rarity: "uncommon", cardType: "vehicle",
        dropWeight: 25, worthValue: 50, burnValue: 25,
        imageUrl: "https://misu.nephbox.net/card_image/1363917781355069761/calzone_cannon_00018120.png",
  },
  {
        name: "Elite Soldier",
        rarity: "uncommon", cardType: "vehicle",
        dropWeight: 25, worthValue: 50, burnValue: 25,
        imageUrl: "https://misu.nephbox.net/card_image/1363917781355069761/elite_soldier_00018133.png",
  },
  {
        name: "Golden Soldier",
        rarity: "uncommon", cardType: "vehicle",
        dropWeight: 25, worthValue: 50, burnValue: 25,
        imageUrl: "https://misu.nephbox.net/card_image/1363917781355069761/golden_soldier_00018135.png",
  },
  {
        name: "Marine Soilder",
        description: "An amphibious infantry unit armed with an AUG and flashbang. Blinds enemies, disrupts their vision, and creates openings for teammates to attack.",
        rarity: "uncommon", cardType: "vehicle",
        dropWeight: 25, worthValue: 50, burnValue: 25,
        imageUrl: "https://misu.nephbox.net/card_image/1363917781355069761/1fa40c3562da49398246b1f92c8d0be7.png",
  },
  {
        name: "Naval Officer",
        rarity: "uncommon", cardType: "vehicle",
        dropWeight: 25, worthValue: 50, burnValue: 25,
        imageUrl: "https://misu.nephbox.net/card_image/1363917781355069761/9f4c3ae2117d414d91794eaffda0b0b9.png",
  },
  {
        name: "Railgun Killer",
        rarity: "uncommon", cardType: "vehicle",
        dropWeight: 25, worthValue: 50, burnValue: 25,
        imageUrl: "https://misu.nephbox.net/card_image/1363917781355069761/railgun_killer_00018138.png",
  },
  {
        name: "T90",
        rarity: "uncommon", cardType: "vehicle",
        dropWeight: 25, worthValue: 50, burnValue: 25,
        imageUrl: "https://misu.nephbox.net/card_image/1363917781355069761/t90_00018122.png",
  },
  {
        name: "Volk",
        rarity: "uncommon", cardType: "vehicle",
        dropWeight: 25, worthValue: 50, burnValue: 25,
        imageUrl: "https://misu.nephbox.net/card_image/1363917781355069761/volk_00018123.png",
  },
  {
        name: "Weiner Wagon",
        rarity: "uncommon", cardType: "vehicle",
        dropWeight: 25, worthValue: 50, burnValue: 25,
        imageUrl: "https://misu.nephbox.net/card_image/1363917781355069761/weiner_wagon_00018118.png",
  },
  {
        name: "G-Bis",
        rarity: "rare", cardType: "vehicle",
        dropWeight: 10, worthValue: 3000, burnValue: 1500,
        imageUrl: "https://misu.nephbox.net/card_image/1363917781355069761/g-bis_00018109.png",
  },
  {
        name: "Haunted Tank",
        rarity: "rare", cardType: "vehicle",
        dropWeight: 10, worthValue: 3000, burnValue: 1500,
        imageUrl: "https://misu.nephbox.net/card_image/1363917781355069761/haunted_tank_00018126.png",
  },
  {
        name: "LE A-10",
        rarity: "rare", cardType: "vehicle",
        dropWeight: 10, worthValue: 3000, burnValue: 1500,
        imageUrl: "https://misu.nephbox.net/card_image/1363917781355069761/2261f18589ec4d3fb8b151fcd303fa8b.png",
  },
  {
        name: "LEBB",
        rarity: "rare", cardType: "vehicle",
        dropWeight: 10, worthValue: 3000, burnValue: 1500,
        imageUrl: "https://misu.nephbox.net/card_image/1363917781355069761/fe1f2d45cb1447a2829d21d5dd694d2d.png",
  },
  {
        name: "NMT",
        rarity: "rare", cardType: "vehicle",
        dropWeight: 10, worthValue: 3000, burnValue: 1500,
        imageUrl: "https://misu.nephbox.net/card_image/1363917781355069761/d80c273e5676436faddc017f46a83690.png",
  },
  {
        name: "Patriot Event 3rd Place",
        description: "3rd Place — ArtificiallyAbove — 21 kills. Outnumbered but never outmatched. A place on the podium was earned through persistence and skill.",
        rarity: "rare", cardType: "event",
        dropWeight: 0, worthValue: 3000, burnValue: 1500,
        imageUrl: "/card-patriot-3rd.png",
        droppable: false,
        isEventExclusive: true,
        inPacks: false,
  },
  {
        name: "RATTE",
        rarity: "rare", cardType: "vehicle",
        dropWeight: 10, worthValue: 3000, burnValue: 1500,
        imageUrl: "https://misu.nephbox.net/card_image/1363917781355069761/ratte_00018127.png",
  },
  {
        name: "SA50",
        rarity: "rare", cardType: "vehicle",
        dropWeight: 10, worthValue: 3000, burnValue: 1500,
        imageUrl: "https://misu.nephbox.net/card_image/1363917781355069761/08108c02d7724998a275539f8b6e6e3d.png",
  },
  {
        name: "SB-12",
        rarity: "rare", cardType: "vehicle",
        dropWeight: 10, worthValue: 3000, burnValue: 1500,
        imageUrl: "https://misu.nephbox.net/card_image/1363917781355069761/sb-12_00018113.png",
  },
  {
        name: "SB21",
        rarity: "rare", cardType: "vehicle",
        dropWeight: 10, worthValue: 3000, burnValue: 1500,
        imageUrl: "https://misu.nephbox.net/card_image/1363917781355069761/sb21_00018114.png",
  },
  {
        name: "STT",
        rarity: "rare", cardType: "vehicle",
        dropWeight: 10, worthValue: 3000, burnValue: 1500,
        imageUrl: "https://misu.nephbox.net/card_image/1363917781355069761/6337be0ec09f46c6bb58172dd5dbca4f.png",
  },
  {
        name: "BOB",
        description: "The Face. The Legend. The Cult. Awarded to members present during the Great Bob Awakening. Grants unlimited emotional support and questionable tactical advice.",
        rarity: "epic", cardType: "community",
        dropWeight: 0, worthValue: 5000, burnValue: 2500,
        imageUrl: "/card-bob.png",
        droppable: false,
        isEventExclusive: true,
        inPacks: false,
  },
  {
        name: "Mech Walker",
        rarity: "epic", cardType: "vehicle",
        dropWeight: 4, worthValue: 2000, burnValue: 1000,
        imageUrl: "https://misu.nephbox.net/card_image/1363917781355069761/26d6264d9003474a845c9daa24e9a8dc.png",
  },
  {
        name: "Nuke Sniper",
        rarity: "epic", cardType: "vehicle",
        dropWeight: 4, worthValue: 1480, burnValue: 740,
        imageUrl: "https://misu.nephbox.net/card_image/1363917781355069761/27720dd43de44547a1024d9110d57347.png",
  },
  {
        name: "Nuke Sniper Animated",
        rarity: "epic", cardType: "vehicle",
        dropWeight: 4, worthValue: 1480, burnValue: 740,
        imageUrl: "https://misu.nephbox.net/card_image/1363917781355069761/3a6052e7dec349e7be0ce9d5bd174e7b.gif",
  },
  {
        name: "Patriot Event 2nd Place",
        description: "2nd Place — tobiqwe123 — 35 kills. One elimination short of glory, yet feared by every opponent.",
        rarity: "epic", cardType: "event",
        dropWeight: 0, worthValue: 5000, burnValue: 2500,
        imageUrl: "/card-patriot-2nd.png",
        droppable: false,
        isEventExclusive: true,
        inPacks: false,
  },
  {
        name: "Platinum Mech",
        rarity: "epic", cardType: "vehicle",
        dropWeight: 4, worthValue: 2000, burnValue: 1000,
        imageUrl: "https://misu.nephbox.net/card_image/1363917781355069761/785aa2867d83457aab48c235de0dcbfd.png",
  },
  {
        name: "Puckmonster",
        rarity: "epic", cardType: "vehicle",
        dropWeight: 4, worthValue: 1480, burnValue: 740,
        imageUrl: "https://misu.nephbox.net/card_image/1363917781355069761/c45747e7de2049efa4d05dc1106b9056.png",
  },
  {
        name: "STM",
        rarity: "epic", cardType: "vehicle",
        dropWeight: 4, worthValue: 2000, burnValue: 1000,
        imageUrl: "https://misu.nephbox.net/card_image/1363917781355069761/07dabfbdb06d4e30b7c9ace7196cefd8.png",
  },
  {
        name: "BGW",
        rarity: "legendary", cardType: "vehicle",
        dropWeight: 1, worthValue: 800, burnValue: 400,
        imageUrl: "https://misu.nephbox.net/card_image/1363917781355069761/bgw_00018110.png",
  },
  {
        name: "BOSS Sea Tank",
        rarity: "legendary", cardType: "vehicle",
        dropWeight: 1, worthValue: 800, burnValue: 400,
        imageUrl: "https://misu.nephbox.net/card_image/1363917781355069761/boss_sea_tank_00018130.png",
  },
  {
        name: "DN Owner",
        description: "The Owner of DN. The leader who builds, creates, and leads the community to victory. Respect the Owner. Respect the Vision. — Artem_Kukuruza",
        rarity: "legendary", cardType: "community",
        dropWeight: 0, worthValue: 10000, burnValue: 5000,
        imageUrl: "/card-dn-owner.png",
        droppable: false,
        isLimitedEdition: true,
        isEventExclusive: true,
        inPacks: false,
  },
  {
        name: "Founding Soldier",
        description: "Awarded to the first soldiers present during the launch of the DN Card System. Military Tycoon DN — Launch Event. The beginning of every great operation.",
        rarity: "legendary", cardType: "event",
        dropWeight: 0, worthValue: 7500, burnValue: 3750,
        imageUrl: "/card-founding-soldier.png",
        droppable: false,
        isLimitedEdition: true,
        isEventExclusive: true,
        inPacks: false,
  },
  {
        name: "Gold Typhoon",
        rarity: "legendary", cardType: "vehicle",
        dropWeight: 1, worthValue: 5000, burnValue: 2500,
        imageUrl: "https://misu.nephbox.net/card_image/1363917781355069761/121bb44e38354e00a42f2e388b8bb412.png",
  },
  {
        name: "Le Bismarck",
        rarity: "legendary", cardType: "vehicle",
        dropWeight: 1, worthValue: 800, burnValue: 400,
        imageUrl: "https://misu.nephbox.net/card_image/1363917781355069761/cecd41970a5e493cbd17c5a3fb1cf525.png",
  },
  {
        name: "Master Helstorm",
        rarity: "legendary", cardType: "vehicle",
        dropWeight: 1, worthValue: 800, burnValue: 400,
        imageUrl: "https://misu.nephbox.net/card_image/1363917781355069761/master_helstorm_00018108.png",
  },
  {
        name: "Master Reaper",
        rarity: "legendary", cardType: "vehicle",
        dropWeight: 1, worthValue: 800, burnValue: 400,
        imageUrl: "https://misu.nephbox.net/card_image/1363917781355069761/master_reaper_00018112.png",
  },
  {
        name: "Mother ship",
        rarity: "legendary", cardType: "vehicle",
        dropWeight: 1, worthValue: 800, burnValue: 400,
        imageUrl: "https://misu.nephbox.net/card_image/1363917781355069761/mother_ship_00018129.png",
  },
  {
        name: "Nuke F35",
        rarity: "legendary", cardType: "vehicle",
        dropWeight: 1, worthValue: 800, burnValue: 400,
        imageUrl: "https://misu.nephbox.net/card_image/1363917781355069761/c32ede043d9849de9a9d8b07821a1ba7.png",
  },
  {
        name: "Nuke Sub",
        rarity: "legendary", cardType: "vehicle",
        dropWeight: 1, worthValue: 2500, burnValue: 1250,
        imageUrl: "https://misu.nephbox.net/card_image/1363917781355069761/831c1e58287547f385523e99f4fc9bfa.png",
  },
  {
        name: "Patriot Event 1st Place",
        description: "1st Place — evgeni2372006 — 36 kills. The highest kill count of the event. Every Patriot launched brought them closer to victory.",
        rarity: "legendary", cardType: "event",
        dropWeight: 0, worthValue: 7500, burnValue: 3750,
        imageUrl: "/card-patriot-1st.png",
        droppable: false,
        isEventExclusive: true,
        inPacks: false,
  },
  {
        name: "SX59",
        rarity: "legendary", cardType: "vehicle",
        dropWeight: 1, worthValue: 800, burnValue: 400,
        imageUrl: "https://misu.nephbox.net/card_image/1363917781355069761/sx59_00018111.png",
  },
  {
        name: "Super AN Jeep",
        rarity: "legendary", cardType: "vehicle",
        dropWeight: 1, worthValue: 800, burnValue: 400,
        imageUrl: "https://misu.nephbox.net/card_image/1363917781355069761/super_an_jeep_00018128.png",
  },
  {
        name: "Super Keiler",
        rarity: "legendary", cardType: "vehicle",
        dropWeight: 1, worthValue: 800, burnValue: 400,
        imageUrl: "https://misu.nephbox.net/card_image/1363917781355069761/e21beb1e2b1749a6b0c1a935778358a9.png",
  },
  {
        name: "The Apocalypse",
        rarity: "legendary", cardType: "vehicle",
        dropWeight: 1, worthValue: 5000, burnValue: 2500,
        imageUrl: "https://misu.nephbox.net/card_image/1363917781355069761/b9c1a86ef92a40f285a0fb1421a30e22.png",
  },
];
