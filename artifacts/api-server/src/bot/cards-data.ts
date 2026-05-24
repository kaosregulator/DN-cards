// Default starter cards — admin can add more via commands
// Rarity drop weights (higher = more common):
//   Common:    60
//   Uncommon:  25
//   Rare:      10
//   Epic:       4
//   Legendary:  1

export type Rarity = "common" | "uncommon" | "rare" | "epic" | "legendary";

export const RARITY_WEIGHTS: Record<Rarity, number> = {
  common: 60,
  uncommon: 25,
  rare: 10,
  epic: 4,
  legendary: 1,
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

// Default starter cards seeded on first boot
export const DEFAULT_CARDS = [
  // Common
  { name: "Stone Golem", description: "A sturdy creature made of solid rock.", rarity: "common" as Rarity, dropWeight: 60 },
  { name: "Mud Sprite", description: "A tiny elemental born from swamp mud.", rarity: "common" as Rarity, dropWeight: 60 },
  { name: "Copper Coin", description: "Just a coin, but it's yours.", rarity: "common" as Rarity, dropWeight: 60 },
  { name: "Thorn Vine", description: "A vine that bites back.", rarity: "common" as Rarity, dropWeight: 60 },
  { name: "Barn Owl", description: "Silent hunter of the night.", rarity: "common" as Rarity, dropWeight: 60 },
  // Uncommon
  { name: "Silver Fox", description: "Cunning and quick, silver-furred.", rarity: "uncommon" as Rarity, dropWeight: 25 },
  { name: "Iron Shield", description: "Dented but dependable.", rarity: "uncommon" as Rarity, dropWeight: 25 },
  { name: "Storm Crow", description: "Brings dark clouds wherever it flies.", rarity: "uncommon" as Rarity, dropWeight: 25 },
  { name: "Jade Serpent", description: "A snake carved from living jade.", rarity: "uncommon" as Rarity, dropWeight: 25 },
  // Rare
  { name: "Azure Drake", description: "A small drake with brilliant blue scales.", rarity: "rare" as Rarity, dropWeight: 10 },
  { name: "Phantom Blade", description: "A sword that cuts through shadows.", rarity: "rare" as Rarity, dropWeight: 10 },
  { name: "Crimson Wyvern", description: "Red-winged terror of the skies.", rarity: "rare" as Rarity, dropWeight: 10 },
  // Epic
  { name: "Shadow Phoenix", description: "Reborn from darkness, not flame.", rarity: "epic" as Rarity, dropWeight: 4 },
  { name: "Void Stalker", description: "Walks between dimensions unseen.", rarity: "epic" as Rarity, dropWeight: 4 },
  // Legendary
  { name: "Eternal Dragon", description: "Ancient beyond measure, power beyond reckoning.", rarity: "legendary" as Rarity, dropWeight: 1 },
  { name: "Celestial Arbiter", description: "Judge of worlds. Only one exists.", rarity: "legendary" as Rarity, dropWeight: 1 },
];
