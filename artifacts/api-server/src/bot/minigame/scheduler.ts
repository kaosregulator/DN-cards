// Wild Mini-Game scheduler — arms a game on a cadence (every N minutes / hourly
// / daily / weekly). "Arming" flips miniGameArmed=true; the NEXT successful catch
// (see spawn-manager) then triggers the encounter and consumes the arm. Mirrors
// the spawn-boost transition-timer pattern (spawn-manager armBoostTransition):
// one-shot timers, persisted next-arm time so the schedule survives a restart.

import { getOrCreateGuildSettings } from "../db.js";
import { updateMiniGameSettings } from "./db.js";
import { logger } from "../../lib/logger.js";
import type { GuildSettings } from "@workspace/db";

// setTimeout caps out around 24.8 days; clamp so weekly schedules don't overflow.
const MAX_TIMER_MS = 2_000_000_000;

const armTimers = new Map<string, ReturnType<typeof setTimeout>>();

function clearArmTimer(guildId: string): void {
  const t = armTimers.get(guildId);
  if (t) { clearTimeout(t); armTimers.delete(guildId); }
}

// Next arm time from cadence. Minutes → now + interval; hourly/daily/weekly →
// the next UTC boundary so the schedule is deterministic across restarts.
export function computeNextArm(settings: GuildSettings, from: Date = new Date()): Date {
  const cadence = settings.miniGameCadence;
  if (cadence === "minutes") {
    const mins = Math.max(1, settings.miniGameIntervalMinutes || 1);
    return new Date(from.getTime() + mins * 60_000);
  }
  const d = new Date(from.getTime());
  if (cadence === "hourly") {
    d.setUTCMinutes(0, 0, 0);
    d.setUTCHours(d.getUTCHours() + 1);
    return d;
  }
  if (cadence === "weekly") {
    d.setUTCHours(0, 0, 0, 0);
    // Advance to next Monday.
    const day = d.getUTCDay(); // 0 = Sun
    const daysUntilMon = ((8 - day) % 7) || 7;
    d.setUTCDate(d.getUTCDate() + daysUntilMon);
    return d;
  }
  // daily (default)
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() + 1);
  return d;
}

// Arm the guild's next game: compute + persist the next arm time and set a
// one-shot timer that flips miniGameArmed=true when it fires. No-op (and clears
// any timer) when the feature is disabled.
export async function scheduleNextMiniGameArm(guildId: string): Promise<void> {
  clearArmTimer(guildId);
  const settings = await getOrCreateGuildSettings(guildId);
  if (!settings.miniGameEnabled) return;
  // Already armed and waiting for a catch — don't reschedule over it.
  if (settings.miniGameArmed) return;

  const next = computeNextArm(settings);
  await updateMiniGameSettings(guildId, { miniGameNextArmAt: next, miniGameArmed: false });
  armAt(guildId, next);
}

// (Re)create the one-shot timer for an already-persisted next arm time.
function armAt(guildId: string, next: Date): void {
  clearArmTimer(guildId);
  const delay = Math.max(0, Math.min(next.getTime() - Date.now(), MAX_TIMER_MS));
  const timer = setTimeout(() => {
    void (async () => {
      // If the real target is still in the future (weekly clamp), re-arm the
      // remaining delay; otherwise flip armed on.
      const settings = await getOrCreateGuildSettings(guildId).catch(() => null);
      if (!settings || !settings.miniGameEnabled) return;
      const target = settings.miniGameNextArmAt?.getTime() ?? 0;
      if (target > Date.now() + 1000) { armAt(guildId, new Date(target)); return; }
      await updateMiniGameSettings(guildId, { miniGameArmed: true });
      logger.info({ guildId }, "Wild mini-game armed — next catch triggers an encounter");
    })();
  }, delay);
  armTimers.set(guildId, timer);
}

// Admin "Trigger now": arm immediately so the very next catch pops a game.
export async function armMiniGameNow(guildId: string): Promise<void> {
  clearArmTimer(guildId);
  await updateMiniGameSettings(guildId, { miniGameArmed: true, miniGameNextArmAt: new Date() });
  logger.info({ guildId }, "Wild mini-game armed manually (Trigger now)");
}

// Called after any admin edit: recompute the schedule from current settings.
export async function applyMiniGameChange(guildId: string): Promise<void> {
  const settings = await getOrCreateGuildSettings(guildId);
  if (!settings.miniGameEnabled) {
    clearArmTimer(guildId);
    await updateMiniGameSettings(guildId, { miniGameArmed: false, miniGameNextArmAt: null });
    return;
  }
  await scheduleNextMiniGameArm(guildId);
}

// True when a game is armed and waiting for the next catch.
export async function isMiniGameArmed(guildId: string): Promise<boolean> {
  const settings = await getOrCreateGuildSettings(guildId);
  return settings.miniGameEnabled && settings.miniGameArmed;
}

// Consume the arm (a catch just triggered a game) so only one catch fires it.
export async function consumeMiniGameArm(guildId: string): Promise<void> {
  await updateMiniGameSettings(guildId, { miniGameArmed: false });
}

// After a game resolves, re-arm for the next cadence tick.
export async function rearmAfterResolve(guildId: string): Promise<void> {
  await scheduleNextMiniGameArm(guildId);
}

// Startup: re-create arm timers for every guild from persisted state. An already
// past-due next-arm time arms immediately; a future one re-schedules its timer.
export async function initMiniGameSchedules(guildIds: Iterable<string>): Promise<void> {
  for (const guildId of guildIds) {
    try {
      const settings = await getOrCreateGuildSettings(guildId);
      if (!settings.miniGameEnabled) continue;
      if (settings.miniGameArmed) continue; // already waiting for a catch
      const next = settings.miniGameNextArmAt;
      if (next && next.getTime() > Date.now()) armAt(guildId, next);
      else await scheduleNextMiniGameArm(guildId);
    } catch (err) {
      logger.debug({ err, guildId }, "initMiniGameSchedules: skip guild");
    }
  }
}
