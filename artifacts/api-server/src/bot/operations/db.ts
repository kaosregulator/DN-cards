// Operations Center — data access layer.
// All queries are per-guild. Never touches cards, economy, or battle tables.

import { eq, and, asc, count } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  opsGuildConfigTable,
  opsTypeConfigTable,
  opsBoardsTable,
  opsActiveTable,
  opsQueueTable,
  opsRespondersTable,
  opsHistoryTable,
  type OpsGuildConfig,
  type OpsTypeConfig,
  type OpsBoard,
  type OpsActive,
  type OpsQueue,
  type OpsResponder,
  type OpChannelButton,
} from "@workspace/db";
import type { OpKey, OpStatus } from "./types.js";

// ── Guild config ──────────────────────────────────────────────────────────────

export async function getOpsGuildConfig(guildId: string): Promise<OpsGuildConfig | null> {
  const rows = await db
    .select()
    .from(opsGuildConfigTable)
    .where(eq(opsGuildConfigTable.guildId, guildId))
    .limit(1);
  return rows[0] ?? null;
}

export async function upsertOpsGuildConfig(
  guildId: string,
  patch: Partial<Omit<OpsGuildConfig, "id" | "guildId" | "createdAt">>,
): Promise<OpsGuildConfig> {
  const existing = await getOpsGuildConfig(guildId);
  if (!existing) {
    const rows = await db
      .insert(opsGuildConfigTable)
      .values({ guildId, ...patch })
      .returning();
    return rows[0]!;
  }
  const rows = await db
    .update(opsGuildConfigTable)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(opsGuildConfigTable.guildId, guildId))
    .returning();
  return rows[0]!;
}

// ── Op-type config ────────────────────────────────────────────────────────────

export async function getOpsTypeConfig(guildId: string, opKey: OpKey): Promise<OpsTypeConfig | null> {
  const rows = await db
    .select()
    .from(opsTypeConfigTable)
    .where(and(eq(opsTypeConfigTable.guildId, guildId), eq(opsTypeConfigTable.opKey, opKey)))
    .limit(1);
  return rows[0] ?? null;
}

export async function getAllOpsTypeConfigs(guildId: string): Promise<OpsTypeConfig[]> {
  return db.select().from(opsTypeConfigTable).where(eq(opsTypeConfigTable.guildId, guildId));
}

export async function upsertOpsTypeConfig(
  guildId: string,
  opKey: OpKey,
  patch: Partial<Omit<OpsTypeConfig, "id" | "guildId" | "opKey">>,
): Promise<OpsTypeConfig> {
  const existing = await getOpsTypeConfig(guildId, opKey);
  if (!existing) {
    const rows = await db
      .insert(opsTypeConfigTable)
      .values({ guildId, opKey, ...patch })
      .returning();
    return rows[0]!;
  }
  const rows = await db
    .update(opsTypeConfigTable)
    .set({ ...patch, updatedAt: new Date() })
    .where(and(eq(opsTypeConfigTable.guildId, guildId), eq(opsTypeConfigTable.opKey, opKey)))
    .returning();
  return rows[0]!;
}

// ── Boards ────────────────────────────────────────────────────────────────────

export async function getOpsBoard(guildId: string, opKey: OpKey): Promise<OpsBoard | null> {
  const rows = await db
    .select()
    .from(opsBoardsTable)
    .where(and(eq(opsBoardsTable.guildId, guildId), eq(opsBoardsTable.opKey, opKey)))
    .limit(1);
  return rows[0] ?? null;
}

export async function getAllOpsBoards(guildId: string): Promise<OpsBoard[]> {
  return db.select().from(opsBoardsTable).where(eq(opsBoardsTable.guildId, guildId));
}

export async function upsertOpsBoard(
  guildId: string,
  opKey: OpKey,
  channelId: string,
  messageId: string,
): Promise<OpsBoard> {
  const existing = await getOpsBoard(guildId, opKey);
  if (!existing) {
    const rows = await db
      .insert(opsBoardsTable)
      .values({ guildId, opKey, channelId, messageId })
      .returning();
    return rows[0]!;
  }
  const rows = await db
    .update(opsBoardsTable)
    .set({ channelId, messageId })
    .where(and(eq(opsBoardsTable.guildId, guildId), eq(opsBoardsTable.opKey, opKey)))
    .returning();
  return rows[0]!;
}

export async function deleteOpsBoard(guildId: string, opKey: OpKey): Promise<void> {
  await db
    .delete(opsBoardsTable)
    .where(and(eq(opsBoardsTable.guildId, guildId), eq(opsBoardsTable.opKey, opKey)));
}

// ── Active operation ──────────────────────────────────────────────────────────

export async function getOpsActive(guildId: string, opKey: OpKey): Promise<OpsActive | null> {
  const rows = await db
    .select()
    .from(opsActiveTable)
    .where(and(eq(opsActiveTable.guildId, guildId), eq(opsActiveTable.opKey, opKey)))
    .limit(1);
  return rows[0] ?? null;
}

export async function getOrCreateOpsActive(guildId: string, opKey: OpKey): Promise<OpsActive> {
  const existing = await getOpsActive(guildId, opKey);
  if (existing) return existing;
  const rows = await db
    .insert(opsActiveTable)
    .values({ guildId, opKey, status: "inactive" })
    .returning();
  return rows[0]!;
}

export async function updateOpsActive(
  guildId: string,
  opKey: OpKey,
  patch: Partial<Omit<OpsActive, "id" | "guildId" | "opKey">>,
): Promise<OpsActive | null> {
  const rows = await db
    .update(opsActiveTable)
    .set(patch)
    .where(and(eq(opsActiveTable.guildId, guildId), eq(opsActiveTable.opKey, opKey)))
    .returning();
  return rows[0] ?? null;
}

// ── Queue ─────────────────────────────────────────────────────────────────────

export async function getOpsQueue(guildId: string, opKey: OpKey): Promise<OpsQueue[]> {
  return db
    .select()
    .from(opsQueueTable)
    .where(and(eq(opsQueueTable.guildId, guildId), eq(opsQueueTable.opKey, opKey)))
    .orderBy(asc(opsQueueTable.queuedAt));
}

export async function getOpsQueueCount(guildId: string, opKey: OpKey): Promise<number> {
  const rows = await db
    .select({ n: count() })
    .from(opsQueueTable)
    .where(and(eq(opsQueueTable.guildId, guildId), eq(opsQueueTable.opKey, opKey)));
  return Number(rows[0]?.n ?? 0);
}

export async function enqueueOp(
  guildId: string,
  opKey: OpKey,
  requesterId: string,
  objective: string | null,
  robloxLink: string | null,
  respondersNeeded: number,
): Promise<OpsQueue> {
  const rows = await db
    .insert(opsQueueTable)
    .values({ guildId, opKey, requesterId, objective, robloxLink, respondersNeeded })
    .returning();
  return rows[0]!;
}

export async function dequeueNextOp(guildId: string, opKey: OpKey): Promise<OpsQueue | null> {
  const rows = await db
    .select()
    .from(opsQueueTable)
    .where(and(eq(opsQueueTable.guildId, guildId), eq(opsQueueTable.opKey, opKey)))
    .orderBy(asc(opsQueueTable.queuedAt))
    .limit(1);
  const next = rows[0];
  if (!next) return null;
  await db.delete(opsQueueTable).where(eq(opsQueueTable.id, next.id));
  return next;
}

export async function clearOpsQueue(guildId: string, opKey: OpKey): Promise<void> {
  await db
    .delete(opsQueueTable)
    .where(and(eq(opsQueueTable.guildId, guildId), eq(opsQueueTable.opKey, opKey)));
}

// ── Responders ────────────────────────────────────────────────────────────────

export async function getOpsResponders(activeOpId: number): Promise<OpsResponder[]> {
  return db
    .select()
    .from(opsRespondersTable)
    .where(eq(opsRespondersTable.activeOpId, activeOpId))
    .orderBy(asc(opsRespondersTable.joinedAt));
}

export async function addResponder(
  activeOpId: number,
  guildId: string,
  opKey: OpKey,
  userId: string,
): Promise<OpsResponder | null> {
  try {
    const rows = await db
      .insert(opsRespondersTable)
      .values({ activeOpId, guildId, opKey, userId })
      .onConflictDoNothing()
      .returning();
    return rows[0] ?? null;
  } catch {
    return null;
  }
}

export async function removeResponder(activeOpId: number, userId: string): Promise<void> {
  await db
    .delete(opsRespondersTable)
    .where(and(eq(opsRespondersTable.activeOpId, activeOpId), eq(opsRespondersTable.userId, userId)));
}

export async function clearResponders(activeOpId: number): Promise<void> {
  await db.delete(opsRespondersTable).where(eq(opsRespondersTable.activeOpId, activeOpId));
}

// ── History / stats ───────────────────────────────────────────────────────────

export async function recordOpsHistory(
  guildId: string,
  opKey: OpKey,
  commanderId: string | null,
  objective: string | null,
  responderCount: number,
  respondersNeeded: number,
  startedAt: Date | null,
  outcome: "completed" | "cancelled" | "timeout",
): Promise<void> {
  const now = new Date();
  const responseTimeSeconds =
    startedAt ? Math.floor((now.getTime() - startedAt.getTime()) / 1000) : null;
  await db.insert(opsHistoryTable).values({
    guildId, opKey, commanderId, objective, responderCount, respondersNeeded,
    startedAt, completedAt: now, responseTimeSeconds, outcome,
  });
}

export interface OpsStats {
  opKey: OpKey;
  totalStarted: number;
  totalCompleted: number;
  avgResponseSeconds: number | null;
}

export async function getOpsStats(guildId: string): Promise<OpsStats[]> {
  // Pull raw history rows and aggregate in JS to keep it simple
  const rows = await db
    .select()
    .from(opsHistoryTable)
    .where(eq(opsHistoryTable.guildId, guildId));

  const map = new Map<OpKey, { started: number; completed: number; times: number[] }>();
  for (const r of rows) {
    const key = r.opKey as OpKey;
    if (!map.has(key)) map.set(key, { started: 0, completed: 0, times: [] });
    const entry = map.get(key)!;
    entry.started++;
    if (r.outcome === "completed") entry.completed++;
    if (r.responseTimeSeconds != null) entry.times.push(r.responseTimeSeconds);
  }

  return Array.from(map.entries()).map(([opKey, d]) => ({
    opKey,
    totalStarted: d.started,
    totalCompleted: d.completed,
    avgResponseSeconds: d.times.length > 0
      ? Math.round(d.times.reduce((a, b) => a + b, 0) / d.times.length)
      : null,
  }));
}
