import {
  pgTable, text, serial, integer, timestamp,
  boolean, real, pgEnum, uniqueIndex,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// ── Enums ─────────────────────────────────────────────────────────────────────
export const rarityEnum = pgEnum("rarity", [
  "common", "uncommon", "rare", "epic", "legendary",
]);

export const cardTypeEnum = pgEnum("card_type", [
  "tank", "aircraft", "ship", "vehicle", "infantry",
  "boss", "community", "event", "achievement", "limited",
]);

export const tradeStatusEnum = pgEnum("trade_status", [
  "pending", "accepted", "declined", "cancelled", "expired",
]);

// ── Cards ─────────────────────────────────────────────────────────────────────
export const cardsTable = pgTable("cards", {
  id: serial("id").primaryKey(),
  name: text("name").notNull().unique(),
  description: text("description").notNull().default(""),
  rarity: rarityEnum("rarity").notNull(),
  cardType: cardTypeEnum("card_type").notNull().default("vehicle"),
  dropWeight: real("drop_weight").notNull().default(1.0),
  worthValue: integer("worth_value").notNull().default(10),
  burnValue: integer("burn_value").notNull().default(5),
  isLimitedEdition: boolean("is_limited_edition").notNull().default(false),
  isEventExclusive: boolean("is_event_exclusive").notNull().default(false),
  maxCopies: integer("max_copies"),
  totalMinted: integer("total_minted").notNull().default(0),
  imageUrl: text("image_url"),
  flavor: text("flavor"),
  droppable: boolean("droppable").notNull().default(true),
  inPacks: boolean("in_packs").notNull().default(true),
  isArchived: boolean("is_archived").notNull().default(false),
  setName: text("set_name"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertCardSchema = createInsertSchema(cardsTable).omit({ id: true, createdAt: true, totalMinted: true });
export type InsertCard = z.infer<typeof insertCardSchema>;
export type Card = typeof cardsTable.$inferSelect;

// ── User Collections ──────────────────────────────────────────────────────────
export const collectionsTable = pgTable("collections", {
  id: serial("id").primaryKey(),
  guildId: text("guild_id").notNull(),
  userId: text("user_id").notNull(),
  cardId: integer("card_id").notNull().references(() => cardsTable.id),
  count: integer("count").notNull().default(1),
  firstCaughtAt: timestamp("first_caught_at").notNull().defaultNow(),
  lastCaughtAt: timestamp("last_caught_at").notNull().defaultNow(),
});

export const insertCollectionSchema = createInsertSchema(collectionsTable).omit({
  id: true, firstCaughtAt: true, lastCaughtAt: true,
});
export type InsertCollection = z.infer<typeof insertCollectionSchema>;
export type Collection = typeof collectionsTable.$inferSelect;

// ── User Currency (DN Shards) ─────────────────────────────────────────────────
export const userCurrencyTable = pgTable("user_currency", {
  id: serial("id").primaryKey(),
  guildId: text("guild_id").notNull(),
  userId: text("user_id").notNull(),
  shards: integer("shards").notNull().default(0),
  totalEarned: integer("total_earned").notNull().default(0),
  packsOpened: integer("packs_opened").notNull().default(0),
  cardsBurned: integer("cards_burned").notNull().default(0),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type UserCurrency = typeof userCurrencyTable.$inferSelect;

// ── Daily Claims ──────────────────────────────────────────────────────────────
export const dailyClaimsTable = pgTable("daily_claims", {
  id: serial("id").primaryKey(),
  guildId: text("guild_id").notNull(),
  userId: text("user_id").notNull(),
  lastClaimedAt: timestamp("last_claimed_at").notNull().defaultNow(),
  streak: integer("streak").notNull().default(0),
}, t => ({
  uniqGuildUser: uniqueIndex("daily_claims_guild_user_uniq").on(t.guildId, t.userId),
}));

export type DailyClaim = typeof dailyClaimsTable.$inferSelect;

// ── Achievements (unlocked) ───────────────────────────────────────────────────
export const achievementsTable = pgTable("achievements_unlocked", {
  id: serial("id").primaryKey(),
  guildId: text("guild_id").notNull(),
  userId: text("user_id").notNull(),
  achievementKey: text("achievement_key").notNull(),
  unlockedAt: timestamp("unlocked_at").notNull().defaultNow(),
}, t => ({
  uniqUserAchievement: uniqueIndex("achievements_user_key_uniq").on(t.guildId, t.userId, t.achievementKey),
}));

export type AchievementUnlock = typeof achievementsTable.$inferSelect;

// ── Trades ────────────────────────────────────────────────────────────────────
// Card fields are nullable so a trade can be cards-only, shards-only, or mixed.
export const tradesTable = pgTable("trades", {
  id: serial("id").primaryKey(),
  guildId: text("guild_id").notNull(),
  initiatorId: text("initiator_id").notNull(),
  targetId: text("target_id").notNull(),
  offeredCardId: integer("offered_card_id").references(() => cardsTable.id),
  requestedCardId: integer("requested_card_id").references(() => cardsTable.id),
  offeredShards: integer("offered_shards").notNull().default(0),
  requestedShards: integer("requested_shards").notNull().default(0),
  status: tradeStatusEnum("status").notNull().default("pending"),
  messageId: text("message_id"),
  channelId: text("channel_id"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  resolvedAt: timestamp("resolved_at"),
});

export type Trade = typeof tradesTable.$inferSelect;

// ── Guild Settings ────────────────────────────────────────────────────────────
export const guildSettingsTable = pgTable("guild_settings", {
  id: serial("id").primaryKey(),
  guildId: text("guild_id").notNull().unique(),
  spawnChannelId: text("spawn_channel_id"),
  tradeChannelId: text("trade_channel_id"),
  spawnIntervalSeconds: integer("spawn_interval_seconds").notNull().default(3600),
  spawnIntervalMin: integer("spawn_interval_min"),
  spawnIntervalMax: integer("spawn_interval_max"),
  useRandomInterval: boolean("use_random_interval").notNull().default(false),
  spawnEnabled: boolean("spawn_enabled").notNull().default(true),
  catchWindowSeconds: integer("catch_window_seconds").notNull().default(120),
  tradeEnabled: boolean("trade_enabled").notNull().default(true),
  // Cards per spawn: 1, 3, 5, or -1 (random 1–3)
  cardsPerSpawn: integer("cards_per_spawn").notNull().default(1),
  // Custom rarity drop weights per card of that tier (null = use card's default)
  rarityWeightCommon: integer("rarity_weight_common"),
  rarityWeightUncommon: integer("rarity_weight_uncommon"),
  rarityWeightRare: integer("rarity_weight_rare"),
  rarityWeightEpic: integer("rarity_weight_epic"),
  rarityWeightLegendary: integer("rarity_weight_legendary"),
  // Catch mode: "type" (type card name), "button" (click claim button), or "both"
  catchMode: text("catch_mode").notNull().default("type"),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type GuildSettings = typeof guildSettingsTable.$inferSelect;

// ── Admin Users ───────────────────────────────────────────────────────────────
export const adminUsersTable = pgTable("admin_users", {
  id: serial("id").primaryKey(),
  guildId: text("guild_id").notNull(),
  userId: text("user_id").notNull(),
  addedAt: timestamp("added_at").notNull().defaultNow(),
  addedBy: text("added_by").notNull(),
});

export type AdminUser = typeof adminUsersTable.$inferSelect;

// ── User Catch Timeouts ───────────────────────────────────────────────────────
// Admin-imposed time-out preventing a user from catching cards (typing or
// button) in a guild until `expiresAt`. One active row per (guild,user).
export const userTimeoutsTable = pgTable("user_timeouts", {
  id: serial("id").primaryKey(),
  guildId: text("guild_id").notNull(),
  userId: text("user_id").notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  reason: text("reason"),
  issuedBy: text("issued_by").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type UserTimeout = typeof userTimeoutsTable.$inferSelect;

// ── Spawn Log ─────────────────────────────────────────────────────────────────
export const spawnLogTable = pgTable("spawn_log", {
  id: serial("id").primaryKey(),
  guildId: text("guild_id").notNull(),
  channelId: text("channel_id").notNull(),
  cardId: integer("card_id").notNull().references(() => cardsTable.id),
  caughtBy: text("caught_by"),
  isForced: boolean("is_forced").notNull().default(false),
  spawnedAt: timestamp("spawned_at").notNull().defaultNow(),
  caughtAt: timestamp("caught_at"),
});

export type SpawnLog = typeof spawnLogTable.$inferSelect;

// ── Wishlists ─────────────────────────────────────────────────────────────────
export const wishlistsTable = pgTable("wishlists", {
  id: serial("id").primaryKey(),
  guildId: text("guild_id").notNull(),
  userId: text("user_id").notNull(),
  cardId: integer("card_id").notNull().references(() => cardsTable.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => ({
  uniqUserCard: uniqueIndex("wishlists_guild_user_card_uniq").on(t.guildId, t.userId, t.cardId),
  byGuildCard: uniqueIndex("wishlists_guild_card_user_idx").on(t.guildId, t.cardId, t.userId),
}));

export type Wishlist = typeof wishlistsTable.$inferSelect;
