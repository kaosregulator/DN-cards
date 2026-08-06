// ─────────────────────────────────────────────────────────────────────────────
// HQ data-access layer — owns ONLY the four HQ tables (player_hq, hq_unlocks,
// hq_displays, hq_placements). It never writes to any other system; HQ
// progression is derived read-only in engine.ts. Cross-feature reads (player
// profile, collection, raids, achievements) are imported from their own
// accessors there, not duplicated here.
// ─────────────────────────────────────────────────────────────────────────────

import {
  db, playerHqTable, hqUnlocksTable, hqDisplaysTable, hqPlacementsTable, hqDefendersTable,
  type PlayerHq, type HqItemType,
} from "@workspace/db";
import { and, eq } from "drizzle-orm";

// ── player_hq ─────────────────────────────────────────────────────────────────
export async function getOrCreateHq(guildId: string, userId: string): Promise<PlayerHq> {
  const [row] = await db.select().from(playerHqTable)
    .where(and(eq(playerHqTable.guildId, guildId), eq(playerHqTable.userId, userId)))
    .limit(1);
  if (row) return row;
  const [created] = await db.insert(playerHqTable)
    .values({ guildId, userId })
    .onConflictDoUpdate({
      target: [playerHqTable.guildId, playerHqTable.userId],
      set: { updatedAt: new Date() },
    })
    .returning();
  return created;
}

export async function updateHq(
  guildId: string, userId: string,
  patch: Partial<Pick<PlayerHq, "themeId" | "activeRoomId" | "wallId" | "floorId" | "hqLevel" | "stats">>,
): Promise<void> {
  await getOrCreateHq(guildId, userId);
  await db.update(playerHqTable)
    .set({ ...patch, updatedAt: new Date() })
    .where(and(eq(playerHqTable.guildId, guildId), eq(playerHqTable.userId, userId)));
}

// ── hq_unlocks (earned cosmetics ledger) ──────────────────────────────────────
export async function getUnlockedItemIds(guildId: string, userId: string): Promise<Set<string>> {
  const rows = await db.select({ itemId: hqUnlocksTable.itemId }).from(hqUnlocksTable)
    .where(and(eq(hqUnlocksTable.guildId, guildId), eq(hqUnlocksTable.userId, userId)));
  return new Set(rows.map(r => r.itemId));
}

// Idempotent grant. Returns true only when this call created the row (i.e. a
// genuinely new unlock), so callers can build a "just unlocked" toast — same
// idiom as achievements/raid-frame grants.
export async function grantUnlock(
  guildId: string, userId: string, itemId: string, itemType: HqItemType, source: string | null,
): Promise<boolean> {
  const rows = await db.insert(hqUnlocksTable)
    .values({ guildId, userId, itemId, itemType, source })
    .onConflictDoNothing({ target: [hqUnlocksTable.guildId, hqUnlocksTable.userId, hqUnlocksTable.itemId] })
    .returning({ id: hqUnlocksTable.id });
  return rows.length > 0;
}

// ── hq_displays (pinned featured cards) ───────────────────────────────────────
export async function getDisplays(guildId: string, userId: string): Promise<Map<number, number>> {
  const rows = await db.select({ slot: hqDisplaysTable.slot, cardId: hqDisplaysTable.cardId })
    .from(hqDisplaysTable)
    .where(and(eq(hqDisplaysTable.guildId, guildId), eq(hqDisplaysTable.userId, userId)));
  return new Map(rows.map(r => [r.slot, r.cardId]));
}

export async function pinDisplay(guildId: string, userId: string, slot: number, cardId: number): Promise<void> {
  await db.insert(hqDisplaysTable)
    .values({ guildId, userId, slot, cardId })
    .onConflictDoUpdate({
      target: [hqDisplaysTable.guildId, hqDisplaysTable.userId, hqDisplaysTable.slot],
      set: { cardId, createdAt: new Date() },
    });
}

export async function clearDisplay(guildId: string, userId: string, slot: number): Promise<void> {
  await db.delete(hqDisplaysTable).where(and(
    eq(hqDisplaysTable.guildId, guildId),
    eq(hqDisplaysTable.userId, userId),
    eq(hqDisplaysTable.slot, slot),
  ));
}

// ── hq_placements (placed decorations per room) ───────────────────────────────
export async function getPlacements(guildId: string, userId: string, roomId: string): Promise<Map<number, string>> {
  const rows = await db.select({ slot: hqPlacementsTable.slot, itemId: hqPlacementsTable.itemId })
    .from(hqPlacementsTable)
    .where(and(
      eq(hqPlacementsTable.guildId, guildId),
      eq(hqPlacementsTable.userId, userId),
      eq(hqPlacementsTable.roomId, roomId),
    ));
  return new Map(rows.map(r => [r.slot, r.itemId]));
}

export async function placeDecoration(
  guildId: string, userId: string, roomId: string, slot: number, itemId: string,
): Promise<void> {
  await db.insert(hqPlacementsTable)
    .values({ guildId, userId, roomId, slot, itemId })
    .onConflictDoUpdate({
      target: [hqPlacementsTable.guildId, hqPlacementsTable.userId, hqPlacementsTable.roomId, hqPlacementsTable.slot],
      set: { itemId, createdAt: new Date() },
    });
}

export async function clearPlacement(guildId: string, userId: string, roomId: string, slot: number): Promise<void> {
  await db.delete(hqPlacementsTable).where(and(
    eq(hqPlacementsTable.guildId, guildId),
    eq(hqPlacementsTable.userId, userId),
    eq(hqPlacementsTable.roomId, roomId),
    eq(hqPlacementsTable.slot, slot),
  ));
}

// ── hq_defenders (cards guarding the base) ────────────────────────────────────
export async function getDefenders(guildId: string, userId: string): Promise<Map<number, number>> {
  const rows = await db.select({ slot: hqDefendersTable.slot, cardId: hqDefendersTable.cardId })
    .from(hqDefendersTable)
    .where(and(eq(hqDefendersTable.guildId, guildId), eq(hqDefendersTable.userId, userId)));
  return new Map(rows.map(r => [r.slot, r.cardId]));
}

export async function setDefender(guildId: string, userId: string, slot: number, cardId: number): Promise<void> {
  await db.insert(hqDefendersTable)
    .values({ guildId, userId, slot, cardId })
    .onConflictDoUpdate({
      target: [hqDefendersTable.guildId, hqDefendersTable.userId, hqDefendersTable.slot],
      set: { cardId, createdAt: new Date() },
    });
}

export async function clearDefender(guildId: string, userId: string, slot: number): Promise<void> {
  await db.delete(hqDefendersTable).where(and(
    eq(hqDefendersTable.guildId, guildId),
    eq(hqDefendersTable.userId, userId),
    eq(hqDefendersTable.slot, slot),
  ));
}

// Remove any placements whose decoration is no longer owned (defensive — keeps a
// lost unlock from lingering on display). Returns the removed item ids.
export async function pruneUnownedPlacements(
  guildId: string, userId: string, ownedIds: Set<string>,
): Promise<void> {
  const rows = await db.select({ id: hqPlacementsTable.id, itemId: hqPlacementsTable.itemId })
    .from(hqPlacementsTable)
    .where(and(eq(hqPlacementsTable.guildId, guildId), eq(hqPlacementsTable.userId, userId)));
  const orphanIds = rows.filter(r => !ownedIds.has(r.itemId)).map(r => r.id);
  if (orphanIds.length === 0) return;
  for (const id of orphanIds) {
    await db.delete(hqPlacementsTable).where(eq(hqPlacementsTable.id, id));
  }
}
