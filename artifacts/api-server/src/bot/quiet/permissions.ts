import {
  ChannelType, PermissionFlagsBits, PermissionsBitField,
  type CategoryChannel, type Guild, type GuildChannel,
  type GuildMember, type TextChannel,
} from "discord.js";
import { logger } from "../../lib/logger.js";
import { getQuietSettings, updateQuietSettings } from "./models.js";

// ─────────────────────────────────────────────────────────────────────────────
// Quiet Mode — channel isolation via MEMBER overwrites (no role churn).
//
// Strategy:
//  1. Ensure one Quiet Room text channel under an optional category.
//  2. @everyone cannot see the Quiet Room by default.
//  3. For a quiet member: ALLOW View on Quiet Room; DENY View/Connect on other
//     top-level categories and orphan channels.
//  4. On exit: remove those member overwrites only.
//
// Administrator members bypass Discord channel denies — we still apply what we
// can and flag adminBypass so UX can be honest without stripping admin roles.
// ─────────────────────────────────────────────────────────────────────────────

const VIEW = PermissionFlagsBits.ViewChannel;
const CONNECT = PermissionFlagsBits.Connect;

const BOT_ROOM_PERMS = [
  PermissionFlagsBits.ViewChannel,
  PermissionFlagsBits.SendMessages,
  PermissionFlagsBits.EmbedLinks,
  PermissionFlagsBits.AttachFiles,
  PermissionFlagsBits.ReadMessageHistory,
  PermissionFlagsBits.ManageChannels,
  PermissionFlagsBits.ManageMessages,
];

export function memberHasAdminBypass(member: GuildMember): boolean {
  return member.permissions.has(PermissionFlagsBits.Administrator);
}

export async function ensureQuietRoom(guild: Guild): Promise<{
  channel: TextChannel;
  categoryId: string | null;
}> {
  const settings = await getQuietSettings(guild.id);
  const me = guild.members.me;

  let category: CategoryChannel | null = null;
  if (settings.quietCategoryId) {
    const existing = guild.channels.cache.get(settings.quietCategoryId);
    if (existing?.type === ChannelType.GuildCategory) category = existing as CategoryChannel;
  }

  if (!category) {
    category = await guild.channels.create({
      name: "Quiet Room",
      type: ChannelType.GuildCategory,
      permissionOverwrites: [
        {
          id: guild.roles.everyone.id,
          deny: [VIEW, CONNECT],
        },
        ...(me ? [{ id: me.id, allow: BOT_ROOM_PERMS }] : []),
      ],
      reason: "Quiet Mode: Quiet Room category",
    });
    await updateQuietSettings(guild.id, { quietCategoryId: category.id });
  }

  let channel: TextChannel | null = null;
  if (settings.quietChannelId) {
    const existing = guild.channels.cache.get(settings.quietChannelId);
    if (existing?.isTextBased() && !existing.isThread() && existing.type === ChannelType.GuildText) {
      channel = existing as TextChannel;
    }
  }

  if (!channel) {
    channel = await guild.channels.create({
      name: "quiet-room",
      type: ChannelType.GuildText,
      parent: category.id,
      topic: "A quiet corner. Disappear without leaving. Return without explaining.",
      permissionOverwrites: [
        {
          id: guild.roles.everyone.id,
          deny: [VIEW, CONNECT, PermissionFlagsBits.SendMessages],
        },
        ...(me ? [{ id: me.id, allow: BOT_ROOM_PERMS }] : []),
      ],
      reason: "Quiet Mode: Quiet Room channel",
    });
    await updateQuietSettings(guild.id, { quietChannelId: channel.id });
  } else if (channel.parentId !== category.id) {
    await channel.setParent(category.id, { lockPermissions: false }).catch(() => {});
  }

  // Keep @everyone denied even if someone edited the channel.
  await channel.permissionOverwrites.edit(guild.roles.everyone, {
    ViewChannel: false,
    Connect: false,
  }).catch(err => logger.debug({ err }, "Quiet Room everyone overwrite refresh failed"));

  if (me) {
    await channel.permissionOverwrites.edit(me, {
      ViewChannel: true,
      SendMessages: true,
      EmbedLinks: true,
      AttachFiles: true,
      ReadMessageHistory: true,
      ManageMessages: true,
    }).catch(() => {});
  }

  return { channel, categoryId: category.id };
}

/**
 * Channels/categories we should hide from a quiet member.
 * We prefer category-level denies (fewer overwrite events) and only touch
 * orphan top-level channels individually. Quiet Room + its category are skipped.
 */
export function collectHideTargets(
  guild: Guild,
  quietChannelId: string,
  quietCategoryId: string | null,
): GuildChannel[] {
  const targets: GuildChannel[] = [];
  for (const ch of guild.channels.cache.values()) {
    if (ch.id === quietChannelId) continue;
    if (quietCategoryId && ch.id === quietCategoryId) continue;
    // Hide via categories when possible.
    if (ch.type === ChannelType.GuildCategory) {
      // Don't hide the Quiet Room category itself (already skipped).
      targets.push(ch);
      continue;
    }
    // Orphan channels (no parent) need their own deny.
    if (!ch.parentId && "permissionOverwrites" in ch) {
      targets.push(ch as GuildChannel);
    }
  }
  return targets;
}

export async function applyQuietIsolation(
  member: GuildMember,
  quietChannel: TextChannel,
  quietCategoryId: string | null,
): Promise<{ targets: string[]; adminBypass: boolean }> {
  const adminBypass = memberHasAdminBypass(member);
  const targets = collectHideTargets(member.guild, quietChannel.id, quietCategoryId);
  const applied: string[] = [];

  // Always allow Quiet Room for this member.
  try {
    await quietChannel.permissionOverwrites.edit(member.id, {
      ViewChannel: true,
      ReadMessageHistory: true,
      SendMessages: true,
      EmbedLinks: true,
      AttachFiles: true,
      Connect: false,
    });
    applied.push(quietChannel.id);
  } catch (err) {
    logger.warn({ err, guildId: member.guild.id, userId: member.id }, "Quiet Room allow overwrite failed");
  }

  if (quietCategoryId) {
    const cat = member.guild.channels.cache.get(quietCategoryId);
    if (cat && "permissionOverwrites" in cat) {
      try {
        await (cat as CategoryChannel).permissionOverwrites.edit(member.id, {
          ViewChannel: true,
        });
        applied.push(quietCategoryId);
      } catch (err) {
        logger.debug({ err }, "Quiet category allow failed");
      }
    }
  }

  // Deny view on other categories / orphan channels. Skip if bot lacks ManageChannels.
  const me = member.guild.members.me;
  if (!me?.permissions.has(PermissionFlagsBits.ManageChannels)) {
    logger.warn({ guildId: member.guild.id }, "Quiet Mode: bot missing ManageChannels — isolation limited to Quiet Room allow");
    return { targets: applied, adminBypass };
  }

  for (const ch of targets) {
    try {
      // Don't fight Administrator — overwrites still "apply" but Discord ignores them.
      await ch.permissionOverwrites.edit(member.id, {
        ViewChannel: false,
        Connect: false,
      });
      applied.push(ch.id);
    } catch (err) {
      logger.debug({ err, channelId: ch.id }, "Quiet hide overwrite skipped");
    }
  }

  return { targets: applied, adminBypass };
}

/**
 * Remove member-specific overwrites we previously applied.
 * Safe to call multiple times / with stale target IDs.
 */
export async function clearQuietIsolation(
  guild: Guild,
  userId: string,
  targets: string[],
): Promise<void> {
  for (const id of targets) {
    const ch = guild.channels.cache.get(id);
    if (!ch || !("permissionOverwrites" in ch)) continue;
    try {
      const existing = ch.permissionOverwrites.cache.get(userId);
      if (!existing) continue;
      await ch.permissionOverwrites.delete(userId, "Quiet Mode: restore access");
    } catch (err) {
      logger.debug({ err, channelId: id, userId }, "Quiet overwrite cleanup skipped");
    }
  }
}

/** Best-effort: does this member currently have View on Quiet Room? */
export function memberCanSeeQuietRoom(member: GuildMember, quietChannel: TextChannel): boolean {
  const perms = quietChannel.permissionsFor(member);
  return Boolean(perms?.has(VIEW));
}

export function describeIsolationNote(adminBypass: boolean): string | null {
  if (!adminBypass) return null;
  return (
    "Note: Discord **Administrator** bypasses channel hides, so other channels may still " +
    "appear for you. Your roles were not changed. Use **I'm Ready** (or `/quiet` again) anytime to leave."
  );
}

/** Unused helper kept for debugging permission math. */
export function summarizeMemberOverwrites(channel: GuildChannel, userId: string): string {
  const ow = channel.permissionOverwrites.cache.get(userId);
  if (!ow) return "none";
  const allow = new PermissionsBitField(ow.allow).toArray().join(",") || "-";
  const deny = new PermissionsBitField(ow.deny).toArray().join(",") || "-";
  return `allow=${allow}; deny=${deny}`;
}
