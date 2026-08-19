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

export type MapKey = "world" | "village" | "card-shop" | "duel-hall";

/** What a portal / encounter does when the player interacts with it. */
export type WorldAction =
  | { kind: "map"; to: MapKey } // walk into another world map
  | { kind: "duel" } // start a real AI duel (DuelScene)
  | { kind: "shop" } // open the Card Shop counter (ShopScene)
  | { kind: "pvp" } // find an online opponent (MatchmakingScene)
  | { kind: "menu" }; // back to the title menu

export interface PortalDef {
  id: string;
  label: string;
  glyph: string;
  color: number;
  action: WorldAction;
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
};

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
