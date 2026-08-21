// ─────────────────────────────────────────────────────────────────────────────
// WorkAdventure world registry — the connected, tile-based overworld foundation.
//
// Each entry is a real Tiled (.tmj) map bundled under public/world/maps, built
// from the WorkAdventure Map Starter Kit + the "great place to work" and
// "wa-headquarters" presets. The registry declares how the maps connect and what
// each portal / encounter does. Duels, the shop and PvP hand off to the REAL
// battle scenes from PR #106 (DuelScene / ShopScene / MatchmakingScene), so the
// card game is fully preserved — this only rebuilds the world you walk around in.
//
// (Named worldMaps to avoid clashing with world/maps.ts, the duel-side map data.)
// ─────────────────────────────────────────────────────────────────────────────

import { HM_MAPS } from "./hmMaps";

// Core map keys are the WA maps + the cave; Harvest Moon maps add many more keys
// at runtime (hm-town, hm-crossroads, …), so the key type is a plain string.
export type MapKey = string;

/** What a portal / encounter does when the player interacts with it. */
export type WorldAction =
  | { kind: "map"; to: MapKey; spawnAt?: { tx: number; ty: number } } // walk into another map
  | { kind: "duel" } // start a real AI duel (DuelScene)
  | { kind: "shop" } // open the Card Shop counter (ShopScene)
  | { kind: "pvp" } // find an online opponent (MatchmakingScene)
  | { kind: "menu" }; // back to the title menu

/** A reciprocal door/edge exit that auto-transitions when walked onto (HM maps). */
export interface MapExit {
  to: MapKey;
  tx: number;
  ty: number;
  w: number;
  h: number;
  /** Explicit arrival tile in the target (else the reciprocal exit is used). */
  spawnAt?: { tx: number; ty: number };
}

export interface PortalDef {
  id: string;
  label: string;
  glyph: string;
  color: number;
  action: WorldAction;
  /** Fixed tile placement. When set, the portal sits here instead of being
   *  auto-arranged in the ring around spawn (used for the cave entrance). */
  at?: { tx: number; ty: number };
  /** Optional world art drawn under the beacon, e.g. a cave mouth. */
  art?: "cave";
}

// A duelist you can walk up to and challenge. Every encounter starts a real duel
// (DuelScene) with the given display name — the seam for scattering enemies and,
// later, a mini-tournament across the world.
export interface EncounterDef {
  id: string;
  name: string;
  glyph: string;
  color: number;
}

export interface MapDef {
  key: MapKey;
  name: string;
  subtitle: string;
  /** "start" = the map's Tiled start layer; "center" = nearest open tile to the map centre. */
  spawn: "start" | "center";
  portals: PortalDef[];
  encounters?: EncounterDef[];
  /** Ambient NPCs/dogs are scattered by default; set false for tight interiors. */
  ambient?: boolean;
  // ── Harvest Moon (image-backed) maps ──
  /** Tile size in px (default 32; HM maps are 20). */
  tile?: number;
  /** Map grid size in tiles (HM maps — used to nudge arrival spawns inward). */
  gridW?: number;
  gridH?: number;
  /** Full background image drawn in-scene (small HM maps). */
  bgImage?: string;
  /** Full-map detail overlay drawn above the base ground (trees/rocks/springs). */
  bgOverlay?: string;
  /** Background sliced into chunks for maps larger than the GPU texture cap. */
  bgChunks?: { url: string; x: number; y: number; w: number; h: number }[];
  /** Scale the player/pet to match the map's native art (HM ≈ 0.6). */
  avatarScale?: number;
  /** Reciprocal door/edge exits — auto-transition when walked onto. */
  hmExits?: MapExit[];
  /** Explicit default spawn tile (used by HM maps / direct loads). */
  spawnTile?: { tx: number; ty: number };
  /** Map picture for the minimap (HM maps reuse their background). */
  mapImage?: string;
}

export const MAPS: Record<MapKey, MapDef> = {
  world: {
    key: "world",
    name: "DN City",
    subtitle: "Main World · Plaza · Districts",
    spawn: "center",
    portals: [
      { id: "cardshop", label: "Card Shop", glyph: "🃏", color: 0xffb020, action: { kind: "shop" } },
      { id: "village", label: "The Village", glyph: "🏘️", color: 0x2dd4bf, action: { kind: "map", to: "village" } },
      { id: "duelhall", label: "Duel Hall", glyph: "🏟️", color: 0x8b5cf6, action: { kind: "map", to: "duel-hall" } },
      { id: "arena", label: "Duel Arena", glyph: "⚔️", color: 0xff4d6d, action: { kind: "duel" } },
      { id: "pvp", label: "Online PvP", glyph: "🌐", color: 0x38bdf8, action: { kind: "pvp" } },
      { id: "menu", label: "Main Menu", glyph: "🏠", color: 0x9aa4b2, action: { kind: "menu" } },
    ],
    encounters: [
      { id: "enc-rookie", name: "Rookie Rival", glyph: "🥊", color: 0xff6b6b },
      { id: "enc-street", name: "Street Duelist", glyph: "🎴", color: 0xf59e0b },
      { id: "enc-shadow", name: "Shadow Challenger", glyph: "🥷", color: 0xa855f7 },
      { id: "enc-rogue", name: "Rogue AI", glyph: "🤖", color: 0x38bdf8 },
      { id: "enc-veteran", name: "Arena Veteran", glyph: "🛡️", color: 0xef4444 },
    ],
  },
  village: {
    key: "village",
    name: "The Village",
    subtitle: "Lakeside Campus · Explore",
    spawn: "start",
    portals: [
      { id: "toworld", label: "To City", glyph: "🚪", color: 0x9aa4b2, action: { kind: "map", to: "world" } },
      { id: "cardshop", label: "Card Shop", glyph: "🃏", color: 0xffb020, action: { kind: "shop" } },
      { id: "arena", label: "Duel Arena", glyph: "⚔️", color: 0xff4d6d, action: { kind: "duel" } },
      // The cave mouth by the lakeside fire pit — a doorway into a new area.
      { id: "cave", label: "Mystery Cave", glyph: "🕳️", color: 0x7d6b8f,
        at: { tx: 195, ty: 101 }, art: "cave", action: { kind: "map", to: "cave" } },
      { id: "menu", label: "Main Menu", glyph: "🏠", color: 0x9aa4b2, action: { kind: "menu" } },
    ],
    encounters: [
      { id: "vil-scout", name: "Village Scout", glyph: "🥊", color: 0xff6b6b },
      { id: "vil-artisan", name: "Card Artisan", glyph: "🎴", color: 0xf59e0b },
      { id: "vil-champion", name: "Campus Champion", glyph: "🛡️", color: 0xef4444 },
    ],
  },
  "card-shop": {
    key: "card-shop",
    name: "Card Shop",
    subtitle: "Interior · Browse & Duel",
    spawn: "start",
    portals: [
      { id: "toworld", label: "To City", glyph: "🚪", color: 0x9aa4b2, action: { kind: "map", to: "world" } },
      { id: "packs", label: "Buy Cards", glyph: "🛒", color: 0x38bdf8, action: { kind: "shop" } },
      { id: "duel", label: "Duel Table", glyph: "⚔️", color: 0xff4d6d, action: { kind: "duel" } },
    ],
  },
  "duel-hall": {
    key: "duel-hall",
    name: "Duel Hall",
    subtitle: "Tournament Floor",
    spawn: "start",
    portals: [
      { id: "toworld", label: "To City", glyph: "🚪", color: 0x9aa4b2, action: { kind: "map", to: "world" } },
      { id: "duel", label: "Enter Duel", glyph: "⚔️", color: 0xff4d6d, action: { kind: "duel" } },
      { id: "pvp", label: "Online PvP", glyph: "🌐", color: 0x38bdf8, action: { kind: "pvp" } },
    ],
    encounters: [
      { id: "hall-a", name: "Tournament Rival", glyph: "🥷", color: 0xa855f7 },
      { id: "hall-b", name: "Hall Veteran", glyph: "🛡️", color: 0xef4444 },
    ],
  },
  cave: {
    key: "cave",
    name: "Mystery Cave",
    subtitle: "A passage between worlds",
    spawn: "start",
    ambient: false,
    portals: [
      { id: "tovillage", label: "Leave Cave", glyph: "🚪", color: 0x9aa4b2, action: { kind: "map", to: "village" } },
      // The far side of the cave opens onto the Harvest Moon world — you step out
      // of the mountain cave up in the Mountains.
      { id: "toharvest", label: "Deeper Passage →", glyph: "🌄", color: 0x7bb26a,
        at: { tx: 15, ty: 3 }, art: "cave",
        action: { kind: "map", to: "hm-town", spawnAt: { tx: 96, ty: 124 } } },
    ],
  },
};

// ── Harvest Moon world (mimikim/harvest-moon-phaser3-game), image-backed maps ──
// Generated registry → MapDef. Exits become reciprocal auto-transitions. The
// mountain cave (originally "cave2", which has no room) is remapped to loop back
// to our Mystery Cave, so the cave you emerged from also takes you home.
const HM_KEYS = new Set(HM_MAPS.map((m) => `hm-${m.key}`));
for (const m of HM_MAPS) {
  const exits: MapExit[] = m.exits
    .map((e) => e.to === "cave2"
      ? { to: "cave", tx: e.tx, ty: e.ty, w: e.w, h: e.h, spawnAt: { tx: 15, ty: 4 } }
      : { to: `hm-${e.to}`, tx: e.tx, ty: e.ty, w: e.w, h: e.h })
    .filter((e) => e.to === "cave" || HM_KEYS.has(e.to));
  MAPS[`hm-${m.key}`] = {
    key: `hm-${m.key}`,
    name: m.name,
    subtitle: m.subtitle,
    spawn: "start",
    ambient: false,
    portals: [],
    tile: m.tile,
    gridW: m.w,
    gridH: m.h,
    bgImage: m.bg ?? undefined,
    bgChunks: m.chunks ?? undefined,
    bgOverlay: m.overlay ?? undefined,
    mapImage: m.mapImage,
    avatarScale: 0.85,
    spawnTile: m.spawn,
    hmExits: exits,
  };
}

export const START_MAP: MapKey = "world";

// Runtime manifest describing the tilesets each map needs (generated alongside
// the maps — see public/world/maps/_manifest.json).
export interface TilesetInfo {
  name: string;
  firstgid: number;
  image: string;
  columns: number;
  tilecount: number;
  tilewidth: number;
  tileheight: number;
  margin: number;
  spacing: number;
  imagewidth: number;
  imageheight: number;
}

export interface MapManifestEntry {
  width: number;
  height: number;
  tilewidth: number;
  tileheight: number;
  tilesets: TilesetInfo[];
}

export type WorldManifest = Record<string, MapManifestEntry>;
