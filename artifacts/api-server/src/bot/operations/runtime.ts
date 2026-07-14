// Operations Center — runtime: start, complete, cancel, queue promotion.
// Fetches the board message and edits it in-place after every state change.

import { type Client, type TextChannel, MessageFlags } from "discord.js";
import { logger } from "../../lib/logger.js";
import {
  getOpsGuildConfig, getOpsBoard, getOrCreateOpsActive, updateOpsActive,
  getOpsResponders, getOpsQueueCount, addResponder, removeResponder,
  clearResponders, dequeueNextOp, enqueueOp, recordOpsHistory,
  getOpsQueue,
} from "./db.js";
import { getOpsTypeConfig } from "./db.js";
import { resolveOpConfig, buildBoardEmbed, buildQueueEmbed } from "./embeds.js";
import { buildBoardRows, buildChannelButtonRowFromConfig } from "./buttons.js";
import type { OpKey } from "./types.js";

// ── Board refresh ─────────────────────────────────────────────────────────────

/** Fetch the board message and edit it with the latest state. Silent on error. */
export async function refreshBoard(client: Client, guildId: string, opKey: OpKey): Promise<void> {
  try {
    const [board, active, cfg] = await Promise.all([
      getOpsBoard(guildId, opKey),
      getOrCreateOpsActive(guildId, opKey),
      getOpsTypeConfig(guildId, opKey),
    ]);

    if (!board) return; // boards not set up yet

    const channel = await client.channels.fetch(board.channelId).catch(() => null) as TextChannel | null;
    if (!channel?.isTextBased()) return;

    const message = await channel.messages.fetch(board.messageId).catch(() => null);
    if (!message) return;

    const resolved = resolveOpConfig(opKey, cfg);
    const responders = active.id ? await getOpsResponders(active.id) : [];
    const queueCount = await getOpsQueueCount(guildId, opKey);

    const embed = buildBoardEmbed(resolved, active, responders, queueCount);
    const rows = buildBoardRows(resolved, active, false); // board always shows generic state

    // Append custom channel buttons if configured
    if (cfg?.channelButtons?.length) {
      const customRow = buildChannelButtonRowFromConfig(cfg.channelButtons, active.status === "active");
      if (customRow) rows.push(customRow);
    }

    await message.edit({ embeds: [embed], components: rows.slice(0, 5) });
  } catch (err) {
    logger.warn({ err, guildId, opKey }, "ops: refreshBoard failed");
  }
}

// ── Start an operation ────────────────────────────────────────────────────────

export interface StartOpResult {
  ok: boolean;
  queued?: boolean;
  queuePosition?: number;
  error?: string;
}

export async function startOp(
  client: Client,
  guildId: string,
  opKey: OpKey,
  commanderId: string,
  objective: string | null,
  robloxLink: string | null,
  respondersNeeded: number,
): Promise<StartOpResult> {
  const guildCfg = await getOpsGuildConfig(guildId);
  if (!guildCfg?.enabled) return { ok: false, error: "Operations Center is not enabled in this server." };

  const typeCfg = await getOpsTypeConfig(guildId, opKey);
  if (typeCfg && !typeCfg.enabled) return { ok: false, error: "This operation type is disabled." };

  const active = await getOrCreateOpsActive(guildId, opKey);

  // If already active → queue it
  if (active.status === "active") {
    const queueCount = await getOpsQueueCount(guildId, opKey);
    const maxQueue = typeCfg?.maxQueueSize ?? 5;
    if (queueCount >= maxQueue) {
      return { ok: false, error: `The queue is full (max ${maxQueue}). Try again later.` };
    }
    await enqueueOp(guildId, opKey, commanderId, objective, robloxLink, respondersNeeded);
    const newCount = await getOpsQueueCount(guildId, opKey);
    await refreshBoard(client, guildId, opKey);
    return { ok: true, queued: true, queuePosition: newCount };
  }

  // Start the op
  const timeout = typeCfg?.timeoutMinutes ?? 60;
  const now = new Date();
  const autoCompleteAt = new Date(now.getTime() + timeout * 60 * 1000);

  await updateOpsActive(guildId, opKey, {
    status: "active",
    commanderId,
    objective,
    robloxLink,
    respondersNeeded,
    notes: null,
    startedAt: now,
    completedAt: null,
    autoCompleteAt,
  });

  await refreshBoard(client, guildId, opKey);

  // Ping staff role if configured
  void pingStaffRole(client, guildId, opKey, commanderId, objective);

  return { ok: true, queued: false };
}

// ── Complete / cancel ─────────────────────────────────────────────────────────

export async function completeOp(
  client: Client,
  guildId: string,
  opKey: OpKey,
  outcome: "completed" | "cancelled" | "timeout" = "completed",
): Promise<void> {
  const active = await getOrCreateOpsActive(guildId, opKey);
  if (active.status !== "active") return;

  const responders = await getOpsResponders(active.id);

  // Record history
  await recordOpsHistory(
    guildId, opKey, active.commanderId, active.objective,
    responders.length, active.respondersNeeded, active.startedAt, outcome,
  );

  // Clear responders
  await clearResponders(active.id);

  // Promote next from queue or go inactive
  const next = await dequeueNextOp(guildId, opKey);
  if (next) {
    const typeCfg = await getOpsTypeConfig(guildId, opKey);
    const timeout = typeCfg?.timeoutMinutes ?? 60;
    const now = new Date();
    await updateOpsActive(guildId, opKey, {
      status: "active",
      commanderId: next.requesterId,
      objective: next.objective,
      robloxLink: next.robloxLink,
      respondersNeeded: next.respondersNeeded,
      notes: null,
      startedAt: now,
      completedAt: null,
      autoCompleteAt: new Date(now.getTime() + timeout * 60 * 1000),
    });
  } else {
    await updateOpsActive(guildId, opKey, {
      status: "inactive",
      commanderId: null,
      objective: null,
      robloxLink: null,
      notes: null,
      startedAt: null,
      completedAt: new Date(),
      autoCompleteAt: null,
    });
  }

  await refreshBoard(client, guildId, opKey);
}

// ── Join / leave responder ────────────────────────────────────────────────────

export async function joinOp(
  client: Client,
  guildId: string,
  opKey: OpKey,
  userId: string,
): Promise<{ ok: boolean; alreadyIn?: boolean; message?: string }> {
  const active = await getOrCreateOpsActive(guildId, opKey);
  if (active.status !== "active") return { ok: false, message: "No active operation to join." };

  const added = await addResponder(active.id, guildId, opKey, userId);
  if (!added) return { ok: true, alreadyIn: true };

  await refreshBoard(client, guildId, opKey);
  return { ok: true, alreadyIn: false };
}

export async function leaveOp(
  client: Client,
  guildId: string,
  opKey: OpKey,
  userId: string,
): Promise<void> {
  const active = await getOrCreateOpsActive(guildId, opKey);
  if (active.status !== "active") return;
  await removeResponder(active.id, userId);
  await refreshBoard(client, guildId, opKey);
}

// ── Notes ────────────────────────────────────────────────────────────────────

export async function setOpNotes(
  client: Client,
  guildId: string,
  opKey: OpKey,
  notes: string,
): Promise<void> {
  await updateOpsActive(guildId, opKey, { notes });
  await refreshBoard(client, guildId, opKey);
}

// ── Maintenance tick (auto-timeout) ──────────────────────────────────────────

export function startOpsMaintenance(client: Client): void {
  // Check every 2 minutes for expired operations
  setInterval(() => void runOpsMaintenanceTick(client), 2 * 60 * 1000);
  logger.info("ops: maintenance ticker started");
}

async function runOpsMaintenanceTick(client: Client): Promise<void> {
  try {
    const { db, opsActiveTable } = await import("@workspace/db");
    const { eq, and, lte, isNotNull } = await import("drizzle-orm");

    const now = new Date();
    const expired = await db
      .select()
      .from(opsActiveTable)
      .where(
        and(
          eq(opsActiveTable.status, "active"),
          isNotNull(opsActiveTable.autoCompleteAt),
          lte(opsActiveTable.autoCompleteAt, now),
        ),
      );

    for (const op of expired) {
      logger.info({ guildId: op.guildId, opKey: op.opKey }, "ops: auto-completing timed-out operation");
      await completeOp(client, op.guildId, op.opKey as OpKey, "timeout");
    }
  } catch (err) {
    logger.warn({ err }, "ops: maintenance tick error");
  }
}

// ── Staff ping ────────────────────────────────────────────────────────────────

async function pingStaffRole(
  client: Client,
  guildId: string,
  opKey: OpKey,
  commanderId: string,
  objective: string | null,
): Promise<void> {
  try {
    const [guildCfg, board] = await Promise.all([
      getOpsGuildConfig(guildId),
      getOpsBoard(guildId, opKey),
    ]);
    if (!board || !guildCfg?.staffRoleId) return;

    const channel = await client.channels.fetch(board.channelId).catch(() => null) as TextChannel | null;
    if (!channel?.isTextBased()) return;

    const typeCfg = await getOpsTypeConfig(guildId, opKey);
    const resolved = resolveOpConfig(opKey, typeCfg);
    const objText = objective ? ` — ${objective}` : "";

    const msg = await channel.send({
      content: `<@&${guildCfg.staffRoleId}> ${resolved.emoji} **${resolved.label}** requested by <@${commanderId}>${objText}`,
      allowedMentions: { roles: [guildCfg.staffRoleId] },
    });

    // Auto-delete ping after 30s to keep channel clean
    setTimeout(() => { msg.delete().catch(() => {}); }, 30_000);
  } catch (err) {
    logger.warn({ err }, "ops: staff ping failed");
  }
}
