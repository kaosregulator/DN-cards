import type { Presence, Client } from "discord.js";
import { logger } from "../../lib/logger.js";
import { getAfk, getDueAutoRemovals } from "./models.js";
import { clearAfkForUser } from "./shared.js";

// ─────────────────────────────────────────────────────────────────────────────
// AFK Secretary — presenceUpdate status-sync engine + timed sweeper.
//
// • presenceUpdate  → clears "on status change" AFK states when a member flips
//                     Offline/Idle → Online.
// • startAfkSweeper → background loop that lifts "timed" AFK states once their
//                     countdown elapses (presence + messages can't cover this).
//
// NOTE: presenceUpdate requires the GuildPresences privileged intent — enabled
// both in the client's intent list (index.ts) AND in the Discord Developer
// Portal ("Presence Intent"). Without it this handler simply never fires.
// ─────────────────────────────────────────────────────────────────────────────

const RETURNED_STATUSES = new Set(["offline", "idle"]);

/** Wired into index.ts's Events.PresenceUpdate listener. */
export async function handleAfkPresence(
  oldPresence: Presence | null,
  newPresence: Presence,
): Promise<void> {
  try {
    const guild = newPresence.guild;
    const userId = newPresence.userId;
    if (!guild || !userId) return;

    // Only care about a transition INTO online from a "was away" status.
    const oldStatus = oldPresence?.status ?? "offline";
    if (newPresence.status !== "online") return;
    if (!RETURNED_STATUSES.has(oldStatus)) return;

    const state = await getAfk(guild.id, userId);
    if (!state || state.removalMethod !== "STATUS") return;

    await clearAfkForUser(newPresence.client, guild.id, userId, "STATUS");
    logger.info({ guildId: guild.id, userId }, "AFK cleared via status change");
  } catch (err) {
    logger.debug({ err }, "AFK presence handler skipped");
  }
}

/**
 * Start the timed auto-remove sweeper. Polls every `intervalMs` for AUTO states
 * whose `autoRemoveAt` has passed and clears them (restoring nicknames + firing
 * Notify-Me DMs via the shared lifecycle path). Returns the interval handle so
 * callers can clear it on shutdown if desired.
 */
export function startAfkSweeper(client: Client, intervalMs = 30_000): NodeJS.Timeout {
  const tick = async () => {
    try {
      const due = await getDueAutoRemovals();
      if (due.length === 0) return;
      logger.info({ count: due.length }, "AFK sweeper clearing timed states");
      for (const row of due) {
        await clearAfkForUser(client, row.guildId, row.userId, "AUTO").catch(err =>
          logger.debug({ err, userId: row.userId }, "AFK sweeper clear failed"));
      }
    } catch (err) {
      logger.debug({ err }, "AFK sweeper tick failed");
    }
  };

  // Kick once shortly after boot, then on the interval.
  setTimeout(() => { void tick(); }, 5_000);
  const handle = setInterval(() => { void tick(); }, intervalMs);
  // Don't keep the event loop alive purely for the sweeper.
  if (typeof handle.unref === "function") handle.unref();
  return handle;
}
