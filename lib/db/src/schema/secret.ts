import {
  pgTable, text, serial, boolean, jsonb, timestamp, uniqueIndex, index,
} from "drizzle-orm/pg-core";

// ─────────────────────────────────────────────────────────────────────────────
// Echo-Whisper — encrypted-messaging addon (ported from the standalone
// secret-bot). Members can send encrypted whispers to each other and staff can
// post role-gated "admin secret" messages. Payloads are AES-256-CBC encrypted;
// only a short transmission code is shown publicly.
//
// This is PURELY ADDITIVE. It touches no existing card/economy tables — it only
// adds its own per-guild tables. The original bot stored roles/settings/
// transmissions in JSON files on disk; here we use the shared database so data
// survives restarts and stays per-guild isolated.
// ─────────────────────────────────────────────────────────────────────────────

// ── Encrypted transmissions ──────────────────────────────────────────────────
// One row per posted whisper / admin-secret. The public message shows only the
// short `code` (e.g. WSP-1A2B); the encrypted payload lives here and is only
// decrypted server-side for authorized viewers.
export const secretTransmissionsTable = pgTable("secret_transmissions", {
  id: serial("id").primaryKey(),
  guildId: text("guild_id").notNull(),
  // Short human-visible code stamped into the public message (unique per guild).
  code: text("code").notNull(),
  // Base64 AES-256-CBC ciphertext (iv prefixed).
  payload: text("payload").notNull(),
  type: text("type").notNull(), // "whisper" | "adminsecret"
  senderId: text("sender_id").notNull(),
  receiverId: text("receiver_id"), // whispers only
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => ({
  guildCodeUniq: uniqueIndex("secret_tx_guild_code_uniq").on(t.guildId, t.code),
  byGuild: index("secret_tx_guild_idx").on(t.guildId, t.createdAt),
}));

export type SecretTransmission = typeof secretTransmissionsTable.$inferSelect;

// ── Per-guild secret settings ────────────────────────────────────────────────
// adminOverride: when true, server admins can decrypt any whisper/adminsecret.
// viewerRoleIds: roles allowed to reveal /adminsecret messages.
export const secretSettingsTable = pgTable("secret_settings", {
  id: serial("id").primaryKey(),
  guildId: text("guild_id").notNull().unique(),
  adminOverride: boolean("admin_override").notNull().default(true),
  viewerRoleIds: jsonb("viewer_role_ids").$type<string[]>().notNull().default([]),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type SecretSettings = typeof secretSettingsTable.$inferSelect;
