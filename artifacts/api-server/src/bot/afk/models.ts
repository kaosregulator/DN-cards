import {
  db,
  afkGuildSettingsTable,
  afkWhitelistTable,
  afkStateTable,
  afkSavedNotesTable,
  afkNotifySubscribersTable,
  type AfkGuildSettings,
  type AfkWhitelistEntry,
  type AfkState,
  type AfkSavedNote,
  type AfkNotifySubscriber,
} from "@workspace/db";
import { and, eq, lte, desc, sql } from "drizzle-orm";

// ─────────────────────────────────────────────────────────────────────────────
// AFK Secretary — data-access layer.
//
// Every DB touch for the AFK system funnels through here so the command / hook /
// interaction layers stay free of Drizzle query wiring. Pure persistence only —
// no Discord API calls (those live in shared.ts / the hooks).
// ─────────────────────────────────────────────────────────────────────────────

export type AfkGuildSettingsRow = AfkGuildSettings;
export type AfkWhitelistRow = AfkWhitelistEntry;
export type AfkStateRow = AfkState;
export type AfkNoteRow = AfkSavedNote;
export type AfkSubscriberRow = AfkNotifySubscriber;

// ── GuildSettings ────────────────────────────────────────────────────────────

/** Fetch a guild's AFK settings, creating the default row on first access. */
export async function getAfkSettings(guildId: string): Promise<AfkGuildSettingsRow> {
  const [existing] = await db.select()
    .from(afkGuildSettingsTable)
    .where(eq(afkGuildSettingsTable.guildId, guildId))
    .limit(1);
  if (existing) return existing;

  const [row] = await db.insert(afkGuildSettingsTable)
    .values({ guildId })
    .onConflictDoUpdate({
      target: afkGuildSettingsTable.guildId,
      set: { updatedAt: new Date() },
    })
    .returning();
  return row;
}

/** Patch feature toggles. Only provided fields change. */
export async function updateAfkSettings(
  guildId: string,
  patch: Partial<Pick<AfkGuildSettingsRow, "secretaryEnabled" | "nicknameChanges" | "maxSavedMessages">>,
): Promise<AfkGuildSettingsRow> {
  await getAfkSettings(guildId); // ensure the row exists
  const [row] = await db.update(afkGuildSettingsTable)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(afkGuildSettingsTable.guildId, guildId))
    .returning();
  return row;
}

// ── WhitelistRegistry ────────────────────────────────────────────────────────

export async function getWhitelist(guildId: string): Promise<AfkWhitelistRow[]> {
  return db.select()
    .from(afkWhitelistTable)
    .where(eq(afkWhitelistTable.guildId, guildId));
}

/** Idempotent add — re-adding an existing target is a no-op. */
export async function addWhitelist(
  guildId: string,
  targetId: string,
  type: "USER" | "ROLE",
  addedBy: string,
): Promise<void> {
  await db.insert(afkWhitelistTable)
    .values({ guildId, targetId, type, addedBy })
    .onConflictDoNothing({
      target: [afkWhitelistTable.guildId, afkWhitelistTable.targetId],
    });
}

/** Returns true if a row was actually removed. */
export async function removeWhitelist(guildId: string, targetId: string): Promise<boolean> {
  const removed = await db.delete(afkWhitelistTable)
    .where(and(
      eq(afkWhitelistTable.guildId, guildId),
      eq(afkWhitelistTable.targetId, targetId),
    ))
    .returning({ id: afkWhitelistTable.id });
  return removed.length > 0;
}

// ── AFKState ─────────────────────────────────────────────────────────────────

export async function getAfk(guildId: string, userId: string): Promise<AfkStateRow | null> {
  const [row] = await db.select()
    .from(afkStateTable)
    .where(and(
      eq(afkStateTable.guildId, guildId),
      eq(afkStateTable.userId, userId),
    ))
    .limit(1);
  return row ?? null;
}

/**
 * Create or overwrite a member's AFK state. The unique (guildId, userId) index
 * makes this a clean upsert — re-running /afk set just replaces the prior state.
 */
export async function setAfk(input: {
  guildId: string;
  userId: string;
  reason: string;
  removalMethod: "RETURN" | "STATUS" | "AUTO";
  autoRemoveAt: Date | null;
  originalNickname: string | null;
}): Promise<AfkStateRow> {
  const [row] = await db.insert(afkStateTable)
    .values({
      guildId: input.guildId,
      userId: input.userId,
      reason: input.reason,
      removalMethod: input.removalMethod,
      startTime: new Date(),
      autoRemoveAt: input.autoRemoveAt,
      originalNickname: input.originalNickname,
    })
    .onConflictDoUpdate({
      target: [afkStateTable.guildId, afkStateTable.userId],
      set: {
        reason: input.reason,
        removalMethod: input.removalMethod,
        startTime: new Date(),
        autoRemoveAt: input.autoRemoveAt,
        originalNickname: input.originalNickname,
      },
    })
    .returning();
  return row;
}

/** Delete an AFK row. Returns the deleted row (for nickname restoration), if any. */
export async function deleteAfk(guildId: string, userId: string): Promise<AfkStateRow | null> {
  const [row] = await db.delete(afkStateTable)
    .where(and(
      eq(afkStateTable.guildId, guildId),
      eq(afkStateTable.userId, userId),
    ))
    .returning();
  return row ?? null;
}

/** All AUTO states whose timer has elapsed — consumed by the sweeper. */
export async function getDueAutoRemovals(now = new Date()): Promise<AfkStateRow[]> {
  return db.select()
    .from(afkStateTable)
    .where(and(
      eq(afkStateTable.removalMethod, "AUTO"),
      lte(afkStateTable.autoRemoveAt, now),
    ));
}

// ── SavedNotes ───────────────────────────────────────────────────────────────

/**
 * Store a note for an away member, respecting the guild's maxSavedMessages cap.
 * Returns { stored, atCapacity }. When at capacity the note is dropped and the
 * caller surfaces a graceful "inbox full" message.
 */
export async function addNote(input: {
  guildId: string;
  senderId: string;
  receiverId: string;
  message: string;
  maxSavedMessages: number;
}): Promise<{ stored: boolean; atCapacity: boolean }> {
  const [{ count }] = await db.select({ count: sql<number>`count(*)::int` })
    .from(afkSavedNotesTable)
    .where(and(
      eq(afkSavedNotesTable.guildId, input.guildId),
      eq(afkSavedNotesTable.receiverId, input.receiverId),
      eq(afkSavedNotesTable.isRead, false),
    ));

  if (count >= input.maxSavedMessages) return { stored: false, atCapacity: true };

  await db.insert(afkSavedNotesTable).values({
    guildId: input.guildId,
    senderId: input.senderId,
    receiverId: input.receiverId,
    message: input.message,
  });
  return { stored: true, atCapacity: false };
}

export async function getNotes(guildId: string, receiverId: string): Promise<AfkNoteRow[]> {
  return db.select()
    .from(afkSavedNotesTable)
    .where(and(
      eq(afkSavedNotesTable.guildId, guildId),
      eq(afkSavedNotesTable.receiverId, receiverId),
    ))
    .orderBy(desc(afkSavedNotesTable.createdAt));
}

export async function getNoteById(id: number, receiverId: string): Promise<AfkNoteRow | null> {
  const [row] = await db.select()
    .from(afkSavedNotesTable)
    .where(and(
      eq(afkSavedNotesTable.id, id),
      eq(afkSavedNotesTable.receiverId, receiverId),
    ))
    .limit(1);
  return row ?? null;
}

export async function markNoteRead(id: number, receiverId: string): Promise<void> {
  await db.update(afkSavedNotesTable)
    .set({ isRead: true })
    .where(and(
      eq(afkSavedNotesTable.id, id),
      eq(afkSavedNotesTable.receiverId, receiverId),
    ));
}

/** Returns true if a note was deleted (scoped to the owner for safety). */
export async function deleteNote(id: number, receiverId: string): Promise<boolean> {
  const removed = await db.delete(afkSavedNotesTable)
    .where(and(
      eq(afkSavedNotesTable.id, id),
      eq(afkSavedNotesTable.receiverId, receiverId),
    ))
    .returning({ id: afkSavedNotesTable.id });
  return removed.length > 0;
}

export async function countUnreadNotes(guildId: string, receiverId: string): Promise<number> {
  const [{ count }] = await db.select({ count: sql<number>`count(*)::int` })
    .from(afkSavedNotesTable)
    .where(and(
      eq(afkSavedNotesTable.guildId, guildId),
      eq(afkSavedNotesTable.receiverId, receiverId),
      eq(afkSavedNotesTable.isRead, false),
    ));
  return count;
}

// ── Notify subscribers ───────────────────────────────────────────────────────

/** Register interest in a return DM. Idempotent per (guild, afkUser, subscriber). */
export async function addSubscriber(input: {
  guildId: string;
  afkUserId: string;
  subscriberId: string;
  channelId: string | null;
}): Promise<{ added: boolean }> {
  const inserted = await db.insert(afkNotifySubscribersTable)
    .values(input)
    .onConflictDoNothing({
      target: [
        afkNotifySubscribersTable.guildId,
        afkNotifySubscribersTable.afkUserId,
        afkNotifySubscribersTable.subscriberId,
      ],
    })
    .returning({ id: afkNotifySubscribersTable.id });
  return { added: inserted.length > 0 };
}

export async function getSubscribers(guildId: string, afkUserId: string): Promise<AfkSubscriberRow[]> {
  return db.select()
    .from(afkNotifySubscribersTable)
    .where(and(
      eq(afkNotifySubscribersTable.guildId, guildId),
      eq(afkNotifySubscribersTable.afkUserId, afkUserId),
    ));
}

export async function clearSubscribers(guildId: string, afkUserId: string): Promise<void> {
  await db.delete(afkNotifySubscribersTable)
    .where(and(
      eq(afkNotifySubscribersTable.guildId, guildId),
      eq(afkNotifySubscribersTable.afkUserId, afkUserId),
    ));
}
