// Cosmetic frame registry for card leveling.
//
// Each rarity has a DEFAULT frame (always available) plus two EXTRA frames that
// unlock as the card levels up. A frame is a purely-visual decoration applied
// to a card's showcase embed: a title wrap, an accent color, and a name. No
// gameplay effect whatsoever.

import type { Rarity } from "../cards-data.js";

export interface Frame {
  id: string;
  name: string;
  emoji: string;
  rarity: Rarity;
  unlockLevel: number;         // card level required to equip
  color: number;               // embed accent
  // Decorative wrap applied around the card name in the showcase title.
  wrap: (name: string) => string;
}

// Level thresholds at which each rarity's frames unlock.
export const FRAME_UNLOCK_LEVELS = [1, 5, 10] as const;

const plain = (l: string, r: string) => (name: string) => `${l} ${name} ${r}`;

// Three frames per rarity: [default @L1, extra @L5, extra @L10].
const RARITY_FRAMES: Record<Rarity, [Frame, Frame, Frame]> = {
  common: [
    { id: "common_default", name: "Standard", emoji: "⚪", rarity: "common", unlockLevel: 1, color: 0x95a5a6, wrap: plain("⟨", "⟩") },
    { id: "common_iron", name: "Iron Edge", emoji: "🔩", rarity: "common", unlockLevel: 50, color: 0x808b96, wrap: plain("┃", "┃") },
    { id: "common_slate", name: "Slate", emoji: "◾", rarity: "common", unlockLevel: 100, color: 0x5d6d7e, wrap: plain("▪", "▪") },
  ],
  uncommon: [
    { id: "uncommon_default", name: "Verdant", emoji: "🟢", rarity: "uncommon", unlockLevel: 1, color: 0x2ecc71, wrap: plain("⟨", "⟩") },
    { id: "uncommon_leaf", name: "Leafbound", emoji: "🍃", rarity: "uncommon", unlockLevel: 50, color: 0x27ae60, wrap: plain("❨", "❩") },
    { id: "uncommon_jade", name: "Jade", emoji: "💚", rarity: "uncommon", unlockLevel: 100, color: 0x1abc9c, wrap: plain("༺", "༻") },
  ],
  rare: [
    { id: "rare_default", name: "Azure", emoji: "🔵", rarity: "rare", unlockLevel: 1, color: 0x3498db, wrap: plain("⟨", "⟩") },
    { id: "rare_tide", name: "Tidecaller", emoji: "🌊", rarity: "rare", unlockLevel: 50, color: 0x2980b9, wrap: plain("❨", "❩") },
    { id: "rare_frost", name: "Frostline", emoji: "❄️", rarity: "rare", unlockLevel: 100, color: 0x5dade2, wrap: plain("༺", "༻") },
  ],
  epic: [
    { id: "epic_default", name: "Amethyst", emoji: "🟣", rarity: "epic", unlockLevel: 1, color: 0x9b59b6, wrap: plain("⟨", "⟩") },
    { id: "epic_arcane", name: "Arcane", emoji: "🔮", rarity: "epic", unlockLevel: 50, color: 0x8e44ad, wrap: plain("❰", "❱") },
    { id: "epic_void", name: "Voidtouched", emoji: "🌌", rarity: "epic", unlockLevel: 100, color: 0x6c3483, wrap: plain("༺", "༻") },
  ],
  legendary: [
    { id: "legendary_default", name: "Golden", emoji: "🟡", rarity: "legendary", unlockLevel: 1, color: 0xf1c40f, wrap: plain("⟨", "⟩") },
    { id: "legendary_sunfire", name: "Sunfire", emoji: "☀️", rarity: "legendary", unlockLevel: 50, color: 0xf39c12, wrap: plain("❰", "❱") },
    { id: "legendary_royal", name: "Royal Crest", emoji: "👑", rarity: "legendary", unlockLevel: 100, color: 0xe67e22, wrap: plain("♜", "♜") },
  ],
  mythic: [
    { id: "mythic_default", name: "Mythic", emoji: "🔴", rarity: "mythic", unlockLevel: 1, color: 0xe74c3c, wrap: plain("⟨", "⟩") },
    { id: "mythic_ember", name: "Ember Rift", emoji: "🔥", rarity: "mythic", unlockLevel: 50, color: 0xc0392b, wrap: plain("❰", "❱") },
    { id: "mythic_celestial", name: "Celestial", emoji: "✨", rarity: "mythic", unlockLevel: 100, color: 0xff5e78, wrap: plain("༺✧", "✧༻") },
  ],
};

const ALL_FRAMES: Frame[] = Object.values(RARITY_FRAMES).flat();
const FRAME_BY_ID = new Map(ALL_FRAMES.map(f => [f.id, f]));

export function framesForRarity(rarity: Rarity): Frame[] {
  return RARITY_FRAMES[rarity] ?? RARITY_FRAMES.common;
}

export function getFrameById(id: string): Frame | undefined {
  return FRAME_BY_ID.get(id);
}

export function defaultFrameForRarity(rarity: Rarity): Frame {
  return framesForRarity(rarity)[0];
}

// The frame a user currently has active on a card: their equipped one if still
// valid (right rarity + unlocked), otherwise the rarity default.
export function resolveActiveFrame(rarity: Rarity, equippedId: string | null, level: number): Frame {
  if (equippedId) {
    const f = FRAME_BY_ID.get(equippedId);
    if (f && f.rarity === rarity && level >= f.unlockLevel) return f;
  }
  return defaultFrameForRarity(rarity);
}

export function isFrameUnlocked(frame: Frame, level: number): boolean {
  return level >= frame.unlockLevel;
}
