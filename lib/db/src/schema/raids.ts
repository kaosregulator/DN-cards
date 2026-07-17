import {
  pgTable, text, serial, integer, boolean, timestamp, index, uniqueIndex,
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
  // The card this boss IS — granted to winners who pick the "boss card" reward,
  // and the art shown on the boss card. Null → the boss is portrait-only and
  // the card reward option is hidden. References cards.id (loosely; not FK).
  cardId: integer("card_id"),
  // Exclusive cosmetic frame unlocked (account-wide) by beating this boss. Null
  // → a generic "Raid Champion" frame is granted instead. See frames registry.
  rewardFrameId: text("reward_frame_id"),
  // Progression order within the guild's boss ladder (0 = first). Beating one
  // boss points players toward the next in sequence; the highest is the finale.
  sequence: integer("sequence").notNull().default(0),
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

// ─────────────────────────────────────────────────────────────────────────────
// Raid frame unlocks — account-wide cosmetic frames earned by clearing a boss.
//
// Unlike the level-based per-card frames (card_progress.equipped_frame), a raid
// frame is unlocked ONCE for the whole account and can be equipped on ANY owned
// card. Purely cosmetic. One row per (guild, user, frame). Purely additive.
// ─────────────────────────────────────────────────────────────────────────────
export const raidFrameUnlocksTable = pgTable("raid_frame_unlocks", {
  id: serial("id").primaryKey(),
  guildId: text("guild_id").notNull(),
  userId: text("user_id").notNull(),
  frameId: text("frame_id").notNull(),
  // The boss that awarded it (for display/history). Null tolerated.
  bossId: integer("boss_id"),
  unlockedAt: timestamp("unlocked_at").notNull().defaultNow(),
}, (t) => ({
  uniq: uniqueIndex("raid_frame_unlocks_guild_user_frame_uniq").on(t.guildId, t.userId, t.frameId),
  byUser: index("raid_frame_unlocks_user_idx").on(t.guildId, t.userId),
}));

export type RaidFrameUnlock = typeof raidFrameUnlocksTable.$inferSelect;
