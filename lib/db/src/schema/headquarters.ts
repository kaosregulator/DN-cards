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
export type HqItemType = "decoration" | "room" | "theme" | "wall" | "floor";

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
