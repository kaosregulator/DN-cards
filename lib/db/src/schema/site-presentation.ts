import { pgTable, serial, text, integer, timestamp, jsonb, uniqueIndex } from "drizzle-orm/pg-core";
import { z } from "zod/v4";
import { dashboardUsersTable } from "./cards";

/**
 * site_presentation — website cosmetics ONLY (guild-scoped).
 *
 * This table holds nothing about gameplay. It stores the admin-editable
 * presentation config (hero copy + media, splash toggle/timing, theme accent,
 * Discord invite, scheduled hero banners) as a single validated JSON blob per
 * guild. Discord and every game table are completely independent of it.
 *
 * Guild-scoped by design (`guildId` unique) so a second guild is a new row, not
 * a schema change — future multi-guild support with no rewrite.
 *
 * The website always falls back to hardcoded client defaults when a field is
 * absent, so a missing row / deleted asset can never blank the UI.
 */
export const sitePresentationTable = pgTable("site_presentation", {
  id: serial("id").primaryKey(),
  guildId: text("guild_id").notNull(),
  config: jsonb("config").notNull().default({}),
  updatedBy: integer("updated_by").references(() => dashboardUsersTable.id, { onDelete: "set null" }),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => ({
  guildUniq: uniqueIndex("site_presentation_guild_uniq").on(t.guildId),
}));

// ── Validation (shared by API routes) ────────────────────────────────────────
// Loose + partial: the admin can save any subset; the site merges over defaults.

const heroBannerSchema = z.object({
  id: z.string().min(1).max(64),
  label: z.string().max(120).optional().default(""),
  /** absolute URL or object-storage path (`/objects/...`). */
  imageSrc: z.string().max(2048),
  /** static poster/frame for reduced-motion + GIF freeze. */
  poster: z.string().max(2048).nullable().optional().default(null),
  enabled: z.boolean().optional().default(true),
  /** ISO datetimes bounding when this banner is live. null = unbounded. */
  startAt: z.string().datetime().nullable().optional().default(null),
  endAt: z.string().datetime().nullable().optional().default(null),
});
export type HeroBanner = z.infer<typeof heroBannerSchema>;

export const presentationConfigSchema = z.object({
  hero: z.object({
    eyebrow: z.string().max(120),
    title: z.string().max(160),
    subtitle: z.string().max(600),
    ctaLabel: z.string().max(60),
    ctaHref: z.string().max(300),
    secondaryCtaLabel: z.string().max(60),
    secondaryCtaHref: z.string().max(300),
  }).partial().optional(),
  heroBanners: z.array(heroBannerSchema).max(24).optional(),
  splash: z.object({
    enabled: z.boolean(),
    tierDurationMs: z.number().int().min(800).max(10000),
  }).partial().optional(),
  theme: z.object({
    /** HSL triplet WITHOUT hsl() wrapper, e.g. "25 100% 55%" — matches the CSS var. */
    primary: z.string().max(40),
  }).partial().optional(),
  discordInviteUrl: z.string().max(300).optional(),
}).strip();

export type PresentationConfigInput = z.infer<typeof presentationConfigSchema>;
export type SitePresentationRow = typeof sitePresentationTable.$inferSelect;
