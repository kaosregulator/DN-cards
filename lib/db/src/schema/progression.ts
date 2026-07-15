import {
  pgTable, text, serial, integer, jsonb, timestamp, uniqueIndex,
} from "drizzle-orm/pg-core";

// ─────────────────────────────────────────────────────────────────────────────
// DN Cards — Unified account-level progression (Player XP)
//
// This is a PURELY ADDITIVE table. It does NOT replace or migrate any existing
// progression store — card XP (`card_progress`), battle XP/ranks
// (`battle_profiles`), economy (`user_currency`), quests, reputation, etc. all
// keep their own tables and logic. This table only holds the NEW account-wide
// "Player Level" that every activity contributes to, so the User Hub can show a
// single unified progression number without duplicating any system.
//
// The `PlayerProfile` service (bot/player/profile.ts) is the source of truth: it
// aggregates the existing tables for reads and writes account XP here.
// ─────────────────────────────────────────────────────────────────────────────

export const playerProgressionTable = pgTable("player_progression", {
  id: serial("id").primaryKey(),
  guildId: text("guild_id").notNull(),
  userId: text("user_id").notNull(),
  // Total cumulative account XP and the level derived from it (stored so
  // leaderboards and Hub reads don't have to recompute from the curve).
  xp: integer("xp").notNull().default(0),
  level: integer("level").notNull().default(1),
  // Lifetime XP contributed per activity source, e.g. { catch: 120, battle: 400 }.
  // Drives the "you're rewarded for every system" breakdown on the Hub.
  xpBySource: jsonb("xp_by_source").notNull().default({}),
  // Highest collection-milestone tier already rewarded, so crossing a milestone
  // grants its XP exactly once (idempotent on repeated reads/among concurrent
  // catches).
  collectionMilestone: integer("collection_milestone").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => ({
  guildUserUniq: uniqueIndex("player_progression_guild_user_uniq").on(t.guildId, t.userId),
}));

export type PlayerProgression = typeof playerProgressionTable.$inferSelect;

// The activities that contribute account XP. Kept here so the schema, service,
// and Hub breakdown all share one canonical list.
export type XpSource =
  | "catch"
  | "pack"
  | "battle"
  | "raid"
  | "trade"
  | "economy"
  | "daily"
  | "quest"
  | "achievement"
  | "reputation"
  | "collection";
