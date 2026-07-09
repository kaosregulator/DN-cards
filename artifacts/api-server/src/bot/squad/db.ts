// Squad data-access layer. Squad membership is stored; all stats are DERIVED by
// aggregating the existing collection / currency / battle-profile tables so the
// numbers are always live and nothing is duplicated.

import {
  db, squadsTable, squadMembersTable,
  collectionsTable, cardsTable, userCurrencyTable, battleProfilesTable,
} from "@workspace/db";
import type { Squad, SquadMember } from "@workspace/db";
import { and, eq, sql, asc } from "drizzle-orm";

function num(v: unknown): number { return typeof v === "number" ? v : Number(v ?? 0); }

// ── Membership ───────────────────────────────────────────────────────────────
export async function getUserSquad(guildId: string, userId: string): Promise<{ squad: Squad; role: string } | null> {
  const [row] = await db.select({ squad: squadsTable, role: squadMembersTable.role })
    .from(squadMembersTable)
    .innerJoin(squadsTable, eq(squadsTable.id, squadMembersTable.squadId))
    .where(and(eq(squadMembersTable.guildId, guildId), eq(squadMembersTable.userId, userId)))
    .limit(1);
  return row ? { squad: row.squad, role: row.role } : null;
}

export async function getSquadByName(guildId: string, name: string): Promise<Squad | null> {
  const rows = await db.select().from(squadsTable).where(eq(squadsTable.guildId, guildId));
  const q = name.toLowerCase().trim();
  return rows.find(s => s.name.toLowerCase() === q)
    ?? rows.find(s => s.name.toLowerCase().includes(q))
    ?? null;
}

export async function getSquadById(id: number): Promise<Squad | null> {
  const [row] = await db.select().from(squadsTable).where(eq(squadsTable.id, id)).limit(1);
  return row ?? null;
}

export async function getSquadMembers(squadId: number): Promise<SquadMember[]> {
  return db.select().from(squadMembersTable)
    .where(eq(squadMembersTable.squadId, squadId))
    .orderBy(asc(squadMembersTable.joinedAt));
}

export type CreateResult =
  | { ok: true; squad: Squad }
  | { ok: false; reason: "name_taken" | "already_in_squad" };

export async function createSquad(args: {
  guildId: string; name: string; ownerId: string; tag?: string | null; description?: string | null;
}): Promise<CreateResult> {
  if (await getUserSquad(args.guildId, args.ownerId)) return { ok: false, reason: "already_in_squad" };
  const existing = await getSquadByNameExact(args.guildId, args.name);
  if (existing) return { ok: false, reason: "name_taken" };

  return await db.transaction(async (tx) => {
    const [squad] = await tx.insert(squadsTable)
      .values({ guildId: args.guildId, name: args.name, ownerId: args.ownerId, tag: args.tag ?? null, description: args.description ?? null })
      .returning();
    await tx.insert(squadMembersTable)
      .values({ guildId: args.guildId, squadId: squad!.id, userId: args.ownerId, role: "leader" });
    return { ok: true as const, squad: squad! };
  });
}

async function getSquadByNameExact(guildId: string, name: string): Promise<Squad | null> {
  const [row] = await db.select().from(squadsTable)
    .where(and(eq(squadsTable.guildId, guildId), sql`lower(${squadsTable.name}) = ${name.toLowerCase().trim()}`))
    .limit(1);
  return row ?? null;
}

export type JoinResult = "ok" | "already_in_squad";

export async function joinSquad(guildId: string, squadId: number, userId: string): Promise<JoinResult> {
  const res = await db.insert(squadMembersTable)
    .values({ guildId, squadId, userId, role: "member" })
    .onConflictDoNothing() // unique (guild,user) → already in a squad
    .returning({ id: squadMembersTable.id });
  return res.length > 0 ? "ok" : "already_in_squad";
}

export async function leaveSquad(guildId: string, userId: string): Promise<void> {
  await db.delete(squadMembersTable)
    .where(and(eq(squadMembersTable.guildId, guildId), eq(squadMembersTable.userId, userId)));
}

export async function disbandSquad(squadId: number): Promise<void> {
  // Cascade deletes members.
  await db.delete(squadsTable).where(eq(squadsTable.id, squadId));
}

// ── Aggregated stats ─────────────────────────────────────────────────────────
export interface SquadStats {
  memberCount: number;
  collectionValue: number;   // Σ worthValue × (count + shinyCount)
  totalCards: number;
  shards: number;
  packsOpened: number;
  cardsBurned: number;
  wins: number;
  losses: number;
  score: number;             // headline "Squad Score"
}

export function squadScore(collectionValue: number, wins: number, cardsBurned: number): number {
  return Math.round(collectionValue + wins * 200 + cardsBurned * 5);
}

export async function getSquadStats(squadId: number): Promise<SquadStats> {
  const members = await getSquadMembers(squadId);
  const ids = members.map(m => m.userId);
  if (ids.length === 0) {
    return { memberCount: 0, collectionValue: 0, totalCards: 0, shards: 0, packsOpened: 0, cardsBurned: 0, wins: 0, losses: 0, score: 0 };
  }
  const guildId = members[0]!.guildId;

  const [[coll], [curr], [prof]] = await Promise.all([
    db.select({
      value: sql`coalesce(sum(${cardsTable.worthValue} * (${collectionsTable.count} + ${collectionsTable.shinyCount})), 0)`,
      cards: sql`coalesce(sum(${collectionsTable.count} + ${collectionsTable.shinyCount}), 0)`,
    }).from(collectionsTable)
      .innerJoin(cardsTable, eq(cardsTable.id, collectionsTable.cardId))
      .where(and(eq(collectionsTable.guildId, guildId), sql`${collectionsTable.userId} IN ${ids}`)),
    db.select({
      shards: sql`coalesce(sum(${userCurrencyTable.shards}), 0)`,
      packs: sql`coalesce(sum(${userCurrencyTable.packsOpened}), 0)`,
      burned: sql`coalesce(sum(${userCurrencyTable.cardsBurned}), 0)`,
    }).from(userCurrencyTable)
      .where(and(eq(userCurrencyTable.guildId, guildId), sql`${userCurrencyTable.userId} IN ${ids}`)),
    db.select({
      wins: sql`coalesce(sum(${battleProfilesTable.wins}), 0)`,
      losses: sql`coalesce(sum(${battleProfilesTable.losses}), 0)`,
    }).from(battleProfilesTable)
      .where(and(eq(battleProfilesTable.guildId, guildId), sql`${battleProfilesTable.userId} IN ${ids}`)),
  ]);

  const collectionValue = num(coll?.value);
  const wins = num(prof?.wins);
  const cardsBurned = num(curr?.burned);
  return {
    memberCount: ids.length,
    collectionValue,
    totalCards: num(coll?.cards),
    shards: num(curr?.shards),
    packsOpened: num(curr?.packs),
    cardsBurned,
    wins,
    losses: num(prof?.losses),
    score: squadScore(collectionValue, wins, cardsBurned),
  };
}

// Server-wide squad leaderboard. Computes collection value + wins per squad in
// two grouped joins, then ranks by Squad Score.
export interface SquadRankRow {
  squad: Squad;
  memberCount: number;
  collectionValue: number;
  wins: number;
  score: number;
}

export async function getSquadLeaderboard(guildId: string, limit = 15): Promise<SquadRankRow[]> {
  const squads = await db.select().from(squadsTable).where(eq(squadsTable.guildId, guildId));
  if (squads.length === 0) return [];

  const [counts, values, wins] = await Promise.all([
    db.select({ squadId: squadMembersTable.squadId, n: sql`count(*)` })
      .from(squadMembersTable).where(eq(squadMembersTable.guildId, guildId))
      .groupBy(squadMembersTable.squadId),
    db.select({
      squadId: squadMembersTable.squadId,
      value: sql`coalesce(sum(${cardsTable.worthValue} * (${collectionsTable.count} + ${collectionsTable.shinyCount})), 0)`,
    }).from(squadMembersTable)
      .innerJoin(collectionsTable, and(eq(collectionsTable.guildId, squadMembersTable.guildId), eq(collectionsTable.userId, squadMembersTable.userId)))
      .innerJoin(cardsTable, eq(cardsTable.id, collectionsTable.cardId))
      .where(eq(squadMembersTable.guildId, guildId))
      .groupBy(squadMembersTable.squadId),
    db.select({
      squadId: squadMembersTable.squadId,
      wins: sql`coalesce(sum(${battleProfilesTable.wins}), 0)`,
    }).from(squadMembersTable)
      .innerJoin(battleProfilesTable, and(eq(battleProfilesTable.guildId, squadMembersTable.guildId), eq(battleProfilesTable.userId, squadMembersTable.userId)))
      .where(eq(squadMembersTable.guildId, guildId))
      .groupBy(squadMembersTable.squadId),
  ]);

  const countMap = new Map(counts.map(r => [r.squadId, num(r.n)]));
  const valueMap = new Map(values.map(r => [r.squadId, num(r.value)]));
  const winMap = new Map(wins.map(r => [r.squadId, num(r.wins)]));

  return squads.map(squad => {
    const collectionValue = valueMap.get(squad.id) ?? 0;
    const w = winMap.get(squad.id) ?? 0;
    return {
      squad, memberCount: countMap.get(squad.id) ?? 0,
      collectionValue, wins: w, score: squadScore(collectionValue, w, 0),
    };
  }).sort((a, b) => b.score - a.score).slice(0, limit);
}
