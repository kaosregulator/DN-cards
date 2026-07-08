import {
  pgTable, text, integer, timestamp, boolean,
} from "drizzle-orm/pg-core";

// ── Server Stats (global server-vs-server leaderboard) ────────────────────────
// ONE row per guild. This backs the single GLOBAL leaderboard that ranks whole
// servers against each other — NOT individual players. No per-user card /
// rarity / image data ever leaves a server; only coarse server-level totals
// are compared.
//
// Design: the money-ish metrics (total shards, packs opened, trades completed)
// are aggregated LIVE from the existing per-guild tables (user_currency,
// trades) at read time, so they're always correct and need no syncing. This
// table stores only:
//   - guildName: a display-name cache so other servers can be named on the
//     board even if the bot can't see them in its client cache right now.
//   - battlesWon: the running count of duels won in the guild — battles have
//     no source table of their own, so the battling feature increments this.
//   - optOut: an admin switch to hide this server from the global board.
export const serverStatsTable = pgTable("server_stats", {
  guildId: text("guild_id").primaryKey(),
  guildName: text("guild_name"),
  battlesWon: integer("battles_won").notNull().default(0),
  optOut: boolean("opt_out").notNull().default(false),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type ServerStats = typeof serverStatsTable.$inferSelect;
