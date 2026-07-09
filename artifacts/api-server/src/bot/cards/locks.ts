// Favorite / lock helpers. A locked card is protected from `/burn` and bulk
// trade-in. Lock state lives on the shared card_progress row (per user, per
// card) so no extra table is needed.

import { db, cardProgressTable } from "@workspace/db";
import { and, eq } from "drizzle-orm";

export async function isCardLocked(guildId: string, userId: string, cardId: number): Promise<boolean> {
  const [row] = await db.select({ locked: cardProgressTable.locked })
    .from(cardProgressTable)
    .where(and(
      eq(cardProgressTable.guildId, guildId),
      eq(cardProgressTable.userId, userId),
      eq(cardProgressTable.cardId, cardId),
    )).limit(1);
  return row?.locked ?? false;
}

export async function getLockedCardIds(guildId: string, userId: string): Promise<Set<number>> {
  const rows = await db.select({ cardId: cardProgressTable.cardId })
    .from(cardProgressTable)
    .where(and(
      eq(cardProgressTable.guildId, guildId),
      eq(cardProgressTable.userId, userId),
      eq(cardProgressTable.locked, true),
    ));
  return new Set(rows.map(r => r.cardId));
}

// Set (or toggle) the lock. Returns the new locked state.
export async function setCardLocked(guildId: string, userId: string, cardId: number, locked: boolean): Promise<boolean> {
  await db.insert(cardProgressTable)
    .values({ guildId, userId, cardId, locked })
    .onConflictDoUpdate({
      target: [cardProgressTable.guildId, cardProgressTable.userId, cardProgressTable.cardId],
      set: { locked, updatedAt: new Date() },
    });
  return locked;
}
