import {
  pgTable, text, serial, integer, boolean, timestamp, jsonb, index, uniqueIndex,
} from "drizzle-orm/pg-core";

// ─────────────────────────────────────────────────────────────────────────────
// DN Cards — Giveaway System
//
// A dedicated, admin-run giveaway feature that is POWERED BY DN Cards but works
// like its own bot feature. Purely ADDITIVE: three self-contained per-guild
// tables. It never modifies the card, collection, currency, battle, raid, or
// Echo tables — it only READS their activity (through lightweight event hooks,
// exactly like the quests engine) to measure requirement progress, and it PAYS
// prizes through the existing economy (addShards / grantFreePack / catchCard).
//
//   giveaways          — one row per giveaway (prizes, requirements, timing).
//   giveaway_entries   — one row per (giveaway, user): progress + earned entries.
//   giveaway_winners   — selected winners + their claim state.
//
// Live giveaway messages are edited in place (like co-op raid embeds); nothing
// about the running UI needs extra persistence beyond these rows.
// ─────────────────────────────────────────────────────────────────────────────

// A single requirement a player can work toward inside a giveaway. `type` maps
// to a giveaway event (see giveaway/hooks.ts). Progress is measured from the
// moment the giveaway goes active. `entriesPerUnit` powers entry-based draws
// (e.g. +1 entry per card caught); `goal` powers completion gating and the
// progress bar. `rarityMin` narrows catch/burn requirements to a rarity floor.
export type GiveawayRequirement = {
  key: string;              // stable id, unique within the giveaway
  type: GiveawayReqType;    // catch | battle_win | battle_played | ...
  label: string;            // human text ("Catch 50 cards")
  emoji: string;
  goal: number;             // amount needed to fully complete this requirement
  rarityMin?: string;       // catch/burn: minimum rarity that counts
  entriesPerUnit?: number;  // entry-based: entries granted per unit of progress
  entriesOnComplete?: number; // flat entries granted once the goal is reached
};

export type GiveawayReqType =
  | "catch"          // cards caught (optionally rarity-gated)
  | "burn"           // cards burned
  | "pack_open"      // packs opened
  | "battle_win"     // battles won
  | "battle_played"  // battles played (valid, non-forfeit)
  | "raid_join"      // co-op raid boss fights joined
  | "raid_damage"    // total damage dealt in raids
  | "echo_use"       // Echo / Echo-Whisper activations
  | "message";       // real (non-bot, non-command) Discord messages

// A single prize inside a giveaway. DN Cards prizes are fulfilled automatically
// (cards / packs / shards); community prizes (nitro / role / custom) are either
// auto-applied (role) or handed off to admins with a claim receipt.
export type GiveawayPrize = {
  type: GiveawayPrizeType;
  label: string;            // display text, e.g. "10 Legendary Cards"
  emoji?: string;
  qty?: number;             // cards: copies; pack: count; shards: amount
  cardId?: number;          // card prize: the DN Cards card to grant
  cardName?: string;        // convenience label for a card prize
  packTier?: string;        // pack prize: basic | premium | legendary
  roleId?: string;          // role prize: role to assign on claim
};

export type GiveawayPrizeType =
  | "cards" | "pack" | "shards" | "nitro" | "role" | "custom";

export type GiveawayDifficulty = "easy" | "medium" | "hard" | "legendary";
export type GiveawayStatus = "draft" | "active" | "ended" | "cancelled";
export type GiveawayWinnerMode = "entry" | "completion";
export type GiveawayAnnounceMode = "channel" | "dm" | "both";

export const giveawaysTable = pgTable("giveaways", {
  id: serial("id").primaryKey(),
  guildId: text("guild_id").notNull(),
  channelId: text("channel_id"),
  messageId: text("message_id"),
  title: text("title").notNull(),
  description: text("description"),
  // Custom giveaway image (uploaded/hosted). Kept SEPARATE from any card art so
  // editing a giveaway's visuals never touches original card files/data. When
  // absent and the giveaway has a single card prize, the card's own art is used.
  imageUrl: text("image_url"),
  createdBy: text("created_by").notNull(),
  difficulty: text("difficulty").$type<GiveawayDifficulty>().notNull().default("medium"),
  status: text("status").$type<GiveawayStatus>().notNull().default("draft"),
  // How many winners are drawn.
  winnerCount: integer("winner_count").notNull().default(1),
  // entry     → weighted random draw by earned entries (more activity = more chances)
  // completion→ only players who completed EVERY requirement qualify (drawn evenly)
  winnerMode: text("winner_mode").$type<GiveawayWinnerMode>().notNull().default("entry"),
  requirements: jsonb("requirements").$type<GiveawayRequirement[]>().notNull().default([]),
  prizes: jsonb("prizes").$type<GiveawayPrize[]>().notNull().default([]),
  // Timing. startsAt = when it went active (progress counts from here).
  startsAt: timestamp("starts_at"),
  endsAt: timestamp("ends_at"),
  endedAt: timestamp("ended_at"),
  // Minutes a winner has to click Claim before an automatic reroll. 0 = never.
  claimTimerMinutes: integer("claim_timer_minutes").notNull().default(1440),
  announceMode: text("announce_mode").$type<GiveawayAnnounceMode>().notNull().default("channel"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => ({
  byGuildStatus: index("giveaways_guild_status_idx").on(t.guildId, t.status),
  byEndsAt: index("giveaways_ends_at_idx").on(t.status, t.endsAt),
}));

export type Giveaway = typeof giveawaysTable.$inferSelect;

// One row per (giveaway, user). `progress` maps requirement key → accumulated
// amount; `entries` is the cached total of earned entries; `completed` flips
// true once every requirement's goal is met.
export const giveawayEntriesTable = pgTable("giveaway_entries", {
  id: serial("id").primaryKey(),
  giveawayId: integer("giveaway_id").notNull().references(() => giveawaysTable.id, { onDelete: "cascade" }),
  guildId: text("guild_id").notNull(),
  userId: text("user_id").notNull(),
  progress: jsonb("progress").$type<Record<string, number>>().notNull().default({}),
  entries: integer("entries").notNull().default(0),
  completed: boolean("completed").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => ({
  uniq: uniqueIndex("giveaway_entries_giveaway_user_uniq").on(t.giveawayId, t.userId),
  byGiveaway: index("giveaway_entries_giveaway_idx").on(t.giveawayId),
}));

export type GiveawayEntry = typeof giveawayEntriesTable.$inferSelect;

export type GiveawayClaimStatus = "pending" | "claimed" | "expired" | "rerolled";

// One row per selected winner. Prizes are granted on claim (or auto on end for
// self-fulfilling prizes). Unclaimed winners past `claimDeadline` are rerolled.
export const giveawayWinnersTable = pgTable("giveaway_winners", {
  id: serial("id").primaryKey(),
  giveawayId: integer("giveaway_id").notNull().references(() => giveawaysTable.id, { onDelete: "cascade" }),
  guildId: text("guild_id").notNull(),
  userId: text("user_id").notNull(),
  claimStatus: text("claim_status").$type<GiveawayClaimStatus>().notNull().default("pending"),
  claimDeadline: timestamp("claim_deadline"),
  // Snapshot of the prizes awarded to this winner + a human receipt for the ones
  // an admin must hand-fulfil (nitro / custom). Kept per-winner so a reroll only
  // affects the vacated slot.
  prizes: jsonb("prizes").$type<GiveawayPrize[]>().notNull().default([]),
  wonAt: timestamp("won_at").notNull().defaultNow(),
  claimedAt: timestamp("claimed_at"),
}, (t) => ({
  byGiveaway: index("giveaway_winners_giveaway_idx").on(t.giveawayId),
  byStatus: index("giveaway_winners_status_idx").on(t.claimStatus, t.claimDeadline),
}));

export type GiveawayWinner = typeof giveawayWinnersTable.$inferSelect;
