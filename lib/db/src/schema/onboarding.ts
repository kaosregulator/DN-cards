import { pgTable, serial, text, integer, boolean, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

// ── Onboarding progress ──────────────────────────────────────────────────────
// One row per (guild, player) tracking the one-time interactive onboarding
// adventure. Permanent: a completed row is what stops the exclusive rewards +
// achievement from ever being granted twice, for new AND existing players.
//
// Purely additive — it references nothing and nothing references it, so it can
// never affect existing collections, battles, or currency. `status` is
// "in_progress" while the player is mid-adventure and "completed" once they
// finish; `chapter` is the highest chapter they've cleared (for resume);
// `rewardsClaimed` guards the final grant independently of status.
export const onboardingProgressTable = pgTable("onboarding_progress", {
  id: serial("id").primaryKey(),
  guildId: text("guild_id").notNull(),
  userId: text("user_id").notNull(),
  status: text("status").notNull().default("in_progress"),   // in_progress | completed
  chapter: integer("chapter").notNull().default(0),           // highest chapter cleared
  rewardsClaimed: boolean("rewards_claimed").notNull().default(false),
  startedAt: timestamp("started_at").notNull().defaultNow(),
  completedAt: timestamp("completed_at"),
}, (t) => ({
  guildUserUniq: uniqueIndex("onboarding_guild_user_uniq").on(t.guildId, t.userId),
}));

export type OnboardingProgress = typeof onboardingProgressTable.$inferSelect;
export type NewOnboardingProgress = typeof onboardingProgressTable.$inferInsert;
