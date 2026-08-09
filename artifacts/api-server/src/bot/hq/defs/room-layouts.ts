// ─────────────────────────────────────────────────────────────────────────────
// HQ — room LAYOUTS (the "pick your room, pick its size" registry).
//
// Every interior room now ships THREE ready-made, furnished mini-worlds — Small,
// Medium and Large — instead of one bare box. A player chooses a room and a
// size; the matching `SuiteLayout` is what the room-suite renderer draws and the
// editor decorates on top of.
//
// These reuse the suite engine wholesale (`SuiteLayout` + `suiteWalls` derive the
// masonry; `validateSuite` guards the geometry; `renderRoomSuite` paints it), so
// there is no second coordinate system to keep in sync. The only new idea here is
// the (roomId × size) → layout lookup and a small size registry for the UI.
//
// Stripped to FOUR core rooms on purpose — Command Center, Barracks, Treasury and
// Trophy Hall — keeping the existing HQ_ROOMS ids so saved placements, unlocks
// and floorplans keep resolving. The outdoor base is a separate canvas and is
// untouched.
// ─────────────────────────────────────────────────────────────────────────────

import type { SuiteLayout, SuiteRoom, SuiteItem, SuiteOpening } from "./room-suites.js";
import { validateSuite } from "./room-suites.js";

export type RoomSizeId = "small" | "medium" | "large";

export interface RoomSizeOption {
  id: RoomSizeId;
  label: string;
  emoji: string;
  blurb: string;
}

export const ROOM_SIZES: RoomSizeOption[] = [
  { id: "small", label: "Small", emoji: "▫️", blurb: "A single tidy chamber — quick to fill." },
  { id: "medium", label: "Medium", emoji: "◽", blurb: "A main room with an adjoining annex." },
  { id: "large", label: "Large", emoji: "⬜", blurb: "A whole suite of connected rooms." },
];

export const DEFAULT_ROOM_SIZE: RoomSizeId = "medium";

/** The four rooms that have hand-built layouts (ids match HQ_ROOMS). */
export const LAYOUT_ROOM_IDS = ["entrance", "barracks", "treasury", "trophy-hall"] as const;
export type LayoutRoomId = (typeof LAYOUT_ROOM_IDS)[number];

export const DEFAULT_LAYOUT_ROOM_ID: LayoutRoomId = "entrance";

// A little sugar so the layouts below read like a floor plan rather than a wall
// of object literals.
const room = (id: string, roomTypeId: string, label: string, x: number, y: number, w: number, h: number, floor: SuiteRoom["floor"] = "stone"): SuiteRoom =>
  ({ id, roomTypeId, label, rect: { x, y, w, h }, floor });
const flr = (gx: number, gy: number, sprite: string, label?: string, scale?: number): SuiteItem =>
  ({ gx, gy, sprite, mount: "floor", label, scale });
const rug = (gx: number, gy: number, sprite: string, label?: string, scale = 1.35): SuiteItem =>
  ({ gx, gy, sprite, mount: "rug", label, scale });
const wall = (gx: number, gy: number, sprite: string, label?: string): SuiteItem =>
  ({ gx, gy, sprite, mount: "wall", face: "n", label });
const win = (x: number, y: number): SuiteOpening => ({ axis: "n", x, y, kind: "window" });
const winBars = (x: number, y: number): SuiteOpening => ({ axis: "n", x, y, kind: "window-bars" });
const gate = (y: number): SuiteOpening => ({ axis: "w", x: 0, y, kind: "gate-open" });
const doorW = (x: number, y: number): SuiteOpening => ({ axis: "w", x, y, kind: "door-open" });
const doorN = (x: number, y: number): SuiteOpening => ({ axis: "n", x, y, kind: "door-open" });
const archN = (x: number, y: number): SuiteOpening => ({ axis: "n", x, y, kind: "archway" });
const archW = (x: number, y: number): SuiteOpening => ({ axis: "w", x, y, kind: "archway" });

// ── Command Center ───────────────────────────────────────────────────────────

function commandSmall(): SuiteLayout {
  return {
    id: "custom", name: "Command Center · Small", emoji: "🎛️",
    blurb: "A single command chamber — a war table on the crest rug, banners overhead.",
    cols: 5, rows: 4,
    rooms: [room("command", "entrance", "Command", 0, 0, 5, 4, "stone-detail")],
    openings: [win(1, 0), win(3, 0), gate(3)],
    items: [
      rug(2, 2, "furniture/command-rug.png", "Command Rug", 1.5),
      flr(2, 2, "furniture/table-round-items.png", "War Table"),
      flr(3, 2, "furniture/chair.png", "Officer's Chair"),
      flr(0, 3, "furniture/stone-column.png", "Column"),
      flr(4, 0, "furniture/stone-column-wood.png", "Column"),
      wall(1, 0, "medals/laurel-wreath.png", "Laurel Crest"),
      wall(3, 0, "medals/veteran-medals.png", "Veteran Medals"),
    ],
  };
}

function commandMedium(): SuiteLayout {
  return {
    id: "custom", name: "Command Center · Medium", emoji: "🎛️",
    blurb: "A command hall with an ops annex and a supply nook off the side.",
    cols: 8, rows: 5,
    rooms: [
      room("command", "entrance", "Command Hall", 0, 0, 5, 5, "stone-detail"),
      room("ops", "entrance", "Ops", 5, 0, 3, 3, "stone"),
      room("supply", "storage", "Supply", 5, 3, 3, 2, "wood"),
    ],
    openings: [win(1, 0), win(3, 0), gate(4), doorW(5, 1), archN(6, 3), doorW(5, 4)],
    items: [
      rug(2, 2, "furniture/command-rug.png", "Command Rug", 1.5),
      flr(2, 2, "furniture/table-round-items.png", "War Table"),
      flr(1, 1, "furniture/table-short-chairs.png", "Briefing Table"),
      flr(3, 3, "furniture/chair.png", "Officer's Chair"),
      flr(0, 4, "furniture/stone-column.png", "Column"),
      flr(4, 0, "furniture/stone-column-wood.png", "Column"),
      wall(1, 0, "medals/laurel-wreath.png", "Laurel Crest"),
      wall(3, 0, "medals/veteran-medals.png", "Veteran Medals"),
      flr(6, 1, "furniture/study-table.png", "Ops Desk"),
      flr(5, 2, "furniture/chair.png", "Analyst Chair"),
      wall(6, 0, "medals/collectors-crest.png", "Company Crest"),
      flr(6, 4, "furniture/supply-crates.png", "Supplies"),
      flr(5, 3, "furniture/barrels.png", "Stores"),
    ],
  };
}

function commandLarge(): SuiteLayout {
  return {
    id: "custom", name: "Command Center · Large", emoji: "🎛️",
    blurb: "A full command floor: the war hall, an ops room, a briefing room and a corridor.",
    cols: 11, rows: 7,
    rooms: [
      room("hall", "entrance", "War Hall", 0, 0, 6, 5, "stone-detail"),
      room("corridor", "entrance", "Corridor", 0, 5, 11, 2, "stone"),
      room("ops", "atrium", "Ops", 6, 0, 5, 3, "stone"),
      room("briefing", "hall-of-fame", "Briefing", 6, 3, 5, 2, "wood"),
    ],
    openings: [
      win(2, 0), win(4, 0), winBars(8, 0), gate(6),
      archN(2, 5), doorN(8, 5), gate(6),
      archW(6, 1), archN(8, 3),
    ],
    items: [
      rug(2, 2, "furniture/command-rug.png", "Command Rug", 1.7),
      flr(2, 2, "furniture/table-round-items.png", "War Table"),
      flr(1, 1, "furniture/table-short-chairs.png", "Briefing Table"),
      flr(4, 3, "furniture/chair.png", "General's Chair"),
      flr(0, 4, "furniture/stone-column.png", "Column"),
      flr(5, 0, "furniture/stone-column-wood.png", "Column"),
      wall(2, 0, "medals/laurel-wreath.png", "Laurel Crest"),
      wall(4, 0, "medals/veteran-medals.png", "Veteran Medals"),
      flr(8, 1, "furniture/study-table.png", "Ops Desk"),
      flr(7, 2, "furniture/chair.png", "Analyst Chair"),
      wall(8, 0, "medals/collectors-crest.png", "Company Crest"),
      flr(8, 4, "furniture/feast-table.png", "Briefing Table"),
      rug(2, 5, "furniture/royal-runner.png", "Runner", 1.35),
      rug(6, 5, "furniture/royal-runner.png", "Runner", 1.35),
      flr(9, 6, "furniture/supply-crate.png", "Crate"),
    ],
  };
}

// ── Barracks ───────────────────────────────────────────────────────────────--

function barracksSmall(): SuiteLayout {
  return {
    id: "custom", name: "Barracks · Small", emoji: "🏕️",
    blurb: "A snug bunk room — a mess table, a barrel of rations, the company crest.",
    cols: 5, rows: 4,
    rooms: [room("barracks", "barracks", "Barracks", 0, 0, 5, 4, "wood")],
    openings: [win(2, 0), gate(2)],
    items: [
      rug(2, 2, "furniture/woven-rug.png", "Mess Rug", 1.4),
      flr(2, 2, "furniture/table-round-chairs.png", "Mess Table"),
      flr(4, 1, "furniture/barrel.png", "Rations"),
      flr(0, 3, "furniture/supply-crate.png", "Footlocker"),
      wall(2, 0, "medals/collectors-crest.png", "Company Crest"),
    ],
  };
}

function barracksMedium(): SuiteLayout {
  return {
    id: "custom", name: "Barracks · Medium", emoji: "🏕️",
    blurb: "A mess hall with a stores annex — where the garrison eats and re-arms.",
    cols: 8, rows: 5,
    rooms: [
      room("mess", "barracks", "Mess Hall", 0, 0, 5, 5, "wood"),
      room("stores", "storage", "Stores", 5, 0, 3, 5, "stone"),
    ],
    openings: [win(1, 0), win(3, 0), gate(4), doorW(5, 2)],
    items: [
      rug(2, 2, "furniture/woven-rug.png", "Mess Rug", 1.5),
      flr(2, 2, "furniture/table-round-chairs.png", "Mess Table"),
      flr(1, 1, "furniture/table-short-chairs.png", "Long Table"),
      flr(4, 1, "furniture/barrel.png", "Rations"),
      flr(0, 4, "furniture/log-pile.png", "Firewood"),
      wall(2, 0, "medals/collectors-crest.png", "Company Crest"),
      flr(6, 1, "furniture/supply-crates.png", "Supplies"),
      flr(6, 3, "furniture/barrels-stacked-tall.png", "Stores"),
      flr(5, 4, "furniture/storage-barrel.png", "Barrel"),
    ],
  };
}

function barracksLarge(): SuiteLayout {
  return {
    id: "custom", name: "Barracks · Large", emoji: "🏕️",
    blurb: "A garrison wing: a mess hall, two bunk rooms and a stores corridor.",
    cols: 11, rows: 7,
    rooms: [
      room("mess", "barracks", "Mess Hall", 0, 0, 6, 5, "wood"),
      room("corridor", "entrance", "Corridor", 0, 5, 11, 2, "stone"),
      room("bunkA", "barracks", "Bunks A", 6, 0, 5, 3, "wood"),
      room("stores", "storage", "Stores", 6, 3, 5, 2, "stone"),
    ],
    openings: [
      win(1, 0), win(3, 0), winBars(8, 0), gate(6),
      archN(2, 5), doorN(8, 5),
      doorW(6, 1), archN(8, 3),
    ],
    items: [
      rug(2, 2, "furniture/woven-rug.png", "Mess Rug", 1.6),
      flr(2, 2, "furniture/table-round-chairs.png", "Mess Table"),
      flr(1, 1, "furniture/feast-table.png", "Feast Table"),
      flr(5, 0, "furniture/stone-column.png", "Column"),
      flr(0, 4, "furniture/log-pile.png", "Firewood"),
      wall(1, 0, "medals/collectors-crest.png", "Company Crest"),
      wall(3, 0, "medals/veteran-medals.png", "Battle Honours"),
      flr(8, 1, "furniture/table-short-chairs.png", "Bunk Table"),
      flr(6, 2, "furniture/barrel.png", "Rations"),
      flr(8, 4, "furniture/supply-crates.png", "Supplies"),
      flr(10, 3, "furniture/barrels-stacked-tall.png", "Stores"),
      rug(3, 5, "furniture/woven-rug.png", "Runner", 1.35),
      flr(9, 6, "furniture/barrels.png", "Barrels"),
    ],
  };
}

// ── Treasury ──────────────────────────────────────────────────────────────---

function treasurySmall(): SuiteLayout {
  return {
    id: "custom", name: "Treasury · Small", emoji: "💎",
    blurb: "A strongroom — chests on a gold runner beneath the sovereign's crown.",
    cols: 5, rows: 4,
    rooms: [room("vault", "treasury", "Vault", 0, 0, 5, 4, "stone-detail")],
    openings: [winBars(2, 0), gate(2)],
    items: [
      rug(2, 2, "furniture/vault-rug.png", "Vault Runner", 1.4),
      flr(2, 2, "furniture/treasure-chest.png", "Vault Chest"),
      flr(3, 2, "furniture/treasure-chest-open.png", "Open Chest"),
      flr(0, 3, "furniture/stacked-barrels.png", "Coin Barrels"),
      flr(4, 0, "furniture/stone-column.png", "Column"),
      wall(2, 0, "medals/sovereign-crown.png", "Sovereign Crown"),
    ],
  };
}

function treasuryMedium(): SuiteLayout {
  return {
    id: "custom", name: "Treasury · Medium", emoji: "💎",
    blurb: "A vault hall with a counting-room annex for the ledgers.",
    cols: 8, rows: 5,
    rooms: [
      room("vault", "treasury", "Vault", 0, 0, 5, 5, "stone-detail"),
      room("counting", "treasury", "Counting Room", 5, 0, 3, 5, "wood"),
    ],
    openings: [winBars(1, 0), winBars(3, 0), gate(4), doorW(5, 2)],
    items: [
      rug(2, 2, "furniture/vault-rug.png", "Vault Runner", 1.5),
      flr(2, 2, "furniture/treasure-chest.png", "Vault Chest"),
      flr(1, 2, "furniture/treasure-chest-open.png", "Open Chest"),
      flr(3, 1, "furniture/stacked-barrels.png", "Coin Barrels"),
      flr(0, 4, "furniture/stone-column.png", "Column"),
      flr(4, 0, "furniture/stone-column-wood.png", "Column"),
      wall(1, 0, "medals/sovereign-crown.png", "Sovereign Crown"),
      wall(3, 0, "medals/diplomat-seal.png", "Treasury Seal"),
      flr(6, 1, "furniture/study-table.png", "Ledger Desk"),
      flr(5, 2, "furniture/chair.png", "Clerk's Chair"),
      flr(6, 4, "furniture/storage-barrel.png", "Strongbox"),
    ],
  };
}

function treasuryLarge(): SuiteLayout {
  return {
    id: "custom", name: "Treasury · Large", emoji: "💎",
    blurb: "The great vault: a treasure hall, a counting room, a strongroom and a guarded corridor.",
    cols: 11, rows: 7,
    rooms: [
      room("hall", "treasury", "Treasure Hall", 0, 0, 6, 5, "stone-detail"),
      room("corridor", "entrance", "Guard Corridor", 0, 5, 11, 2, "stone"),
      room("counting", "treasury", "Counting", 6, 0, 5, 3, "wood"),
      room("strong", "treasury", "Strongroom", 6, 3, 5, 2, "stone-detail"),
    ],
    openings: [
      winBars(2, 0), winBars(4, 0), winBars(8, 0), gate(6),
      archN(2, 5), doorN(8, 5),
      doorW(6, 1), doorN(8, 3),
    ],
    items: [
      rug(2, 2, "furniture/vault-rug.png", "Vault Runner", 1.7),
      flr(2, 2, "furniture/treasure-chest.png", "Vault Chest"),
      flr(1, 2, "furniture/treasure-chest-open.png", "Open Chest"),
      flr(3, 1, "furniture/stacked-barrels.png", "Coin Barrels"),
      flr(0, 4, "furniture/stone-column.png", "Column"),
      flr(5, 0, "furniture/stone-column-wood.png", "Column"),
      wall(2, 0, "medals/sovereign-crown.png", "Sovereign Crown"),
      wall(4, 0, "medals/diplomat-seal.png", "Treasury Seal"),
      flr(8, 1, "furniture/study-table.png", "Ledger Desk"),
      flr(6, 2, "furniture/chair.png", "Clerk's Chair"),
      flr(8, 4, "furniture/treasure-chest.png", "Sealed Chest"),
      flr(10, 3, "furniture/stacked-barrels.png", "Bullion"),
      rug(3, 5, "furniture/royal-runner.png", "Runner", 1.35),
      flr(9, 6, "furniture/storage-barrel.png", "Strongbox"),
    ],
  };
}

// ── Trophy Hall ──────────────────────────────────────────────────────────────

function trophySmall(): SuiteLayout {
  return {
    id: "custom", name: "Trophy Hall · Small", emoji: "🏆",
    blurb: "A showcase chamber — laurels and honours over a proud red runner.",
    cols: 5, rows: 4,
    rooms: [room("trophy", "trophy-hall", "Trophy Hall", 0, 0, 5, 4, "stone-detail")],
    openings: [win(2, 0), archW(0, 2)],
    items: [
      rug(2, 2, "furniture/royal-runner.png", "Hall Runner", 1.45),
      flr(2, 2, "furniture/table-round.png", "Display Table"),
      flr(0, 3, "furniture/stone-column.png", "Column"),
      flr(4, 3, "furniture/stone-column.png", "Column"),
      wall(1, 0, "medals/laurel-wreath.png", "Laurels"),
      wall(3, 0, "medals/sovereign-crown.png", "Crown"),
    ],
  };
}

function trophyMedium(): SuiteLayout {
  return {
    id: "custom", name: "Trophy Hall · Medium", emoji: "🏆",
    blurb: "A hall of honours with a relic vault annex for the rarest pieces.",
    cols: 8, rows: 5,
    rooms: [
      room("hall", "trophy-hall", "Hall of Honours", 0, 0, 5, 5, "stone-detail"),
      room("relics", "trophy-hall", "Relic Vault", 5, 0, 3, 5, "wood"),
    ],
    openings: [win(1, 0), win(3, 0), archW(0, 2), archW(5, 2)],
    items: [
      rug(2, 2, "furniture/royal-runner.png", "Hall Runner", 1.55),
      flr(2, 2, "furniture/feast-table.png", "Banquet of Champions"),
      flr(1, 1, "furniture/table-round.png", "Display Table"),
      flr(0, 4, "furniture/stone-column.png", "Column"),
      flr(4, 0, "furniture/stone-column-wood.png", "Column"),
      wall(1, 0, "medals/laurel-wreath.png", "Laurels"),
      wall(3, 0, "medals/veteran-medals.png", "Honours"),
      flr(6, 1, "furniture/table-round-items.png", "Relic Table"),
      flr(6, 3, "furniture/treasure-chest-open.png", "Relic Chest"),
      wall(6, 0, "medals/sovereign-crown.png", "Crown Jewel"),
    ],
  };
}

function trophyLarge(): SuiteLayout {
  return {
    id: "custom", name: "Trophy Hall · Large", emoji: "🏆",
    blurb: "The grand museum: a hall of honours, a relic vault, a portrait gallery and a promenade.",
    cols: 11, rows: 7,
    rooms: [
      room("hall", "trophy-hall", "Hall of Honours", 0, 0, 6, 5, "stone-detail"),
      room("promenade", "entrance", "Promenade", 0, 5, 11, 2, "stone"),
      room("relics", "trophy-hall", "Relic Vault", 6, 0, 5, 3, "wood"),
      room("gallery", "trophy-hall", "Gallery", 6, 3, 5, 2, "stone-detail"),
    ],
    openings: [
      win(2, 0), win(4, 0), win(8, 0), gate(6),
      archN(2, 5), archN(8, 5),
      archW(6, 1), archN(8, 3),
    ],
    items: [
      rug(2, 2, "furniture/royal-runner.png", "Hall Runner", 1.7),
      flr(2, 2, "furniture/feast-table.png", "Banquet of Champions"),
      flr(1, 1, "furniture/table-round.png", "Display Table"),
      flr(0, 4, "furniture/stone-column.png", "Column"),
      flr(5, 0, "furniture/stone-column-wood.png", "Column"),
      wall(2, 0, "medals/laurel-wreath.png", "Laurels"),
      wall(4, 0, "medals/veteran-medals.png", "Honours"),
      flr(8, 1, "furniture/table-round-items.png", "Relic Table"),
      flr(6, 2, "furniture/treasure-chest-open.png", "Relic Chest"),
      wall(8, 0, "medals/sovereign-crown.png", "Crown Jewel"),
      flr(8, 4, "furniture/table-round.png", "Gallery Table"),
      wall(7, 3, "medals/collectors-crest.png", "Collector's Crest"),
      rug(3, 5, "furniture/royal-runner.png", "Runner", 1.35),
      rug(7, 5, "furniture/royal-runner.png", "Runner", 1.35),
      flr(10, 6, "furniture/stone-column.png", "Column"),
    ],
  };
}

// ── Registry ─────────────────────────────────────────────────────────────────

type LayoutFactory = () => SuiteLayout;

const REGISTRY: Record<LayoutRoomId, Record<RoomSizeId, LayoutFactory>> = {
  "entrance": { small: commandSmall, medium: commandMedium, large: commandLarge },
  "barracks": { small: barracksSmall, medium: barracksMedium, large: barracksLarge },
  "treasury": { small: treasurySmall, medium: treasuryMedium, large: treasuryLarge },
  "trophy-hall": { small: trophySmall, medium: trophyMedium, large: trophyLarge },
};

export function isLayoutRoom(roomId: string | null | undefined): roomId is LayoutRoomId {
  return !!roomId && roomId in REGISTRY;
}

export function resolveLayoutRoomId(roomId: string | null | undefined): LayoutRoomId {
  return isLayoutRoom(roomId) ? roomId : DEFAULT_LAYOUT_ROOM_ID;
}

export function resolveRoomSize(size: string | null | undefined): RoomSizeId {
  return size === "small" || size === "medium" || size === "large" ? size : DEFAULT_ROOM_SIZE;
}

/** The furnished mini-world for a room at a chosen size (self-healing). */
export function roomLayout(roomId: string | null | undefined, size: string | null | undefined): SuiteLayout {
  return REGISTRY[resolveLayoutRoomId(roomId)][resolveRoomSize(size)]();
}

/** All three sizes for one room — for a size picker preview. */
export function roomLayoutsFor(roomId: string | null | undefined): Record<RoomSizeId, SuiteLayout> {
  const r = REGISTRY[resolveLayoutRoomId(roomId)];
  return { small: r.small(), medium: r.medium(), large: r.large() };
}

/** Validate every built-in layout — used by tests / the preview script. */
export function validateAllLayouts(): { key: string; errors: string[] }[] {
  const out: { key: string; errors: string[] }[] = [];
  for (const roomId of LAYOUT_ROOM_IDS) {
    for (const size of ["small", "medium", "large"] as RoomSizeId[]) {
      const errs = validateSuite(REGISTRY[roomId][size]());
      if (errs.length) out.push({ key: `${roomId}/${size}`, errors: errs });
    }
  }
  return out;
}
