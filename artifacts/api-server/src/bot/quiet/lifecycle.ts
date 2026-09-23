import {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder,
  MessageFlags, type GuildMember, type TextChannel,
} from "discord.js";
import { logger } from "../../lib/logger.js";
import {
  deleteQuietState, getQuietPrefs, getQuietSettings, getQuietState,
  patchQuietState, rememberQuietSelection, updateQuietSettings, upsertQuietState,
} from "./models.js";
import { QUIET_BRAND, QUIET_CUSTOM, QUIET_EMOJI, formatDurationLabel } from "./shared.js";
import { pickQuietQuote, type QuietTheme } from "./quotes.js";
import {
  applyQuietIsolation, clearQuietIsolation, ensureQuietRoom,
  type QuietIsolationMode,
} from "./permissions.js";
import { pickQuietAudio, describeAudioCard } from "./audio/select.js";
import { prepareQuietExperience, startQuietAudioPrebuild } from "./audio/generate.js";
import { sendQuietVoiceMessage } from "./audio/voice-message.js";
import {
  getModeOrDefault, mergeSanctuaryModes, patchMode, type SanctuaryMode,
} from "./modes.js";
import { buildReleaseGameStart } from "./games/release.js";

// ─────────────────────────────────────────────────────────────────────────────
// Sanctuary lifecycle — Quiet / Vacation / LOA / Step Away
// Enter adds a quarantine role; leave removes it. DB-backed for safety.
// ─────────────────────────────────────────────────────────────────────────────

export interface EnterQuietOptions {
  member: GuildMember;
  enteredBy: string;
  theme?: QuietTheme | null;
  lastChannelId?: string | null;
  /** Sanctuary mode key (quiet | vacation | loa | step_away). */
  modeKey?: string | null;
  /** Prefer skipping audio (tests / degraded). */
  skipAudio?: boolean;
}

export interface EnterQuietResult {
  ok: boolean;
  alreadyQuiet?: boolean;
  quietChannelId?: string;
  adminBypass?: boolean;
  isolationMode?: QuietIsolationMode;
  isolationNote?: string | null;
  modeKey?: string;
  modeLabel?: string;
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

function roomEmbed(mode: SanctuaryMode, quoteText: string): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(QUIET_BRAND.COLOR)
    .setTitle(`${QUIET_EMOJI.MOON} ${mode.label.toUpperCase()}`)
    .setDescription(
      `${mode.intro}\n\n` +
      `${QUIET_EMOJI.THOUGHT} *"${quoteText}"*`,
    )
    .setFooter({ text: QUIET_BRAND.FOOTER });
}

async function resolveMode(guildId: string, modeKey?: string | null): Promise<{
  mode: SanctuaryMode;
  modes: SanctuaryMode[];
}> {
  const settings = await getQuietSettings(guildId);
  let modes = mergeSanctuaryModes(settings.sanctuaryModes);
  // Seed legacy quiet channel/role into the quiet mode once.
  const quiet = modes.find(m => m.key === "quiet");
  if (quiet) {
    let changed = false;
    if (!quiet.channelId && settings.quietChannelId) {
      quiet.channelId = settings.quietChannelId;
      changed = true;
    }
    if (!quiet.roleId && settings.quietRoleId) {
      quiet.roleId = settings.quietRoleId;
      changed = true;
    }
    if (changed) {
      modes = modes.map(m => (m.key === "quiet" ? quiet : m));
      await updateQuietSettings(guildId, { sanctuaryModes: modes });
    }
  }
  return { mode: getModeOrDefault(modes, modeKey), modes };
}

/**
 * Enter a sanctuary mode (Quiet / Vacation / LOA / …). Idempotent if already in.
 */
export async function enterQuietMode(opts: EnterQuietOptions): Promise<EnterQuietResult> {
  startQuietAudioPrebuild();
  const { member } = opts;
  const guild = member.guild;
  const guildId = guild.id;
  const userId = member.id;

  const existing = await getQuietState(guildId, userId);
  if (existing) {
    return {
      ok: true,
      alreadyQuiet: true,
      quietChannelId: (await getQuietSettings(guildId)).quietChannelId ?? undefined,
      modeKey: existing.modeKey,
    };
  }

  const settings = await getQuietSettings(guildId);
  if (!settings.enabled) {
    return { ok: false, error: "Sanctuary / Quiet Mode is disabled in this server." };
  }

  const { mode, modes } = await resolveMode(guildId, opts.modeKey);
  if (!mode.enabled) {
    return { ok: false, error: `**${mode.label}** is turned off in this server.` };
  }

  let quietChannel: TextChannel;
  let categoryId: string | null;
  try {
    const room = await ensureQuietRoom(guild, {
      channelName: mode.channelName,
      topic: mode.topic,
      preferChannelId: mode.channelId,
      persistChannelId: async (channelId) => {
        const next = patchMode(modes, mode.key, { channelId });
        const patch: { sanctuaryModes: typeof next; quietChannelId?: string } = {
          sanctuaryModes: next,
        };
        if (mode.key === "quiet") patch.quietChannelId = channelId;
        await updateQuietSettings(guildId, patch);
        mode.channelId = channelId;
      },
    });
    quietChannel = room.channel;
    categoryId = room.categoryId;
  } catch (err) {
    logger.error({ err, guildId, mode: mode.key }, "Sanctuary room ensure failed");
    return { ok: false, error: `Couldn't open **${mode.label}** (need Manage Channels / Admin on the bot role).` };
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
    modeKey: mode.key,
    quarantineRoleId: mode.roleId,
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
  let isolationMode: QuietIsolationMode = "room_only";
  let isolationNote: string | null = null;
  let quarantineRoleId: string | null = mode.roleId;
  try {
    const iso = await applyQuietIsolation(member, quietChannel, categoryId, {
      roleName: mode.roleName,
      preferRoleId: mode.roleId,
      persistRoleId: async (roleId) => {
        const next = patchMode(modes, mode.key, { roleId });
        const patch: { sanctuaryModes: typeof next; quietRoleId?: string } = {
          sanctuaryModes: next,
        };
        if (mode.key === "quiet") patch.quietRoleId = roleId;
        await updateQuietSettings(guildId, patch);
        mode.roleId = roleId;
        quarantineRoleId = roleId;
      },
    });
    targets = iso.targets;
    adminBypass = iso.adminBypass;
    isolationMode = iso.isolationMode;
    isolationNote = iso.note;
    if (iso.roleId) quarantineRoleId = iso.roleId;
  } catch (err) {
    logger.error({ err, guildId, userId }, "Quiet isolation failed");
    await patchQuietState(guildId, userId, { needsRecovery: true });
    return { ok: false, error: "Couldn't adjust channel visibility. Try again." };
  }

  await patchQuietState(guildId, userId, {
    overwriteTargets: targets,
    adminBypass,
    quarantineRoleId,
    modeKey: mode.key,
  });

  const messageIds: string[] = [];

  // Main room card + return button
  try {
    const embed = roomEmbed(mode, quote.text);
    if (isolationNote) {
      embed.addFields({
        name: isolationMode === "full" && !adminBypass ? mode.label : "Heads up",
        value: isolationNote.slice(0, 1024),
      });
    }

    const card = await quietChannel.send({
      content: `<@${userId}>`,
      embeds: [embed],
      components: [readyButton()],
      allowedMentions: { users: [userId] },
    });
    messageIds.push(card.id);
  } catch (err) {
    logger.error({ err }, "Sanctuary room embed send failed");
  }

  // Therapeutic release game (click-animated embed)
  try {
    const game = buildReleaseGameStart();
    const gameMsg = await quietChannel.send({
      embeds: [game.embed],
      components: [game.row],
    });
    messageIds.push(gameMsg.id);
  } catch (err) {
    logger.debug({ err }, "Sanctuary release game skipped");
  }

  // Audio experience (non-blocking failure)
  const audioOn = settings.audioEnabled && !opts.skipAudio;
  if (audioOn) {
    try {
      const recording = await prepareQuietExperience({
        entry: audioPick.entry,
        durationSec: audioPick.durationSec,
        quoteText: audioPick.withSpeech ? quote.text : null,
        withSpeech: audioPick.withSpeech,
      });

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
          guildId,
          userId,
          audioId: recording.audioId,
          mode: sent.mode,
          detail: sent.detail,
          seconds: recording.durationSec,
          clock,
          sourceKind: recording.sourceKind,
          sourceAssetId: recording.sourceAssetId,
          hasSpeech: recording.hasSpeech,
        }, "Quiet audio delivered");
      } else {
        logger.warn({
          guildId, userId, audioId: audioPick.entry.id, error: sent.error,
        }, "Quiet audio delivery failed");
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

  logger.info({
    guildId, userId, enteredBy: opts.enteredBy, adminBypass, isolationMode,
    modeKey: mode.key,
  }, "User entered sanctuary mode");
  return {
    ok: true,
    quietChannelId: quietChannel.id,
    adminBypass,
    isolationMode,
    isolationNote,
    modeKey: mode.key,
    modeLabel: mode.label,
  };
}

export interface LeaveQuietResult {
  ok: boolean;
  wasQuiet: boolean;
  error?: string;
}

/**
 * Leave Quiet Mode — remove Quiet role, restore overwrites, clean room, clear DB.
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

  const settings = await getQuietSettings(guildId);

  // Clear isolation first so the member can see the server again ASAP.
  const roleToRemove = state.quarantineRoleId ?? settings.quietRoleId;
  try {
    await clearQuietIsolation(
      guild,
      userId,
      state.overwriteTargets ?? [],
      roleToRemove,
    );
  } catch (err) {
    logger.warn({ err, guildId, userId }, "Quiet isolation clear had errors");
  }

  // Cleanup sanctuary room messages we posted for this session.
  const roomId = settings.quietChannelId; // may be mode channel via overwrites list messages
  const modes = mergeSanctuaryModes(settings.sanctuaryModes);
  const modeChannelId = modes.find(m => m.key === (state.modeKey ?? "quiet"))?.channelId
    ?? roomId;
  if (modeChannelId && state.roomMessageIds?.length) {
    const ch = guild.channels.cache.get(modeChannelId);
    if (ch?.isTextBased()) {
      for (const mid of state.roomMessageIds) {
        await ch.messages.delete(mid).catch(() => {});
      }
    }
  }

  await deleteQuietState(guildId, userId);
  logger.info({ guildId, userId, modeKey: state.modeKey }, "User left sanctuary mode");

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
    const settings = await getQuietSettings(guildId);
    const modes = mergeSanctuaryModes(settings.sanctuaryModes);
    const modeChannelId = modes.find(m => m.key === (state.modeKey ?? "quiet"))?.channelId
      ?? settings.quietChannelId;
    await clearQuietIsolation(
      guild,
      userId,
      state.overwriteTargets ?? [],
      state.quarantineRoleId ?? settings.quietRoleId,
    ).catch(() => {});
    if (modeChannelId && state.roomMessageIds?.length) {
      const ch = guild.channels.cache.get(modeChannelId);
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
