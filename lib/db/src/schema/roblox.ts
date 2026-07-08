import {
  pgTable, text, serial, integer, timestamp, boolean, uniqueIndex,
} from "drizzle-orm/pg-core";

// ── Roblox Account Links (GLOBAL — one Discord user ↔ one Roblox account) ─────
// This is deliberately NOT per-guild. A Discord user's Roblox identity is the
// same in every server, and keeping it global means per-server gameplay
// (collections, currency, trades) is never touched by the integration.
//
// `robloxUserId` is the numeric Roblox id stored as text. It is unique so two
// Discord users can't both claim the same Roblox account. The link is only
// written after profile-code verification succeeds (see roblox_verifications).
export const robloxLinksTable = pgTable("roblox_links", {
  discordUserId: text("discord_user_id").primaryKey(),
  robloxUserId: text("roblox_user_id").notNull(),
  robloxUsername: text("roblox_username").notNull(),
  robloxDisplayName: text("roblox_display_name"),
  verifiedAt: timestamp("verified_at").notNull().defaultNow(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => ({
  robloxUserUniq: uniqueIndex("roblox_links_roblox_user_uniq").on(t.robloxUserId),
}));

export type RobloxLink = typeof robloxLinksTable.$inferSelect;

// ── Pending Verifications (GLOBAL) ────────────────────────────────────────────
// When a user runs `/link start`, we resolve the Roblox username they claim to
// a Roblox userId, generate a random code, and store it here. `/link verify`
// then fetches that Roblox user's profile "About" blurb and checks the code is
// present. One pending row per Discord user (PK) — starting again overwrites.
export const robloxVerificationsTable = pgTable("roblox_verifications", {
  discordUserId: text("discord_user_id").primaryKey(),
  code: text("code").notNull(),
  robloxUserId: text("roblox_user_id").notNull(),
  robloxUsername: text("roblox_username").notNull(),
  robloxDisplayName: text("roblox_display_name"),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type RobloxVerification = typeof robloxVerificationsTable.$inferSelect;

// ── Per-Guild Roblox Perk Config ──────────────────────────────────────────────
// Admins opt each server into Roblox perks. Nothing fires unless `enabled`.
// - groupId: optional Roblox group; the bot reads the linked user's rank in it
//   and shows it on `/link status` (and can gate the bonus in a later pass).
// - verifiedRoleId: Discord role granted to a member when their link verifies.
// - linkBonusShards: one-time DN Shards awarded the first time a member's link
//   is active in THIS guild (tracked in roblox_reward_grants so re-verifying
//   can't farm it).
export const robloxGuildSettingsTable = pgTable("roblox_guild_settings", {
  guildId: text("guild_id").primaryKey(),
  enabled: boolean("enabled").notNull().default(false),
  groupId: text("group_id"),
  verifiedRoleId: text("verified_role_id"),
  linkBonusShards: integer("link_bonus_shards").notNull().default(0),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
  updatedBy: text("updated_by"),
});

export type RobloxGuildSettings = typeof robloxGuildSettingsTable.$inferSelect;

// ── Per-Guild Reward Grants (idempotency for the one-time link bonus) ─────────
// One row per (guildId, discordUserId) once the link bonus has been paid in
// that guild. Prevents unlink/relink or re-verify from re-awarding shards.
export const robloxRewardGrantsTable = pgTable("roblox_reward_grants", {
  id: serial("id").primaryKey(),
  guildId: text("guild_id").notNull(),
  discordUserId: text("discord_user_id").notNull(),
  bonusShards: integer("bonus_shards").notNull().default(0),
  grantedAt: timestamp("granted_at").notNull().defaultNow(),
}, (t) => ({
  guildUserUniq: uniqueIndex("roblox_reward_grants_guild_user_uniq")
    .on(t.guildId, t.discordUserId),
}));

export type RobloxRewardGrant = typeof robloxRewardGrantsTable.$inferSelect;
