import {
  pgTable, text, serial, integer, boolean, timestamp, jsonb, index, uniqueIndex,
} from "drizzle-orm/pg-core";

// ─────────────────────────────────────────────────────────────────────────────
// UnbelievaBoat addon — local control plane for the UnbelievaBoat economy API.
//
// This does NOT replace DN Cards shards / Bob / market. It stores:
//   • per-guild hub settings (which Discord guild maps to which UB economy)
//   • role ↔ economy links (Discord roles we manage + optional UB store items)
//   • local store catalog extras (things we author here and can push to UB)
//   • audit log for balance edits made from our admin hub
//
// The UB API token itself stays in env (`UNBELIEVABOAT_TOKEN`) — never in DB.
// ─────────────────────────────────────────────────────────────────────────────

export const ubSettingsTable = pgTable("ub_settings", {
  id: serial("id").primaryKey(),
  guildId: text("guild_id").notNull().unique(),
  // Discord guild snowflake whose UnbelievaBoat economy we control. Usually
  // the same as guildId; kept separate so one DN install can point at a
  // different UB guild if needed.
  ubGuildId: text("ub_guild_id").notNull(),
  enabled: boolean("enabled").notNull().default(true),
  // Default leaderboard sort for the dashboard: cash | bank | total
  leaderboardSort: text("leaderboard_sort").notNull().default("total"),
  // When true, pet shop purchases deduct UB cash via the API.
  petsSpendUb: boolean("pets_spend_ub").notNull().default(true),
  // Optional currency symbol override (falls back to UnbelievaBoat guild.symbol).
  currencyLabel: text("currency_label"),
  // Mini-games + Cash Check-In + role storefront (Discord addon).
  gamesEnabled: boolean("games_enabled").notNull().default(true),
  storeEnabled: boolean("store_enabled").notNull().default(true),
  dailyMin: integer("daily_min").notNull().default(100),
  dailyMax: integer("daily_max").notNull().default(250),
  // Income + gambling cooldowns (UnbelievaBoat API does not expose theirs).
  cooldowns: jsonb("cooldowns").$type<Record<string, number>>().notNull().default({}),
  // Discord log channel for economy / casino events (universal logger also checks guild bot_log).
  logChannelId: text("log_channel_id"),
  // Roles that cannot be robbed (Discord role snowflakes).
  robImmuneRoleIds: jsonb("rob_immune_role_ids").$type<string[]>().notNull().default([]),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type UbSettings = typeof ubSettingsTable.$inferSelect;

/** Discord role linked into the UnbelievaBoat economy (store / rewards). */
export const ubRoleLinksTable = pgTable("ub_role_links", {
  id: serial("id").primaryKey(),
  guildId: text("guild_id").notNull(),
  // Discord role snowflake (nullable until linked).
  discordRoleId: text("discord_role_id"),
  name: text("name").notNull(),
  description: text("description"),
  // Optional UnbelievaBoat store item this role is tied to.
  ubItemId: text("ub_item_id"),
  // Suggested cash price when creating / syncing a store item.
  price: integer("price").notNull().default(0),
  // When purchased/assigned: also grant this much UB cash (0 = none).
  grantCash: integer("grant_cash").notNull().default(0),
  // Recurring role income claimed via /casino collect (UnbelievaBoat-style).
  incomeAmount: integer("income_amount").notNull().default(0),
  // Soft category for the hub UI (vip, perk, cosmetic, custom, …).
  category: text("category").notNull().default("custom"),
  emoji: text("emoji"),
  enabled: boolean("enabled").notNull().default(true),
  // Free-form metadata (requirements notes, sync flags, robImmune, …).
  meta: jsonb("meta").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => [
  index("ub_role_links_guild_idx").on(t.guildId),
  uniqueIndex("ub_role_links_guild_role_uidx").on(t.guildId, t.discordRoleId),
]);

export type UbRoleLink = typeof ubRoleLinksTable.$inferSelect;

/**
 * Local store catalog — items we author on our side and can push / link to
 * UnbelievaBoat's guild store. Lets admins draft economy goods here even before
 * the UB token is plugged in on Railway.
 */
export const ubStoreCatalogTable = pgTable("ub_store_catalog", {
  id: serial("id").primaryKey(),
  guildId: text("guild_id").notNull(),
  name: text("name").notNull(),
  description: text("description"),
  price: integer("price").notNull().default(0),
  emoji: text("emoji"),
  category: text("category").notNull().default("general"),
  // Linked UnbelievaBoat item id once synced.
  ubItemId: text("ub_item_id"),
  // Optional Discord role granted on purchase (our side bookkeeping + sync action).
  grantRoleId: text("grant_role_id"),
  isInventory: boolean("is_inventory").notNull().default(true),
  isUsable: boolean("is_usable").notNull().default(true),
  isSellable: boolean("is_sellable").notNull().default(true),
  unlimitedStock: boolean("unlimited_stock").notNull().default(true),
  stockRemaining: integer("stock_remaining"),
  listed: boolean("listed").notNull().default(true),
  // Pet-shop flag — surfaced in /pet shop when true.
  forPets: boolean("for_pets").notNull().default(false),
  // Pet item effect key (food, soap, toy, medicine, egg_boost, …).
  petEffect: text("pet_effect"),
  petEffectValue: integer("pet_effect_value").notNull().default(0),
  meta: jsonb("meta").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => [
  index("ub_store_catalog_guild_idx").on(t.guildId),
  index("ub_store_catalog_ub_item_idx").on(t.ubItemId),
]);

export type UbStoreCatalog = typeof ubStoreCatalogTable.$inferSelect;

export const ubAuditLogTable = pgTable("ub_audit_log", {
  id: serial("id").primaryKey(),
  guildId: text("guild_id").notNull(),
  actorId: text("actor_id").notNull(),
  targetUserId: text("target_user_id"),
  action: text("action").notNull(), // balance_patch | balance_set | store_create | role_link | …
  detail: jsonb("detail").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => [
  index("ub_audit_log_guild_idx").on(t.guildId),
]);

export type UbAuditLog = typeof ubAuditLogTable.$inferSelect;

/**
 * Per-player UnbelievaBoat mini-game cooldowns (daily check-in, rob, beg, …).
 * Does not store balances — those live on UnbelievaBoat's API.
 */
export const ubGameStateTable = pgTable("ub_game_state", {
  id: serial("id").primaryKey(),
  guildId: text("guild_id").notNull(),
  userId: text("user_id").notNull(),
  lastDailyAt: timestamp("last_daily_at"),
  lastRobAt: timestamp("last_rob_at"),
  lastBegAt: timestamp("last_beg_at"),
  lastWorkAt: timestamp("last_work_at"),
  lastCrimeAt: timestamp("last_crime_at"),
  lastRouletteAt: timestamp("last_roulette_at"),
  lastBlackjackAt: timestamp("last_blackjack_at"),
  lastRussianAt: timestamp("last_russian_at"),
  lastCollectAt: timestamp("last_collect_at"),
  dailyStreak: integer("daily_streak").notNull().default(0),
  meta: jsonb("meta").$type<Record<string, unknown>>().notNull().default({}),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => [
  uniqueIndex("ub_game_state_guild_user_uidx").on(t.guildId, t.userId),
  index("ub_game_state_guild_idx").on(t.guildId),
]);

export type UbGameState = typeof ubGameStateTable.$inferSelect;
