import {
  db,
  quietGuildSettingsTable,
  quietStateTable,
  quietUserPrefsTable,
  quietAudioConfigTable,
  type QuietGuildSettings,
  type QuietState,
  type QuietUserPrefs,
  type QuietAudioConfig,
} from "@workspace/db";
import { and, eq } from "drizzle-orm";

// ─────────────────────────────────────────────────────────────────────────────
// Quiet Mode — data-access layer (Drizzle only; no Discord API calls).
// ─────────────────────────────────────────────────────────────────────────────

export type QuietGuildSettingsRow = QuietGuildSettings;
export type QuietStateRow = QuietState;
export type QuietUserPrefsRow = QuietUserPrefs;
export type QuietAudioConfigRow = QuietAudioConfig;

const RECENT_CAP = 12;

// ── Guild settings ───────────────────────────────────────────────────────────

export async function getQuietSettings(guildId: string): Promise<QuietGuildSettingsRow> {
  const [existing] = await db.select()
    .from(quietGuildSettingsTable)
    .where(eq(quietGuildSettingsTable.guildId, guildId))
    .limit(1);
  if (existing) return existing;

  const [row] = await db.insert(quietGuildSettingsTable)
    .values({ guildId })
    .onConflictDoUpdate({
      target: quietGuildSettingsTable.guildId,
      set: { updatedAt: new Date() },
    })
    .returning();
  return row;
}

export async function updateQuietSettings(
  guildId: string,
  patch: Partial<{
    enabled: boolean;
    quietChannelId: string | null;
    quietCategoryId: string | null;
    quietRoleId: string | null;
    whitelistRoleId: string | null;
    blacklistRoleId: string | null;
    audioEnabled: boolean;
  }>,
): Promise<QuietGuildSettingsRow> {
  await getQuietSettings(guildId);
  const [row] = await db.update(quietGuildSettingsTable)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(quietGuildSettingsTable.guildId, guildId))
    .returning();
  return row;
}

// ── Live state ───────────────────────────────────────────────────────────────

export async function getQuietState(guildId: string, userId: string): Promise<QuietStateRow | null> {
  const [row] = await db.select()
    .from(quietStateTable)
    .where(and(
      eq(quietStateTable.guildId, guildId),
      eq(quietStateTable.userId, userId),
    ))
    .limit(1);
  return row ?? null;
}

export async function listQuietStates(guildId?: string): Promise<QuietStateRow[]> {
  if (guildId) {
    return db.select().from(quietStateTable).where(eq(quietStateTable.guildId, guildId));
  }
  return db.select().from(quietStateTable);
}

export async function listNeedsRecovery(): Promise<QuietStateRow[]> {
  return db.select()
    .from(quietStateTable)
    .where(eq(quietStateTable.needsRecovery, true));
}

export async function upsertQuietState(input: {
  guildId: string;
  userId: string;
  enteredBy: string;
  theme?: string | null;
  quoteId?: string | null;
  quoteText?: string | null;
  audioId?: string | null;
  lastChannelId?: string | null;
  roomMessageIds?: string[];
  overwriteTargets?: string[];
  needsRecovery?: boolean;
  adminBypass?: boolean;
}): Promise<QuietStateRow> {
  const [row] = await db.insert(quietStateTable)
    .values({
      guildId: input.guildId,
      userId: input.userId,
      enteredBy: input.enteredBy,
      theme: input.theme ?? null,
      quoteId: input.quoteId ?? null,
      quoteText: input.quoteText ?? null,
      audioId: input.audioId ?? null,
      lastChannelId: input.lastChannelId ?? null,
      roomMessageIds: input.roomMessageIds ?? [],
      overwriteTargets: input.overwriteTargets ?? [],
      needsRecovery: input.needsRecovery ?? false,
      adminBypass: input.adminBypass ?? false,
      enteredAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [quietStateTable.guildId, quietStateTable.userId],
      set: {
        enteredBy: input.enteredBy,
        theme: input.theme ?? null,
        quoteId: input.quoteId ?? null,
        quoteText: input.quoteText ?? null,
        audioId: input.audioId ?? null,
        lastChannelId: input.lastChannelId ?? null,
        roomMessageIds: input.roomMessageIds ?? [],
        overwriteTargets: input.overwriteTargets ?? [],
        needsRecovery: input.needsRecovery ?? false,
        adminBypass: input.adminBypass ?? false,
        enteredAt: new Date(),
      },
    })
    .returning();
  return row;
}

export async function patchQuietState(
  guildId: string,
  userId: string,
  patch: Partial<Pick<
    QuietStateRow,
    | "theme"
    | "quoteId"
    | "quoteText"
    | "audioId"
    | "lastChannelId"
    | "roomMessageIds"
    | "overwriteTargets"
    | "needsRecovery"
    | "adminBypass"
  >>,
): Promise<QuietStateRow | null> {
  const [row] = await db.update(quietStateTable)
    .set(patch)
    .where(and(
      eq(quietStateTable.guildId, guildId),
      eq(quietStateTable.userId, userId),
    ))
    .returning();
  return row ?? null;
}

export async function deleteQuietState(guildId: string, userId: string): Promise<boolean> {
  const removed = await db.delete(quietStateTable)
    .where(and(
      eq(quietStateTable.guildId, guildId),
      eq(quietStateTable.userId, userId),
    ))
    .returning({ id: quietStateTable.id });
  return removed.length > 0;
}

// ── User prefs (anti-repeat) ─────────────────────────────────────────────────

export async function getQuietPrefs(guildId: string, userId: string): Promise<QuietUserPrefsRow> {
  const [existing] = await db.select()
    .from(quietUserPrefsTable)
    .where(and(
      eq(quietUserPrefsTable.guildId, guildId),
      eq(quietUserPrefsTable.userId, userId),
    ))
    .limit(1);
  if (existing) return existing;

  const [row] = await db.insert(quietUserPrefsTable)
    .values({ guildId, userId })
    .onConflictDoUpdate({
      target: [quietUserPrefsTable.guildId, quietUserPrefsTable.userId],
      set: { updatedAt: new Date() },
    })
    .returning();
  return row;
}

export async function rememberQuietSelection(
  guildId: string,
  userId: string,
  audioId: string | null,
  quoteId: string | null,
): Promise<void> {
  const prefs = await getQuietPrefs(guildId, userId);
  const recentAudioIds = audioId
    ? [audioId, ...prefs.recentAudioIds.filter(id => id !== audioId)].slice(0, RECENT_CAP)
    : prefs.recentAudioIds;
  const recentQuoteIds = quoteId
    ? [quoteId, ...prefs.recentQuoteIds.filter(id => id !== quoteId)].slice(0, RECENT_CAP)
    : prefs.recentQuoteIds;

  await db.update(quietUserPrefsTable)
    .set({ recentAudioIds, recentQuoteIds, updatedAt: new Date() })
    .where(and(
      eq(quietUserPrefsTable.guildId, guildId),
      eq(quietUserPrefsTable.userId, userId),
    ));
}

// ── Audio config overrides ───────────────────────────────────────────────────

export async function getAudioConfig(audioId: string): Promise<QuietAudioConfigRow | null> {
  const [row] = await db.select()
    .from(quietAudioConfigTable)
    .where(eq(quietAudioConfigTable.audioId, audioId))
    .limit(1);
  return row ?? null;
}

export async function listAudioConfigs(): Promise<QuietAudioConfigRow[]> {
  return db.select().from(quietAudioConfigTable);
}

export async function setAudioEnabled(audioId: string, enabled: boolean): Promise<void> {
  await db.insert(quietAudioConfigTable)
    .values({ audioId, enabled })
    .onConflictDoUpdate({
      target: quietAudioConfigTable.audioId,
      set: { enabled, updatedAt: new Date() },
    });
}
