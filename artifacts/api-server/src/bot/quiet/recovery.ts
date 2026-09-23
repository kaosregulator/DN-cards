import {
  Events, type Client, type GuildMember, type PartialGuildMember,
} from "discord.js";
import { logger } from "../../lib/logger.js";
import {
  getQuietSettings, getQuietState, listNeedsRecovery, listQuietStates, patchQuietState,
} from "./models.js";
import { ensureQuietRoom, applyQuietIsolation, clearQuietIsolation } from "./permissions.js";
import { forceClearQuietState } from "./lifecycle.js";
import { startQuietAudioPrebuild } from "./audio/generate.js";
import {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder,
} from "discord.js";
import { QUIET_BRAND, QUIET_CUSTOM, QUIET_EMOJI } from "./shared.js";
import { getModeOrDefault, mergeSanctuaryModes } from "./modes.js";

// ─────────────────────────────────────────────────────────────────────────────
// Quiet Mode — restart recovery + member-leave cleanup
//
// If the bot dies while people are quiet, DB state remains. On ready we:
//  - re-assert Quiet quarantine role + room access + channel hides
//  - re-post an I'm Ready button if prior messages vanished
// Members can ALWAYS emergency-exit with /quiet even if recovery fails.
// ─────────────────────────────────────────────────────────────────────────────

let recoveryStarted = false;

export function startQuietRecovery(client: Client): void {
  if (recoveryStarted) return;
  recoveryStarted = true;
  startQuietAudioPrebuild();

  client.on(Events.GuildMemberRemove, (member) => {
    void onMemberRemove(member).catch(err =>
      logger.debug({ err }, "Quiet member-remove cleanup error"),
    );
  });

  // Run shortly after ready so guild channel caches are warm.
  setTimeout(() => {
    void recoverAll(client).catch(err =>
      logger.error({ err }, "Quiet recovery pass failed"),
    );
  }, 8_000);

  // Periodic light pass for needsRecovery rows.
  setInterval(() => {
    void recoverNeedsAttention(client).catch(() => {});
  }, 5 * 60_000).unref?.();
}

async function onMemberRemove(member: GuildMember | PartialGuildMember): Promise<void> {
  const guild = member.guild;
  const userId = member.id;
  let state;
  try {
    state = await getQuietState(guild.id, userId);
  } catch (err) {
    if (isMissingRelation(err)) return;
    throw err;
  }
  if (!state) return;
  await forceClearQuietState(guild.id, userId, guild);
  logger.info({ guildId: guild.id, userId }, "Cleared Quiet Mode after member left");
}

function isMissingRelation(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { code?: string; message?: string; cause?: { code?: string; message?: string } };
  if (e.code === "42P01") return true;
  if (e.cause?.code === "42P01") return true;
  const msg = `${e.message ?? ""} ${e.cause?.message ?? ""}`;
  return /relation ["']?quiet_/i.test(msg) && /does not exist/i.test(msg);
}

async function recoverAll(client: Client): Promise<void> {
  let states;
  try {
    states = await listQuietStates();
  } catch (err) {
    if (isMissingRelation(err)) {
      logger.warn(
        "Quiet recovery skipped — quiet_* tables not ready yet " +
          "(boot migration / start-production will create them on this deploy)",
      );
      return;
    }
    throw err;
  }
  if (states.length === 0) {
    logger.info("Quiet recovery: nobody in Quiet Mode");
    return;
  }
  logger.info({ count: states.length }, "Quiet recovery: restoring active Quiet Mode sessions");

  for (const state of states) {
    await recoverOne(client, state.guildId, state.userId).catch(err =>
      logger.warn({ err, guildId: state.guildId, userId: state.userId }, "Quiet recoverOne failed"),
    );
  }
}

async function recoverNeedsAttention(client: Client): Promise<void> {
  let rows;
  try {
    rows = await listNeedsRecovery();
  } catch (err) {
    if (isMissingRelation(err)) return;
    throw err;
  }
  for (const state of rows) {
    await recoverOne(client, state.guildId, state.userId).catch(() => {});
  }
}

async function recoverOne(client: Client, guildId: string, userId: string): Promise<void> {
  const guild = client.guilds.cache.get(guildId) ?? await client.guilds.fetch(guildId).catch(() => null);
  if (!guild) {
    await forceClearQuietState(guildId, userId, null);
    return;
  }

  const member = await guild.members.fetch(userId).catch(() => null);
  if (!member) {
    await forceClearQuietState(guildId, userId, guild);
    return;
  }

  const state = await getQuietState(guildId, userId);
  if (!state) return;

  try {
    const settings = await getQuietSettings(guildId);
    const modes = mergeSanctuaryModes(settings.sanctuaryModes);
    const mode = getModeOrDefault(modes, state.modeKey);
    const { channel, categoryId } = await ensureQuietRoom(guild, {
      channelName: mode.channelName,
      topic: mode.topic,
      preferChannelId: mode.channelId ?? settings.quietChannelId,
    });
    // Re-apply isolation (idempotent role assign + member hides).
    const iso = await applyQuietIsolation(member, channel, categoryId, {
      roleName: mode.roleName,
      preferRoleId: state.quarantineRoleId ?? mode.roleId ?? settings.quietRoleId,
    });
    await patchQuietState(guildId, userId, {
      overwriteTargets: iso.targets,
      adminBypass: iso.adminBypass,
      quarantineRoleId: iso.roleId ?? state.quarantineRoleId,
      needsRecovery: false,
    });

    // Ensure they still have a return button somehow.
    const hasMessages = (state.roomMessageIds?.length ?? 0) > 0;
    let buttonAlive = false;
    if (hasMessages) {
      for (const mid of state.roomMessageIds) {
        const msg = await channel.messages.fetch(mid).catch(() => null);
        if (msg?.components?.length) { buttonAlive = true; break; }
      }
    }

    if (!buttonAlive) {
      const embed = new EmbedBuilder()
        .setColor(QUIET_BRAND.COLOR)
        .setTitle(`${QUIET_EMOJI.MOON} ${mode.label.toUpperCase()}`)
        .setDescription(
          "Still here.\n\n" +
          (state.quoteText ? `💭 *"${state.quoteText}"*\n\n` : "") +
          `The bot came back. Your **${mode.label}** was restored.\n` +
          "Press **I'm Ready** when you want the server again — or run `/quiet`.",
        )
        .setFooter({ text: QUIET_BRAND.FOOTER });

      if (iso.note && iso.isolationMode !== "full") {
        embed.addFields({ name: "Heads up", value: iso.note.slice(0, 1024) });
      }

      const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(QUIET_CUSTOM.READY)
          .setLabel("I'm Ready — Bring Me Back")
          .setEmoji("🌤️")
          .setStyle(ButtonStyle.Success),
      );

      const card = await channel.send({
        content: `<@${userId}>`,
        embeds: [embed],
        components: [row],
        allowedMentions: { users: [userId] },
      });
      await patchQuietState(guildId, userId, {
        roomMessageIds: [...(state.roomMessageIds ?? []), card.id],
      });
    }

    logger.info({ guildId, userId, isolationMode: iso.isolationMode }, "Quiet Mode session recovered");
  } catch (err) {
    logger.warn({ err, guildId, userId }, "Quiet recovery incomplete — marking needsRecovery");
    await patchQuietState(guildId, userId, { needsRecovery: true });
    // Last resort: clear isolation so they aren't locked out if Quiet Room is broken.
    try {
      const settings = await getQuietSettings(guildId);
      await clearQuietIsolation(
        guild,
        userId,
        state.overwriteTargets ?? [],
        state.quarantineRoleId ?? settings.quietRoleId,
      );
    } catch { /* ignore */ }
  }
}
