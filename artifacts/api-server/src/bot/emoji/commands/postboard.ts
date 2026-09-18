// ─────────────────────────────────────────────────────────────────────────────
// /postboard — staff posts the shared emoji maker into a channel.
//
// The message is the same target chooser as `/emoji`, but public and persistent.
// Each member who taps it gets their own private (ephemeral) session so many
// people can use the board at once. Per-user cooldowns keep the render pipeline
// respectful; Post-to-channel is disabled on these sessions (save via download).
// ─────────────────────────────────────────────────────────────────────────────

import {
  ChannelType, PermissionFlagsBits,
  type ChatInputCommandInteraction, type GuildTextBasedChannel,
} from "discord.js";
import { logger } from "../../../lib/logger.js";
import { buildPublicBoard } from "./ui.js";

/** Minimum gap between one user starting another postboard session. */
export const BOARD_COOLDOWN_MS = 30_000;

const lastBoardStart = new Map<string, number>();

function cooldownKey(guildId: string, userId: string): string {
  return `${guildId}:${userId}`;
}

export interface BoardCooldownResult {
  ok: boolean;
  retryMs?: number;
  message?: string;
}

/**
 * Check (and on success, arm) the per-user postboard cooldown.
 *
 * Keyed by guild + user so one server's spam does not block another, and so
 * two members of the same server never share a cooldown.
 */
export function consumeBoardCooldown(guildId: string, userId: string): BoardCooldownResult {
  const key = cooldownKey(guildId, userId);
  const now = Date.now();
  const last = lastBoardStart.get(key) ?? 0;
  const elapsed = now - last;
  if (elapsed < BOARD_COOLDOWN_MS) {
    const retryMs = Math.max(1000, BOARD_COOLDOWN_MS - elapsed);
    return {
      ok: false,
      retryMs,
      message: `⏳ Easy — you can use the emoji board again in **${Math.ceil(retryMs / 1000)}s**.`,
    };
  }
  lastBoardStart.set(key, now);
  return { ok: true };
}

/** Test helper — clears in-memory board cooldowns. */
export function resetBoardCooldownsForTesting(): void {
  lastBoardStart.clear();
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
    const board = buildPublicBoard();
    await textChannel.send({
      content: board.content,
      components: board.components,
    });
    await interaction.editReply(
      `✅ Posted the emoji board in ${textChannel.toString()}.\n`
      + "-# Anyone can use it — each person gets a private session. No Post-to-channel on this flow.",
    );
  } catch (err) {
    logger.error({ err }, "Failed to post emoji board");
    await interaction.editReply("❌ Could not post the board. Check my permissions in that channel.");
  }
}
