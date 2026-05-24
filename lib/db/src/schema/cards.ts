import {
  pgTable, text, serial, integer, timestamp,
  boolean, real, pgEnum,
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
  worthValue: integer("worth_value").notNull().default(10),   // collector worth in DN Shards
  burnValue: integer("burn_value").notNull().default(5),      // shards gained on burn
  isLimitedEdition: boolean("is_limited_edition").notNull().default(false),
  isEventExclusive: boolean("is_event_exclusive").notNull().default(false),
  maxCopies: integer("max_copies"),                           // null = unlimited
  totalMinted: integer("total_minted").notNull().default(0),  // total caught globally
  imageUrl: text("image_url"),
  flavor: text("flavor"),                                     // lore/flavor text
  droppable: boolean("droppable").notNull().default(true),    // false = admin-only drops
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
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type UserCurrency = typeof userCurrencyTable.$inferSelect;

// ── Trades ────────────────────────────────────────────────────────────────────
export const tradesTable = pgTable("trades", {
  id: serial("id").primaryKey(),
  guildId: text("guild_id").notNull(),
  initiatorId: text("initiator_id").notNull(),
  targetId: text("target_id").notNull(),
  offeredCardId: integer("offered_card_id").notNull().references(() => cardsTable.id),
  requestedCardId: integer("requested_card_id").notNull().references(() => cardsTable.id),
  status: tradeStatusEnum("status").notNull().default("pending"),
  messageId: text("message_id"),    // Discord message to update
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
  tradeChannelId: text("trade_channel_id"),    // optional dedicated trade channel
  spawnIntervalSeconds: integer("spawn_interval_seconds").notNull().default(3600),
  spawnIntervalMin: integer("spawn_interval_min"),
  spawnIntervalMax: integer("spawn_interval_max"),
  useRandomInterval: boolean("use_random_interval").notNull().default(false),
  spawnEnabled: boolean("spawn_enabled").notNull().default(true),
  catchWindowSeconds: integer("catch_window_seconds").notNull().default(120),
  tradeEnabled: boolean("trade_enabled").notNull().default(true),
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
