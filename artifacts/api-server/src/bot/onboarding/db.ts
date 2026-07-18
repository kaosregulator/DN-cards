// ─────────────────────────────────────────────────────────────────────────────
// Onboarding persistence — the one-time completion ledger.
//
// The whole point is that the exclusive rewards can be granted EXACTLY once per
// player, ever. `claimCompletion()` is the guard: it flips rewards_claimed from
// false→true in a single conditional UPDATE and reports whether THIS call won
// the race, so the caller grants rewards only on a true first completion — safe
// against double-clicks and concurrent invocations alike.
// ─────────────────────────────────────────────────────────────────────────────

import { db, onboardingProgressTable, type OnboardingProgress } from "@workspace/db";
import { and, eq, sql } from "drizzle-orm";

export async function getOnboarding(guildId: string, userId: string): Promise<OnboardingProgress | null> {
  const [row] = await db.select().from(onboardingProgressTable)
    .where(and(eq(onboardingProgressTable.guildId, guildId), eq(onboardingProgressTable.userId, userId)))
    .limit(1);
  return row ?? null;
}

export async function hasCompletedOnboarding(guildId: string, userId: string): Promise<boolean> {
  const row = await getOnboarding(guildId, userId);
  return row?.status === "completed" || !!row?.rewardsClaimed;
}

/** Begin (or resume) the adventure — creates the in-progress row if absent. */
export async function startOnboarding(guildId: string, userId: string): Promise<OnboardingProgress> {
  await db.insert(onboardingProgressTable)
    .values({ guildId, userId, status: "in_progress", chapter: 0 })
    .onConflictDoNothing();
  return (await getOnboarding(guildId, userId))!;
}

/** Record progress through a chapter (monotonic — never moves backward). */
export async function advanceChapter(guildId: string, userId: string, chapter: number): Promise<void> {
  await db.update(onboardingProgressTable)
    .set({ chapter: sql`GREATEST(${onboardingProgressTable.chapter}, ${chapter})` })
    .where(and(eq(onboardingProgressTable.guildId, guildId), eq(onboardingProgressTable.userId, userId)));
}

/**
 * Atomically claim the final completion. Returns true ONLY for the call that
 * first flips rewards_claimed → true; every later attempt returns false. The
 * caller grants the exclusive rewards iff this returns true.
 */
export async function claimCompletion(guildId: string, userId: string): Promise<boolean> {
  // Ensure a row exists (a player who somehow skipped start still gets one).
  await startOnboarding(guildId, userId);
  const won = await db.update(onboardingProgressTable)
    .set({ status: "completed", rewardsClaimed: true, completedAt: new Date() })
    .where(and(
      eq(onboardingProgressTable.guildId, guildId),
      eq(onboardingProgressTable.userId, userId),
      eq(onboardingProgressTable.rewardsClaimed, false),
    ))
    .returning({ id: onboardingProgressTable.id });
  return won.length > 0;
}
