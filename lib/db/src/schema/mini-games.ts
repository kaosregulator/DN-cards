import { pgTable, text, serial, integer, timestamp } from "drizzle-orm/pg-core";
import { cardsTable } from "./cards";

// ── Wild Mini-Game log ──────────────────────────────────────────────────────
// One row per mini-game encounter, written when the game resolves. Powers
// auditing/analytics ("how often do players win the Dice game?") and lets an
// admin see recent activity. Modeled on spawnLogTable.
export const miniGameLogTable = pgTable("mini_game_log", {
  id: serial("id").primaryKey(),
  guildId: text("guild_id").notNull(),
  channelId: text("channel_id").notNull(),
  userId: text("user_id").notNull(),
  cardId: integer("card_id").notNull().references(() => cardsTable.id),
  // Which game was played (e.g. "reaction", "dice", "aim", "code", "choose").
  gameKey: text("game_key").notNull(),
  // Resolution: "win" (card granted), "lose" (card escaped), or "timeout".
  result: text("result").notNull(),
  startedAt: timestamp("started_at").notNull().defaultNow(),
  resolvedAt: timestamp("resolved_at"),
});

export type MiniGameLog = typeof miniGameLogTable.$inferSelect;
