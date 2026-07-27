import {
  pgTable, text, serial, integer, boolean, timestamp, uniqueIndex,
} from "drizzle-orm/pg-core";

// ─────────────────────────────────────────────────────────────────────────────
// DN Cards — Variable card acquisition progression (Star Rank + Level on drop)
//
// These tables let admins decide the Star Rank (0–5) and Level (1–100) a card
// arrives with when it is caught from a spawn, pulled from a pack, or dropped.
// They are PURELY ADDITIVE and read defensively by the bot: when a guild has no
// config row (the default), acquisition behaves exactly as before — every card
// arrives at 0★ / Level 1 — so existing gameplay is unchanged until an admin
// opts in.
//
//   • card_acquisition_config    — per-guild default ranges, one row per source.
//   • card_acquisition_overrides — per-card overrides ("the hub"), highest
//                                   priority, so a specific card can always
//                                   arrive maxed / half-levelled regardless of
//                                   the guild default.
//
// The shared progression service (bot/cards/progression.ts) rolls a concrete
// {starRank, level} from whichever config wins and applies it through the SAME
// card_progress row that battles, raids and fusion already read — so a card
// that spawns pre-levelled is instantly battle-ready with no separate stat path.
// ─────────────────────────────────────────────────────────────────────────────

// Acquisition sources a config row can target. "*" (stored literally) means the
// row applies to every source unless a more specific row exists.
export const ACQUISITION_SOURCES = ["spawn", "pack", "drop"] as const;
export type AcquisitionSource = (typeof ACQUISITION_SOURCES)[number];

export const cardAcquisitionConfigTable = pgTable("card_acquisition_config", {
  id: serial("id").primaryKey(),
  guildId: text("guild_id").notNull(),
  // "spawn" | "pack" | "drop" | "*" (fallback for all sources).
  source: text("source").notNull().default("*"),
  // Master switch. When false (or no row), the source grants 0★ / Lv 1.
  enabled: boolean("enabled").notNull().default(false),
  // Inclusive Star Rank roll range (0–5). min===max ⇒ fixed value.
  starMin: integer("star_min").notNull().default(0),
  starMax: integer("star_max").notNull().default(0),
  // Inclusive Level roll range (1–100). min===max ⇒ fixed value.
  levelMin: integer("level_min").notNull().default(1),
  levelMax: integer("level_max").notNull().default(1),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
  updatedBy: text("updated_by"),
}, (t) => ({
  guildSourceUniq: uniqueIndex("card_acquisition_config_guild_source_uniq").on(t.guildId, t.source),
}));

export type CardAcquisitionConfig = typeof cardAcquisitionConfigTable.$inferSelect;

// Per-card override hub. A row here wins over the guild default for that card.
// `source` scopes the override to one acquisition source, or "*" for all.
export const cardAcquisitionOverridesTable = pgTable("card_acquisition_overrides", {
  id: serial("id").primaryKey(),
  guildId: text("guild_id").notNull(),
  cardId: integer("card_id").notNull(),
  source: text("source").notNull().default("*"),
  enabled: boolean("enabled").notNull().default(true),
  starMin: integer("star_min").notNull().default(0),
  starMax: integer("star_max").notNull().default(0),
  levelMin: integer("level_min").notNull().default(1),
  levelMax: integer("level_max").notNull().default(1),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
  updatedBy: text("updated_by"),
}, (t) => ({
  guildCardSourceUniq: uniqueIndex("card_acquisition_overrides_guild_card_source_uniq")
    .on(t.guildId, t.cardId, t.source),
}));

export type CardAcquisitionOverride = typeof cardAcquisitionOverridesTable.$inferSelect;
