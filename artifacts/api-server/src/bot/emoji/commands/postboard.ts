// ─────────────────────────────────────────────────────────────────────────────
// /postboard — staff posts the shared emoji maker into a channel.
//
// The message is the same target chooser as `/emoji`, but public and persistent.
// Each member who taps it gets their own private (ephemeral) session so many
// people can use the board at once. Per-user cooldowns arm *after* a successful
// generate (browsing stays free). Post-to-channel is disabled on these sessions.
// Optional allow_role / block_role on the slash command gate who may tap the
// live board (encoded into the component token so it survives restarts).
// ─────────────────────────────────────────────────────────────────────────────

import {
  ChannelType, PermissionFlagsBits,
  type ChatInputCommandInteraction, type GuildMember, type GuildTextBasedChannel,
} from "discord.js";
import { logger } from "../../../lib/logger.js";
import { buildPublicBoard, encodeBoardToken, type BoardAccess } from "./ui.js";

/** Minimum gap after one user finishes a generate before they may start again. */
export const BOARD_COOLDOWN_MS = 30_000;

const lastBoardGenerate = new Map<string, number>();

function cooldownKey(guildId: string, userId: string): string {
  return `${guildId}:${userId}`;
}

export interface BoardCooldownResult {
  ok: boolean;
  retryMs?: number;
  message?: string;
}

/**
 * Check whether `userId` may start a new postboard session.
 *
 * Does **not** arm the timer — browsing and picking a target stay free. The
 * cooldown is armed only after a successful generate ({@link armBoardCooldown}).
 */
export function checkBoardCooldown(guildId: string, userId: string): BoardCooldownResult {
  const key = cooldownKey(guildId, userId);
  const now = Date.now();
  const last = lastBoardGenerate.get(key) ?? 0;
  const elapsed = now - last;
  if (elapsed < BOARD_COOLDOWN_MS) {
    const retryMs = Math.max(1000, BOARD_COOLDOWN_MS - elapsed);
    return {
      ok: false,
      retryMs,
      message: `⏳ Easy — you can use the emoji board again in **${Math.ceil(retryMs / 1000)}s**.`,
    };
  }
  return { ok: true };
}

/**
 * Arm the per-user postboard cooldown after a successful emoji generate.
 *
 * Keyed by guild + user so one server's spam does not block another, and so
 * two members of the same server never share a cooldown.
 */
export function armBoardCooldown(guildId: string, userId: string): void {
  lastBoardGenerate.set(cooldownKey(guildId, userId), Date.now());
}

/** @deprecated Prefer {@link checkBoardCooldown} + {@link armBoardCooldown}. */
export function consumeBoardCooldown(guildId: string, userId: string): BoardCooldownResult {
  const checked = checkBoardCooldown(guildId, userId);
  if (!checked.ok) return checked;
  armBoardCooldown(guildId, userId);
  return { ok: true };
}

/** Test helper — clears in-memory board cooldowns. */
export function resetBoardCooldownsForTesting(): void {
  lastBoardGenerate.clear();
}

/**
 * Whether a guild member may use the live postboard.
 *
 * - If any allow roles are set, the member must hold at least one (admins always pass).
 * - If any block roles are set, holding any of them denies access (admins always pass).
 * - `/emoji` is unaffected — this only gates the channel board.
 */
export function memberMayUseBoard(
  member: GuildMember | null | undefined,
  access: BoardAccess,
  opts?: { isGuildOwner?: boolean; isAdministrator?: boolean },
): { ok: true } | { ok: false; message: string } {
  if (opts?.isGuildOwner || opts?.isAdministrator) return { ok: true };
  if (!member) {
    return { ok: false, message: "❌ Couldn't verify your roles for this board." };
  }

  const roles = member.roles.cache;
  if (access.allowRoleIds.length > 0) {
    const allowed = access.allowRoleIds.some(id => roles.has(id));
    if (!allowed) {
      return {
        ok: false,
        message: "🔒 This emoji board is limited to certain roles. Ask a staff member if you need access.",
      };
    }
  }
  if (access.blockRoleIds.length > 0) {
    const blocked = access.blockRoleIds.some(id => roles.has(id));
    if (blocked) {
      return {
        ok: false,
        message: "🔒 Your role can't use this emoji board. Ask a staff member if that seems wrong.",
      };
    }
  }
  return { ok: true };
}

/** `/postboard` — admin posts the shared board into a chosen channel. */
export async function handlePostboardCommand(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  if (!interaction.guild) return;
  // Caller (handleAdminCommand) already deferred ephemerally.

  // Lazy import so unit tests for cooldowns/UI don't need DATABASE_URL.
  const { isAdmin } = await import("../../db.js");
  const isAuthorized =
    interaction.guild.ownerId === interaction.user.id
    || interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)
    || (await isAdmin(interaction.guild.id, interaction.user.id));
  if (!isAuthorized) {
    await interaction.editReply("❌ Only admins can post an emoji board.");
    return;
  }

  const channel = interaction.options.getChannel("channel", true);
  if (
    !channel
    || (channel.type !== ChannelType.GuildText && channel.type !== ChannelType.GuildAnnouncement)
  ) {
    await interaction.editReply("❌ Choose a text or announcement channel.");
    return;
  }
  const textChannel = channel as GuildTextBasedChannel;

  const allowRole = interaction.options.getRole("allow_role");
  const blockRole = interaction.options.getRole("block_role");
  if (allowRole && blockRole && allowRole.id === blockRole.id) {
    await interaction.editReply("❌ `allow_role` and `block_role` can't be the same role.");
    return;
  }

  const access: BoardAccess = {
    allowRoleIds: allowRole ? [allowRole.id] : [],
    blockRoleIds: blockRole ? [blockRole.id] : [],
  };

  const me = interaction.guild.members.me;
  if (!me?.permissionsIn(textChannel).has(
    PermissionFlagsBits.SendMessages | PermissionFlagsBits.AttachFiles,
  )) {
    await interaction.editReply(
      "❌ I need **Send Messages** and **Attach Files** in that channel to post the board.",
    );
    return;
  }

  try {
    const board = buildPublicBoard(access);
    await textChannel.send({
      content: board.content,
      components: board.components,
    });

    const accessNote = [
      allowRole ? `allow: ${allowRole.toString()}` : null,
      blockRole ? `block: ${blockRole.toString()}` : null,
    ].filter(Boolean).join(" · ");

    await interaction.editReply(
      `✅ Posted the emoji board in ${textChannel.toString()}.\n`
      + (accessNote ? `-# Access: ${accessNote}\n` : "")
      + "-# Each person gets a private session. Cooldown starts after they generate. No Post-to-channel.",
    );
  } catch (err) {
    logger.error({ err }, "Failed to post emoji board");
    await interaction.editReply("❌ Could not post the board. Check my permissions in that channel.");
  }
}
