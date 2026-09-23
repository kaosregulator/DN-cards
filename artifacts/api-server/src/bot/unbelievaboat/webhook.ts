// Post public UnbelievaBoat economy messages as a channel webhook that looks
// like UnbelievaBoat (name + avatar). Ephemeral admin replies stay as DN bot.
// Pattern mirrors AFK speak-as-user — Manage Webhooks required; falls back.

import {
  ChannelType, PermissionFlagsBits,
  type Client, type Webhook, type TextChannel, type NewsChannel, type ThreadChannel,
  type Interaction, type EmbedBuilder, type AttachmentBuilder,
  type ActionRowBuilder, type MessageActionRowComponentBuilder,
  type Message,
} from "discord.js";
import { logger } from "../../lib/logger.js";
import {
  UNBELIEVABOAT_ICON,
  UNBELIEVABOAT_WEBHOOK_USERNAME,
} from "./branding.js";

const WEBHOOK_NAME = "UnbelievaBoat Economy";
const webhookCache = new Map<string, Webhook | null>();

type WebhookCapableChannel = TextChannel | NewsChannel;

function webhookHost(channel: Interaction["channel"] | Message["channel"]): {
  host: WebhookCapableChannel | null;
  threadId?: string;
} {
  if (!channel || channel.isDMBased()) return { host: null };
  if (
    channel.type === ChannelType.PublicThread ||
    channel.type === ChannelType.PrivateThread ||
    channel.type === ChannelType.AnnouncementThread
  ) {
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

async function resolveWebhook(client: Client, host: WebhookCapableChannel): Promise<Webhook | null> {
  const cached = webhookCache.get(host.id);
  if (cached !== undefined) return cached;

  let hook: Webhook | null = null;
  try {
    const me = host.guild.members.me ?? await host.guild.members.fetchMe().catch(() => null);
    if (!me || !host.permissionsFor(me)?.has(PermissionFlagsBits.ManageWebhooks)) {
      webhookCache.set(host.id, null);
      return null;
    }
    const existing = await host.fetchWebhooks();
    hook = existing.find(w => w.name === WEBHOOK_NAME && w.owner?.id === client.user?.id) ?? null;
    if (!hook) {
      hook = await host.createWebhook({
        name: WEBHOOK_NAME,
        avatar: UNBELIEVABOAT_ICON,
        reason: "Post UnbelievaBoat economy games & store as UnbelievaBoat",
      });
    }
  } catch (err) {
    logger.debug({ err, channelId: host.id }, "UnbelievaBoat webhook unavailable");
    hook = null;
  }
  webhookCache.set(host.id, hook);
  return hook;
}

export type PostAsUnbelievaBoatOpts = {
  embeds?: EmbedBuilder[];
  content?: string;
  files?: AttachmentBuilder[];
  components?: ActionRowBuilder<MessageActionRowComponentBuilder>[];
  /** Prefer follow-up when the interaction was already deferred/replied. */
  ephemeralFallback?: boolean;
};

/**
 * Post as UnbelievaBoat via webhook. Returns the message id, or null when the
 * caller should fall back to a normal bot reply on the interaction.
 */
export async function postAsUnbelievaBoat(
  interaction: Interaction & { channel: Interaction["channel"] },
  opts: PostAsUnbelievaBoatOpts,
): Promise<string | null> {
  const { host, threadId } = webhookHost(interaction.channel);
  if (!host || !interaction.client) return null;

  const hook = await resolveWebhook(interaction.client, host);
  if (!hook) return null;

  try {
    const sent = await hook.send({
      username: UNBELIEVABOAT_WEBHOOK_USERNAME,
      avatarURL: UNBELIEVABOAT_ICON,
      content: opts.content,
      embeds: opts.embeds,
      files: opts.files,
      components: opts.components,
      ...(threadId ? { threadId } : {}),
      allowedMentions: { parse: ["users"] },
    });
    return sent.id;
  } catch (err) {
    webhookCache.delete(host.id);
    logger.debug({ err, channelId: host.id }, "UnbelievaBoat webhook send failed");
    return null;
  }
}

/** Acknowledge privately, then post the public UnbelievaBoat webhook message. */
export async function replyThenPostAsUnbelievaBoat(
  interaction: Interaction & {
    deferred: boolean;
    replied: boolean;
    deferReply: (o?: object) => Promise<unknown>;
    editReply: (o: object) => Promise<unknown>;
    followUp: (o: object) => Promise<unknown>;
    channel: Interaction["channel"];
  },
  publicPayload: PostAsUnbelievaBoatOpts,
  privateAck = "✅ Posted as **UnbelievaBoat**.",
): Promise<void> {
  if (!interaction.deferred && !interaction.replied) {
    await interaction.deferReply({ ephemeral: true });
  }

  const id = await postAsUnbelievaBoat(interaction, publicPayload);
  if (id) {
    await interaction.editReply({ content: privateAck, embeds: [], components: [], files: [] });
    return;
  }

  // Fallback: bot message (still branded via embed author).
  await interaction.editReply({
    content: undefined,
    embeds: publicPayload.embeds ?? [],
    files: publicPayload.files ?? [],
    components: publicPayload.components ?? [],
  });
}
