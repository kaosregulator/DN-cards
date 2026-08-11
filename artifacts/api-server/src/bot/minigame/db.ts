// Wild Mini-Game data-access layer: the encounter log + settings mutations used
// by the scheduler and admin panel. Live sessions are in-memory (manager.ts);
// only the log rows and the guild's schedule state are persisted.

import { db, miniGameLogTable, guildSettingsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "../../lib/logger.js";
import type { GameKey } from "./types.js";

// Insert a "game started" row; returns its id so the resolve can update it.
export async function logMiniGameStart(
  guildId: string, channelId: string, userId: string, cardId: number, gameKey: GameKey,
): Promise<number | null> {
  try {
    const [row] = await db.insert(miniGameLogTable)
      .values({ guildId, channelId, userId, cardId, gameKey, result: "pending" })
      .returning({ id: miniGameLogTable.id });
    return row?.id ?? null;
  } catch (err) {
    logger.debug({ err }, "logMiniGameStart failed (non-fatal)");
    return null;
  }
}

export async function logMiniGameResolve(logId: number | null, result: "win" | "lose" | "timeout"): Promise<void> {
  if (logId == null) return;
  try {
    await db.update(miniGameLogTable)
      .set({ result, resolvedAt: new Date() })
      .where(eq(miniGameLogTable.id, logId));
  } catch (err) {
    logger.debug({ err }, "logMiniGameResolve failed (non-fatal)");
  }
}

// Patch mini-game settings columns for a guild (used by scheduler + admin panel).
export async function updateMiniGameSettings(
  guildId: string,
  patch: Partial<{
    miniGameEnabled: boolean;
    miniGameCadence: string;
    miniGameIntervalMinutes: number;
    miniGameSelection: string;
    miniGameNextArmAt: Date | null;
    miniGameArmed: boolean;
    miniGameAnimationEnabled: boolean;
  }>,
): Promise<void> {
  await db.update(guildSettingsTable)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(guildSettingsTable.guildId, guildId));
}
