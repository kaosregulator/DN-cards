import {
  SlashCommandBuilder, PermissionFlagsBits, MessageFlags,
  EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  type ChatInputCommandInteraction, type GuildMember,
} from "discord.js";
import { logger } from "../../lib/logger.js";
import {
  getAfkSettings, updateAfkSettings, addWhitelist, removeWhitelist,
  getNotes, getAfk, countUnreadNotes, type AfkNoteRow,
} from "./models.js";
import {
  AFK_BRAND, AFK_EMOJI, hasAfkAccess, putDraft, isPresenceTriggerEnabled,
  clearAfkForUser,
} from "./shared.js";
import { buildNotesViewer } from "./interactions.js";

// ─────────────────────────────────────────────────────────────────────────────
// AFK Secretary — slash command definitions + top-level handlers.
//
// Two commands:
//   /afk        (user)  — set an away state, read notes left for you
//   /afk_setup   (admin) — feature toggles + the access whitelist
//
// The multi-step /afk set dashboard (method → optional duration → preview →
// confirm) and the notes viewer are continued in interactions.ts; this file
// owns the command surface + the first render of each flow.
// ─────────────────────────────────────────────────────────────────────────────

// ── Builders (consumed by commands/register.ts) ──────────────────────────────

/** `/afk` — gated behind the whitelist inside the handler. */
export function buildAfkCommandJson() {
  return new SlashCommandBuilder()
    .setName("afk")
    .setDescription("Set yourself away with a Secretary that handles your pings")
    .setDMPermission(false)
    .addSubcommand(sc => sc
      .setName("set")
      .setDescription("Go AFK — opens your away dashboard")
      .addStringOption(o => o
        .setName("reason")
        .setDescription("Why you're stepping away (shown to anyone who pings you)")
        .setMaxLength(200)))
    .addSubcommand(sc => sc
      .setName("clear")
      .setDescription("Clear your AFK right now, whatever return trigger you picked"))
    .addSubcommand(sc => sc
      .setName("messages")
      .setDescription("Read and manage notes left for you while you were away"))
    .toJSON();
}

/** `/afk_setup` — admin-only (Manage Server). */
export function buildAfkSetupCommandJson() {
  return new SlashCommandBuilder()
    .setName("afksetup")
    .setDescription("Configure the AFK Secretary & manage whitelist access")
    .setDMPermission(false)
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand(sc => sc
      .setName("config")
      .setDescription("Toggle Secretary features for this server")
      .addBooleanOption(o => o
        .setName("secretary")
        .setDescription("Enable the ping-intercept Secretary engine"))
      .addBooleanOption(o => o
        .setName("nicknames")
        .setDescription("Prefix [AFK] onto members' nicknames while away"))
      .addBooleanOption(o => o
        .setName("speak_as_user")
        .setDescription("Reply as the away member (their name + avatar) instead of the bot"))
      .addIntegerOption(o => o
        .setName("max_messages")
        .setDescription("Max unread notes a member may hold (1–100)")
        .setMinValue(1).setMaxValue(100)))
    .addSubcommandGroup(g => g
      .setName("whitelist")
      .setDescription("Manage who may use the AFK system")
      .addSubcommand(sc => sc
        .setName("add")
        .setDescription("Grant AFK access to a user or role")
        .addMentionableOption(o => o
          .setName("target")
          .setDescription("Mention a @user or @role (or paste an ID)")
          .setRequired(true)))
      .addSubcommand(sc => sc
        .setName("remove")
        .setDescription("Revoke AFK access from a user or role")
        .addMentionableOption(o => o
          .setName("target")
          .setDescription("Mention a @user or @role (or paste an ID)")
          .setRequired(true))))
    .toJSON();
}

// ── Shared UI fragments ──────────────────────────────────────────────────────

/** The polished, ephemeral "you're not on the list" notice. */
function accessDeniedEmbed(): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(AFK_BRAND.COLOR_DANGER)
    .setTitle(`${AFK_EMOJI.LOCK} Access Restricted`)
    .setDescription(
      "The **AFK Secretary** is a members-only concierge service, and your " +
      "account isn't on the access list for this server yet.\n\n" +
      "**How to request access**\n" +
      "› Ask a server administrator or staff member to run\n" +
      " `/afk_setup whitelist add` and mention you.\n" +
      "› Access can be granted to you individually or to a role you already hold.",
    )
    .setFooter({ text: AFK_BRAND.FOOTER })
    .setTimestamp();
}

// ── /afk dispatch ────────────────────────────────────────────────────────────

export async function handleAfkCommand(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!interaction.guild) return;
  const member = interaction.member as GuildMember | null;
  if (!member) return;
  const sub = interaction.options.getSubcommand(true);

  // Every /afk invocation passes through the access wall first.
  if (!(await hasAfkAccess(member))) {
    await interaction.reply({ embeds: [accessDeniedEmbed()], flags: MessageFlags.Ephemeral });
    return;
  }

  if (sub === "set") return handleAfkSet(interaction);
  if (sub === "clear") return handleAfkClear(interaction);
  if (sub === "messages") return handleAfkMessages(interaction);
}

/**
 * `/afk clear` — lift your own away state immediately, regardless of the return
 * trigger you chose. Useful when you picked a long timer (or "on status
 * change") and just want to be back now. Runs the same teardown every other
 * clear path uses: nickname restored, Notify-Me subscribers told you're back.
 */
async function handleAfkClear(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const guildId = interaction.guild!.id;
  const userId = interaction.user.id;

  const state = await getAfk(guildId, userId);
  if (!state) {
    await interaction.editReply({
      embeds: [new EmbedBuilder()
        .setColor(AFK_BRAND.COLOR_MUTED)
        .setDescription(`${AFK_EMOJI.PROFILE} You're not currently AFK — nothing to clear.`)
        .setFooter({ text: AFK_BRAND.FOOTER })],
    });
    return;
  }

  const cleared = await clearAfkForUser(interaction.client, guildId, userId, "MANUAL")
    .catch(err => { logger.debug({ err, guildId, userId }, "AFK manual clear failed"); return null; });

  const awaySince = Math.floor(state.startTime.getTime() / 1000);
  const unread = await countUnreadNotes(guildId, userId).catch(() => 0);

  const embed = new EmbedBuilder()
    .setColor(cleared ? AFK_BRAND.COLOR_SUCCESS : AFK_BRAND.COLOR_DANGER)
    .setTitle(cleared ? `${AFK_EMOJI.RETURN} Welcome back` : `${AFK_EMOJI.LOCK} Couldn't clear that`)
    .setDescription(cleared
      ? `Your AFK is cleared — you were away since <t:${awaySince}:R>.` +
        (unread > 0 ? `\n\n${AFK_EMOJI.NOTE} You have **${unread}** unread note${unread === 1 ? "" : "s"} — read them with \`/afk messages\`.` : "")
      : "Something went wrong lifting your away state. Try again in a moment.")
    .setFooter({ text: AFK_BRAND.FOOTER })
    .setTimestamp();

  await interaction.editReply({ embeds: [embed] });
}

/** Step 1 of the away flow — render the premium method-picker dashboard. */
async function handleAfkSet(interaction: ChatInputCommandInteraction): Promise<void> {
  const reason = interaction.options.getString("reason")?.trim() || "Away from keyboard";

  // Stash the reason (and any long text) server-side; the select menus only
  // carry the chosen method/duration, not the reason itself.
  putDraft(interaction.user.id, { guildId: interaction.guild!.id, reason });

  const statusEnabled = isPresenceTriggerEnabled();

  const fields = [
    { name: `${AFK_EMOJI.RETURN} On Return`, value: "Clears the moment you send a message *(after a 45s grace window)*.", inline: false },
  ];
  if (statusEnabled) {
    fields.push({ name: `${AFK_EMOJI.STATUS} On Status Change`, value: "Clears automatically when you flip Offline/Idle → Online.", inline: false });
  }
  fields.push({ name: `${AFK_EMOJI.TIMED} Timed Auto-Remove`, value: "Set a countdown — we'll lift it for you when time's up.", inline: false });

  const dashboard = new EmbedBuilder()
    .setColor(AFK_BRAND.COLOR_PRIMARY)
    .setAuthor({ name: `${interaction.user.username} · AFK Setup`, iconURL: interaction.user.displayAvatarURL() })
    .setTitle(`${AFK_EMOJI.SPARKLE} How should we bring you back?`)
    .setDescription(
      `> **Reason**\n> ${reason}\n\n` +
      "Pick how your away state should clear. Your **Secretary** will greet " +
      "anyone who pings you until then.",
    )
    .addFields(fields)
    .setFooter({ text: AFK_BRAND.FOOTER })
    .setTimestamp();

  const options = [
    new StringSelectMenuOptionBuilder().setLabel("On Return").setValue("RETURN")
      .setDescription("Clear when I next send a message").setEmoji(AFK_EMOJI.RETURN),
  ];
  if (statusEnabled) {
    options.push(new StringSelectMenuOptionBuilder().setLabel("On Status Change").setValue("STATUS")
      .setDescription("Clear when I come back Online").setEmoji(AFK_EMOJI.STATUS));
  }
  options.push(new StringSelectMenuOptionBuilder().setLabel("Timed Auto-Remove").setValue("AUTO")
    .setDescription("Clear after a set amount of time").setEmoji(AFK_EMOJI.TIMED));

  const menu = new StringSelectMenuBuilder()
    .setCustomId("afk:set:method")
    .setPlaceholder("Choose a return trigger…")
    .addOptions(options);

  await interaction.reply({
    embeds: [dashboard],
    components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu)],
    flags: MessageFlags.Ephemeral,
  });
}

/** `/afk messages` — open the interactive note inbox. */
async function handleAfkMessages(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const notes: AfkNoteRow[] = await getNotes(interaction.guild!.id, interaction.user.id);
  const view = buildNotesViewer(notes, null);
  await interaction.editReply(view);
}

// ── /afk_setup dispatch ───────────────────────────────────────────────────────

export async function handleAfkSetupCommand(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!interaction.guild) return;
  const member = interaction.member as GuildMember | null;

  // Server-side belt-and-braces even though the command is permission-gated in
  // the Discord UI: owner + Administrator/ManageGuild only.
  const isAdmin =
    interaction.guild.ownerId === interaction.user.id ||
    !!member?.permissions.has(PermissionFlagsBits.Administrator) ||
    !!member?.permissions.has(PermissionFlagsBits.ManageGuild);
  if (!isAdmin) {
    await interaction.reply({
      content: "🔒 You need **Manage Server** to configure the AFK Secretary.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const group = interaction.options.getSubcommandGroup(false);
  const sub = interaction.options.getSubcommand(true);

  if (group === "whitelist") return handleWhitelistMutation(interaction, sub as "add" | "remove");
  if (sub === "config") return handleConfig(interaction);
}

async function handleConfig(interaction: ChatInputCommandInteraction): Promise<void> {
  const guildId = interaction.guild!.id;
  const secretary = interaction.options.getBoolean("secretary");
  const nicknames = interaction.options.getBoolean("nicknames");
  const speakAsUser = interaction.options.getBoolean("speak_as_user");
  const maxMessages = interaction.options.getInteger("max_messages");

  const patch: Parameters<typeof updateAfkSettings>[1] = {};
  if (secretary !== null) patch.secretaryEnabled = secretary;
  if (nicknames !== null) patch.nicknameChanges = nicknames;
  if (speakAsUser !== null) patch.speakAsUser = speakAsUser;
  if (maxMessages !== null) patch.maxSavedMessages = maxMessages;

  const settings = Object.keys(patch).length > 0
    ? await updateAfkSettings(guildId, patch)
    : await getAfkSettings(guildId);

  const onOff = (v: boolean) => (v ? "🟢 Enabled" : "⚪ Disabled");
  const embed = new EmbedBuilder()
    .setColor(AFK_BRAND.COLOR_PRIMARY)
    .setTitle("⚙️ AFK Secretary — Configuration")
    .setDescription(
      (Object.keys(patch).length > 0
        ? "Your changes have been saved."
        : "Current configuration for this server.") +
      (settings.speakAsUser
        ? "\n\n> **Reply As Member** is on: intercepts post through a webhook with the " +
          "away member's name and avatar. Discord still shows a small **APP** tag on " +
          "these — no bot can remove it — and it needs **Manage Webhooks** in the " +
          "channel, otherwise the Secretary replies as the bot."
        : ""),
    )
    .addFields(
      { name: "Secretary Engine", value: onOff(settings.secretaryEnabled), inline: true },
      { name: "Nickname Tagging", value: onOff(settings.nicknameChanges), inline: true },
      { name: "Reply As Member", value: onOff(settings.speakAsUser), inline: true },
      { name: "Max Unread Notes", value: `\`${settings.maxSavedMessages}\``, inline: true },
    )
    .setFooter({ text: AFK_BRAND.FOOTER })
    .setTimestamp();
  await interaction.editReply({ embeds: [embed] });
}

async function handleWhitelistMutation(
  interaction: ChatInputCommandInteraction,
  action: "add" | "remove",
): Promise<void> {
  const guildId = interaction.guild!.id;
  // Mentionable resolves to a User or a Role — detect which.
  const target = interaction.options.getMentionable("target", true) as
    | { id: string; user?: unknown }
    | GuildMember
    | { id: string };

  const targetId = (target as { id: string }).id;
  // Roles have no `.user`; GuildMembers/Users do. `@everyone` role id === guildId.
  const isRole = !("user" in (target as object)) && !("username" in (target as object));
  const type: "USER" | "ROLE" = isRole ? "ROLE" : "USER";
  const mention = type === "ROLE" ? `<@&${targetId}>` : `<@${targetId}>`;

  try {
    if (action === "add") {
      await addWhitelist(guildId, targetId, type, interaction.user.id);
      await interaction.editReply({
        embeds: [new EmbedBuilder()
          .setColor(AFK_BRAND.COLOR_SUCCESS)
          .setTitle("✅ Access Granted")
          .setDescription(
            `${mention} can now use the **AFK Secretary**.` +
            (type === "ROLE" ? "\nEveryone holding this role inherits access." : ""),
          )
          .setFooter({ text: AFK_BRAND.FOOTER })
          .setTimestamp()],
      });
    } else {
      const removed = await removeWhitelist(guildId, targetId);
      await interaction.editReply({
        embeds: [new EmbedBuilder()
          .setColor(removed ? AFK_BRAND.COLOR_SUCCESS : AFK_BRAND.COLOR_MUTED)
          .setTitle(removed ? "🗑️ Access Revoked" : "ℹ️ Nothing to Remove")
          .setDescription(
            removed
              ? `${mention} has been removed from the AFK access list.`
              : `${mention} wasn't on the access list.`,
          )
          .setFooter({ text: AFK_BRAND.FOOTER })
          .setTimestamp()],
      });
    }
  } catch (err) {
    logger.error({ err, guildId, targetId, action }, "AFK whitelist mutation failed");
    await interaction.editReply("❌ Couldn't update the whitelist. Please try again.");
  }
}
