import {
  pgTable, text, serial, integer, timestamp, uniqueIndex, index,
} from "drizzle-orm/pg-core";

// ─────────────────────────────────────────────────────────────────────────────
// DN Cards — Squads (player-created guilds within a server)
//
// Players band together into squads; their collections and battle records
// aggregate into a combined "Squad Score" for a server-wide squad leaderboard —
// a natural fit for the military theme. Purely additive: two tables. All stats
// are DERIVED by aggregating the existing collection / currency / battle-profile
// tables, so nothing is duplicated and a squad's numbers are always live.
// ─────────────────────────────────────────────────────────────────────────────

export const squadsTable = pgTable("squads", {
  id: serial("id").primaryKey(),
  guildId: text("guild_id").notNull(),
  name: text("name").notNull(),
  tag: text("tag"),               // short [TAG] shown next to members
  description: text("description"),
  ownerId: text("owner_id").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => ({
  guildNameUniq: uniqueIndex("squads_guild_name_uniq").on(t.guildId, t.name),
  byGuild: index("squads_guild_idx").on(t.guildId),
}));

export type Squad = typeof squadsTable.$inferSelect;

// One row per member. The unique (guild, user) index enforces "at most one
// squad per player per server".
export const squadMembersTable = pgTable("squad_members", {
  id: serial("id").primaryKey(),
  guildId: text("guild_id").notNull(),
  squadId: integer("squad_id").notNull().references(() => squadsTable.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull(),
  role: text("role").notNull().default("member"), // "leader" | "member"
  joinedAt: timestamp("joined_at").notNull().defaultNow(),
}, (t) => ({
  guildUserUniq: uniqueIndex("squad_members_guild_user_uniq").on(t.guildId, t.userId),
  bySquad: index("squad_members_squad_idx").on(t.squadId),
}));

export type SquadMember = typeof squadMembersTable.$inferSelect;
