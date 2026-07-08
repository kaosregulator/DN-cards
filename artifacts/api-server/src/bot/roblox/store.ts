import {
  db,
  robloxLinksTable,
  robloxVerificationsTable,
  robloxGuildSettingsTable,
  robloxRewardGrantsTable,
  type RobloxLink,
  type RobloxGuildSettings,
} from "@workspace/db";
import { and, eq } from "drizzle-orm";

const VERIFICATION_TTL_MS = 30 * 60 * 1000; // 30 minutes to paste the code

// A short, unambiguous verification code (no easily-confused chars).
export function generateVerifyCode(): string {
  const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  let out = "DN-";
  for (let i = 0; i < 6; i++) {
    out += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return out;
}

// ── Links ─────────────────────────────────────────────────────────────────────

export async function getLinkByDiscordId(discordUserId: string): Promise<RobloxLink | null> {
  const [row] = await db.select().from(robloxLinksTable)
    .where(eq(robloxLinksTable.discordUserId, discordUserId)).limit(1);
  return row ?? null;
}

export async function getLinkByRobloxId(robloxUserId: string): Promise<RobloxLink | null> {
  const [row] = await db.select().from(robloxLinksTable)
    .where(eq(robloxLinksTable.robloxUserId, robloxUserId)).limit(1);
  return row ?? null;
}

export async function upsertLink(link: {
  discordUserId: string;
  robloxUserId: string;
  robloxUsername: string;
  robloxDisplayName: string | null;
}): Promise<RobloxLink> {
  const now = new Date();
  const [row] = await db.insert(robloxLinksTable)
    .values({ ...link, verifiedAt: now, updatedAt: now })
    .onConflictDoUpdate({
      target: robloxLinksTable.discordUserId,
      set: {
        robloxUserId: link.robloxUserId,
        robloxUsername: link.robloxUsername,
        robloxDisplayName: link.robloxDisplayName,
        verifiedAt: now,
        updatedAt: now,
      },
    })
    .returning();
  return row;
}

export async function deleteLink(discordUserId: string): Promise<boolean> {
  const rows = await db.delete(robloxLinksTable)
    .where(eq(robloxLinksTable.discordUserId, discordUserId))
    .returning({ discordUserId: robloxLinksTable.discordUserId });
  return rows.length > 0;
}

// ── Pending verifications ──────────────────────────────────────────────────────

export async function startVerification(v: {
  discordUserId: string;
  code: string;
  robloxUserId: string;
  robloxUsername: string;
  robloxDisplayName: string | null;
}): Promise<void> {
  const expiresAt = new Date(Date.now() + VERIFICATION_TTL_MS);
  await db.insert(robloxVerificationsTable)
    .values({ ...v, expiresAt })
    .onConflictDoUpdate({
      target: robloxVerificationsTable.discordUserId,
      set: {
        code: v.code,
        robloxUserId: v.robloxUserId,
        robloxUsername: v.robloxUsername,
        robloxDisplayName: v.robloxDisplayName,
        expiresAt,
      },
    });
}

export async function getVerification(discordUserId: string) {
  const [row] = await db.select().from(robloxVerificationsTable)
    .where(eq(robloxVerificationsTable.discordUserId, discordUserId)).limit(1);
  if (!row) return null;
  if (row.expiresAt.getTime() < Date.now()) return null; // expired
  return row;
}

export async function clearVerification(discordUserId: string): Promise<void> {
  await db.delete(robloxVerificationsTable)
    .where(eq(robloxVerificationsTable.discordUserId, discordUserId));
}

// ── Per-guild config ───────────────────────────────────────────────────────────

export async function getGuildRobloxSettings(guildId: string): Promise<RobloxGuildSettings | null> {
  const [row] = await db.select().from(robloxGuildSettingsTable)
    .where(eq(robloxGuildSettingsTable.guildId, guildId)).limit(1);
  return row ?? null;
}

export async function upsertGuildRobloxSettings(
  guildId: string,
  patch: Partial<Pick<RobloxGuildSettings, "enabled" | "groupId" | "verifiedRoleId" | "linkBonusShards">>,
  updatedBy: string,
): Promise<RobloxGuildSettings> {
  const now = new Date();
  const [row] = await db.insert(robloxGuildSettingsTable)
    .values({ guildId, ...patch, updatedAt: now, updatedBy })
    .onConflictDoUpdate({
      target: robloxGuildSettingsTable.guildId,
      set: { ...patch, updatedAt: now, updatedBy },
    })
    .returning();
  return row;
}

// ── One-time link-bonus idempotency ─────────────────────────────────────────────
// Returns true if THIS call inserted the grant row (i.e. the bonus should be
// paid now); false if a grant already existed (already paid before).
export async function claimLinkBonusOnce(
  guildId: string,
  discordUserId: string,
  bonusShards: number,
): Promise<boolean> {
  const rows = await db.insert(robloxRewardGrantsTable)
    .values({ guildId, discordUserId, bonusShards })
    .onConflictDoNothing({
      target: [robloxRewardGrantsTable.guildId, robloxRewardGrantsTable.discordUserId],
    })
    .returning({ id: robloxRewardGrantsTable.id });
  return rows.length > 0;
}

export async function hasClaimedLinkBonus(guildId: string, discordUserId: string): Promise<boolean> {
  const [row] = await db.select({ id: robloxRewardGrantsTable.id })
    .from(robloxRewardGrantsTable)
    .where(and(
      eq(robloxRewardGrantsTable.guildId, guildId),
      eq(robloxRewardGrantsTable.discordUserId, discordUserId),
    )).limit(1);
  return !!row;
}
