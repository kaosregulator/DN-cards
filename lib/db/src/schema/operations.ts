import {
  pgTable, text, serial, integer, boolean, timestamp, jsonb, index, uniqueIndex,
} from "drizzle-orm/pg-core";

// ─────────────────────────────────────────────────────────────────────────────
// DN Cards — Operations Center
//
// A live-operations broadcast system for Discord communities.
// Each operation type owns ONE permanent embed that is edited in place.
// Never spams new embeds; never floods channels.
//
// Tables:
//   ops_guild_config   — one row per guild: channel, staff role, enabled flag.
//   ops_type_config    — per-guild overrides for each op type (name, color, etc).
//   ops_boards         — permanent embed message IDs (one per guild+op_key).
//   ops_active         — current live operation per guild+op_key.
//   ops_queue          — requests waiting while an op is already active.
//   ops_responders     — users who have joined the current active op.
//   ops_history        — completed ops for statistics.
// ─────────────────────────────────────────────────────────────────────────────

// The six built-in backend op keys. These NEVER change — admins only rename
// the display label, never the key.
export type OpKey =
  | "staff_request"
  | "combat_support"
  | "base_defense"
  | "convoy_escort"
  | "event_support"
  | "custom";

export type OpStatus = "inactive" | "active" | "completed" | "cancelled";

// A configurable channel-jump or URL button shown on the board embed.
export type OpChannelButton = {
  label: string;           // Button label text (max 80 chars)
  style: "primary" | "secondary" | "success" | "danger" | "link";
  action: "url" | "none";  // "url" opens a URL; "none" is a disabled label
  url?: string;            // Used when action = "url"
  emoji?: string;          // Optional emoji prefix (unicode only)
  activeOnly?: boolean;    // Only show when op is active
};

// ── Guild-level config ────────────────────────────────────────────────────────
export const opsGuildConfigTable = pgTable("ops_guild_config", {
  id: serial("id").primaryKey(),
  guildId: text("guild_id").notNull().unique(),
  enabled: boolean("enabled").notNull().default(false),
  opsChannelId: text("ops_channel_id"),          // Where boards are posted
  staffRoleId: text("staff_role_id"),            // Role pinged on new requests
  categoryId: text("category_id"),               // Optional Discord category
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type OpsGuildConfig = typeof opsGuildConfigTable.$inferSelect;

// ── Per-op-type customization ─────────────────────────────────────────────────
export const opsTypeConfigTable = pgTable("ops_type_config", {
  id: serial("id").primaryKey(),
  guildId: text("guild_id").notNull(),
  opKey: text("op_key").$type<OpKey>().notNull(),
  enabled: boolean("enabled").notNull().default(true),
  displayName: text("display_name"),             // Override the default label
  description: text("description"),             // Board embed description
  color: text("color"),                         // Hex color e.g. "#FF5722"
  thumbnailUrl: text("thumbnail_url"),
  bannerUrl: text("banner_url"),
  footerText: text("footer_text"),
  timeoutMinutes: integer("timeout_minutes").notNull().default(60),
  autoComplete: boolean("auto_complete").notNull().default(true),
  requiredResponders: integer("required_responders").notNull().default(1),
  maxQueueSize: integer("max_queue_size").notNull().default(5),
  channelButtons: jsonb("channel_buttons").$type<OpChannelButton[]>().notNull().default([]),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => ({
  uniq: uniqueIndex("ops_type_config_guild_key_uniq").on(t.guildId, t.opKey),
  byGuild: index("ops_type_config_guild_idx").on(t.guildId),
}));

export type OpsTypeConfig = typeof opsTypeConfigTable.$inferSelect;

// ── Permanent board embed message ─────────────────────────────────────────────
export const opsBoardsTable = pgTable("ops_boards", {
  id: serial("id").primaryKey(),
  guildId: text("guild_id").notNull(),
  opKey: text("op_key").$type<OpKey>().notNull(),
  channelId: text("channel_id").notNull(),
  messageId: text("message_id").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => ({
  uniq: uniqueIndex("ops_boards_guild_key_uniq").on(t.guildId, t.opKey),
  byGuild: index("ops_boards_guild_idx").on(t.guildId),
}));

export type OpsBoard = typeof opsBoardsTable.$inferSelect;

// ── Active operation ──────────────────────────────────────────────────────────
export const opsActiveTable = pgTable("ops_active", {
  id: serial("id").primaryKey(),
  guildId: text("guild_id").notNull(),
  opKey: text("op_key").$type<OpKey>().notNull(),
  status: text("status").$type<OpStatus>().notNull().default("inactive"),
  commanderId: text("commander_id"),             // userId who submitted
  objective: text("objective"),
  robloxLink: text("roblox_link"),
  respondersNeeded: integer("responders_needed").notNull().default(1),
  notes: text("notes"),                          // Admin notes shown on board
  startedAt: timestamp("started_at"),
  completedAt: timestamp("completed_at"),
  autoCompleteAt: timestamp("auto_complete_at"), // When it should auto-timeout
}, (t) => ({
  uniq: uniqueIndex("ops_active_guild_key_uniq").on(t.guildId, t.opKey),
  byGuild: index("ops_active_guild_idx").on(t.guildId),
  byStatus: index("ops_active_status_idx").on(t.status, t.autoCompleteAt),
}));

export type OpsActive = typeof opsActiveTable.$inferSelect;

// ── Queue ─────────────────────────────────────────────────────────────────────
export const opsQueueTable = pgTable("ops_queue", {
  id: serial("id").primaryKey(),
  guildId: text("guild_id").notNull(),
  opKey: text("op_key").$type<OpKey>().notNull(),
  requesterId: text("requester_id").notNull(),
  objective: text("objective"),
  robloxLink: text("roblox_link"),
  respondersNeeded: integer("responders_needed").notNull().default(1),
  queuedAt: timestamp("queued_at").notNull().defaultNow(),
}, (t) => ({
  byGuildKey: index("ops_queue_guild_key_idx").on(t.guildId, t.opKey),
}));

export type OpsQueue = typeof opsQueueTable.$inferSelect;

// ── Responders ────────────────────────────────────────────────────────────────
export const opsRespondersTable = pgTable("ops_responders", {
  id: serial("id").primaryKey(),
  activeOpId: integer("active_op_id").notNull(),
  guildId: text("guild_id").notNull(),
  opKey: text("op_key").$type<OpKey>().notNull(),
  userId: text("user_id").notNull(),
  joinedAt: timestamp("joined_at").notNull().defaultNow(),
}, (t) => ({
  uniq: uniqueIndex("ops_responders_op_user_uniq").on(t.activeOpId, t.userId),
  byActiveOp: index("ops_responders_active_idx").on(t.activeOpId),
}));

export type OpsResponder = typeof opsRespondersTable.$inferSelect;

// ── History (for stats) ───────────────────────────────────────────────────────
export const opsHistoryTable = pgTable("ops_history", {
  id: serial("id").primaryKey(),
  guildId: text("guild_id").notNull(),
  opKey: text("op_key").$type<OpKey>().notNull(),
  commanderId: text("commander_id"),
  objective: text("objective"),
  responderCount: integer("responder_count").notNull().default(0),
  respondersNeeded: integer("responders_needed").notNull().default(1),
  startedAt: timestamp("started_at"),
  completedAt: timestamp("completed_at").notNull().defaultNow(),
  responseTimeSeconds: integer("response_time_seconds"),
  outcome: text("outcome").$type<"completed" | "cancelled" | "timeout">().notNull().default("completed"),
}, (t) => ({
  byGuild: index("ops_history_guild_idx").on(t.guildId),
  byGuildKey: index("ops_history_guild_key_idx").on(t.guildId, t.opKey),
}));

export type OpsHistory = typeof opsHistoryTable.$inferSelect;
