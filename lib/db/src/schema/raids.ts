import {
  pgTable, text, serial, integer, boolean, timestamp, index,
} from "drizzle-orm/pg-core";

// ─────────────────────────────────────────────────────────────────────────────
// DN Cards — Co-op Boss Raids
//
// A team of players fights an ADMIN-CREATED boss together. Distinct from the AI
// battle: it's multiplayer, the boss has a shared health pool scaled to the
// party's card power, and players must clear a prestige gate (their card must be
// a certain star rating, and they a certain battle level) to join. Admins define
// and tune bosses per guild; boss stats derive from the admins' base numbers
// PLUS live scaling off the party that shows up.
//
// Purely additive: one boss-definition table. Live raid sessions run in memory
// (like live battles) — nothing to persist since raids never risk a player's
// cards.
// ─────────────────────────────────────────────────────────────────────────────

export const raidBossesTable = pgTable("raid_bosses", {
  id: serial("id").primaryKey(),
  guildId: text("guild_id").notNull(),
  name: text("name").notNull(),
  description: text("description"),
  imageUrl: text("image_url"),
  // Optional battlefield/arena image drawn behind the raid intro canvas + fight.
  // One image per boss (admin-uploaded); null falls back to a dramatic gradient.
  battlefieldUrl: text("battlefield_url"),
  // Archetype (drives the boss's stat flavour via the stat engine) + a rarity
  // reference used in scaling/among display. Admin-tunable.
  archetype: text("archetype").notNull().default("boss"),
  rarity: text("rarity").notNull().default("mythic"),
  // Base combat numbers (before party scaling). Admin-owned knobs.
  baseHealth: integer("base_health").notNull().default(6000),
  baseAttack: integer("base_attack").notNull().default(140),
  baseDefense: integer("base_defense").notNull().default(90),
  // Entry gates.
  minStars: integer("min_stars").notNull().default(5),
  minPlayerLevel: integer("min_player_level").notNull().default(1),
  minPlayers: integer("min_players").notNull().default(2),
  maxPlayers: integer("max_players").notNull().default(4),
  // Live scaling: how much each extra unit of party power inflates boss HP.
  healthScalingPct: integer("health_scaling_pct").notNull().default(100),
  // Boss enrages (attack ramps) after this many rounds. 0 = never.
  enrageTurn: integer("enrage_turn").notNull().default(8),
  // Rewards paid to every survivor on a clear.
  rewardShards: integer("reward_shards").notNull().default(500),
  rewardXp: integer("reward_xp").notNull().default(120),
  // Extra card XP granted to each participant's fielded card on a clear.
  rewardCardXp: integer("reward_card_xp").notNull().default(150),
  enabled: boolean("enabled").notNull().default(true),
  createdBy: text("created_by"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => ({
  byGuild: index("raid_bosses_guild_idx").on(t.guildId, t.enabled),
}));

export type RaidBoss = typeof raidBossesTable.$inferSelect;
