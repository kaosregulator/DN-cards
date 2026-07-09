import {
  pgTable, text, serial, jsonb, timestamp, uniqueIndex,
} from "drizzle-orm/pg-core";

// ─────────────────────────────────────────────────────────────────────────────
// DN Cards — Quests / Missions (retention loop layered onto /cards daily)
//
// Daily + weekly objectives that span the whole game (catch cards, open packs,
// complete trades, win battles, burn duplicates, claim daily). Purely additive:
// one per-guild/per-user/per-period table. Progress is tracked by fire-and-
// forget event hooks in the catch/pack/trade/battle/burn flows; rewards are
// granted through the existing shard economy + free-pack path.
// ─────────────────────────────────────────────────────────────────────────────

// A single objective inside a period's quest set.
export type Quest = {
  key: string;                 // stable template id (e.g. "catch5", "packs2")
  label: string;               // human text
  emoji: string;
  type: string;                // event type: catch | pack_open | trade | battle_win | burn | daily
  rarityMin?: string;          // for catch quests — minimum rarity that counts
  goal: number;
  progress: number;
  rewardShards: number;
  rewardPackTier?: string;     // optional free pack tier granted on completion
  done: boolean;               // goal reached AND reward granted
};

export const questProgressTable = pgTable("quest_progress", {
  id: serial("id").primaryKey(),
  guildId: text("guild_id").notNull(),
  userId: text("user_id").notNull(),
  period: text("period").notNull(),      // "daily" | "weekly"
  periodKey: text("period_key").notNull(), // daily: YYYY-MM-DD (UTC); weekly: YYYY-Www
  quests: jsonb("quests").$type<Quest[]>().notNull().default([]),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => ({
  uniq: uniqueIndex("quest_progress_guild_user_period_uniq").on(t.guildId, t.userId, t.period, t.periodKey),
}));

export type QuestProgress = typeof questProgressTable.$inferSelect;
