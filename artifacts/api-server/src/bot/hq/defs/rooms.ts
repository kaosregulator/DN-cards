// ─────────────────────────────────────────────────────────────────────────────
// HQ — room registry (data-only).
//
// A room is a generic space with N featured-card PEDESTALS and M DECORATION
// slots. The engine never hardcodes "Trophy Hall" behaviour; it reads these
// counts and the unlock rule. Rooms unlock as the player progresses. Add a room
// = append to HQ_ROOMS.
// ─────────────────────────────────────────────────────────────────────────────

import type { UnlockRule } from "./unlock-rules.js";

export type HqRoomKind = "entrance" | "trophy" | "display";

export interface HqRoom {
  id: string;
  name: string;
  emoji: string;
  kind: HqRoomKind;
  blurb: string;
  pedestals: number;  // featured-card display slots
  decoSlots: number;  // decoration slots
  unlock: UnlockRule;
}

export const HQ_ROOMS: HqRoom[] = [
  {
    id: "entrance",
    name: "Entrance",
    emoji: "🚪",
    kind: "entrance",
    blurb: "The welcome hall — the first thing visitors see.",
    pedestals: 0,
    decoSlots: 4,
    unlock: { kind: "always" },
  },
  {
    id: "trophy-hall",
    name: "Trophy Hall",
    emoji: "🏆",
    kind: "trophy",
    blurb: "Your museum — pin your proudest cards on lit pedestals.",
    pedestals: 3,
    decoSlots: 6,
    unlock: { kind: "collectionUnique", n: 10 },
  },
];

export const DEFAULT_ROOM_ID = "entrance";

const ROOM_BY_ID = new Map<string, HqRoom>(HQ_ROOMS.map(r => [r.id, r]));

// Resolve a room id to its definition, degrading to the entrance (never throws).
export function resolveRoom(id: string | null | undefined): HqRoom {
  return (id && ROOM_BY_ID.get(id)) || ROOM_BY_ID.get(DEFAULT_ROOM_ID)!;
}

export function getRoomById(id: string): HqRoom | undefined {
  return ROOM_BY_ID.get(id);
}
