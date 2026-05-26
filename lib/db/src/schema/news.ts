import { pgTable, serial, text, boolean, timestamp, integer, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { dashboardUsersTable } from "./cards";

// ── News posts (website-only) ────────────────────────────────────────────────
// Public site reads `publishedAt IS NOT NULL`. Admin reads everything. Body
// is markdown (rendered client-side as plain text + line breaks for now —
// upgrade to a real renderer when needed). `pinned` floats a post to the top.
export const newsPostsTable = pgTable("news_posts", {
  id: serial("id").primaryKey(),
  slug: text("slug").notNull(),
  title: text("title").notNull(),
  bodyMd: text("body_md").notNull().default(""),
  imageUrl: text("image_url"),
  pinned: boolean("pinned").notNull().default(false),
  publishedAt: timestamp("published_at"),
  authorUserId: integer("author_user_id").references(() => dashboardUsersTable.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => ({
  slugUniq: uniqueIndex("news_posts_slug_uniq").on(t.slug),
}));

export const insertNewsPostSchema = createInsertSchema(newsPostsTable).omit({
  id: true, createdAt: true, updatedAt: true, authorUserId: true,
});
export const updateNewsPostSchema = insertNewsPostSchema.partial();
export type InsertNewsPost = z.infer<typeof insertNewsPostSchema>;
export type UpdateNewsPost = z.infer<typeof updateNewsPostSchema>;
export type NewsPost = typeof newsPostsTable.$inferSelect;
