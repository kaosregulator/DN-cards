import {
  pgTable, text, serial, integer, boolean, timestamp, jsonb, index, uniqueIndex,
} from "drizzle-orm/pg-core";

// ─────────────────────────────────────────────────────────────────────────────
// Tamagotchi pet addon — competitive creature care powered by UnbelievaBoat cash.
//
// Species: dragon · cat · dog · hamster
// Stages:  egg → hatchling → juvenile → adult (real-time growth + care XP)
// Needs:   hunger · cleanliness · happiness · health (decay while neglected)
// Death:   after enough consecutive neglect cycles the pet dies (animated).
// ─────────────────────────────────────────────────────────────────────────────

export const PET_SPECIES = ["dragon", "cat", "dog", "hamster"] as const;
export type PetSpecies = (typeof PET_SPECIES)[number];

export const PET_STAGES = ["egg", "hatchling", "juvenile", "adult"] as const;
export type PetStage = (typeof PET_STAGES)[number];

export const petSettingsTable = pgTable("pet_settings", {
  id: serial("id").primaryKey(),
  guildId: text("guild_id").notNull().unique(),
  enabled: boolean("enabled").notNull().default(true),
  // Hours between growth ticks toward the next stage (when healthy).
  growthHours: integer("growth_hours").notNull().default(24),
  // How many fully-neglected cycles before death.
  maxNeglects: integer("max_neglects").notNull().default(5),
  // Decay rates per hour (points lost).
  hungerDecayPerHour: integer("hunger_decay_per_hour").notNull().default(4),
  cleanlinessDecayPerHour: integer("cleanliness_decay_per_hour").notNull().default(3),
  happinessDecayPerHour: integer("happiness_decay_per_hour").notNull().default(3),
  // Hatch cost in UnbelievaBoat cash (0 = free).
  hatchCost: integer("hatch_cost").notNull().default(250),
  // Challenge wager default.
  challengeWager: integer("challenge_wager").notNull().default(50),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type PetSettings = typeof petSettingsTable.$inferSelect;

export const petsTable = pgTable("pets", {
  id: serial("id").primaryKey(),
  guildId: text("guild_id").notNull(),
  userId: text("user_id").notNull(),
  name: text("name").notNull(),
  species: text("species").notNull(), // PetSpecies
  stage: text("stage").notNull().default("egg"),
  // Palette / look variant (0–3) for procedural art.
  variant: integer("variant").notNull().default(0),
  // Needs 0–100.
  hunger: integer("hunger").notNull().default(80),
  cleanliness: integer("cleanliness").notNull().default(80),
  happiness: integer("happiness").notNull().default(80),
  health: integer("health").notNull().default(100),
  level: integer("level").notNull().default(1),
  xp: integer("xp").notNull().default(0),
  // Competitive rating used for challenges / leaderboards.
  power: integer("power").notNull().default(10),
  wins: integer("wins").notNull().default(0),
  losses: integer("losses").notNull().default(0),
  neglectCount: integer("neglect_count").notNull().default(0),
  isDead: boolean("is_dead").notNull().default(false),
  diedAt: timestamp("died_at"),
  // Cosmetics owned (item keys).
  cosmetics: jsonb("cosmetics").$type<string[]>().notNull().default([]),
  activeCosmetic: text("active_cosmetic"),
  // Inventory of consumables: { food: 2, soap: 1, … }
  inventory: jsonb("inventory").$type<Record<string, number>>().notNull().default({}),
  lastFedAt: timestamp("last_fed_at"),
  lastCleanedAt: timestamp("last_cleaned_at"),
  lastPlayedAt: timestamp("last_played_at"),
  lastTickAt: timestamp("last_tick_at").notNull().defaultNow(),
  stageStartedAt: timestamp("stage_started_at").notNull().defaultNow(),
  hatchedAt: timestamp("hatched_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => [
  uniqueIndex("pets_guild_user_uidx").on(t.guildId, t.userId),
  index("pets_guild_power_idx").on(t.guildId, t.power),
  index("pets_guild_alive_idx").on(t.guildId, t.isDead),
]);

export type Pet = typeof petsTable.$inferSelect;

export const petChallengesTable = pgTable("pet_challenges", {
  id: serial("id").primaryKey(),
  guildId: text("guild_id").notNull(),
  challengerId: text("challenger_id").notNull(),
  opponentId: text("opponent_id").notNull(),
  wager: integer("wager").notNull().default(0),
  status: text("status").notNull().default("pending"), // pending | active | done | cancelled
  winnerId: text("winner_id"),
  // Snapshot of the fight outcome for the GIF / embed.
  result: jsonb("result").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  resolvedAt: timestamp("resolved_at"),
}, (t) => [
  index("pet_challenges_guild_idx").on(t.guildId),
  index("pet_challenges_status_idx").on(t.guildId, t.status),
]);

export type PetChallenge = typeof petChallengesTable.$inferSelect;

export const petCareLogTable = pgTable("pet_care_log", {
  id: serial("id").primaryKey(),
  guildId: text("guild_id").notNull(),
  petId: integer("pet_id").notNull(),
  userId: text("user_id").notNull(),
  action: text("action").notNull(), // feed | clean | play | hatch | revive | buy | challenge | tick
  detail: jsonb("detail").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => [
  index("pet_care_log_pet_idx").on(t.petId),
]);

export type PetCareLog = typeof petCareLogTable.$inferSelect;
