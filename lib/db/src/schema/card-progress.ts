import {
  pgTable, text, serial, integer, boolean, timestamp, uniqueIndex,
} from "drizzle-orm/pg-core";

// ─────────────────────────────────────────────────────────────────────────────
// DN Cards — Card leveling + cosmetic frames
//
// Per-user, per-card battle progression. A card the player fields in battles
// gains XP and levels up; leveling unlocks cosmetic FRAMES (a default frame per
// rarity plus a couple of extras) the player can equip to show off on the
// card's showcase. Purely cosmetic — leveling never changes battle stats, so it
// can't unbalance combat. One additive per-guild/per-user/per-card table.
// ─────────────────────────────────────────────────────────────────────────────

export const cardProgressTable = pgTable("card_progress", {
  id: serial("id").primaryKey(),
  guildId: text("guild_id").notNull(),
  userId: text("user_id").notNull(),
  cardId: integer("card_id").notNull(),
  xp: integer("xp").notNull().default(0),
  level: integer("level").notNull().default(1),
  battlesFought: integer("battles_fought").notNull().default(0),
  battlesWon: integer("battles_won").notNull().default(0),
  // Equipped frame id (see frames registry). Null = the rarity's default frame.
  equippedFrame: text("equipped_frame"),
  // Favorite/lock flag: locked cards are protected from `/burn` and bulk
  // trade-in so a prized copy can't be destroyed by a mass action.
  locked: boolean("locked").notNull().default(false),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => ({
  guildUserCardUniq: uniqueIndex("card_progress_guild_user_card_uniq").on(t.guildId, t.userId, t.cardId),
}));

export type CardProgress = typeof cardProgressTable.$inferSelect;
