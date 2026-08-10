// ─────────────────────────────────────────────────────────────────────────────
// HQ — room registry (data-only).
//
// Rooms are buildable interior spaces that share the same editing engine as the
// outdoor base. Every room has a clear purpose, a unique bonus, a visual
// identity (category + emoji), and an understandable description.
//
// Themes (Command Post / Arcane Sanctum / Void Station) remain PRESENTATION
// skins — they are not rooms. Room ids are stable so existing placements /
// unlocks keep working when names or bonuses evolve.
// ─────────────────────────────────────────────────────────────────────────────

import type { UnlockRule } from "./unlock-rules.js";

export type HqRoomKind =
  | "command" | "trophy" | "military" | "economy" | "magical"
  | "defense" | "utility" | "decorative";

export type HqRoomCategory =
  | "military" | "economy" | "magical" | "defense" | "utility" | "decorative";

/** Gameplay / presentation bonuses a built room grants the HQ. */
export interface HqRoomBonus {
  /** Short label shown in Room Info (e.g. "Troop Capacity"). */
  label: string;
  /** Display value (e.g. "+25%", "+1", "+15"). */
  value: string;
  /** Optional numeric magnitude used by fortify / income helpers. */
  amount?: number;
  /** Which system consumes this bonus. */
  kind?: "fortify" | "income" | "storage" | "defenders" | "display" | "command" | "research";
}

export interface HqRoom {
  id: string;
  name: string;
  emoji: string;
  kind: HqRoomKind;
  category: HqRoomCategory;
  blurb: string;
  pedestals: number;  // featured-card display slots
  decoSlots: number;  // decoration slots
  /** Default interior footprint hint for the editor UI (not a hard lattice size). */
  sizeLabel: string;
  bonuses: HqRoomBonus[];
  unlock: UnlockRule;
}

export const HQ_ROOMS: HqRoom[] = [
  {
    id: "entrance",
    name: "Command Center",
    emoji: "🎛️",
    kind: "command",
    category: "military",
    blurb: "The core of your HQ. Improves troop capacity and unlocks advanced commands.",
    pedestals: 0,
    decoSlots: 14,
    sizeLabel: "24×24",
    bonuses: [
      { label: "Troop Capacity", value: "+25%", amount: 25, kind: "command" },
      { label: "Rally Points", value: "+1", amount: 1, kind: "command" },
      { label: "Command Power", value: "+15", amount: 15, kind: "command" },
    ],
    unlock: { kind: "always" },
  },
  {
    id: "trophy-hall",
    name: "Trophy Hall",
    emoji: "🏆",
    kind: "trophy",
    category: "decorative",
    blurb: "Pin your proudest cards on lit pedestals — the museum every visitor sees first.",
    pedestals: 5,
    decoSlots: 12,
    sizeLabel: "20×20",
    bonuses: [
      { label: "Showcase Slots", value: "5", amount: 5, kind: "display" },
      { label: "Prestige", value: "+10%", amount: 10, kind: "display" },
    ],
    unlock: { kind: "collectionUnique", n: 10 },
  },
  {
    id: "atrium",
    name: "Research Lab",
    emoji: "🔬",
    kind: "utility",
    category: "utility",
    blurb: "Study relics and blueprints. Unlocks faster material research for Build mode.",
    pedestals: 0,
    decoSlots: 14,
    sizeLabel: "18×18",
    bonuses: [
      { label: "Research Speed", value: "+20%", amount: 20, kind: "research" },
      { label: "Material Unlock", value: "+1 tier", amount: 1, kind: "research" },
    ],
    unlock: { kind: "collectionUnique", n: 25 },
  },
  {
    id: "hall-of-fame",
    name: "War Room",
    emoji: "🗺️",
    kind: "military",
    category: "military",
    blurb: "Plan sieges and raids. Hardens your garrison when enemies assault your base.",
    pedestals: 0,
    decoSlots: 12,
    sizeLabel: "20×20",
    bonuses: [
      { label: "Siege Defense", value: "+8%", amount: 8, kind: "fortify" },
      { label: "Scout Range", value: "+1", amount: 1, kind: "command" },
    ],
    unlock: { kind: "accountLevel", n: 15 },
  },
  {
    id: "armory",
    name: "Armory",
    emoji: "⚔️",
    kind: "military",
    category: "military",
    blurb: "Store weapons and armor for your stationed defenders. Raises garrison power.",
    pedestals: 0,
    decoSlots: 12,
    sizeLabel: "16×16",
    bonuses: [
      { label: "Garrison Power", value: "+12%", amount: 12, kind: "fortify" },
      { label: "Weapon Racks", value: "4", amount: 4, kind: "storage" },
    ],
    unlock: { kind: "battleWins", n: 10 },
  },
  {
    id: "barracks",
    name: "Barracks",
    emoji: "🏕️",
    kind: "military",
    category: "military",
    blurb: "House extra defenders. Unlocks an additional defender post on your base.",
    pedestals: 0,
    decoSlots: 10,
    sizeLabel: "18×18",
    bonuses: [
      { label: "Defender Posts", value: "+1", amount: 1, kind: "defenders" },
      { label: "Morale", value: "+10%", amount: 10, kind: "command" },
    ],
    unlock: { kind: "battleWins", n: 25 },
  },
  {
    id: "treasury",
    name: "Treasury",
    emoji: "💎",
    kind: "economy",
    category: "economy",
    blurb: "Secure vault for shard income. Boosts hold-tribute and storage capacity.",
    pedestals: 0,
    decoSlots: 10,
    sizeLabel: "14×14",
    bonuses: [
      { label: "Income Bonus", value: "+15%", amount: 15, kind: "income" },
      { label: "Storage", value: "+500", amount: 500, kind: "storage" },
    ],
    unlock: { kind: "netWorth", n: 5_000 },
  },
  {
    id: "workshop",
    name: "Workshop",
    emoji: "🔧",
    kind: "utility",
    category: "utility",
    blurb: "Craft traps, turrets, and build materials. Discount on Shop surfaces.",
    pedestals: 0,
    decoSlots: 12,
    sizeLabel: "16×16",
    bonuses: [
      { label: "Build Discount", value: "10%", amount: 10, kind: "research" },
      { label: "Trap Efficiency", value: "+15%", amount: 15, kind: "fortify" },
    ],
    unlock: { kind: "accountLevel", n: 12 },
  },
  {
    id: "storage",
    name: "Storage Room",
    emoji: "📦",
    kind: "economy",
    category: "economy",
    blurb: "Warehouses for supplies. Raises the shard storage cap shown on Base Upgrade.",
    pedestals: 0,
    decoSlots: 8,
    sizeLabel: "14×14",
    bonuses: [
      { label: "Storage", value: "+1,000", amount: 1000, kind: "storage" },
      { label: "Loot Retain", value: "+5%", amount: 5, kind: "income" },
    ],
    unlock: { kind: "accountLevel", n: 8 },
  },
  {
    id: "arcane-vault",
    name: "Arcane Vault",
    emoji: "🔮",
    kind: "magical",
    category: "magical",
    blurb: "Channel arcane wards around your grounds. Strengthens the base shield aura.",
    pedestals: 0,
    decoSlots: 12,
    sizeLabel: "16×16",
    bonuses: [
      { label: "Shield Duration", value: "+10%", amount: 10, kind: "fortify" },
      { label: "Ward Power", value: "+12", amount: 12, kind: "fortify" },
    ],
    unlock: { kind: "accountLevel", n: 18 },
  },
];

export const DEFAULT_ROOM_ID = "entrance";

const ROOM_BY_ID = new Map<string, HqRoom>(HQ_ROOMS.map(r => [r.id, r]));

/** Resolve a room id to its definition, degrading to the Command Center. */
export function resolveRoom(id: string | null | undefined): HqRoom {
  return (id && ROOM_BY_ID.get(id)) || ROOM_BY_ID.get(DEFAULT_ROOM_ID)!;
}

export function getRoomById(id: string): HqRoom | undefined {
  return ROOM_BY_ID.get(id);
}

export function roomsByCategory(cat: HqRoomCategory | "all"): HqRoom[] {
  if (cat === "all") return HQ_ROOMS;
  return HQ_ROOMS.filter(r => r.category === cat);
}

/** Sum numeric room bonuses of a given kind for unlocked rooms. */
export function sumRoomBonus(
  ownedRoomIds: Iterable<string>,
  kind: NonNullable<HqRoomBonus["kind"]>,
): number {
  let total = 0;
  for (const id of ownedRoomIds) {
    const room = ROOM_BY_ID.get(id);
    if (!room) continue;
    for (const b of room.bonuses) {
      if (b.kind === kind && typeof b.amount === "number") total += b.amount;
    }
  }
  return total;
}
