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
import {
  botCapability, ensureQuietRoom, ensureQuietRole, syncQuietRoleHides,
} from "./permissions.js";
import { QUIET_AUDIO_CATALOG } from "./audio/catalog.js";
import { startQuietAudioPrebuild } from "./audio/generate.js";
import {
  DEFAULT_SANCTUARY_MODES, mergeSanctuaryModes, patchMode,
} from "./modes.js";

// ─────────────────────────────────────────────────────────────────────────────
// Sanctuary slash commands
//
//   /quiet | /vacation | /loa — enter (or leave if already in)
//   /quiet user:@x            — staff toggle: place in OR force out
//   /quietsetup               — config, ensure_room, rename modes, audio
// ─────────────────────────────────────────────────────────────────────────────

const MODE_CHOICES = DEFAULT_SANCTUARY_MODES.map(m => ({
  name: m.label,
  value: m.key,
}));

function themeChoices() {
  return QUIET_THEME_CHOICES.map(t => ({
    name: `${t.emoji} ${t.name}`,
    value: t.value,
  }));
}

export function buildQuietCommandJson() {
  return new SlashCommandBuilder()
    .setName("quiet")
    .setDescription("Step into a silent sanctuary room — disappear without leaving")
    .setDMPermission(false)
    .addUserOption(o => o
      .setName("user")
      .setDescription("(Staff) Place into sanctuary — or force them out if already in")
      .setRequired(false))
    .addStringOption(o => o
      .setName("mode")
      .setDescription("Sanctuary type (Quiet / Vacation / LOA / Step Away)")
      .setRequired(false)
      .addChoices(...MODE_CHOICES))
    .addStringOption(o => o
      .setName("theme")
      .setDescription("Optional quiet theme / message mood")
      .setRequired(false)
      .addChoices(...themeChoices()))
    .toJSON();
}

export function buildVacationCommandJson() {
  return new SlashCommandBuilder()
    .setName("vacation")
    .setDescription("Vacation mode — one soft channel away from the noise")
    .setDMPermission(false)
    .addUserOption(o => o
      .setName("user")
      .setDescription("(Staff) Place on vacation — or force them back if already away")
      .setRequired(false))
    .toJSON();
}

export function buildLoaCommandJson() {
  return new SlashCommandBuilder()
    .setName("loa")
    .setDescription("Leave of Absence — still in the server, not in the noise")
    .setDMPermission(false)
    .addUserOption(o => o
      .setName("user")
      .setDescription("(Staff) Place on LOA — or force them back if already away")
      .setRequired(false))
    .toJSON();
}

export function buildQuietSetupCommandJson() {
  return new SlashCommandBuilder()
    .setName("quietsetup")
    .setDescription("Configure Quiet / Vacation / LOA sanctuary modes")
    .setDMPermission(false)
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand(sc => sc
      .setName("config")
      .setDescription("Toggle Quiet Mode features")
      .addBooleanOption(o => o.setName("enabled").setDescription("Enable sanctuary modes"))
      .addBooleanOption(o => o.setName("audio").setDescription("Send sanctuary voice notes"))
      .addRoleOption(o => o.setName("whitelist_role").setDescription("Only this role may self-enter (empty = everyone)"))
      .addRoleOption(o => o.setName("blacklist_role").setDescription("This role cannot self-enter"))
      .addBooleanOption(o => o.setName("clear_whitelist").setDescription("Clear the whitelist role"))
      .addBooleanOption(o => o.setName("clear_blacklist").setDescription("Clear the blacklist role")))
    .addSubcommand(sc => sc
      .setName("ensure_room")
      .setDescription("Create/refresh sanctuary rooms + quarantine roles + channel hides"))
    .addSubcommand(sc => sc
      .setName("rename")
      .setDescription("Rename a sanctuary mode (label / role / channel) for this server")
      .addStringOption(o => o.setName("mode").setDescription("Which mode").setRequired(true).addChoices(...MODE_CHOICES))
      .addStringOption(o => o.setName("label").setDescription("Display name (e.g. Holiday)"))
      .addStringOption(o => o.setName("role_name").setDescription("Discord role name to create/use"))
      .addStringOption(o => o.setName("channel_name").setDescription("Discord channel name (e.g. holiday-room)"))
      .addBooleanOption(o => o.setName("enabled").setDescription("Enable or disable this mode")))
    .addSubcommand(sc => sc
      .setName("status")
      .setDescription("Show sanctuary settings and who is currently away"))
    .addSubcommand(sc => sc
      .setName("audio")
      .setDescription("List or toggle built-in Quiet audio")
      .addStringOption(o => o.setName("id").setDescription("Audio id to enable/disable"))
      .addBooleanOption(o => o.setName("enabled").setDescription("Enable or disable that audio id")))
    .toJSON();
}

async function runSanctuaryCommand(
  interaction: ChatInputCommandInteraction,
  forcedModeKey?: string,
): Promise<void> {
  if (!interaction.guild) return;
  const member = interaction.member as GuildMember | null;
  if (!member) return;

  const targetUser = interaction.options.getUser("user");
  const theme = normalizeTheme(
    interaction.commandName === "quiet" ? interaction.options.getString("theme") : null,
  );
  const modeKey = forcedModeKey
    ?? (interaction.commandName === "quiet" ? interaction.options.getString("mode") : null)
    ?? "quiet";

  // Staff placing another user
  if (targetUser && targetUser.id !== interaction.user.id) {
    if (!(await isQuietStaff(member))) {
      await interaction.reply({
        content: "Only staff can place someone else into a sanctuary mode.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    if (targetUser.bot) {
      await interaction.reply({ content: "Bots don't need a sanctuary room.", flags: MessageFlags.Ephemeral });
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
      const left = await leaveQuietMode(targetMember, { welcomeBack: true });
      await interaction.editReply({
        embeds: [new EmbedBuilder()
          .setColor(QUIET_BRAND.COLOR_OK)
          .setTitle(`${QUIET_EMOJI.SUN} Brought back`)
          .setDescription(
            left.wasQuiet
              ? `Forced <@${targetMember.id}> out of sanctuary mode. Server access restored.`
              : `<@${targetMember.id}> wasn't in a sanctuary mode.`,
          )],
      });
      return;
    }

    const result = await enterQuietMode({
      member: targetMember,
      enteredBy: interaction.user.id,
      theme,
      modeKey,
      lastChannelId: interaction.channelId,
    });

    if (!result.ok) {
      await interaction.editReply(result.error ?? "Couldn't enter sanctuary mode.");
      return;
    }

    const label = result.modeLabel ?? "Quiet Room";
    await interaction.editReply({
      embeds: [new EmbedBuilder()
        .setColor(QUIET_BRAND.COLOR)
        .setTitle(`${QUIET_EMOJI.MOON} ${label}`)
        .setDescription(
          `Placed <@${targetMember.id}> into **${label}**.\n` +
          `No public announcement. They return when **they** click **I'm Ready**, ` +
          `or you can force them out with \`/${interaction.commandName} user:@Member\` again.` +
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
    const left = await leaveQuietMode(member, { welcomeBack: true });
    await interaction.editReply({
      embeds: [new EmbedBuilder()
        .setColor(QUIET_BRAND.COLOR_OK)
        .setTitle(`${QUIET_EMOJI.SUN} Welcome back.`)
        .setDescription(left.wasQuiet
          ? "Glad you're here. Your server access was restored."
          : "You weren't in a sanctuary mode.")],
    });
    return;
  }

  const access = await canSelfQuiet(member);
  if (!access.ok) {
    await interaction.editReply({
      embeds: [new EmbedBuilder()
        .setColor(QUIET_BRAND.COLOR)
        .setTitle(`${QUIET_EMOJI.LOCK} Sanctuary`)
        .setDescription(access.reason ?? "You can't use this right now.")],
    });
    return;
  }

  const result = await enterQuietMode({
    member,
    enteredBy: member.id,
    theme,
    modeKey,
    lastChannelId: interaction.channelId,
  });

  if (!result.ok) {
    await interaction.editReply(result.error ?? "Couldn't enter sanctuary mode.");
    return;
  }

  const label = result.modeLabel ?? "Quiet Room";
  const roomMention = result.quietChannelId ? `<#${result.quietChannelId}>` : label;
  await interaction.editReply({
    embeds: [new EmbedBuilder()
      .setColor(QUIET_BRAND.COLOR)
      .setTitle(`${QUIET_EMOJI.MOON} ${label}`)
      .setDescription(
        `You're in ${roomMention} now — **one silent channel**. Other channels are hidden.\n\n` +
        "No chat, no reactions. Try the **Stones in the Water** exercise if you want.\n" +
        "When you're ready, press **🌤️ I'm Ready — Bring Me Back**.\n" +
        "Or run this command again anytime to leave — even if the bot restarted." +
        (result.isolationNote
          ? `\n\n${result.isolationNote}`
          : ""),
      )
      .setFooter({ text: QUIET_BRAND.FOOTER })],
  });
}

export async function handleQuietCommand(interaction: ChatInputCommandInteraction): Promise<void> {
  await runSanctuaryCommand(interaction);
}

export async function handleVacationCommand(interaction: ChatInputCommandInteraction): Promise<void> {
  await runSanctuaryCommand(interaction, "vacation");
}

export async function handleLoaCommand(interaction: ChatInputCommandInteraction): Promise<void> {
  await runSanctuaryCommand(interaction, "loa");
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
      const settings = await getQuietSettings(guildId);
      let modes = mergeSanctuaryModes(settings.sanctuaryModes);
      const caps = botCapability(interaction.guild);
      const lines: string[] = [];
      let categoryId: string | null = null;
      let primaryChannelId: string | null = null;

      for (const mode of modes.filter(m => m.enabled)) {
        const room = await ensureQuietRoom(interaction.guild, {
          channelName: mode.channelName,
          topic: mode.topic,
          preferChannelId: mode.channelId,
          persistChannelId: async (channelId) => {
            modes = patchMode(modes, mode.key, { channelId });
            const patch: { sanctuaryModes: typeof modes; quietChannelId?: string } = {
              sanctuaryModes: modes,
            };
            if (mode.key === "quiet") patch.quietChannelId = channelId;
            await updateQuietSettings(guildId, patch);
            mode.channelId = channelId;
          },
        });
        categoryId = room.categoryId;
        if (mode.key === "quiet") primaryChannelId = room.channel.id;

        const roleResult = await ensureQuietRole(interaction.guild, {
          roleName: mode.roleName,
          preferRoleId: mode.roleId,
          persistRoleId: async (roleId) => {
            modes = patchMode(modes, mode.key, { roleId });
            const patch: { sanctuaryModes: typeof modes; quietRoleId?: string } = {
              sanctuaryModes: modes,
            };
            if (mode.key === "quiet") patch.quietRoleId = roleId;
            await updateQuietSettings(guildId, patch);
            mode.roleId = roleId;
          },
        });

        let hideCount = 0;
        if (roleResult.role) {
          const hidden = await syncQuietRoleHides(
            interaction.guild,
            roleResult.role,
            room.channel.id,
            categoryId,
          );
          hideCount = hidden.length;
        }

        lines.push(
          `**${mode.label}** → ${room.channel}` +
          (roleResult.role
            ? ` · role <@&${roleResult.role.id}> · hides **${hideCount}**`
            : ` · role ❌ ${roleResult.error ?? "failed"}`),
        );
      }

      lines.unshift(
        caps.isAdmin
          ? "✅ Bot **Administrator** detected on the bot role (including integration-managed roles like DN Bot)."
          : "⚠️ Bot Administrator **not** detected. Enable **Administrator** on the bot's role, keep that role **above** Quiet/Vacation/LOA roles, then re-run this.",
      );
      if (primaryChannelId) lines.push(`Primary Quiet Room: <#${primaryChannelId}>`);
      await interaction.editReply(lines.join("\n").slice(0, 2000));
    } catch (err) {
      logger.error({ err }, "quiet_setup ensure_room failed");
      await interaction.editReply(
        "Couldn't create sanctuary rooms. Check **Manage Channels** / **Administrator** on the **bot role** (DN Bot), and that it sits above Quiet/Vacation roles.",
      );
    }
    return;
  }

  if (sub === "rename") {
    const modeKey = interaction.options.getString("mode", true);
    const label = interaction.options.getString("label");
    const roleName = interaction.options.getString("role_name");
    const channelName = interaction.options.getString("channel_name");
    const enabled = interaction.options.getBoolean("enabled");
    const settings = await getQuietSettings(guildId);
    let modes = mergeSanctuaryModes(settings.sanctuaryModes);
    const patch: Parameters<typeof patchMode>[2] = {};
    if (label) patch.label = label;
    if (roleName) patch.roleName = roleName;
    if (channelName) patch.channelName = channelName;
    if (enabled !== null) patch.enabled = enabled;
    modes = patchMode(modes, modeKey, patch);
    await updateQuietSettings(guildId, { sanctuaryModes: modes });
    const m = modes.find(x => x.key === modeKey)!;
    await interaction.editReply({
      embeds: [new EmbedBuilder()
        .setColor(QUIET_BRAND.COLOR_SOFT)
        .setTitle(`${QUIET_EMOJI.MOON} Mode updated`)
        .setDescription(
          `**Key:** \`${m.key}\` (stable)\n` +
          `**Label:** ${m.label}\n` +
          `**Role name:** ${m.roleName}\n` +
          `**Channel name:** #${m.channelName}\n` +
          `**Enabled:** ${m.enabled ? "yes" : "no"}\n\n` +
          `Run \`/quietsetup ensure_room\` to apply renames to Discord.`,
        )],
    });
    return;
  }

  if (sub === "status") {
    const settings = await getQuietSettings(guildId);
    const active = await listQuietStates(guildId);
    const caps = botCapability(interaction.guild);
    const modes = mergeSanctuaryModes(settings.sanctuaryModes);
    const modeLines = modes.map(m =>
      `• **${m.label}** (\`${m.key}\`) ${m.enabled ? "✅" : "⛔"}` +
      (m.channelId ? ` → <#${m.channelId}>` : "") +
      (m.roleId ? ` · <@&${m.roleId}>` : ""),
    ).join("\n");
    await interaction.editReply({
      embeds: [new EmbedBuilder()
        .setColor(QUIET_BRAND.COLOR)
        .setTitle(`${QUIET_EMOJI.MOON} Sanctuary status`)
        .setDescription(
          `**Enabled:** ${settings.enabled ? "yes" : "no"}\n` +
          `**Audio:** ${settings.audioEnabled ? "yes" : "no"}\n` +
          `**Bot Administrator (role/computed):** ${caps.isAdmin ? "yes ✅" : "no ⚠️"}\n` +
          `**Modes:**\n${modeLines}\n\n` +
          `**Currently away:** ${active.length}\n` +
          (active.length
            ? active.slice(0, 25).map(s =>
              `• <@${s.userId}> \`${s.modeKey ?? "quiet"}\` · <t:${Math.floor(s.enteredAt.getTime() / 1000)}:R>`,
            ).join("\n")
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
        .setFooter({ text: "Toggle: /quietsetup audio id:<id> enabled:true|false" })],
    });
    return;
  }
}
