import {
  pgTable, text, serial, integer, jsonb, timestamp, uniqueIndex, index,
} from "drizzle-orm/pg-core";

// ─────────────────────────────────────────────────────────────────────────────
// DN Cards — Player Headquarters (HQ)
//
// PURELY ADDITIVE. These four tables hold ONLY the HQ's own state — the chosen
// theme, which cosmetics a player has EARNED, which cards they pin, and where
// they place decorations. They never own or duplicate collection / battle / raid
// / achievement data; HQ progression is DERIVED from those existing systems by
// bot/hq/engine.ts (reusing bot/player/profile.ts + the feature readers) and the
// earned cosmetics are reconciled into `hq_unlocks`.
//
// The engine is deliberately theme-agnostic: it knows only generic concepts
// (theme, room, display, decoration, placement). What a "Military Base" or
// "Castle" looks like lives entirely in the code registries under bot/hq/defs/*
// and (later) bundled/uploaded asset packs — NOT in this schema.
// ─────────────────────────────────────────────────────────────────────────────

// One row per (guild, user): the player's HQ settings. Everything cosmetic that
// is a single choice (active theme, current room) lives here; earned/placed
// items are the other three tables.
export const playerHqTable = pgTable("player_hq", {
  id: serial("id").primaryKey(),
  guildId: text("guild_id").notNull(),
  userId: text("user_id").notNull(),
  // Active theme id — resolves through bot/hq/defs/themes.ts (degrades to the
  // default theme if the id is ever removed, so a stale value never breaks a render).
  themeId: text("theme_id").notNull().default("command"),
  // The room currently being viewed/edited (resolves through defs/rooms.ts).
  activeRoomId: text("active_room_id").notNull().default("trophy-hall"),
  // Active wall & floor styles for the isometric room (resolve through
  // defs/walls.ts and defs/floors.ts; degrade to the default if ever removed).
  wallId: text("wall_id").notNull().default("plaster"),
  floorId: text("floor_id").notNull().default("wood"),
  // Cached HQ level, DERIVED from existing progression by the engine and stored
  // so reads/leaderboards don't recompute the curve. Source of truth stays the
  // underlying systems; this is a convenience cache refreshed on reconcile.
  hqLevel: integer("hq_level").notNull().default(1),
  // Free-form cache for future presentation flags (lighting override, visit
  // counter, etc.). Additive — never required for correctness.
  stats: jsonb("stats").notNull().default({}),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => ({
  guildUserUniq: uniqueIndex("player_hq_guild_user_uniq").on(t.guildId, t.userId),
}));

export type PlayerHq = typeof playerHqTable.$inferSelect;

// The EARNED-cosmetics ledger. One row per unlocked item (decoration, room, or
// theme). Read into a Set exactly like raid_frame_unlocks; written idempotently
// by the reconcile engine (insert … onConflictDoNothing). `source` records HOW
// it was earned so the HQ can tell each decoration's story.
export const hqUnlocksTable = pgTable("hq_unlocks", {
  id: serial("id").primaryKey(),
  guildId: text("guild_id").notNull(),
  userId: text("user_id").notNull(),
  // Generic id of the unlocked thing (decoration/room/theme id from the registries).
  itemId: text("item_id").notNull(),
  itemType: text("item_type").$type<HqItemType>().notNull().default("decoration"),
  // Short human tag of the earning condition, e.g. "battleWins>=100", "raidBoss".
  source: text("source"),
  unlockedAt: timestamp("unlocked_at").notNull().defaultNow(),
}, (t) => ({
  guildUserItemUniq: uniqueIndex("hq_unlocks_guild_user_item_uniq").on(t.guildId, t.userId, t.itemId),
  byUser: index("hq_unlocks_guild_user_idx").on(t.guildId, t.userId),
}));

export type HqUnlock = typeof hqUnlocksTable.$inferSelect;
export type HqItemType =
  | "decoration" | "room" | "theme" | "wall" | "floor" | "backdrop" | "companion"
  // Repeating wall coverings (defs/wallpapers.ts) and build-editor ground
  // materials (defs/surfaces.ts). Stored as free text, so adding a kind never
  // needs a migration.
  | "wallpaper" | "material";

// Pinned featured cards for the Trophy Hall — one row per pedestal slot. Unique
// on (guild, user, slot); repinning a slot upserts. Clicking a featured card in
// the hub opens the normal card view.
export const hqDisplaysTable = pgTable("hq_displays", {
  id: serial("id").primaryKey(),
  guildId: text("guild_id").notNull(),
  userId: text("user_id").notNull(),
  slot: integer("slot").notNull(),
  cardId: integer("card_id").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => ({
  guildUserSlotUniq: uniqueIndex("hq_displays_guild_user_slot_uniq").on(t.guildId, t.userId, t.slot),
}));

export type HqDisplay = typeof hqDisplaysTable.$inferSelect;

// Placed decorations — one row per occupied slot in a room. Unique on
// (guild, user, room, slot); placing into a slot upserts, removing deletes.
// Only EARNED decorations (present in hq_unlocks) may be placed; the engine
// enforces that, so a lost unlock never leaves an un-earned item on display.
export const hqPlacementsTable = pgTable("hq_placements", {
  id: serial("id").primaryKey(),
  guildId: text("guild_id").notNull(),
  userId: text("user_id").notNull(),
  roomId: text("room_id").notNull(),
  slot: integer("slot").notNull(),
  itemId: text("item_id").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => ({
  guildUserRoomSlotUniq: uniqueIndex("hq_placements_guild_user_room_slot_uniq").on(t.guildId, t.userId, t.roomId, t.slot),
  byUserRoom: index("hq_placements_guild_user_room_idx").on(t.guildId, t.userId, t.roomId),
}));

export type HqPlacement = typeof hqPlacementsTable.$inferSelect;

// Base defenders — cards a player sets to guard their base, rendered as standee
// figures. One row per defender slot; unique on (guild, user, slot). This is the
// SETUP half of the base-defense mini-game; the attack/combat side reads these
// (and will add its own state) without changing this table's ownership. Purely
// additive and cosmetic to the rest of the game — a defender is a reference to a
// card the player owns, not a copy of it.
export const hqDefendersTable = pgTable("hq_defenders", {
  id: serial("id").primaryKey(),
  guildId: text("guild_id").notNull(),
  userId: text("user_id").notNull(),
  slot: integer("slot").notNull(),
  cardId: integer("card_id").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => ({
  guildUserSlotUniq: uniqueIndex("hq_defenders_guild_user_slot_uniq").on(t.guildId, t.userId, t.slot),
  byUser: index("hq_defenders_guild_user_idx").on(t.guildId, t.userId),
}));

export type HqDefender = typeof hqDefendersTable.$inferSelect;

// Base-siege state — the capture/defend mini-game layered on top of the base.
// One row per base (guild, user = the base OWNER). `heldBy*` records a conqueror
// (null = the owner holds their own base); `shieldUntil` protects a freshly
// attacked base from being farmed. Additive; combat is DERIVED (bot/hq/siege.ts)
// from card power via the existing battle stat engine — this only stores outcome.
export const hqBaseStateTable = pgTable("hq_base_state", {
  id: serial("id").primaryKey(),
  guildId: text("guild_id").notNull(),
  userId: text("user_id").notNull(),        // the base owner
  heldByUserId: text("held_by_user_id"),    // conqueror, or null when owner holds
  heldByName: text("held_by_name"),
  shieldUntil: timestamp("shield_until"),   // no attacks allowed until this time
  lastAttackedAt: timestamp("last_attacked_at"),
  // When the CURRENT holder took the base — the start of their reign. Null while
  // the owner holds their own base. Powers "shards while you hold" (tribute
  // accrues from here) and the longest-reign leaderboard (live reign = now-this).
  heldSince: timestamp("held_since"),
  // Last time the holder collected their hold-tribute; tribute accrues between
  // this and now. Reset to the capture time on each new capture.
  lastTributeAt: timestamp("last_tribute_at"),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => ({
  guildUserUniq: uniqueIndex("hq_base_state_guild_user_uniq").on(t.guildId, t.userId),
}));

export type HqBaseState = typeof hqBaseStateTable.$inferSelect;

// Attack log — one row per resolved siege. Powers a per-target attacker cooldown
// and a battle history; never affects card ownership.
export const hqBaseAttacksTable = pgTable("hq_base_attacks", {
  id: serial("id").primaryKey(),
  guildId: text("guild_id").notNull(),
  attackerId: text("attacker_id").notNull(),
  defenderId: text("defender_id").notNull(),
  won: text("won").notNull(),               // "1" attacker won, "0" defender held
  attackerPower: integer("attacker_power").notNull().default(0),
  defenderPower: integer("defender_power").notNull().default(0),
  mode: text("mode").notNull().default("static"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => ({
  byPair: index("hq_base_attacks_pair_idx").on(t.guildId, t.attackerId, t.defenderId, t.createdAt),
}));

export type HqBaseAttack = typeof hqBaseAttacksTable.$inferSelect;

// Reign log — one row per COMPLETED hold. Written when a reign ends (the base is
// recaptured by someone else or reclaimed by its owner). Powers the longest-hold
// leaderboard and the "Sovereign" title; combined at read time with any still
// active reign (now − held_since) so a current holder can top the board live.
export const hqBaseReignsTable = pgTable("hq_base_reigns", {
  id: serial("id").primaryKey(),
  guildId: text("guild_id").notNull(),
  holderId: text("holder_id").notNull(),
  holderName: text("holder_name"),
  baseOwnerId: text("base_owner_id").notNull(),
  startedAt: timestamp("started_at").notNull(),
  endedAt: timestamp("ended_at").notNull().defaultNow(),
  durationSec: integer("duration_sec").notNull().default(0),
}, (t) => ({
  byHolder: index("hq_base_reigns_holder_idx").on(t.guildId, t.holderId),
}));

export type HqBaseReign = typeof hqBaseReignsTable.$inferSelect;

// World territories — the AI-held castles that make the world map a place to
// conquer rather than a directory of other players. One row per (guild, node);
// rows are created idempotently from the static blueprint in
// bot/hq/defs/world.ts the first time a guild opens the map, so the code stays
// the source of truth for WHERE a territory is and this table only owns WHO
// holds it. A null `heldByUserId` means the founding AI faction still holds it.
export const hqWorldNodesTable = pgTable("hq_world_nodes", {
  id: serial("id").primaryKey(),
  guildId: text("guild_id").notNull(),
  nodeId: text("node_id").notNull(),          // blueprint id (defs/world.ts)
  heldByUserId: text("held_by_user_id"),      // null = still AI-held
  heldByName: text("held_by_name"),
  heldSince: timestamp("held_since"),         // start of the current player reign
  lastTributeAt: timestamp("last_tribute_at"),// tribute accrues from here
  shieldUntil: timestamp("shield_until"),     // no attacks allowed until this time
  lastAttackedAt: timestamp("last_attacked_at"),
  // How many times this territory has changed hands — surfaced as a "contested"
  // marker on the map.
  captures: integer("captures").notNull().default(0),
  stats: jsonb("stats").notNull().default({}),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => ({
  guildNodeUniq: uniqueIndex("hq_world_nodes_guild_node_uniq").on(t.guildId, t.nodeId),
  byHolder: index("hq_world_nodes_holder_idx").on(t.guildId, t.heldByUserId),
}));

export type HqWorldNode = typeof hqWorldNodesTable.$inferSelect;

// Built terrain — the rectangles the in-Discord world editor stamps onto a
// room's (or the base grounds') isometric lattice: paved patches, ponds, raised
// decks, grass hills. Purely cosmetic and purely additive; `hq_placements` still
// owns single-tile decorations, this owns AREAS.
//
// A feature is (kind of material) × (rectangle) × (elevation), which is enough
// to express every brush the editor offers without a table per material.
export const hqTerrainTable = pgTable("hq_terrain", {
  id: serial("id").primaryKey(),
  guildId: text("guild_id").notNull(),
  userId: text("user_id").notNull(),
  // Which canvas: a room id from defs/rooms.ts, or "base" for the outdoor grounds.
  roomId: text("room_id").notNull(),
  // Material id from defs/surfaces.ts; resolves to the default if ever removed.
  materialId: text("material_id").notNull(),
  x: integer("x").notNull(),
  y: integer("y").notNull(),
  w: integer("w").notNull().default(1),
  h: integer("h").notNull().default(1),
  // Vertical steps of lift (raised/mound) or depth (water). 0 = the material's
  // own default height.
  elevation: integer("elevation").notNull().default(0),
  // Paint order within a room; higher paints later. Lets a player lay a path
  // over grass without deleting the grass.
  z: integer("z").notNull().default(0),
  meta: jsonb("meta").notNull().default({}),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => ({
  byUserRoom: index("hq_terrain_guild_user_room_idx").on(t.guildId, t.userId, t.roomId),
}));

export type HqTerrain = typeof hqTerrainTable.$inferSelect;
