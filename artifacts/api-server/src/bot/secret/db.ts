// Echo-Whisper data-access layer. Replaces the original bot's JSON-file storage
// with the shared database (per-guild isolated, survives restarts).

import {
  db,
  secretTransmissionsTable, secretSettingsTable,
} from "@workspace/db";
import type { SecretSettings, SecretTransmission } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { generateCode } from "./crypto.js";

// ── Settings ─────────────────────────────────────────────────────────────────
export async function getSecretSettings(guildId: string): Promise<SecretSettings> {
  const [row] = await db.select().from(secretSettingsTable)
    .where(eq(secretSettingsTable.guildId, guildId)).limit(1);
  if (row) return row;
  const [created] = await db.insert(secretSettingsTable)
    .values({ guildId })
    .onConflictDoNothing()
    .returning();
  if (created) return created;
  // Lost an insert race — read the row the other writer created.
  const [existing] = await db.select().from(secretSettingsTable)
    .where(eq(secretSettingsTable.guildId, guildId)).limit(1);
  return existing!;
}

export async function isAdminOverrideEnabled(guildId: string): Promise<boolean> {
  return (await getSecretSettings(guildId)).adminOverride;
}

export async function setAdminOverride(guildId: string, enabled: boolean): Promise<void> {
  await getSecretSettings(guildId);
  await db.update(secretSettingsTable)
    .set({ adminOverride: enabled, updatedAt: new Date() })
    .where(eq(secretSettingsTable.guildId, guildId));
}

export async function listViewerRoles(guildId: string): Promise<string[]> {
  return (await getSecretSettings(guildId)).viewerRoleIds;
}

export async function addViewerRole(guildId: string, roleId: string): Promise<void> {
  const current = await listViewerRoles(guildId);
  if (current.includes(roleId)) return;
  await db.update(secretSettingsTable)
    .set({ viewerRoleIds: [...current, roleId], updatedAt: new Date() })
    .where(eq(secretSettingsTable.guildId, guildId));
}

// Returns true if the role was present and removed.
export async function removeViewerRole(guildId: string, roleId: string): Promise<boolean> {
  const current = await listViewerRoles(guildId);
  if (!current.includes(roleId)) return false;
  await db.update(secretSettingsTable)
    .set({ viewerRoleIds: current.filter(r => r !== roleId), updatedAt: new Date() })
    .where(eq(secretSettingsTable.guildId, guildId));
  return true;
}

// True if any of the member's roles is an authorized viewer role.
export async function hasViewerAccess(guildId: string, memberRoleIds: string[]): Promise<boolean> {
  const allowed = await listViewerRoles(guildId);
  if (allowed.length === 0) return false;
  return memberRoleIds.some(r => allowed.includes(r));
}

// ── Transmissions ────────────────────────────────────────────────────────────
export async function storeTransmission(
  guildId: string,
  payload: string,
  type: "whisper" | "adminsecret",
  senderId: string,
  receiverId?: string,
): Promise<string> {
  // Retry on the rare per-guild code collision.
  for (let attempt = 0; attempt < 6; attempt++) {
    const code = generateCode();
    const res = await db.insert(secretTransmissionsTable)
      .values({ guildId, code, payload, type, senderId, receiverId: receiverId ?? null })
      .onConflictDoNothing()
      .returning({ code: secretTransmissionsTable.code });
    if (res.length > 0) return code;
  }
  throw new Error("Could not allocate a unique transmission code");
}

export async function getTransmission(guildId: string, code: string): Promise<SecretTransmission | null> {
  const [row] = await db.select().from(secretTransmissionsTable)
    .where(and(eq(secretTransmissionsTable.guildId, guildId), eq(secretTransmissionsTable.code, code)))
    .limit(1);
  return row ?? null;
}
