import {
  pgTable, text, serial, integer, boolean, timestamp, jsonb, index, uniqueIndex,
} from "drizzle-orm/pg-core";

// ─────────────────────────────────────────────────────────────────────────────
// Bob — the interactive Discord entertainment NPC.
//
// Bob is a SEPARATE, self-contained fun module. It has its OWN currency (Bob
// Coins), XP, stats, tasks, and quests — it never touches the DN Cards card,
// collection, currency, battle, raid, or giveaway tables. (Admins can OPT IN to
// letting rare Bob events pay real DN Cards rewards; that reuses the existing
// grant paths and is the only point of contact.)
//
// Three per-guild tables:
//   bob_settings  — per-guild config (toggles, odds, cooldowns, channels).
//   bob_profiles  — per-(guild,user) coins/xp/stats + short talk memory.
//   bob_progress  — per-(guild,user) daily tasks and long-term quests.
// Live games (roulette, duels, mini-games, channel events) run in memory.
// ─────────────────────────────────────────────────────────────────────────────

// ── Settings ─────────────────────────────────────────────────────────────────
export const bobSettingsTable = pgTable("bob_settings", {
  id: serial("id").primaryKey(),
  guildId: text("guild_id").notNull().unique(),
  enabled: boolean("enabled").notNull().default(true),
  // Per-game on/off (key → enabled). Missing key = enabled.
  gamesEnabled: jsonb("games_enabled").$type<Record<string, boolean>>().notNull().default({}),
  // Bob's alternate forms — appearance chance as a percent of each interaction.
  blueBobPct: integer("blue_bob_pct").notNull().default(12),      // ~10–15%
  upsideBobPct: integer("upside_bob_pct").notNull().default(2),   // ~1–3%
  // Reward scaling (percent) so admins can tune the whole economy at once.
  rewardMultiplierPct: integer("reward_multiplier_pct").notNull().default(100),
  // Shared per-user action cooldown (seconds) — anti-spam for games/roasts.
  cooldownSeconds: integer("cooldown_seconds").notNull().default(4),
  // AI chatter for /bob talk. Off by default; needs ANTHROPIC_API_KEY at runtime
  // too. When off (or no key), Bob uses his built-in personality lines.
  aiTalking: boolean("ai_talking").notNull().default(false),
  // Random channel appearances ("BOB HAS ARRIVED").
  eventsEnabled: boolean("events_enabled").notNull().default(true),
  // Channels Bob may appear in for random events. Empty = any text channel.
  channels: jsonb("channels").$type<string[]>().notNull().default([]),
  // OPT-IN: rare Bob rewards may grant real DN Cards shards/packs.
  dexIntegration: boolean("dex_integration").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type BobSettings = typeof bobSettingsTable.$inferSelect;

// ── Talk memory (short, capped, per user) ────────────────────────────────────
export type BobMemory = { role: "user" | "bob"; text: string };

// ── Profiles ─────────────────────────────────────────────────────────────────
export const bobProfilesTable = pgTable("bob_profiles", {
  id: serial("id").primaryKey(),
  guildId: text("guild_id").notNull(),
  userId: text("user_id").notNull(),
  coins: integer("coins").notNull().default(0),
  xp: integer("xp").notNull().default(0),
  level: integer("level").notNull().default(1),
  // Stats
  gamesPlayed: integer("games_played").notNull().default(0),
  wins: integer("wins").notNull().default(0),
  losses: integer("losses").notNull().default(0),
  biggestWin: integer("biggest_win").notNull().default(0),
  jackpots: integer("jackpots").notNull().default(0),
  roastsGiven: integer("roasts_given").notNull().default(0),
  interactions: integer("interactions").notNull().default(0),
  coinsGambled: integer("coins_gambled").notNull().default(0),
  tasksCompleted: integer("tasks_completed").notNull().default(0),
  questsCompleted: integer("quests_completed").notNull().default(0),
  // Roulette survival streak (consecutive CLICKs without a BANG).
  rouletteStreak: integer("roulette_streak").notNull().default(0),
  bestRouletteStreak: integer("best_roulette_streak").notNull().default(0),
  // Cosmetic titles the player has unlocked + the equipped one.
  titles: jsonb("titles").$type<string[]>().notNull().default([]),
  currentTitle: text("current_title"),
  // Temporary funny "curse" effect (label + expiry). Never harms real progress.
  curseLabel: text("curse_label"),
  curseUntil: timestamp("curse_until"),
  // Short rolling conversation memory for /bob talk (capped in code).
  memory: jsonb("memory").$type<BobMemory[]>().notNull().default([]),
  lastActionAt: timestamp("last_action_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => ({
  uniq: uniqueIndex("bob_profiles_guild_user_uniq").on(t.guildId, t.userId),
  byCoins: index("bob_profiles_guild_coins_idx").on(t.guildId, t.coins),
}));

export type BobProfile = typeof bobProfilesTable.$inferSelect;

// ── Progress (daily tasks + long-term quests) ────────────────────────────────
export type BobObjective = {
  key: string;
  label: string;
  emoji: string;
  type: string;     // event type: game_play | game_win | roulette_win | roast | talk | jackpot | duel_win | roulette_survive
  goal: number;
  progress: number;
  rewardCoins: number;
  rewardXp: number;
  rewardTitle?: string;   // quests may grant a cosmetic title
  done: boolean;
};

export const bobProgressTable = pgTable("bob_progress", {
  id: serial("id").primaryKey(),
  guildId: text("guild_id").notNull(),
  userId: text("user_id").notNull(),
  kind: text("kind").notNull(),           // "daily_task" | "quest"
  periodKey: text("period_key").notNull(), // daily: YYYY-MM-DD (UTC); quests: "global"
  items: jsonb("items").$type<BobObjective[]>().notNull().default([]),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => ({
  uniq: uniqueIndex("bob_progress_guild_user_kind_period_uniq").on(t.guildId, t.userId, t.kind, t.periodKey),
}));

export type BobProgress = typeof bobProgressTable.$inferSelect;
