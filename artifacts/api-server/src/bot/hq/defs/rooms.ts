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

// The four rooms of the HQ. Every one is available from the start — a player
// picks any of them (and a Small/Medium/Large layout) and decorates it. Older
// rooms (Research Lab, War Room, Armory, Workshop, Storage, Arcane Vault) were
// retired when the room system moved to furnished layouts; their bonuses are
// folded into these four so the base's totals stay comparable.
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
    sizeLabel: "Small · Medium · Large",
    bonuses: [
      { label: "Troop Capacity", value: "+25%", amount: 25, kind: "command" },
      { label: "Rally Points", value: "+1", amount: 1, kind: "command" },
      { label: "Command Power", value: "+15", amount: 15, kind: "command" },
    ],
    unlock: { kind: "always" },
  },
  {
    id: "barracks",
    name: "Barracks",
    emoji: "🏕️",
    kind: "military",
    category: "military",
    blurb: "House and arm your defenders. Adds a defender post and hardens your garrison.",
    pedestals: 0,
    decoSlots: 12,
    sizeLabel: "Small · Medium · Large",
    bonuses: [
      { label: "Defender Posts", value: "+1", amount: 1, kind: "defenders" },
      { label: "Garrison Power", value: "+12%", amount: 12, kind: "fortify" },
      { label: "Morale", value: "+10%", amount: 10, kind: "command" },
    ],
    unlock: { kind: "always" },
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
    sizeLabel: "Small · Medium · Large",
    bonuses: [
      { label: "Income Bonus", value: "+15%", amount: 15, kind: "income" },
      { label: "Storage", value: "+1,500", amount: 1500, kind: "storage" },
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
    sizeLabel: "Small · Medium · Large",
    bonuses: [
      { label: "Showcase Slots", value: "5", amount: 5, kind: "display" },
      { label: "Prestige", value: "+10%", amount: 10, kind: "display" },
    ],
    unlock: { kind: "always" },
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
