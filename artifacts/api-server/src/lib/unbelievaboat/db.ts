// UnbelievaBoat local DB helpers (settings, role links, store catalog, audit).

import {
  db,
  ubSettingsTable,
  ubRoleLinksTable,
  ubStoreCatalogTable,
  ubAuditLogTable,
  ubGameStateTable,
  type UbSettings,
  type UbRoleLink,
  type UbStoreCatalog,
  type UbGameState,
} from "@workspace/db";
import { and, desc, eq } from "drizzle-orm";
import { HOME_GUILD_ID } from "../../bot/home-guild.js";

export async function getOrCreateUbSettings(guildId: string): Promise<UbSettings> {
  const existing = await db.select().from(ubSettingsTable).where(eq(ubSettingsTable.guildId, guildId)).limit(1);
  if (existing[0]) return existing[0];
  const ubGuildId = guildId || HOME_GUILD_ID || guildId;
  const [row] = await db.insert(ubSettingsTable).values({
    guildId,
    ubGuildId,
  }).returning();
  return row!;
}

export async function updateUbSettings(
  guildId: string,
  patch: Partial<Pick<UbSettings,
    "ubGuildId" | "enabled" | "leaderboardSort" | "petsSpendUb" | "currencyLabel" |
    "gamesEnabled" | "storeEnabled" | "dailyMin" | "dailyMax" | "cooldowns" | "payouts" |
    "logChannelId" | "robImmuneRoleIds"
  >>,
): Promise<UbSettings> {
  await getOrCreateUbSettings(guildId);
  const [row] = await db.update(ubSettingsTable)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(ubSettingsTable.guildId, guildId))
    .returning();
  return row!;
}

export async function listRoleLinks(guildId: string): Promise<UbRoleLink[]> {
  return db.select().from(ubRoleLinksTable)
    .where(eq(ubRoleLinksTable.guildId, guildId))
    .orderBy(desc(ubRoleLinksTable.id));
}

export async function createRoleLink(
  guildId: string,
  data: {
    name: string;
    description?: string | null;
    discordRoleId?: string | null;
    ubItemId?: string | null;
    price?: number;
    grantCash?: number;
    incomeAmount?: number;
    category?: string;
    emoji?: string | null;
    enabled?: boolean;
  },
): Promise<UbRoleLink> {
  const [row] = await db.insert(ubRoleLinksTable).values({
    guildId,
    name: data.name,
    description: data.description ?? null,
    discordRoleId: data.discordRoleId ?? null,
    ubItemId: data.ubItemId ?? null,
    price: data.price ?? 0,
    grantCash: data.grantCash ?? 0,
    incomeAmount: data.incomeAmount ?? 0,
    category: data.category ?? "custom",
    emoji: data.emoji ?? null,
    enabled: data.enabled ?? true,
  }).returning();
  return row!;
}

export async function updateRoleLink(
  guildId: string,
  id: number,
  patch: Partial<{
    name: string;
    description: string | null;
    discordRoleId: string | null;
    ubItemId: string | null;
    price: number;
    grantCash: number;
    incomeAmount: number;
    category: string;
    emoji: string | null;
    enabled: boolean;
    meta: Record<string, unknown>;
  }>,
): Promise<UbRoleLink | null> {
  const [row] = await db.update(ubRoleLinksTable)
    .set({ ...patch, updatedAt: new Date() })
    .where(and(eq(ubRoleLinksTable.guildId, guildId), eq(ubRoleLinksTable.id, id)))
    .returning();
  return row ?? null;
}

export async function deleteRoleLink(guildId: string, id: number): Promise<boolean> {
  const rows = await db.delete(ubRoleLinksTable)
    .where(and(eq(ubRoleLinksTable.guildId, guildId), eq(ubRoleLinksTable.id, id)))
    .returning({ id: ubRoleLinksTable.id });
  return rows.length > 0;
}

export async function listCatalog(guildId: string, opts?: { forPets?: boolean }): Promise<UbStoreCatalog[]> {
  const rows = await db.select().from(ubStoreCatalogTable)
    .where(eq(ubStoreCatalogTable.guildId, guildId))
    .orderBy(desc(ubStoreCatalogTable.id));
  if (opts?.forPets) return rows.filter(r => r.forPets);
  return rows;
}

export async function createCatalogItem(
  guildId: string,
  data: {
    name: string;
    description?: string | null;
    price?: number;
    emoji?: string | null;
    category?: string;
    grantRoleId?: string | null;
    forPets?: boolean;
    petEffect?: string | null;
    petEffectValue?: number;
    listed?: boolean;
    meta?: Record<string, unknown>;
  },
): Promise<UbStoreCatalog> {
  const [row] = await db.insert(ubStoreCatalogTable).values({
    guildId,
    name: data.name,
    description: data.description ?? null,
    price: data.price ?? 0,
    emoji: data.emoji ?? null,
    category: data.category ?? "general",
    grantRoleId: data.grantRoleId ?? null,
    forPets: data.forPets ?? false,
    petEffect: data.petEffect ?? null,
    petEffectValue: data.petEffectValue ?? 0,
    listed: data.listed ?? true,
    meta: data.meta ?? {},
  }).returning();
  return row!;
}

export async function updateCatalogItem(
  guildId: string,
  id: number,
  patch: Partial<{
    name: string;
    description: string | null;
    price: number;
    emoji: string | null;
    category: string;
    ubItemId: string | null;
    grantRoleId: string | null;
    forPets: boolean;
    petEffect: string | null;
    petEffectValue: number;
    listed: boolean;
    isInventory: boolean;
    isUsable: boolean;
    isSellable: boolean;
    unlimitedStock: boolean;
    stockRemaining: number | null;
    meta: Record<string, unknown>;
  }>,
): Promise<UbStoreCatalog | null> {
  const [row] = await db.update(ubStoreCatalogTable)
    .set({ ...patch, updatedAt: new Date() })
    .where(and(eq(ubStoreCatalogTable.guildId, guildId), eq(ubStoreCatalogTable.id, id)))
    .returning();
  return row ?? null;
}

export async function deleteCatalogItem(guildId: string, id: number): Promise<boolean> {
  const rows = await db.delete(ubStoreCatalogTable)
    .where(and(eq(ubStoreCatalogTable.guildId, guildId), eq(ubStoreCatalogTable.id, id)))
    .returning({ id: ubStoreCatalogTable.id });
  return rows.length > 0;
}

export async function writeUbAudit(
  guildId: string,
  actorId: string,
  action: string,
  detail: Record<string, unknown> = {},
  targetUserId?: string | null,
): Promise<void> {
  await db.insert(ubAuditLogTable).values({
    guildId,
    actorId,
    action,
    detail,
    targetUserId: targetUserId ?? null,
  });
}

export async function listUbAudit(guildId: string, limit = 50) {
  return db.select().from(ubAuditLogTable)
    .where(eq(ubAuditLogTable.guildId, guildId))
    .orderBy(desc(ubAuditLogTable.id))
    .limit(limit);
}

export async function getOrCreateGameState(guildId: string, userId: string): Promise<UbGameState> {
  const existing = await db.select().from(ubGameStateTable)
    .where(and(eq(ubGameStateTable.guildId, guildId), eq(ubGameStateTable.userId, userId)))
    .limit(1);
  if (existing[0]) return existing[0];
  const [row] = await db.insert(ubGameStateTable).values({ guildId, userId }).returning();
  return row!;
}

export async function touchGameState(
  guildId: string,
  userId: string,
  patch: Partial<{
    lastDailyAt: Date | null;
    lastRobAt: Date | null;
    lastBegAt: Date | null;
    lastWorkAt: Date | null;
    lastCrimeAt: Date | null;
    lastRouletteAt: Date | null;
    lastBlackjackAt: Date | null;
    lastRussianAt: Date | null;
    lastCollectAt: Date | null;
    dailyStreak: number;
    meta: Record<string, unknown>;
  }>,
): Promise<UbGameState> {
  await getOrCreateGameState(guildId, userId);
  const [row] = await db.update(ubGameStateTable)
    .set({ ...patch, updatedAt: new Date() })
    .where(and(eq(ubGameStateTable.guildId, guildId), eq(ubGameStateTable.userId, userId)))
    .returning();
  return row!;
}
