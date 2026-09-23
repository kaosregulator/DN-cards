import {
  ChannelType, PermissionFlagsBits, PermissionsBitField,
  type CategoryChannel, type Guild, type GuildChannel,
  type GuildMember, type Role, type TextChannel,
} from "discord.js";
import { logger } from "../../lib/logger.js";
import { getQuietSettings, updateQuietSettings } from "./models.js";

// ─────────────────────────────────────────────────────────────────────────────
// Quiet Mode — true empty-server isolation via a quarantine ROLE.
//
// Strategy (best with bot Administrator, or Manage Roles + Manage Channels):
//  1. Ensure a shared Quiet Room (@everyone denied — outsiders never see it).
//  2. Ensure a "Quiet" quarantine role with ZERO base perms (never hoist /
//     never mentionable / never special powers). Position it high under the bot.
//  3. Deny View (+ talk/connect) for that role on every other category/channel.
//  4. Quiet Room: visitors may ONLY view + read history (no send, react, attach,
//     threads, voice). Bot posts the card; member presses I'm Ready.
//  5. Enter = add role. Leave = remove role.
//
// Result: sidebar looks like a one-channel server; hidden channels can't ping
// them; outsiders don't see Quiet Room or get a loud role dump.
// ─────────────────────────────────────────────────────────────────────────────

const VIEW = PermissionFlagsBits.ViewChannel;
const CONNECT = PermissionFlagsBits.Connect;

const QUIET_ROLE_NAME = "Quiet";
const QUIET_ROLE_COLOR = 0x1b2838;

const BOT_ROOM_PERMS = [
  PermissionFlagsBits.ViewChannel,
  PermissionFlagsBits.SendMessages,
  PermissionFlagsBits.EmbedLinks,
  PermissionFlagsBits.AttachFiles,
  PermissionFlagsBits.ReadMessageHistory,
  PermissionFlagsBits.ManageChannels,
  PermissionFlagsBits.ManageMessages,
];

/** Quiet Room visitors: see the bot card only — no chatting / adding anything. */
const QUIET_ROOM_VISITOR_OVERWRITE = {
  ViewChannel: true,
  ReadMessageHistory: true,
  SendMessages: false,
  SendMessagesInThreads: false,
  CreatePublicThreads: false,
  CreatePrivateThreads: false,
  AddReactions: false,
  AttachFiles: false,
  EmbedLinks: false,
  MentionEveryone: false,
  SendTTSMessages: false,
  SendVoiceMessages: false,
  UseExternalEmojis: false,
  UseExternalStickers: false,
  Connect: false,
  Speak: false,
  Stream: false,
  UseVAD: false,
  PrioritySpeaker: false,
} as const;

/** Everywhere else: invisible + mute (View deny is what blocks pings). */
const QUIET_HIDE_OVERWRITE = {
  ViewChannel: false,
  Connect: false,
  Speak: false,
  SendMessages: false,
  AddReactions: false,
  SendVoiceMessages: false,
} as const;

/** @everyone must never see or use Quiet Room. */
const EVERYONE_ROOM_DENY = [
  VIEW,
  CONNECT,
  PermissionFlagsBits.SendMessages,
  PermissionFlagsBits.AddReactions,
  PermissionFlagsBits.CreatePublicThreads,
  PermissionFlagsBits.CreatePrivateThreads,
  PermissionFlagsBits.SendVoiceMessages,
];

export type QuietIsolationMode = "full" | "partial" | "room_only";

export interface QuietIsolationResult {
  /** Channel/category IDs we touched (role overwrites and/or member fallbacks). */
  targets: string[];
  roleId: string | null;
  roleAssigned: boolean;
  adminBypass: boolean;
  isolationMode: QuietIsolationMode;
  /** Non-Quiet channels the member can still View after apply (capped). */
  stillVisibleChannelIds: string[];
  /** Human-readable capability / limitation note for embeds. */
  note: string | null;
}

export function memberHasAdminBypass(member: GuildMember): boolean {
  return member.permissions.has(PermissionFlagsBits.Administrator);
}

function botCapability(guild: Guild): {
  me: GuildMember | null;
  isAdmin: boolean;
  canManageRoles: boolean;
  canManageChannels: boolean;
} {
  const me = guild.members.me;
  if (!me) {
    return { me: null, isAdmin: false, canManageRoles: false, canManageChannels: false };
  }
  const isAdmin = me.permissions.has(PermissionFlagsBits.Administrator);
  return {
    me,
    isAdmin,
    canManageRoles: isAdmin || me.permissions.has(PermissionFlagsBits.ManageRoles),
    canManageChannels: isAdmin || me.permissions.has(PermissionFlagsBits.ManageChannels),
  };
}

/**
 * Highest position the bot can place a managed role (just under its top role).
 */
function maxQuietRolePosition(me: GuildMember): number {
  const top = me.roles.highest;
  // Position 0 is @everyone; we want Quiet under the bot's highest role.
  return Math.max(1, top.position - 1);
}

export async function ensureQuietRoom(guild: Guild): Promise<{
  channel: TextChannel;
  categoryId: string | null;
}> {
  const settings = await getQuietSettings(guild.id);
  const { me } = botCapability(guild);

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
      topic: "Silent corner. One channel. No chat — just rest, then I'm Ready.",
      permissionOverwrites: [
        {
          id: guild.roles.everyone.id,
          deny: EVERYONE_ROOM_DENY,
        },
        ...(me ? [{ id: me.id, allow: BOT_ROOM_PERMS }] : []),
      ],
      reason: "Quiet Mode: Quiet Room channel",
    });
    await updateQuietSettings(guild.id, { quietChannelId: channel.id });
  } else if (channel.parentId !== category.id) {
    await channel.setParent(category.id, { lockPermissions: false }).catch(() => {});
  }

  // Keep Quiet Room private from @everyone (outsiders never see who is quiet).
  await channel.permissionOverwrites.edit(guild.roles.everyone, {
    ViewChannel: false,
    Connect: false,
    SendMessages: false,
    AddReactions: false,
    CreatePublicThreads: false,
    CreatePrivateThreads: false,
    SendVoiceMessages: false,
  }).catch(err => logger.debug({ err }, "Quiet Room everyone overwrite refresh failed"));

  await category.permissionOverwrites.edit(guild.roles.everyone, {
    ViewChannel: false,
    Connect: false,
  }).catch(() => {});

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

  // If quarantine role already exists, keep Quiet Room view-only for it.
  if (settings.quietRoleId) {
    const role = guild.roles.cache.get(settings.quietRoleId);
    if (role) {
      await grantQuietRoleRoomAccess(channel, category, role).catch(err =>
        logger.debug({ err }, "Quiet role room grant refresh failed"),
      );
    }
  }

  return { channel, categoryId: category.id };
}

async function grantQuietRoleRoomAccess(
  quietChannel: TextChannel,
  category: CategoryChannel | null,
  role: Role,
): Promise<void> {
  // View + read only — never grant send / react / attach / special powers here.
  await quietChannel.permissionOverwrites.edit(role.id, { ...QUIET_ROOM_VISITOR_OVERWRITE });
  if (category) {
    await category.permissionOverwrites.edit(role.id, {
      ViewChannel: true,
      Connect: false,
      SendMessages: false,
      AddReactions: false,
    });
  }
}

/**
 * Create or refresh the Quiet quarantine role, hoist it high under the bot.
 */
export async function ensureQuietRole(guild: Guild): Promise<{
  role: Role | null;
  positionedHigh: boolean;
  error?: string;
}> {
  const settings = await getQuietSettings(guild.id);
  const { me, canManageRoles } = botCapability(guild);

  if (!me || !canManageRoles) {
    return {
      role: null,
      positionedHigh: false,
      error:
        "Bot needs **Administrator** (recommended) or **Manage Roles** to create the Quiet quarantine role.",
    };
  }

  let role: Role | null = null;
  if (settings.quietRoleId) {
    role = guild.roles.cache.get(settings.quietRoleId) ?? null;
    if (!role) {
      role = await guild.roles.fetch(settings.quietRoleId).catch(() => null);
    }
  }

  if (!role) {
    // Prefer an existing identically named unmanaged role we previously made.
    const byName = guild.roles.cache.find(
      r => r.name === QUIET_ROLE_NAME && r.managed === false && r.id !== guild.id,
    );
    if (byName && byName.editable) {
      role = byName;
    } else {
      try {
        role = await guild.roles.create({
          name: QUIET_ROLE_NAME,
          color: QUIET_ROLE_COLOR,
          permissions: [],
          hoist: false,
          mentionable: false,
          reason: "Quiet Mode: quarantine role — empty-server isolation",
        });
      } catch (err) {
        logger.warn({ err, guildId: guild.id }, "Quiet role create failed");
        return {
          role: null,
          positionedHigh: false,
          error: "Couldn't create the Quiet role (need Manage Roles / Admin).",
        };
      }
    }
    await updateQuietSettings(guild.id, { quietRoleId: role.id });
  }

  let positionedHigh = false;
  if (role.editable) {
    // Hard invariants every ensure: zero perms, not displayed, not @mentionable.
    await Promise.all([
      role.permissions.bitfield !== 0n
        ? role.setPermissions([], "Quiet Mode: quarantine role must have no base perms")
        : Promise.resolve(),
      role.hoist
        ? role.setHoist(false, "Quiet Mode: keep Quiet role invisible in member list")
        : Promise.resolve(),
      role.mentionable
        ? role.setMentionable(false, "Quiet Mode: Quiet role must not be pingable")
        : Promise.resolve(),
    ]).catch(err => logger.debug({ err, roleId: role!.id }, "Quiet role invariant refresh failed"));

    const targetPos = maxQuietRolePosition(me);
    if (role.position < targetPos) {
      try {
        await role.setPosition(targetPos, { reason: "Quiet Mode: keep quarantine role high" });
        positionedHigh = true;
      } catch (err) {
        logger.debug({ err, guildId: guild.id, roleId: role.id }, "Quiet role position adjust failed");
        // Still usable if below bot — assignment works when role < bot highest.
        positionedHigh = role.position < me.roles.highest.position;
      }
    } else {
      positionedHigh = role.position < me.roles.highest.position;
    }
  } else {
    return {
      role: null,
      positionedHigh: false,
      error:
        "Quiet role sits above the bot (or isn't editable). Move the bot's role **above** Quiet, or grant the bot **Administrator**.",
    };
  }

  return { role, positionedHigh };
}

/**
 * Categories + every non-Quiet channel (covers broken permission sync).
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
    if (quietCategoryId && "parentId" in ch && ch.parentId === quietCategoryId) continue;
    if (!("permissionOverwrites" in ch)) continue;

    if (ch.type === ChannelType.GuildCategory) {
      targets.push(ch);
      continue;
    }
    // Hide every non-Quiet channel so broken sync / "Show All" can't leak.
    targets.push(ch as GuildChannel);
  }
  return targets;
}

async function applyRoleHide(
  ch: GuildChannel,
  roleId: string,
): Promise<boolean> {
  if (!("permissionOverwrites" in ch)) return false;
  try {
    const existing = ch.permissionOverwrites.cache.get(roleId);
    const deny = existing ? new PermissionsBitField(existing.deny) : null;
    // Already fully hidden — skip the API call.
    if (
      deny?.has(VIEW) &&
      deny.has(CONNECT) &&
      deny.has(PermissionFlagsBits.SendMessages) &&
      deny.has(PermissionFlagsBits.AddReactions)
    ) {
      return true;
    }
    await ch.permissionOverwrites.edit(roleId, { ...QUIET_HIDE_OVERWRITE }, {
      reason: "Quiet Mode: quarantine role hide",
    });
    return true;
  } catch (err) {
    logger.debug({ err, channelId: ch.id, roleId }, "Quiet role hide skipped");
    return false;
  }
}

/**
 * Sync Quiet-role denies across the guild (idempotent).
 */
export async function syncQuietRoleHides(
  guild: Guild,
  role: Role,
  quietChannelId: string,
  quietCategoryId: string | null,
): Promise<string[]> {
  const applied: string[] = [];
  const targets = collectHideTargets(guild, quietChannelId, quietCategoryId);
  for (const ch of targets) {
    if (await applyRoleHide(ch, role.id)) applied.push(ch.id);
  }
  return applied;
}

function listStillVisibleChannels(
  member: GuildMember,
  quietChannelId: string,
  quietCategoryId: string | null,
  limit = 12,
): string[] {
  const visible: string[] = [];
  for (const ch of member.guild.channels.cache.values()) {
    if (ch.id === quietChannelId) continue;
    if (quietCategoryId && ch.id === quietCategoryId) continue;
    if (quietCategoryId && "parentId" in ch && ch.parentId === quietCategoryId) continue;
    // Skip pure categories in the "still visible" list — list real channels.
    if (ch.type === ChannelType.GuildCategory) continue;
    if (!("permissionsFor" in ch)) continue;
    try {
      const perms = ch.permissionsFor(member);
      if (perms?.has(VIEW)) {
        visible.push(ch.id);
        if (visible.length >= limit) break;
      }
    } catch {
      // ignore
    }
  }
  return visible;
}

function buildCapabilityNote(opts: {
  adminBypass: boolean;
  isolationMode: QuietIsolationMode;
  roleAssigned: boolean;
  positionedHigh: boolean;
  botIsAdmin: boolean;
  canManageRoles: boolean;
  canManageChannels: boolean;
  stillVisible: string[];
  roleError?: string;
}): string | null {
  const parts: string[] = [];

  if (opts.adminBypass) {
    parts.push(
      "Discord **Administrator** bypasses channel hides — other channels may still appear for you. " +
      "The Quiet role was still applied for consistency. Use **I'm Ready** (or `/quiet`) to leave.",
    );
  }

  if (opts.isolationMode === "full" && !opts.adminBypass) {
    parts.push(
      "One silent channel only — no chat, no reactions, nothing to add. " +
      "Other channels are hidden, so pings from them shouldn't reach you. " +
      "Outsiders can't see this room.",
    );
    return parts.join("\n\n");
  }

  if (opts.isolationMode !== "full") {
    const need: string[] = [];
    if (!opts.botIsAdmin && !opts.canManageRoles) need.push("**Manage Roles** (or Administrator)");
    if (!opts.botIsAdmin && !opts.canManageChannels) need.push("**Manage Channels** (or Administrator)");
    if (opts.roleError) {
      parts.push(opts.roleError);
    } else if (need.length) {
      parts.push(
        `Bot is missing ${need.join(" and ")}. Full empty-server Quiet Mode needs the bot to have **Administrator** ` +
        `(recommended), or Manage Roles + Manage Channels with its role **above** the Quiet role.`,
      );
    } else if (!opts.roleAssigned) {
      parts.push(
        "Couldn't assign the Quiet quarantine role. Check that the bot's role sits **above** Quiet.",
      );
    } else if (!opts.positionedHigh) {
      parts.push(
        "Quiet role couldn't be moved high in the list. Drag the bot's role above Quiet for reliable quarantine.",
      );
    }

    if (opts.stillVisible.length > 0) {
      const mentions = opts.stillVisible.map(id => `<#${id}>`).join(", ");
      parts.push(
        `**Still visible to this member (isolation incomplete):** ${mentions}` +
        (opts.stillVisible.length >= 12 ? " _(and possibly more)_" : "") +
        "\nGrant the bot **Administrator**, then re-run `/quietsetup ensure_room` and have them `/quiet` again.",
      );
    } else if (opts.isolationMode === "partial") {
      parts.push(
        "Some hides were applied via member overwrites only — less reliable than the Quiet role. " +
        "Grant the bot **Administrator** for a true empty-server experience.",
      );
    } else {
      parts.push(
        "Only Quiet Room access was granted — other channels were **not** hidden. " +
        "Grant the bot **Administrator** (or Manage Roles + Manage Channels), then `/quietsetup ensure_room`.",
      );
    }
  }

  return parts.length ? parts.join("\n\n") : null;
}

/**
 * Apply empty-server isolation: quarantine role (preferred) + Quiet Room allow.
 */
export async function applyQuietIsolation(
  member: GuildMember,
  quietChannel: TextChannel,
  quietCategoryId: string | null,
): Promise<QuietIsolationResult> {
  const guild = member.guild;
  const adminBypass = memberHasAdminBypass(member);
  const { me, isAdmin: botIsAdmin, canManageRoles, canManageChannels } = botCapability(guild);
  const applied: string[] = [];
  let roleId: string | null = null;
  let roleAssigned = false;
  let positionedHigh = false;
  let roleError: string | undefined;
  let isolationMode: QuietIsolationMode = "room_only";

  const category = quietCategoryId
    ? (guild.channels.cache.get(quietCategoryId) as CategoryChannel | undefined) ?? null
    : null;

  // ── 1) Quarantine role path ────────────────────────────────────────────────
  const ensured = await ensureQuietRole(guild);
  if (ensured.role) {
    roleId = ensured.role.id;
    positionedHigh = ensured.positionedHigh;

    try {
      await grantQuietRoleRoomAccess(quietChannel, category, ensured.role);
      applied.push(quietChannel.id);
      if (category) applied.push(category.id);
    } catch (err) {
      logger.warn({ err, guildId: guild.id }, "Quiet role room allow failed");
    }

    if (canManageChannels) {
      const hidden = await syncQuietRoleHides(guild, ensured.role, quietChannel.id, quietCategoryId);
      applied.push(...hidden);
    }

    // Assign role (only if bot's highest role is above Quiet).
    if (me && ensured.role.position < me.roles.highest.position) {
      try {
        if (!member.roles.cache.has(ensured.role.id)) {
          await member.roles.add(ensured.role, "Quiet Mode: enter quarantine");
        }
        roleAssigned = true;
      } catch (err) {
        logger.warn({ err, guildId: guild.id, userId: member.id }, "Quiet role assign failed");
        roleError = "Couldn't add the Quiet role to this member (hierarchy or permissions).";
      }
    } else {
      roleError =
        "Bot role must sit **above** the Quiet role to assign it. Move the bot higher, or grant **Administrator**.";
    }

    if (roleAssigned && canManageChannels) {
      isolationMode = "full";
    } else if (roleAssigned || canManageChannels) {
      isolationMode = "partial";
    }
  } else {
    roleError = ensured.error;
  }

  // ── 2) Member Quiet Room access: view-only (same as role) ──────────────────
  try {
    await quietChannel.permissionOverwrites.edit(member.id, { ...QUIET_ROOM_VISITOR_OVERWRITE });
    if (!applied.includes(quietChannel.id)) applied.push(quietChannel.id);
  } catch (err) {
    logger.warn({ err, guildId: guild.id, userId: member.id }, "Quiet Room member allow failed");
  }

  if (category) {
    try {
      await category.permissionOverwrites.edit(member.id, {
        ViewChannel: true,
        Connect: false,
        SendMessages: false,
        AddReactions: false,
      });
      if (!applied.includes(category.id)) applied.push(category.id);
    } catch (err) {
      logger.debug({ err }, "Quiet category member allow failed");
    }
  }

  // ── 3) Fallback member hides if role path incomplete ───────────────────────
  if (isolationMode !== "full" && canManageChannels) {
    const targets = collectHideTargets(guild, quietChannel.id, quietCategoryId);
    for (const ch of targets) {
      try {
        await ch.permissionOverwrites.edit(member.id, { ...QUIET_HIDE_OVERWRITE });
        applied.push(ch.id);
      } catch (err) {
        logger.debug({ err, channelId: ch.id }, "Quiet member hide overwrite skipped");
      }
    }
    if (isolationMode === "room_only") isolationMode = "partial";
  }

  // Re-fetch member roles for accurate visibility scan after role add.
  const fresh = await guild.members.fetch(member.id).catch(() => member);
  const stillVisibleChannelIds = adminBypass
    ? []
    : listStillVisibleChannels(fresh, quietChannel.id, quietCategoryId);

  if (isolationMode === "full" && stillVisibleChannelIds.length > 0 && !adminBypass) {
    isolationMode = "partial";
  }

  const note = buildCapabilityNote({
    adminBypass,
    isolationMode,
    roleAssigned,
    positionedHigh,
    botIsAdmin,
    canManageRoles,
    canManageChannels,
    stillVisible: stillVisibleChannelIds,
    roleError,
  });

  return {
    targets: [...new Set(applied)],
    roleId,
    roleAssigned,
    adminBypass,
    isolationMode,
    stillVisibleChannelIds,
    note,
  };
}

/**
 * Leave Quiet Mode: remove quarantine role + member overwrites we applied.
 */
export async function clearQuietIsolation(
  guild: Guild,
  userId: string,
  targets: string[],
  quietRoleId?: string | null,
): Promise<void> {
  const settings = quietRoleId === undefined
    ? await getQuietSettings(guild.id).catch(() => null)
    : null;
  const roleId = quietRoleId !== undefined ? quietRoleId : settings?.quietRoleId ?? null;

  if (roleId) {
    const member = await guild.members.fetch(userId).catch(() => null);
    if (member?.roles.cache.has(roleId)) {
      await member.roles.remove(roleId, "Quiet Mode: leave quarantine").catch(err =>
        logger.debug({ err, userId, roleId }, "Quiet role remove skipped"),
      );
    }
  }

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

/** @deprecated Prefer isolation result `.note` — kept for call sites. */
export function describeIsolationNote(adminBypass: boolean, extra?: string | null): string | null {
  if (extra) return extra;
  if (!adminBypass) return null;
  return (
    "Note: Discord **Administrator** bypasses channel hides, so other channels may still " +
    "appear for you. Use **I'm Ready** (or `/quiet` again) anytime to leave."
  );
}

export function summarizeMemberOverwrites(channel: GuildChannel, userId: string): string {
  const ow = channel.permissionOverwrites.cache.get(userId);
  if (!ow) return "none";
  const allow = new PermissionsBitField(ow.allow).toArray().join(",") || "-";
  const deny = new PermissionsBitField(ow.deny).toArray().join(",") || "-";
  return `allow=${allow}; deny=${deny}`;
}
