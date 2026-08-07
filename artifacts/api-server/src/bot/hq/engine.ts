// ─────────────────────────────────────────────────────────────────────────────
// HQ progression engine — DERIVES everything from the existing systems.
//
// There is no HQ grind. `snapshotProgress` composes one progress object from the
// same readers the rest of the bot uses (player profile, collection, raids,
// achievements). `reconcileUnlocks` evaluates every decoration/room/theme's
// declarative UnlockRule against that snapshot and idempotently records newly
// earned cosmetics — so opening `/hq` self-backfills a veteran player exactly
// like backfillGiveawayProgress does. hq_level is a derived cache.
//
// Pull-based on purpose: no call-site edits and no import into player/xp.ts
// (which explicitly guards against import cycles). A future optional hook inside
// awardPlayerXp could make grants instant instead of on-view.
// ─────────────────────────────────────────────────────────────────────────────

import { logger } from "../../lib/logger.js";
import { getPlayerProfile } from "../player/profile.js";
import { getUserCollection, getCompletedSetIds } from "../db.js";
import { getCampaignProgress } from "../raid/db.js";
import { getUnlockedKeys } from "../achievements.js";
import { SHINY_MULTIPLIER } from "../cards-data.js";
import {
  evalUnlockRule, unlockSourceTag, type HqProgress, type UnlockRule,
} from "./defs/unlock-rules.js";
import { HQ_DECORATIONS, type HqDecoration } from "./defs/decorations.js";
import { HQ_ROOMS, type HqRoom } from "./defs/rooms.js";
import { HQ_THEMES, DEFAULT_THEME_ID, type HqTheme } from "./defs/themes.js";
import { HQ_WALLS, DEFAULT_WALL_ID, type HqWall } from "./defs/walls.js";
import { HQ_FLOORS, DEFAULT_FLOOR_ID, type HqFloor } from "./defs/floors.js";
import { HQ_BACKDROPS, DEFAULT_BACKDROP_ID, type HqBackdrop } from "./defs/backdrops.js";
import { HQ_COMPANIONS, type HqCompanion } from "./defs/companions.js";
import { getUnlockedItemIds, grantUnlock, getOrCreateHq, updateHq } from "./db.js";

async function safe<T>(label: string, fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    logger.debug({ err, label }, "hq snapshot sub-read failed (using fallback)");
    return fallback;
  }
}

// Build the progress snapshot from existing systems only. Each domain is
// isolated so one failing subsystem degrades to a safe zero rather than breaking
// HQ — same contract as bot/player/profile.ts.
export async function snapshotProgress(guildId: string, userId: string): Promise<HqProgress> {
  const [profile, collection, completedSets, campaign, achievementKeys] = await Promise.all([
    safe("profile", () => getPlayerProfile(guildId, userId), null),
    safe("collection", () => getUserCollection(guildId, userId), [] as Awaited<ReturnType<typeof getUserCollection>>),
    safe("sets", () => getCompletedSetIds(guildId, userId), [] as number[]),
    safe("campaign", () => getCampaignProgress(guildId, userId), null),
    safe("achievements", () => getUnlockedKeys(guildId, userId), new Set<string>()),
  ]);

  let uniqueCards = 0, totalCards = 0, netWorth = 0, shinyOwned = 0, ownsLimited = false;
  for (const i of collection) {
    const copies = i.count + i.shinyCount;
    uniqueCards += 1;
    totalCards += copies;
    netWorth += i.worthValue * (i.count + i.shinyCount * SHINY_MULTIPLIER);
    shinyOwned += i.shinyCount;
    if (i.isLimitedEdition) ownsLimited = true;
  }

  return {
    accountLevel: profile?.account.level ?? 1,
    uniqueCards, totalCards, netWorth, shinyOwned, ownsLimited,
    battleWins: profile?.battles.wins ?? 0,
    raidBossesCleared: campaign?.defeated ?? 0,
    raidCampaignComplete: campaign?.isComplete ?? false,
    completedSets: completedSets.length,
    dailyStreak: profile?.daily.streak ?? 0,
    achievementKeys,
  };
}

// An item is unlocked when its rule is `always` OR it's in the earned ledger.
function isUnlocked(rule: UnlockRule, id: string, owned: Set<string>): boolean {
  return rule.kind === "always" || owned.has(id);
}

export function ownedDecorations(owned: Set<string>): HqDecoration[] {
  return HQ_DECORATIONS.filter(d => isUnlocked(d.unlock, d.id, owned));
}
export function isRoomUnlocked(room: HqRoom, owned: Set<string>): boolean {
  return isUnlocked(room.unlock, room.id, owned);
}
export function isThemeUnlocked(theme: HqTheme, owned: Set<string>): boolean {
  return theme.id === DEFAULT_THEME_ID || isUnlocked(theme.unlock, theme.id, owned);
}
export function unlockedThemes(owned: Set<string>): HqTheme[] {
  return HQ_THEMES.filter(t => isThemeUnlocked(t, owned));
}
export function unlockedRooms(owned: Set<string>): HqRoom[] {
  return HQ_ROOMS.filter(r => isRoomUnlocked(r, owned));
}
// Wall/floor styles unlock exactly like themes: the default is always available,
// everything else lives in the earned ledger.
export function isWallUnlocked(wall: HqWall, owned: Set<string>): boolean {
  return wall.id === DEFAULT_WALL_ID || isUnlocked(wall.unlock, wall.id, owned);
}
export function isFloorUnlocked(floor: HqFloor, owned: Set<string>): boolean {
  return floor.id === DEFAULT_FLOOR_ID || isUnlocked(floor.unlock, floor.id, owned);
}
export function unlockedWalls(owned: Set<string>): HqWall[] {
  return HQ_WALLS.filter(w => isWallUnlocked(w, owned));
}
export function unlockedFloors(owned: Set<string>): HqFloor[] {
  return HQ_FLOORS.filter(f => isFloorUnlocked(f, owned));
}
export function isBackdropUnlocked(bd: HqBackdrop, owned: Set<string>): boolean {
  return bd.id === DEFAULT_BACKDROP_ID || isUnlocked(bd.unlock, bd.id, owned);
}
export function unlockedBackdrops(owned: Set<string>): HqBackdrop[] {
  return HQ_BACKDROPS.filter(b => isBackdropUnlocked(b, owned));
}
// Companions are earned like decorations (no "always" default — you start with
// no pet); ownership is entirely the ledger.
export function ownedCompanions(owned: Set<string>): HqCompanion[] {
  return HQ_COMPANIONS.filter(c => owned.has(c.id));
}

// HQ level rewards BREADTH of accomplishment: each earned cosmetic and each
// extra room/theme raises it, with a gentle account-level contribution. Purely a
// display number derived from the snapshot + ledger (source of truth stays the
// underlying systems).
export function computeHqLevel(p: HqProgress, owned: Set<string>): number {
  const earnedDecos = HQ_DECORATIONS.filter(d => d.unlock.kind !== "always" && owned.has(d.id)).length;
  const extraRooms = HQ_ROOMS.filter(r => r.unlock.kind !== "always" && owned.has(r.id)).length;
  const extraThemes = HQ_THEMES.filter(t => t.unlock.kind !== "always" && t.id !== DEFAULT_THEME_ID && owned.has(t.id)).length;
  const companions = HQ_COMPANIONS.filter(c => owned.has(c.id)).length;
  const level = 1 + earnedDecos + extraRooms + extraThemes + companions + Math.floor(p.accountLevel / 10);
  return Math.max(1, Math.min(100, level));
}

export interface ReconcileResult {
  progress: HqProgress;
  owned: Set<string>;
  hqLevel: number;
  newlyUnlocked: HqDecoration[]; // decorations earned on THIS reconcile (for a toast)
}

// Grant every satisfied (non-always) unlock idempotently. Safe to call on every
// /hq open; only the first time an item's rule is met does it record + surface.
export async function reconcileUnlocks(guildId: string, userId: string): Promise<ReconcileResult> {
  const progress = await snapshotProgress(guildId, userId);

  const newlyUnlocked: HqDecoration[] = [];
  for (const d of HQ_DECORATIONS) {
    if (d.unlock.kind === "always") continue;
    if (!evalUnlockRule(d.unlock, progress)) continue;
    const isNew = await grantUnlock(guildId, userId, d.id, "decoration", unlockSourceTag(d.unlock)).catch(() => false);
    if (isNew) newlyUnlocked.push(d);
  }
  for (const r of HQ_ROOMS) {
    if (r.unlock.kind === "always") continue;
    if (evalUnlockRule(r.unlock, progress)) {
      await grantUnlock(guildId, userId, r.id, "room", unlockSourceTag(r.unlock)).catch(() => {});
    }
  }
  for (const t of HQ_THEMES) {
    if (t.unlock.kind === "always") continue;
    if (evalUnlockRule(t.unlock, progress)) {
      await grantUnlock(guildId, userId, t.id, "theme", unlockSourceTag(t.unlock)).catch(() => {});
    }
  }
  for (const w of HQ_WALLS) {
    if (w.unlock.kind === "always") continue;
    if (evalUnlockRule(w.unlock, progress)) {
      await grantUnlock(guildId, userId, w.id, "wall", unlockSourceTag(w.unlock)).catch(() => {});
    }
  }
  for (const f of HQ_FLOORS) {
    if (f.unlock.kind === "always") continue;
    if (evalUnlockRule(f.unlock, progress)) {
      await grantUnlock(guildId, userId, f.id, "floor", unlockSourceTag(f.unlock)).catch(() => {});
    }
  }
  for (const b of HQ_BACKDROPS) {
    if (b.unlock.kind === "always") continue;
    if (evalUnlockRule(b.unlock, progress)) {
      await grantUnlock(guildId, userId, b.id, "backdrop", unlockSourceTag(b.unlock)).catch(() => {});
    }
  }
  for (const c of HQ_COMPANIONS) {
    if (c.unlock.kind === "always") continue;
    if (evalUnlockRule(c.unlock, progress)) {
      await grantUnlock(guildId, userId, c.id, "companion", unlockSourceTag(c.unlock)).catch(() => {});
    }
  }

  const owned = await getUnlockedItemIds(guildId, userId).catch(() => new Set<string>());
  const hqLevel = computeHqLevel(progress, owned);
  // Persist the derived level so the cached `player_hq.hq_level` (read by the hub
  // header and leaderboards) stays accurate after new unlocks — only write when it
  // actually changed, so a no-op /hq open costs no extra write.
  const hq = await getOrCreateHq(guildId, userId).catch(() => null);
  if (hq && hq.hqLevel !== hqLevel) {
    await updateHq(guildId, userId, { hqLevel }).catch(() => {});
  }
  return { progress, owned, hqLevel, newlyUnlocked };
}
