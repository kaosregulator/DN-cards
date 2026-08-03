// ─────────────────────────────────────────────────────────────────────────────
// AFK Secretary — "speak as the member".
//
// Posts the Secretary intercept through a channel WEBHOOK carrying the AFK
// member's display name and avatar, so the reply reads as though it came from
// them rather than from the bot.
//
// What this can and cannot do:
//   • Name + avatar are fully impersonated.
//   • Discord still renders an "APP" badge next to a webhook message. That tag
//     is applied by the client to every webhook/bot message and cannot be
//     removed by any bot — only a real user account could post without it, and
//     that would mean automating a user token (against Discord's ToS).
//
// Requirements & safety:
//   • Needs Manage Webhooks in the channel. Without it (or on any failure) the
//     caller falls back to a normal bot message, so the Secretary always
//     answers.
//   • Webhooks are per-channel and capped (15) by Discord, so we reuse one
//     named webhook per channel and cache the resolved handle in memory.
//   • Threads cannot own webhooks: we create it on the parent channel and post
//     into the thread with `threadId`.
//   • Buttons still work — the webhook is owned by this application, so its
//     messages may carry components and their interactions route back here.
// ─────────────────────────────────────────────────────────────────────────────

import {
  ChannelType, PermissionFlagsBits,
  type Client, type Webhook, type Message, type GuildMember,
  type EmbedBuilder, type ActionRowBuilder, type ButtonBuilder,
  type TextChannel, type NewsChannel, type ThreadChannel,
} from "discord.js";
import { logger } from "../../lib/logger.js";

// The webhook we create and reuse. Named so admins can recognise it in
// Server Settings → Integrations.
const WEBHOOK_NAME = "AFK Secretary";

// channelId (the PARENT channel for threads) → webhook, resolved once.
const webhookCache = new Map<string, Webhook | null>();

/**
 * Discord rejects webhook usernames containing "discord" or "clyde", requires
 * 1–80 characters, and will not accept a blank name. Sanitise so an unusual
 * display name can never fail the send.
 */
export function sanitizeWebhookName(raw: string): string {
  let name = raw.replace(/discord/gi, "disc0rd").replace(/clyde/gi, "clyd3").trim();
  if (name.length > 80) name = name.slice(0, 80);
  return name.length > 0 ? name : "Member";
}

type WebhookCapableChannel = TextChannel | NewsChannel;

/** The channel that can actually own a webhook (a thread's parent, else itself). */
function webhookHost(channel: Message["channel"]): { host: WebhookCapableChannel | null; threadId?: string } {
  if (channel.type === ChannelType.PublicThread ||
      channel.type === ChannelType.PrivateThread ||
      channel.type === ChannelType.AnnouncementThread) {
    const thread = channel as ThreadChannel;
    const parent = thread.parent;
    if (parent && (parent.type === ChannelType.GuildText || parent.type === ChannelType.GuildAnnouncement)) {
      return { host: parent as WebhookCapableChannel, threadId: thread.id };
    }
    return { host: null };
  }
  if (channel.type === ChannelType.GuildText || channel.type === ChannelType.GuildAnnouncement) {
    return { host: channel as WebhookCapableChannel };
  }
  return { host: null };
}

/** Find-or-create our webhook on `host`. Returns null when we can't have one. */
async function resolveWebhook(client: Client, host: WebhookCapableChannel): Promise<Webhook | null> {
  const cached = webhookCache.get(host.id);
  if (cached !== undefined) return cached;

  let hook: Webhook | null = null;
  try {
    const me = host.guild.members.me ?? await host.guild.members.fetchMe().catch(() => null);
    if (!me || !host.permissionsFor(me)?.has(PermissionFlagsBits.ManageWebhooks)) {
      logger.debug({ channelId: host.id }, "AFK speak-as-user: missing Manage Webhooks");
      webhookCache.set(host.id, null);
      return null;
    }
    const existing = await host.fetchWebhooks();
    hook = existing.find(w => w.name === WEBHOOK_NAME && w.owner?.id === client.user?.id) ?? null;
    if (!hook) {
      hook = await host.createWebhook({ name: WEBHOOK_NAME, reason: "AFK Secretary replies as the away member" });
    }
  } catch (err) {
    logger.debug({ err, channelId: host.id }, "AFK speak-as-user: webhook unavailable");
    hook = null;
  }
  webhookCache.set(host.id, hook);
  return hook;
}

/** Drop a cached handle (e.g. after the webhook was deleted out from under us). */
function forgetWebhook(channelId: string): void {
  webhookCache.delete(channelId);
}

export interface SpeakAsUserOptions {
  member: GuildMember | null;
  fallbackName: string;
  fallbackAvatar?: string | null;
  embeds: EmbedBuilder[];
  components: ActionRowBuilder<ButtonBuilder>[];
}

/**
 * Post `embeds`/`components` as the AFK member. Resolves to the sent message id
 * on success, or null when the caller should fall back to a normal bot message.
 */
export async function speakAsUser(
  msg: Message, opts: SpeakAsUserOptions,
): Promise<string | null> {
  const { host, threadId } = webhookHost(msg.channel);
  if (!host) return null;

  const hook = await resolveWebhook(msg.client, host);
  if (!hook) return null;

  const username = sanitizeWebhookName(opts.member?.displayName ?? opts.fallbackName);
  const avatarURL = opts.member?.displayAvatarURL() ?? opts.fallbackAvatar ?? undefined;

  try {
    const sent = await hook.send({
      username,
      avatarURL,
      embeds: opts.embeds,
      components: opts.components,
      ...(threadId ? { threadId } : {}),
      allowedMentions: { parse: [] },
    });
    return sent.id;
  } catch (err) {
    // The webhook may have been deleted by an admin since we cached it — drop
    // the handle so the next intercept re-creates one, and let the caller fall
    // back to a plain bot message for THIS intercept.
    forgetWebhook(host.id);
    logger.debug({ err, channelId: host.id }, "AFK speak-as-user: send failed, falling back to bot message");
    return null;
  }
}

/**
 * Delete an intercept that was posted through our webhook. Deleting via the
 * OWNING webhook doesn't need Manage Messages (only Manage Webhooks, which we
 * already had to post it), so the Dismiss button keeps working in channels
 * where the bot can't delete arbitrary messages. Returns false if this isn't a
 * webhook message we can delete that way, so the caller can fall back to a
 * normal message delete.
 */
export async function deleteSpokenMessage(msg: Message): Promise<boolean> {
  if (!msg.webhookId) return false;
  const { host, threadId } = webhookHost(msg.channel);
  if (!host) return false;
  const hook = await resolveWebhook(msg.client, host);
  // Only our own webhook can delete its message; a foreign webhook's id won't match.
  if (!hook || hook.id !== msg.webhookId) return false;
  try {
    await hook.deleteMessage(msg.id, threadId);
    return true;
  } catch (err) {
    forgetWebhook(host.id);
    logger.debug({ err, channelId: host.id }, "AFK speak-as-user: webhook delete failed");
    return false;
  }
}
