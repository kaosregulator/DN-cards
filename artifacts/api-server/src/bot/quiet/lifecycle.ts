import {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder,
  MessageFlags, type GuildMember, type TextChannel,
} from "discord.js";
import { logger } from "../../lib/logger.js";
import {
  deleteQuietState, getQuietPrefs, getQuietSettings, getQuietState,
  patchQuietState, rememberQuietSelection, upsertQuietState,
} from "./models.js";
import { QUIET_BRAND, QUIET_CUSTOM, QUIET_EMOJI, formatDurationLabel } from "./shared.js";
import { pickQuietQuote, type QuietTheme } from "./quotes.js";
import {
  applyQuietIsolation, clearQuietIsolation, describeIsolationNote, ensureQuietRoom,
} from "./permissions.js";
import { pickQuietAudio, describeAudioCard } from "./audio/select.js";
import { prepareQuickFallback, prepareRecording, startQuietAudioPrebuild } from "./audio/generate.js";
import { sendQuietVoiceMessage } from "./audio/voice-message.js";

// ─────────────────────────────────────────────────────────────────────────────
// Quiet Mode lifecycle — enter / leave / room UX
// Roles are never touched. State is DB-backed for restart safety.
// ─────────────────────────────────────────────────────────────────────────────

export interface EnterQuietOptions {
  member: GuildMember;
  enteredBy: string;
  theme?: QuietTheme | null;
  lastChannelId?: string | null;
  /** Prefer skipping audio (tests / degraded). */
  skipAudio?: boolean;
}

export interface EnterQuietResult {
  ok: boolean;
  alreadyQuiet?: boolean;
  quietChannelId?: string;
  adminBypass?: boolean;
  error?: string;
}

function readyButton(): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(QUIET_CUSTOM.READY)
      .setLabel("I'm Ready — Bring Me Back")
      .setEmoji("🌤️")
      .setStyle(ButtonStyle.Success),
  );
}

function roomEmbed(quoteText: string): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(QUIET_BRAND.COLOR)
    .setTitle(`${QUIET_EMOJI.MOON} QUIET ROOM`)
    .setDescription(
      "Everything is still here.\n\n" +
      "You don't need to explain anything.\n" +
      "You don't need to do anything.\n\n" +
      "Take your time.\n\n" +
      `${QUIET_EMOJI.THOUGHT} *"${quoteText}"*`,
    )
    .setFooter({ text: QUIET_BRAND.FOOTER });
}

/**
 * Enter Quiet Mode for a member. Idempotent if already quiet (returns alreadyQuiet).
 */
export async function enterQuietMode(opts: EnterQuietOptions): Promise<EnterQuietResult> {
  startQuietAudioPrebuild();
  const { member } = opts;
  const guild = member.guild;
  const guildId = guild.id;
  const userId = member.id;

  const existing = await getQuietState(guildId, userId);
  if (existing) {
    return { ok: true, alreadyQuiet: true, quietChannelId: (await getQuietSettings(guildId)).quietChannelId ?? undefined };
  }

  const settings = await getQuietSettings(guildId);
  if (!settings.enabled) {
    return { ok: false, error: "Quiet Mode is disabled in this server." };
  }

  let quietChannel: TextChannel;
  let categoryId: string | null;
  try {
    const room = await ensureQuietRoom(guild);
    quietChannel = room.channel;
    categoryId = room.categoryId;
  } catch (err) {
    logger.error({ err, guildId }, "Quiet Room ensure failed");
    return { ok: false, error: "Couldn't open the Quiet Room (need Manage Channels)." };
  }

  const prefs = await getQuietPrefs(guildId, userId);
  const quote = pickQuietQuote(opts.theme, prefs.recentQuoteIds);
  const audioPick = await pickQuietAudio({
    theme: opts.theme,
    recentAudioIds: prefs.recentAudioIds,
  });

  // Persist shell state BEFORE overwrites so a crash mid-enter is recoverable.
  await upsertQuietState({
    guildId,
    userId,
    enteredBy: opts.enteredBy,
    theme: opts.theme ?? null,
    quoteId: quote.id,
    quoteText: quote.text,
    audioId: audioPick.entry.id,
    lastChannelId: opts.lastChannelId ?? null,
    roomMessageIds: [],
    overwriteTargets: [],
    needsRecovery: true,
    adminBypass: false,
  });

  let targets: string[] = [];
  let adminBypass = false;
  try {
    const iso = await applyQuietIsolation(member, quietChannel, categoryId);
    targets = iso.targets;
    adminBypass = iso.adminBypass;
  } catch (err) {
    logger.error({ err, guildId, userId }, "Quiet isolation failed");
    await patchQuietState(guildId, userId, { needsRecovery: true });
    return { ok: false, error: "Couldn't adjust channel visibility. Try again." };
  }

  await patchQuietState(guildId, userId, {
    overwriteTargets: targets,
    adminBypass,
  });

  const messageIds: string[] = [];

  // Main Quiet Room card + return button
  try {
    const embed = roomEmbed(quote.text);
    const note = describeIsolationNote(adminBypass);
    if (note) embed.addFields({ name: "Heads up", value: note });

    const card = await quietChannel.send({
      content: `<@${userId}>`,
      embeds: [embed],
      components: [readyButton()],
      allowedMentions: { users: [userId] },
    });
    messageIds.push(card.id);
  } catch (err) {
    logger.error({ err }, "Quiet Room embed send failed");
  }

  // Audio experience (non-blocking failure)
  const audioOn = settings.audioEnabled && !opts.skipAudio;
  if (audioOn) {
    try {
      let recording = await prepareRecording({
        entry: audioPick.entry,
        durationSec: Math.min(audioPick.durationSec, 180), // prefer ready 3m; longer can prebuild later
        quoteText: audioPick.withSpeech ? quote.text : null,
      }).catch(async () => prepareQuickFallback(audioPick.entry));

      // If long prep is slow, we already fell back inside catch; still try quick if nullish
      if (!recording) recording = await prepareQuickFallback(audioPick.entry);

      const sent = await sendQuietVoiceMessage(quietChannel, recording);
      if (sent.ok) {
        messageIds.push(sent.message.id);
        const clock = formatDurationLabel(recording.durationSec);
        const desc = await quietChannel.send({
          content:
            `${QUIET_EMOJI.MIC} ${describeAudioCard(audioPick.entry, recording.durationSec)}\n` +
            `> ${recording.blurb}` +
            (sent.mode === "attachment"
              ? "\n-# (Playable audio — native voice-message UI unavailable here.)"
              : ""),
        });
        messageIds.push(desc.id);
        logger.info({
          guildId, userId, audioId: recording.audioId, mode: sent.mode, seconds: recording.durationSec, clock,
        }, "Quiet audio delivered");
      }
    } catch (err) {
      logger.warn({ err, guildId, userId }, "Quiet audio skipped");
    }
  }

  await patchQuietState(guildId, userId, {
    roomMessageIds: messageIds,
    needsRecovery: false,
  });
  await rememberQuietSelection(guildId, userId, audioPick.entry.id, quote.id);

  logger.info({ guildId, userId, enteredBy: opts.enteredBy, adminBypass }, "User entered Quiet Mode");
  return { ok: true, quietChannelId: quietChannel.id, adminBypass };
}

export interface LeaveQuietResult {
  ok: boolean;
  wasQuiet: boolean;
  error?: string;
}

/**
 * Leave Quiet Mode — restore overwrites, clean room messages, clear DB state.
 * Safe to call twice (second call is a no-op).
 */
export async function leaveQuietMode(
  member: GuildMember,
  opts?: { welcomeBack?: boolean },
): Promise<LeaveQuietResult> {
  const guild = member.guild;
  const guildId = guild.id;
  const userId = member.id;
  const state = await getQuietState(guildId, userId);
  if (!state) return { ok: true, wasQuiet: false };

  // Clear isolation first so the member can see the server again ASAP.
  try {
    await clearQuietIsolation(guild, userId, state.overwriteTargets ?? []);
  } catch (err) {
    logger.warn({ err, guildId, userId }, "Quiet isolation clear had errors");
  }

  // Cleanup Quiet Room messages we posted for this session.
  const settings = await getQuietSettings(guildId);
  if (settings.quietChannelId && state.roomMessageIds?.length) {
    const ch = guild.channels.cache.get(settings.quietChannelId);
    if (ch?.isTextBased()) {
      for (const mid of state.roomMessageIds) {
        await ch.messages.delete(mid).catch(() => {});
      }
    }
  }

  await deleteQuietState(guildId, userId);
  logger.info({ guildId, userId }, "User left Quiet Mode");

  if (opts?.welcomeBack !== false) {
    await sendWelcomeBack(member, state.lastChannelId).catch(err =>
      logger.debug({ err }, "Welcome-back message skipped"),
    );
  }

  return { ok: true, wasQuiet: true };
}

async function sendWelcomeBack(member: GuildMember, lastChannelId: string | null): Promise<void> {
  const embed = new EmbedBuilder()
    .setColor(QUIET_BRAND.COLOR_OK)
    .setTitle(`${QUIET_EMOJI.SUN} Welcome back.`)
    .setDescription("Glad you're here.")
    .setFooter({ text: QUIET_BRAND.FOOTER });

  const tryChannel = async (id: string | null | undefined) => {
    if (!id) return false;
    const ch = member.guild.channels.cache.get(id);
    if (!ch?.isTextBased() || ch.isDMBased()) return false;
    const perms = ch.permissionsFor(member);
    if (!perms?.has("ViewChannel") || !perms.has("SendMessages")) return false;
    // Prefer ephemeral-like privacy: we can't post ephemeral outside interactions,
    // so send a short message that auto-deletes.
    const msg = await ch.send({
      content: `<@${member.id}>`,
      embeds: [embed],
      allowedMentions: { users: [member.id] },
    });
    setTimeout(() => { void msg.delete().catch(() => {}); }, 20_000);
    return true;
  };

  if (await tryChannel(lastChannelId)) return;

  // Fall back: any text channel they can see (system channel first).
  if (await tryChannel(member.guild.systemChannelId)) return;

  try {
    await member.send({ embeds: [embed] });
  } catch {
    // DMs closed — silent is fine; they already got their access back.
  }
}

/** Force-leave without a GuildMember object (member left the server). */
export async function forceClearQuietState(
  guildId: string,
  userId: string,
  guild: import("discord.js").Guild | null,
): Promise<void> {
  const state = await getQuietState(guildId, userId);
  if (!state) return;
  if (guild) {
    await clearQuietIsolation(guild, userId, state.overwriteTargets ?? []).catch(() => {});
    const settings = await getQuietSettings(guildId);
    if (settings.quietChannelId && state.roomMessageIds?.length) {
      const ch = guild.channels.cache.get(settings.quietChannelId);
      if (ch?.isTextBased()) {
        for (const mid of state.roomMessageIds) {
          await ch.messages.delete(mid).catch(() => {});
        }
      }
    }
  }
  await deleteQuietState(guildId, userId);
}

/** Used by button handler when only userId is known from interaction. */
export async function leaveQuietFromInteraction(
  member: GuildMember,
): Promise<LeaveQuietResult> {
  return leaveQuietMode(member, { welcomeBack: true });
}

// Re-export flag helper for ephemeral replies
export { MessageFlags };
