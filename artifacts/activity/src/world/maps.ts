// ─────────────────────────────────────────────────────────────────────────────
// World maps — classic Game-Boy-style rooms authored as character grids.
//
// Each map is a list of equal-length strings; one character = one 32px tile.
// Doors move the player between maps (with a screen transition), NPCs stand on
// tiles and can be talked to / challenged to a duel.
//
//   🏙️ Battle City ──▶ 🏪 Card Shop (interior) ──▶ 🛒 card browser
//        │  south                    │  arena
//        ▼                           ▼
//   🌳 Route 1 ──east──▶ 🏙️ New City ──▶ 👑 Champion
// ─────────────────────────────────────────────────────────────────────────────

import type { TileKind } from "./tiles";

// Character → tile mapping used by every map grid.
export const LEGEND: Record<string, TileKind> = {
  ".": "grass",
  ",": "grass2",
  "*": "flower",
  "=": "path",
  "s": "sand",
  "~": "water",
  "T": "tree",
  "#": "wall",
  "B": "brick",
  "R": "roof",
  "D": "door",
  "f": "floor",
  "c": "carpet",
  "r": "rug",
  "C": "counter",
  "S": "shelf",
  "F": "fence",
  "o": "stone",
  " ": "void",
};

export interface DoorDef {
  x: number; y: number;
  to: string;        // target map id
  spawn: string;     // spawn point id in the target map
  label?: string;    // floating hint above the door
}

export interface NpcDef {
  id: string;
  x: number; y: number;
  name: string;
  lines: string[];          // dialogue shown before any duel
  duelist?: boolean;        // challenges the player
  defeatedLines?: string[]; // dialogue after they've been beaten
  colors: { body: number; trim: number; skin: number; hair: number };
  /** "shop" opens the card browser instead of a duel. */
  role?: "shop";
  face?: "down" | "left" | "right" | "up";
}

export interface SignDef { x: number; y: number; text: string; }

export interface MapDef {
  id: string;
  name: string;
  /** Ambient tint for the scene (indoor rooms are warmer/darker). */
  ambient: number;
  indoor: boolean;
  grid: string[];
  spawns: Record<string, { x: number; y: number; face?: "down" | "left" | "right" | "up" }>;
  doors: DoorDef[];
  npcs: NpcDef[];
  signs?: SignDef[];
}

const C = {
  blue:   { body: 0x2f6bd0, trim: 0x8fc0ff, skin: 0xe8b98c, hair: 0x3a2a1e },
  red:    { body: 0xb83a3a, trim: 0xffb0b0, skin: 0xe8b98c, hair: 0x1e1a16 },
  green:  { body: 0x2f8f5a, trim: 0xa8f0c8, skin: 0xd9a97a, hair: 0x4a3520 },
  purple: { body: 0x7a45b0, trim: 0xd8b8ff, skin: 0xf0c9a0, hair: 0x241132 },
  gold:   { body: 0xc9a24f, trim: 0xffe9b0, skin: 0xe8b98c, hair: 0x6b4a2f },
  teal:   { body: 0x2f8f8f, trim: 0xa8f0f0, skin: 0xd9a97a, hair: 0x1e3a3a },
};

// ── 🏙️ Battle City ────────────────────────────────────────────────────────────
const CITY: MapDef = {
  id: "city",
  name: "Battle City",
  ambient: 0xffffff,
  indoor: false,
  grid: [
    "TTTTTTTTTTTTTTTTTTTTTTTTTT",
    "T........................T",
    "T..RRRRRR......RRRRRRRR..T",
    "T..RRRRRR......RRRRRRRR..T",
    "T..BBDBBB......BBBBDBBB..T",
    "T....=..........,..=.....T",
    "T....=..........,..=.....T",
    "T,,,,=,,,,,,,,,,,,,=,,,,,T",
    "T====================,,,,T",
    "T....=..........,..=.....T",
    "T..*.=....,,,...,..=..*..T",
    "T....=....,,,...,..=.....T",
    "T..RRRRRR.,,,...RRRRRRR..T",
    "T..RRRRRR.......RRRRRRR..T",
    "T..BBBDBB.......BBBDBBB..T",
    "T....=..............=....T",
    "T....================....T",
    "T....=..............=....T",
    "T,,,,=,,,,,,,,,,,,,,=,,,,T",
    "T....=......====....=....T",
    "TTTTTT======TTTT====TTTTTT",
  ],
  spawns: {
    start:      { x: 12, y: 9, face: "down" },
    fromShop:   { x: 5, y: 5, face: "down" },
    fromArena:  { x: 19, y: 5, face: "down" },
    fromDojo:   { x: 6, y: 15, face: "down" },
    fromRoute1: { x: 12, y: 19, face: "up" },
  },
  doors: [
    { x: 5,  y: 4,  to: "shop",   spawn: "enter", label: "🏪 Card Shop" },
    { x: 19, y: 4,  to: "arena",  spawn: "enter", label: "🏟 Arena" },
    { x: 6,  y: 14, to: "dojo",   spawn: "enter", label: "🥋 Dojo" },
    { x: 12, y: 20, to: "route1", spawn: "fromCity", label: "▼ Route 1" },
    { x: 13, y: 20, to: "route1", spawn: "fromCity" },
  ],
  npcs: [
    {
      id: "greeter", x: 10, y: 9, name: "Townsperson", colors: C.green, face: "right",
      lines: [
        "Welcome to Battle City!",
        "The Card Shop up north-west stocks every card in the server.",
        "Duelists hang around the Arena and the Dojo — beat them all!",
      ],
    },
    {
      id: "city_rival", x: 16, y: 12, name: "Street Duelist", colors: C.red, duelist: true, face: "left",
      lines: ["You've got the look of a duelist.", "Show me what your deck can do!"],
      defeatedLines: ["You're strong. Try the Dojo master next."],
    },
    {
      id: "kid", x: 20, y: 17, name: "Rookie Kid", colors: C.teal, face: "up",
      lines: ["Monsters with 5+ stars need Tributes to summon!", "Set traps face-down — they fire on your opponent's attack."],
    },
  ],
  signs: [
    { x: 12, y: 6, text: "🏙 BATTLE CITY — duels welcome" },
  ],
};

// ── 🏪 Card Shop interior ─────────────────────────────────────────────────────
const SHOP: MapDef = {
  id: "shop",
  name: "Card Shop",
  ambient: 0xffe8c0,
  indoor: true,
  // The shopkeeper stands in the aisle IN FRONT of the counter so you can walk
  // up and talk to them (you can't talk across a solid counter tile).
  grid: [
    "##############",
    "#SSSSS##SSSSS#",
    "#ffffffffffff#",
    "#ffCCCCCCCCff#",
    "#ffffffffffff#",
    "#ffffffffffff#",
    "#frrffffffrrf#",
    "#frrffffffrrf#",
    "#ffffffffffff#",
    "#ffffffffffff#",
    "######DD######",
  ],
  spawns: { enter: { x: 6, y: 9, face: "up" } },
  doors: [
    { x: 6, y: 10, to: "city", spawn: "fromShop", label: "▼ Exit" },
    { x: 7, y: 10, to: "city", spawn: "fromShop" },
  ],
  npcs: [
    {
      id: "shopkeeper", x: 6, y: 4, name: "Shopkeeper", colors: C.gold, role: "shop", face: "down",
      lines: ["Welcome to the Card Shop!", "Every card the server stocks is on these shelves — take a look."],
    },
    {
      id: "shop_duelist", x: 2, y: 7, name: "Rex the Duelist", colors: C.purple, duelist: true, face: "right",
      lines: ["Browsing, huh?", "Cards are for DUELING. Let me prove it!"],
      defeatedLines: ["Fine, fine — you know how to use those cards."],
    },
  ],
  signs: [{ x: 10, y: 5, text: "🛒 Talk to the shopkeeper" }],
};

// ── 🏟 Arena interior ─────────────────────────────────────────────────────────
const ARENA: MapDef = {
  id: "arena",
  name: "Battle Arena",
  ambient: 0xd8d8ff,
  indoor: true,
  grid: [
    "################",
    "#oooooooooooooo#",
    "#oooooooooooooo#",
    "#oooccccccccooo#",
    "#oooccccccccooo#",
    "#oooccccccccooo#",
    "#oooccccccccooo#",
    "#oooooooooooooo#",
    "#oooooooooooooo#",
    "#######DD#######",
  ],
  spawns: { enter: { x: 7, y: 8, face: "up" } },
  doors: [
    { x: 7, y: 9, to: "city", spawn: "fromArena", label: "▼ Exit" },
    { x: 8, y: 9, to: "city", spawn: "fromArena" },
  ],
  npcs: [
    {
      id: "arena_champ", x: 7, y: 3, name: "Arena Champion", colors: C.red, duelist: true, face: "down",
      lines: ["This is the Arena. Only duelists who can win belong here.", "Step onto the field!"],
      defeatedLines: ["A worthy champion. The Dojo master will want a match."],
    },
    {
      id: "spectator", x: 3, y: 6, name: "Spectator", colors: C.blue, face: "right",
      lines: ["Monsters in Defense Position can't be destroyed by weaker attacks.", "Piercing monsters still hurt though!"],
    },
  ],
};

// ── 🥋 Dojo interior ──────────────────────────────────────────────────────────
const DOJO: MapDef = {
  id: "dojo",
  name: "Duel Dojo",
  ambient: 0xffd8b0,
  indoor: true,
  grid: [
    "############",
    "#ffffffffff#",
    "#ffSSffSSff#",
    "#ffffffffff#",
    "#ffFccccFff#",
    "#ffFccccFff#",
    "#ffffffffff#",
    "#ffffffffff#",
    "#####DD#####",
  ],
  spawns: { enter: { x: 5, y: 6, face: "up" } },
  doors: [
    { x: 5, y: 8, to: "city", spawn: "fromDojo", label: "▼ Exit" },
    { x: 6, y: 8, to: "city", spawn: "fromDojo" },
  ],
  npcs: [
    {
      id: "dojo_master", x: 5, y: 2, name: "Dojo Master", colors: C.purple, duelist: true, face: "down",
      lines: ["Patience wins duels, not power.", "Show me the discipline of your deck."],
      defeatedLines: ["Your deck has spirit. Head to New City — the Champion waits."],
    },
  ],
  signs: [{ x: 2, y: 4, text: "🥋 Tribute wisely — a lost monster is a lost turn" }],
};

// ── 🌳 Route 1 ────────────────────────────────────────────────────────────────
const ROUTE1: MapDef = {
  id: "route1",
  name: "Route 1",
  ambient: 0xffffff,
  indoor: false,
  grid: [
    "TTTTTT====TTTTTTTTTTTTTTTT",
    "T,,,,,====,,,,,,,,,,,,,,,T",
    "T,,TT,====,,TT,,,,,,TT,,,T",
    "T,,TT,====,,TT,,,,,,TT,,,T",
    "T,,,,,====,,,,,,,,,,,,,,,T",
    "T,,,,,====,,,,~~~~,,,,,,,T",
    "T,*,,,====,,,~~~~~~,,,,,,T",
    "T,,,,,====,,,~~~~~~,,,,,*T",
    "T,,,,,=========,,~~,,,,,,T",
    "T,,,,,====,,,,,,,,,,,,,,==",
    "T,,,,,====,,,,,,,,,,,,,,==",
    "T,,TT,====,,,TT,,,,TT,,,,T",
    "T,,TT,====,,,TT,,,,TT,,,,T",
    "T,,,,,====,,,,,,,,,,,,,,,T",
    "TTTTTTTTTTTTTTTTTTTTTTTTTT",
  ],
  spawns: {
    fromCity:    { x: 7, y: 1, face: "down" },
    fromNewCity: { x: 24, y: 9, face: "left" },
  },
  doors: [
    { x: 6, y: 0, to: "city", spawn: "fromRoute1", label: "▲ Battle City" },
    { x: 7, y: 0, to: "city", spawn: "fromRoute1" },
    { x: 8, y: 0, to: "city", spawn: "fromRoute1" },
    { x: 9, y: 0, to: "city", spawn: "fromRoute1" },
    { x: 25, y: 9, to: "newcity", spawn: "fromRoute", label: "New City ▶" },
    { x: 25, y: 10, to: "newcity", spawn: "fromRoute" },
  ],
  npcs: [
    {
      id: "route_duelist", x: 15, y: 4, name: "Wandering Duelist", colors: C.green, duelist: true, face: "down",
      lines: ["Nobody crosses Route 1 without a duel!", "Draw your cards!"],
      defeatedLines: ["Safe travels, duelist."],
    },
    {
      id: "fisher", x: 12, y: 8, name: "Angler", colors: C.teal, face: "right",
      lines: ["Water's calm today.", "New City is east — the Champion there is undefeated."],
    },
  ],
  signs: [{ x: 8, y: 5, text: "🌳 ROUTE 1 — New City ▶ east" }],
};

// ── 🏙️ New City ───────────────────────────────────────────────────────────────
const NEWCITY: MapDef = {
  id: "newcity",
  name: "New City",
  ambient: 0xe8d8ff,
  indoor: false,
  grid: [
    "TTTTTTTTTTTTTTTTTTTT",
    "T..................T",
    "T..RRRRRRRRRRRRRR..T",
    "T..RRRRRRRRRRRRRR..T",
    "T..BBBBBBBBBBBBBB..T",
    "T..................T",
    "==,,,,,,,,,,,,,,,,,T",
    "==================,T",
    "T..,,,,,,,,,,,,,,,,T",
    "T..*..,,,,,,,,,,*..T",
    "T.....,,,,,,,,.....T",
    "T..oooo......oooo..T",
    "T..oooo......oooo..T",
    "T..................T",
    "TTTTTTTTTTTTTTTTTTTT",
  ],
  spawns: { fromRoute: { x: 1, y: 6, face: "right" } },
  doors: [
    { x: 0, y: 6, to: "route1", spawn: "fromNewCity", label: "◀ Route 1" },
    { x: 0, y: 7, to: "route1", spawn: "fromNewCity" },
  ],
  npcs: [
    {
      id: "champ", x: 10, y: 10, name: "City Champion", colors: C.gold, duelist: true, face: "down",
      lines: ["So you made it all the way to New City.", "I am the Champion. Prove you deserve the title!"],
      defeatedLines: ["The title is yours, duelist. Well fought."],
    },
    {
      id: "guard", x: 5, y: 8, name: "City Guard", colors: C.blue, face: "down",
      lines: ["The Champion never loses.", "...Well. Never has, anyway."],
    },
  ],
  signs: [{ x: 10, y: 8, text: "🏙 NEW CITY — home of the Champion" }],
};

export const MAPS: Record<string, MapDef> = {
  city: CITY, shop: SHOP, arena: ARENA, dojo: DOJO, route1: ROUTE1, newcity: NEWCITY,
};

export function getMap(id: string): MapDef { return MAPS[id] ?? CITY; }

/** Total duelists across the world (for progress display). */
export const TOTAL_DUELISTS = Object.values(MAPS)
  .reduce((n, m) => n + m.npcs.filter((x) => x.duelist).length, 0);
