import {
  pgTable, text, serial, integer, timestamp, boolean, jsonb,
  uniqueIndex, index,
} from "drizzle-orm/pg-core";

// ─────────────────────────────────────────────────────────────────────────────
// Quiet Mode / Quiet Room — database schema
//
// Addon tables for the optional Quiet Room experience. State is persisted so a
// bot restart never permanently locks a member out of the server. Isolation uses
// a Quiet quarantine role (empty-server) plus Quiet Room allows.
// ─────────────────────────────────────────────────────────────────────────────

/** Per-guild Quiet Mode settings. One row per guild. */
export const quietGuildSettingsTable = pgTable("quiet_guild_settings", {
  id: serial("id").primaryKey(),
  guildId: text("guild_id").notNull().unique(),
  enabled: boolean("enabled").notNull().default(true),
  /** Shared Quiet Room text channel (created/ensured by the bot). */
  quietChannelId: text("quiet_channel_id"),
  /** Optional parent category for the Quiet Room. */
  quietCategoryId: text("quiet_category_id"),
  /** Quarantine role — View denied everywhere except Quiet Room. */
  quietRoleId: text("quiet_role_id"),
  /**
   * If set, only members holding this role may self-enter Quiet Mode.
   * Admins/staff can always place others (and themselves) into Quiet Mode.
   */
  whitelistRoleId: text("whitelist_role_id"),
  /** Members holding this role cannot self-enter Quiet Mode. */
  blacklistRoleId: text("blacklist_role_id"),
  /** Whether to send prepared Quiet Room audio / voice notes. */
  audioEnabled: boolean("audio_enabled").notNull().default(true),
  /**
   * Renameable sanctuary modes (quiet / vacation / loa / step_away / custom).
   * JSON array of { key, label, roleName, channelName, topic, intro, enabled, roleId, channelId }.
   */
  sanctuaryModes: jsonb("sanctuary_modes").$type<unknown[]>().notNull().default([]),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type QuietGuildSettings = typeof quietGuildSettingsTable.$inferSelect;

/**
 * Live Quiet Mode state. At most one active row per (guild, user).
 * `overwriteTargets` lists channel/category IDs touched for cleanup on exit
 * (member fallbacks / room allows). Quarantine is primarily the Quiet role.
 */
export const quietStateTable = pgTable("quiet_state", {
  id: serial("id").primaryKey(),
  guildId: text("guild_id").notNull(),
  userId: text("user_id").notNull(),
  enteredAt: timestamp("entered_at").notNull().defaultNow(),
  /** Discord user id who initiated Quiet Mode (self or staff). */
  enteredBy: text("entered_by").notNull(),
  /** Optional theme key when staff places someone (or self-picks). */
  theme: text("theme"),
  /** Sanctuary mode key: quiet | vacation | loa | step_away | custom… */
  modeKey: text("mode_key").notNull().default("quiet"),
  /** Quarantine role assigned for this session (mode-specific). */
  quarantineRoleId: text("quarantine_role_id"),
  quoteId: text("quote_id"),
  quoteText: text("quote_text"),
  audioId: text("audio_id"),
  /** Channel the member was interacting from — used for welcome-back. */
  lastChannelId: text("last_channel_id"),
  /** Quiet Room message IDs owned by this session (cleanup on exit). */
  roomMessageIds: jsonb("room_message_ids").$type<string[]>().notNull().default([]),
  /** Channel/category IDs we touched with member overwrites. */
  overwriteTargets: jsonb("overwrite_targets").$type<string[]>().notNull().default([]),
  /** True if enter partially failed — recovery tries to finish or unwind. */
  needsRecovery: boolean("needs_recovery").notNull().default(false),
  /** Administrator bypass note — Discord Admin cannot be channel-hidden. */
  adminBypass: boolean("admin_bypass").notNull().default(false),
}, (t) => ({
  uniqActive: uniqueIndex("quiet_state_guild_user_uniq").on(t.guildId, t.userId),
  byGuild: index("quiet_state_guild_idx").on(t.guildId),
  byRecovery: index("quiet_state_recovery_idx").on(t.needsRecovery),
}));

export type QuietState = typeof quietStateTable.$inferSelect;

/**
 * Soft preference memory so the same user does not get the identical
 * audio/quote too often across Quiet Mode sessions.
 */
export const quietUserPrefsTable = pgTable("quiet_user_prefs", {
  id: serial("id").primaryKey(),
  guildId: text("guild_id").notNull(),
  userId: text("user_id").notNull(),
  recentAudioIds: jsonb("recent_audio_ids").$type<string[]>().notNull().default([]),
  recentQuoteIds: jsonb("recent_quote_ids").$type<string[]>().notNull().default([]),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => ({
  uniqUser: uniqueIndex("quiet_user_prefs_guild_user_uniq").on(t.guildId, t.userId),
}));

export type QuietUserPrefs = typeof quietUserPrefsTable.$inferSelect;

/** Optional admin-managed enable flags for built-in audio catalog entries. */
export const quietAudioConfigTable = pgTable("quiet_audio_config", {
  id: serial("id").primaryKey(),
  audioId: text("audio_id").notNull().unique(),
  enabled: boolean("enabled").notNull().default(true),
  /** Soft priority boost (higher = more likely). */
  weight: integer("weight").notNull().default(1),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type QuietAudioConfig = typeof quietAudioConfigTable.$inferSelect;
