import {
  SlashCommandBuilder, PermissionFlagsBits, MessageFlags,
  EmbedBuilder,
  type ChatInputCommandInteraction, type GuildMember,
} from "discord.js";
import { logger } from "../../lib/logger.js";
import { isAdmin } from "../db.js";
import {
  getQuietSettings, updateQuietSettings, getQuietState, listQuietStates,
  setAudioEnabled, listAudioConfigs,
} from "./models.js";
import {
  QUIET_BRAND, QUIET_EMOJI, canSelfQuiet, isQuietStaff, normalizeTheme,
} from "./shared.js";
import { QUIET_THEME_CHOICES } from "./quotes.js";
import { enterQuietMode, leaveQuietMode } from "./lifecycle.js";
import { ensureQuietRoom, ensureQuietRole, syncQuietRoleHides } from "./permissions.js";
import { QUIET_AUDIO_CATALOG } from "./audio/catalog.js";
import { startQuietAudioPrebuild } from "./audio/generate.js";

// ─────────────────────────────────────────────────────────────────────────────
// Quiet Mode — slash commands
//
//   /quiet              — enter (or leave if already quiet)  [users]
//   /quiet user:@x      — staff places someone into Quiet Mode
//   /quiet_setup        — whitelist/blacklist roles, toggles, audio list
// ─────────────────────────────────────────────────────────────────────────────

export function buildQuietCommandJson() {
  const themeChoices = QUIET_THEME_CHOICES.map(t => ({
    name: `${t.emoji} ${t.name}`,
    value: t.value,
  }));

  return new SlashCommandBuilder()
    .setName("quiet")
    .setDescription("Step into the Quiet Room — disappear without leaving")
    .setDMPermission(false)
    .addUserOption(o => o
      .setName("user")
      .setDescription("(Staff) Place this member into Quiet Mode")
      .setRequired(false))
    .addStringOption(o => o
      .setName("theme")
      .setDescription("Optional quiet theme / message mood")
      .setRequired(false)
      .addChoices(...themeChoices))
    .toJSON();
}

export function buildQuietSetupCommandJson() {
  return new SlashCommandBuilder()
    .setName("quietsetup")
    .setDescription("Configure Quiet Mode (roles, audio, room)")
    .setDMPermission(false)
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand(sc => sc
      .setName("config")
      .setDescription("Toggle Quiet Mode features")
      .addBooleanOption(o => o.setName("enabled").setDescription("Enable Quiet Mode"))
      .addBooleanOption(o => o.setName("audio").setDescription("Send Quiet Room voice notes"))
      .addRoleOption(o => o.setName("whitelist_role").setDescription("Only this role may self-/quiet (empty = everyone)"))
      .addRoleOption(o => o.setName("blacklist_role").setDescription("This role cannot self-/quiet"))
      .addBooleanOption(o => o.setName("clear_whitelist").setDescription("Clear the whitelist role"))
      .addBooleanOption(o => o.setName("clear_blacklist").setDescription("Clear the blacklist role")))
    .addSubcommand(sc => sc
      .setName("ensure_room")
      .setDescription("Create or refresh the Quiet Room channel"))
    .addSubcommand(sc => sc
      .setName("status")
      .setDescription("Show Quiet Mode settings and who is currently quiet"))
    .addSubcommand(sc => sc
      .setName("audio")
      .setDescription("List or toggle built-in Quiet audio")
      .addStringOption(o => o.setName("id").setDescription("Audio id to enable/disable"))
      .addBooleanOption(o => o.setName("enabled").setDescription("Enable or disable that audio id")))
    .toJSON();
}

export async function handleQuietCommand(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!interaction.guild) return;
  const member = interaction.member as GuildMember | null;
  if (!member) return;

  const targetUser = interaction.options.getUser("user");
  const theme = normalizeTheme(interaction.options.getString("theme"));

  // Staff placing another user
  if (targetUser && targetUser.id !== interaction.user.id) {
    if (!(await isQuietStaff(member))) {
      await interaction.reply({
        content: "Only staff can place someone else into Quiet Mode.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    if (targetUser.bot) {
      await interaction.reply({ content: "Bots don't need a Quiet Room.", flags: MessageFlags.Ephemeral });
      return;
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const targetMember = await interaction.guild.members.fetch(targetUser.id).catch(() => null);
    if (!targetMember) {
      await interaction.editReply("Couldn't find that member in this server.");
      return;
    }

    const existing = await getQuietState(interaction.guild.id, targetMember.id);
    if (existing) {
      await interaction.editReply({
        embeds: [new EmbedBuilder()
          .setColor(QUIET_BRAND.COLOR_SOFT)
          .setTitle(`${QUIET_EMOJI.MOON} Already quiet`)
          .setDescription(`<@${targetMember.id}> is already in Quiet Mode. They can leave with **I'm Ready** or \`/quiet\`.`)],
      });
      return;
    }

    const result = await enterQuietMode({
      member: targetMember,
      enteredBy: interaction.user.id,
      theme,
      lastChannelId: interaction.channelId,
    });

    if (!result.ok) {
      await interaction.editReply(result.error ?? "Couldn't enter Quiet Mode.");
      return;
    }

    await interaction.editReply({
      embeds: [new EmbedBuilder()
        .setColor(QUIET_BRAND.COLOR)
        .setTitle(`${QUIET_EMOJI.MOON} Quiet Mode`)
        .setDescription(
          `Placed <@${targetMember.id}> into the Quiet Room.\n` +
          `No public announcement was made. They return when **they** click **I'm Ready**.` +
          (result.isolationNote && result.isolationMode !== "full"
            ? `\n\n${result.isolationNote}`
            : result.adminBypass
              ? `\n\n_They have Administrator — Discord may still show them other channels._`
              : ""),
        )],
    });
    return;
  }

  // Self enter / leave toggle
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const existing = await getQuietState(interaction.guild.id, member.id);
  if (existing) {
    // Offline / emergency exit path — /quiet while quiet always brings you back.
    const left = await leaveQuietMode(member, { welcomeBack: true });
    await interaction.editReply({
      embeds: [new EmbedBuilder()
        .setColor(QUIET_BRAND.COLOR_OK)
        .setTitle(`${QUIET_EMOJI.SUN} Welcome back.`)
        .setDescription(left.wasQuiet
          ? "Glad you're here. Your server access was restored."
          : "You weren't in Quiet Mode.")],
    });
    return;
  }

  const access = await canSelfQuiet(member);
  if (!access.ok) {
    await interaction.editReply({
      embeds: [new EmbedBuilder()
        .setColor(QUIET_BRAND.COLOR)
        .setTitle(`${QUIET_EMOJI.LOCK} Quiet Mode`)
        .setDescription(access.reason ?? "You can't use Quiet Mode right now.")],
    });
    return;
  }

  const result = await enterQuietMode({
    member,
    enteredBy: member.id,
    theme,
    lastChannelId: interaction.channelId,
  });

  if (!result.ok) {
    await interaction.editReply(result.error ?? "Couldn't enter Quiet Mode.");
    return;
  }

  const roomMention = result.quietChannelId ? `<#${result.quietChannelId}>` : "the Quiet Room";
  await interaction.editReply({
    embeds: [new EmbedBuilder()
      .setColor(QUIET_BRAND.COLOR)
      .setTitle(`${QUIET_EMOJI.MOON} Quiet Room`)
      .setDescription(
        `You're in ${roomMention} now.\n\n` +
        "The busy server can wait.\n" +
        "When you're ready, press **🌤️ I'm Ready — Bring Me Back**.\n" +
        "Or run `/quiet` again anytime to leave — even if the bot restarted." +
        (result.isolationNote
          ? `\n\n${result.isolationNote}`
          : ""),
      )
      .setFooter({ text: QUIET_BRAND.FOOTER })],
  });
}

export async function handleQuietSetupCommand(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!interaction.guild) return;
  const member = interaction.member as GuildMember | null;
  if (!member) return;

  const isOwner = interaction.guild.ownerId === interaction.user.id;
  const isDiscordAdmin = member.permissions.has(PermissionFlagsBits.Administrator)
    || member.permissions.has(PermissionFlagsBits.ManageGuild);
  const dbAdmin = await isAdmin(interaction.guild.id, interaction.user.id);
  if (!isOwner && !isDiscordAdmin && !dbAdmin) {
    await interaction.reply({ content: "Admins only.", flags: MessageFlags.Ephemeral });
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const sub = interaction.options.getSubcommand(true);
  const guildId = interaction.guild.id;

  if (sub === "config") {
    const patch: {
      enabled?: boolean;
      audioEnabled?: boolean;
      whitelistRoleId?: string | null;
      blacklistRoleId?: string | null;
    } = {};
    const enabled = interaction.options.getBoolean("enabled");
    const audio = interaction.options.getBoolean("audio");
    if (enabled !== null) patch.enabled = enabled;
    if (audio !== null) patch.audioEnabled = audio;

    const wl = interaction.options.getRole("whitelist_role");
    const bl = interaction.options.getRole("blacklist_role");
    if (wl) patch.whitelistRoleId = wl.id;
    if (bl) patch.blacklistRoleId = bl.id;
    if (interaction.options.getBoolean("clear_whitelist")) patch.whitelistRoleId = null;
    if (interaction.options.getBoolean("clear_blacklist")) patch.blacklistRoleId = null;

    const settings = await updateQuietSettings(guildId, patch);

    await interaction.editReply({
      embeds: [new EmbedBuilder()
        .setColor(QUIET_BRAND.COLOR_SOFT)
        .setTitle(`${QUIET_EMOJI.MOON} Quiet Mode config`)
        .setDescription(
          `**Enabled:** ${settings.enabled ? "yes" : "no"}\n` +
          `**Audio:** ${settings.audioEnabled ? "yes" : "no"}\n` +
          `**Whitelist role:** ${settings.whitelistRoleId ? `<@&${settings.whitelistRoleId}>` : "_none (everyone)_"}\n` +
          `**Blacklist role:** ${settings.blacklistRoleId ? `<@&${settings.blacklistRoleId}>` : "_none_"}\n` +
          `**Room:** ${settings.quietChannelId ? `<#${settings.quietChannelId}>` : "_not created yet_"}`,
        )],
    });
    return;
  }

  if (sub === "ensure_room") {
    try {
      const { channel, categoryId } = await ensureQuietRoom(interaction.guild);
      const roleResult = await ensureQuietRole(interaction.guild);
      let hideCount = 0;
      if (roleResult.role) {
        const hidden = await syncQuietRoleHides(
          interaction.guild,
          roleResult.role,
          channel.id,
          categoryId,
        );
        hideCount = hidden.length;
      }
      const me = interaction.guild.members.me;
      const botAdmin = Boolean(me?.permissions.has(PermissionFlagsBits.Administrator));
      const lines = [
        `Quiet Room ready: ${channel}`,
        roleResult.role
          ? `Quarantine role: <@&${roleResult.role.id}>` +
            (roleResult.positionedHigh ? " (positioned high under the bot)" : " _(move bot role above Quiet if assign fails)_") +
            `\nRole hides synced on **${hideCount}** categories/channels`
          : `Quarantine role: **not created** — ${roleResult.error ?? "missing Manage Roles"}`,
        botAdmin
          ? "Bot has **Administrator** — full empty-server Quiet Mode is available."
          : "⚠️ Bot does **not** have Administrator. For a true empty server (hide all channels + block pings), " +
            "grant the bot **Administrator**, or at least **Manage Roles** + **Manage Channels** with its role above **Quiet**. " +
            "Without that, Quiet can only open the room and/or apply weaker member hides — and will list channels still visible.",
      ];
      await interaction.editReply(lines.join("\n"));
    } catch (err) {
      logger.error({ err }, "quiet_setup ensure_room failed");
      await interaction.editReply("Couldn't create the Quiet Room. Check **Manage Channels** / **Administrator** for the bot.");
    }
    return;
  }

  if (sub === "status") {
    const settings = await getQuietSettings(guildId);
    const active = await listQuietStates(guildId);
    const me = interaction.guild.members.me;
    const botAdmin = Boolean(me?.permissions.has(PermissionFlagsBits.Administrator));
    await interaction.editReply({
      embeds: [new EmbedBuilder()
        .setColor(QUIET_BRAND.COLOR)
        .setTitle(`${QUIET_EMOJI.MOON} Quiet Mode status`)
        .setDescription(
          `**Enabled:** ${settings.enabled ? "yes" : "no"}\n` +
          `**Audio:** ${settings.audioEnabled ? "yes" : "no"}\n` +
          `**Room:** ${settings.quietChannelId ? `<#${settings.quietChannelId}>` : "_not created_"}\n` +
          `**Quiet role:** ${settings.quietRoleId ? `<@&${settings.quietRoleId}>` : "_not created — run ensure_room_"}\n` +
          `**Bot Administrator:** ${botAdmin ? "yes ✅" : "no ⚠️ (empty-server quarantine limited)"}\n` +
          `**Currently quiet:** ${active.length}\n` +
          (active.length
            ? active.slice(0, 25).map(s => `• <@${s.userId}> since <t:${Math.floor(s.enteredAt.getTime() / 1000)}:R>`).join("\n")
            : "_nobody_"),
        )],
    });
    return;
  }

  if (sub === "audio") {
    startQuietAudioPrebuild();
    const id = interaction.options.getString("id");
    const enabled = interaction.options.getBoolean("enabled");
    if (id && enabled !== null) {
      const found = QUIET_AUDIO_CATALOG.some(a => a.id === id);
      if (!found) {
        await interaction.editReply(`Unknown audio id \`${id}\`.`);
        return;
      }
      await setAudioEnabled(id, enabled);
      await interaction.editReply(`Audio \`${id}\` is now **${enabled ? "enabled" : "disabled"}**.`);
      return;
    }

    const configs = await listAudioConfigs();
    const disabled = new Set(configs.filter(c => !c.enabled).map(c => c.audioId));
    const lines = QUIET_AUDIO_CATALOG.map(a => {
      const on = !disabled.has(a.id);
      return `${on ? "✅" : "⛔"} \`${a.id}\` — **${a.title}** (${a.category}, ${a.license})`;
    });
    await interaction.editReply({
      embeds: [new EmbedBuilder()
        .setColor(QUIET_BRAND.COLOR_SOFT)
        .setTitle(`${QUIET_EMOJI.MIC} Quiet audio library`)
        .setDescription(lines.join("\n").slice(0, 4000))
        .setFooter({ text: "Toggle: /quiet_setup audio id:<id> enabled:true|false" })],
    });
    return;
  }
}
