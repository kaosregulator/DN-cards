import {
  db, userCurrencyTable, tradesTable, serverStatsTable,
  type ServerStats,
} from "@workspace/db";
import { and, eq, sql } from "drizzle-orm";

export interface ServerRankRow {
  guildId: string;
  guildName: string | null;
  totalShards: number;
  packsOpened: number;
  tradesWon: number;
  battlesWon: number;
  optOut: boolean;
  score: number;
}

// Composite "server power score" — weighted so every axis matters but no single
// one dominates. Shards are the raw economy; the rest are activity multipliers.
export function powerScore(r: {
  totalShards: number; packsOpened: number; tradesWon: number; battlesWon: number;
}): number {
  return Math.round(
    r.totalShards +
    r.packsOpened * 100 +
    r.tradesWon * 150 +
    r.battlesWon * 250,
  );
}

// ── server_stats row helpers ────────────────────────────────────────────────

export async function getServerStats(guildId: string): Promise<ServerStats | null> {
  const [row] = await db.select().from(serverStatsTable)
    .where(eq(serverStatsTable.guildId, guildId)).limit(1);
  return row ?? null;
}

// Refresh the cached display name (best-effort, called when we can see the guild).
export async function cacheGuildName(guildId: string, guildName: string): Promise<void> {
  await db.insert(serverStatsTable)
    .values({ guildId, guildName, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: serverStatsTable.guildId,
      set: { guildName, updatedAt: new Date() },
    });
}

export async function setServerOptOut(guildId: string, optOut: boolean): Promise<void> {
  await db.insert(serverStatsTable)
    .values({ guildId, optOut, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: serverStatsTable.guildId,
      set: { optOut, updatedAt: new Date() },
    });
}

// Increment the guild's battles-won counter (called by the battling feature).
export async function incrementBattlesWon(guildId: string, by = 1): Promise<void> {
  await db.insert(serverStatsTable)
    .values({ guildId, battlesWon: by, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: serverStatsTable.guildId,
      set: {
        battlesWon: sql`${serverStatsTable.battlesWon} + ${by}`,
        updatedAt: new Date(),
      },
    });
}

// ── Global aggregation ─────────────────────────────────────────────────────
// Builds the ranked list of servers. Money/pack/trade metrics are aggregated
// live from the per-guild tables; battles + opt-out + name come from
// server_stats. Opted-out servers are excluded.
export async function getGlobalServerRanking(): Promise<ServerRankRow[]> {
  const currencyRows = await db
    .select({
      guildId: userCurrencyTable.guildId,
      totalShards: sql<number>`COALESCE(SUM(${userCurrencyTable.shards}), 0)`,
      packsOpened: sql<number>`COALESCE(SUM(${userCurrencyTable.packsOpened}), 0)`,
    })
    .from(userCurrencyTable)
    .groupBy(userCurrencyTable.guildId);

  const tradeRows = await db
    .select({
      guildId: tradesTable.guildId,
      tradesWon: sql<number>`COUNT(*)`,
    })
    .from(tradesTable)
    .where(eq(tradesTable.status, "accepted"))
    .groupBy(tradesTable.guildId);

  const statsRows = await db.select().from(serverStatsTable);

  const byGuild = new Map<string, ServerRankRow>();
  const ensure = (guildId: string): ServerRankRow => {
    let row = byGuild.get(guildId);
    if (!row) {
      row = {
        guildId, guildName: null, totalShards: 0, packsOpened: 0,
        tradesWon: 0, battlesWon: 0, optOut: false, score: 0,
      };
      byGuild.set(guildId, row);
    }
    return row;
  };

  for (const c of currencyRows) {
    const row = ensure(c.guildId);
    row.totalShards = Number(c.totalShards) || 0;
    row.packsOpened = Number(c.packsOpened) || 0;
  }
  for (const t of tradeRows) {
    ensure(t.guildId).tradesWon = Number(t.tradesWon) || 0;
  }
  for (const s of statsRows) {
    const row = ensure(s.guildId);
    row.guildName = s.guildName;
    row.battlesWon = s.battlesWon;
    row.optOut = s.optOut;
  }

  const rows = [...byGuild.values()].filter(r => !r.optOut);
  for (const r of rows) r.score = powerScore(r);
  return rows;
}

export type RankMetric = "power" | "shards" | "packs" | "battles" | "trades";

export function sortByMetric(rows: ServerRankRow[], metric: RankMetric): ServerRankRow[] {
  const key = (r: ServerRankRow): number => {
    switch (metric) {
      case "shards": return r.totalShards;
      case "packs": return r.packsOpened;
      case "battles": return r.battlesWon;
      case "trades": return r.tradesWon;
      default: return r.score;
    }
  };
  return rows.slice().sort((a, b) => key(b) - key(a) || a.guildId.localeCompare(b.guildId));
}
