import {
  pgTable, text, serial, integer, timestamp, boolean, pgEnum,
  uniqueIndex, index,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// ─────────────────────────────────────────────────────────────────────────────
// AFK Secretary & Whitelist Access System — database schema
//
// Native Drizzle/Postgres translation of the requested "afkModels" spec. These
// tables live here (alongside the rest of the DN Cards schema) so that a single
// `pnpm --filter @workspace/db run push` provisions them, and so every table is
// re-exported through `@workspace/db` exactly like `userReputationTable` etc.
//
// Requested Mongoose shapes → Postgres equivalents:
//   GuildSettings      → afkGuildSettingsTable
//   WhitelistRegistry  → afkWhitelistTable
//   AFKState           → afkStateTable
//   SavedNotes         → afkSavedNotesTable
//   (+ afkNotifySubscribersTable — backs the "🔔 Notify Me" button)
// ─────────────────────────────────────────────────────────────────────────────

// How an AFK state is allowed to clear. Chosen by the user in the /afk set
// dashboard select menu:
//   RETURN → cleared when the user next sends a message (after the grace window)
//   STATUS → cleared via presenceUpdate (Offline/Idle → Online)
//   AUTO   → cleared by the timed sweeper once `autoRemoveAt` passes
export const afkRemovalMethodEnum = pgEnum("afk_removal_method", [
  "RETURN",
  "STATUS",
  "AUTO",
]);

// A whitelist entry can grant access to a single user or to everyone holding a
// role. Roles double as the "predefined Staff roles" from the spec.
export const afkTargetTypeEnum = pgEnum("afk_target_type", ["USER", "ROLE"]);

// ── GuildSettings ────────────────────────────────────────────────────────────
// Per-guild feature switches. One row per guild.
export const afkGuildSettingsTable = pgTable("afk_guild_settings", {
  id: serial("id").primaryKey(),
  guildId: text("guild_id").notNull().unique(),
  // Master switch for the whole Secretary intercept engine.
  secretaryEnabled: boolean("secretary_enabled").notNull().default(true),
  // Whether the bot prefixes "[AFK]" onto members' nicknames while away.
  nicknameChanges: boolean("nickname_changes").notNull().default(true),
  // Post the ping-intercept through a webhook wearing the away member's name +
  // avatar, so it reads as if they replied. Falls back to a normal bot message
  // when webhooks aren't available in the channel.
  speakAsUser: boolean("speak_as_user").notNull().default(false),
  // Cap on how many unread notes a single receiver may accumulate.
  maxSavedMessages: integer("max_saved_messages").notNull().default(25),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type AfkGuildSettings = typeof afkGuildSettingsTable.$inferSelect;

// ── WhitelistRegistry ────────────────────────────────────────────────────────
// Who is allowed to use /afk. `targetId` is a Discord user ID or role ID; the
// `type` column disambiguates. (guildId, targetId) is unique so re-adding is a
// no-op rather than a duplicate.
export const afkWhitelistTable = pgTable("afk_whitelist", {
  id: serial("id").primaryKey(),
  guildId: text("guild_id").notNull(),
  targetId: text("target_id").notNull(),
  type: afkTargetTypeEnum("type").notNull(),
  addedBy: text("added_by"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => ({
  uniqTarget: uniqueIndex("afk_whitelist_guild_target_uniq").on(t.guildId, t.targetId),
  byGuild: index("afk_whitelist_guild_idx").on(t.guildId),
}));

export type AfkWhitelistEntry = typeof afkWhitelistTable.$inferSelect;

// ── AFKState ─────────────────────────────────────────────────────────────────
// The live "I am away" record. At most one active row per (guild, user) — the
// unique index enforces it and makes upsert-on-set trivial. `startTime` anchors
// the 45-second return grace window; `originalNickname` is captured so the exact
// pre-AFK nickname can be restored on return.
export const afkStateTable = pgTable("afk_state", {
  id: serial("id").primaryKey(),
  guildId: text("guild_id").notNull(),
  userId: text("user_id").notNull(),
  reason: text("reason").notNull().default("AFK"),
  removalMethod: afkRemovalMethodEnum("removal_method").notNull().default("RETURN"),
  startTime: timestamp("start_time").notNull().defaultNow(),
  // Only set when removalMethod = AUTO. The sweeper clears rows past this time.
  autoRemoveAt: timestamp("auto_remove_at"),
  // Null when the member had no custom nickname (so we clear back to username).
  originalNickname: text("original_nickname"),
}, (t) => ({
  uniqActive: uniqueIndex("afk_state_guild_user_uniq").on(t.guildId, t.userId),
  byAuto: index("afk_state_auto_remove_idx").on(t.autoRemoveAt),
}));

export type AfkState = typeof afkStateTable.$inferSelect;

// ── SavedNotes ───────────────────────────────────────────────────────────────
// Notes left for an AFK user via the "📩 Leave a Note" button. Surfaced through
// `/afk messages`.
export const afkSavedNotesTable = pgTable("afk_saved_notes", {
  id: serial("id").primaryKey(),
  guildId: text("guild_id").notNull(),
  senderId: text("sender_id").notNull(),
  receiverId: text("receiver_id").notNull(),
  message: text("message").notNull(),
  isRead: boolean("is_read").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => ({
  byReceiver: index("afk_saved_notes_receiver_idx").on(t.guildId, t.receiverId, t.createdAt),
}));

export type AfkSavedNote = typeof afkSavedNotesTable.$inferSelect;

export const insertAfkNoteSchema = createInsertSchema(afkSavedNotesTable).omit({
  id: true, createdAt: true, isRead: true,
});
export type InsertAfkNote = z.infer<typeof insertAfkNoteSchema>;

// ── Notify subscribers ───────────────────────────────────────────────────────
// Backs the "🔔 Notify Me" button: people who want a DM the moment the AFK user
// returns. Cleared out whenever the AFK state is cleared (after the DMs fire).
export const afkNotifySubscribersTable = pgTable("afk_notify_subscribers", {
  id: serial("id").primaryKey(),
  guildId: text("guild_id").notNull(),
  // The member who is currently away.
  afkUserId: text("afk_user_id").notNull(),
  // The member who wants to be pinged when they come back.
  subscriberId: text("subscriber_id").notNull(),
  // Where the interest was expressed — included in the return DM for context.
  channelId: text("channel_id"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => ({
  uniqSub: uniqueIndex("afk_notify_guild_afk_sub_uniq").on(t.guildId, t.afkUserId, t.subscriberId),
  byAfkUser: index("afk_notify_afk_user_idx").on(t.guildId, t.afkUserId),
}));

export type AfkNotifySubscriber = typeof afkNotifySubscribersTable.$inferSelect;
