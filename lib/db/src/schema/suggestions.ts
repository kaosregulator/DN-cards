import { pgTable, serial, text, boolean, timestamp, integer, pgEnum, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { dashboardUsersTable } from "./cards";

export const suggestionCategoryEnum = pgEnum("suggestion_category", [
  "bug_report",
  "card_correction",
  "card_suggestion",
  "event_suggestion",
  "website_feedback",
]);

export const suggestionStatusEnum = pgEnum("suggestion_status", [
  "new",
  "in_review",
  "planned",
  "resolved",
  "rejected",
  "duplicate",
]);

// ── Suggestions / bug reports ────────────────────────────────────────────────
// Submitted publicly (no auth). When `anonymous=true` the submitter's
// Discord identity is NEVER exposed to admins or the public — only the
// hashed IP is stored, and only for spam mitigation.
//
// `ipHash` is sha256(ip + SESSION_SECRET) — 64 hex chars. Indexed for the
// per-ip rate limiter and the 1-hour duplicate guard. Never returned by any
// public or admin API response.
export const suggestionsTable = pgTable("suggestions", {
  id: serial("id").primaryKey(),
  category: suggestionCategoryEnum("category").notNull(),
  title: text("title").notNull(),
  body: text("body").notNull(),
  anonymous: boolean("anonymous").notNull().default(true),
  submitterDiscordId: text("submitter_discord_id"),
  submitterDiscordUsername: text("submitter_discord_username"),
  ipHash: text("ip_hash").notNull(),
  status: suggestionStatusEnum("status").notNull().default("new"),
  adminNotes: text("admin_notes").notNull().default(""),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  resolvedAt: timestamp("resolved_at"),
  resolvedBy: integer("resolved_by").references(() => dashboardUsersTable.id, { onDelete: "set null" }),
}, (t) => ({
  byIp: index("suggestions_ip_hash_idx").on(t.ipHash, t.createdAt),
  byStatus: index("suggestions_status_idx").on(t.status, t.createdAt),
}));

export const insertSuggestionSchema = createInsertSchema(suggestionsTable).omit({
  id: true, createdAt: true, resolvedAt: true, resolvedBy: true,
  status: true, adminNotes: true, ipHash: true,
});
export type InsertSuggestion = z.infer<typeof insertSuggestionSchema>;
export type Suggestion = typeof suggestionsTable.$inferSelect;
