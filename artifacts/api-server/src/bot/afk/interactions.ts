import {
  EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
  StringSelectMenuBuilder, StringSelectMenuOptionBuilder,
  ModalBuilder, TextInputBuilder, TextInputStyle, MessageFlags,
  type Interaction, type MessageComponentInteraction,
  type ModalSubmitInteraction, type StringSelectMenuInteraction,
  type ButtonInteraction, type GuildMember,
} from "discord.js";
import { logger } from "../../lib/logger.js";
import {
  getAfkSettings, getAfk, setAfk, getNotes, getNoteById,
  markNoteRead, deleteNote, addNote, addSubscriber, type AfkNoteRow,
} from "./models.js";
import {
  AFK_BRAND, AFK_EMOJI, AFK_DURATIONS,
  getDraft, patchDraft, clearDraft,
  applyAfkNickname, canDismiss, forgetDismissOwner,
} from "./shared.js";

// ─────────────────────────────────────────────────────────────────────────────
// AFK Secretary — universal interaction router.
//
// Every button, select menu and modal in the AFK system carries an `afk:`
// customId prefix and lands here. index.ts hands us anything matching that
// prefix; we fan out to the right handler. One switchboard, no leakage into the
// host bot's existing routers.
// ─────────────────────────────────────────────────────────────────────────────

/** Entry point wired into index.ts's InteractionCreate handler. */
export async function handleAfkInteraction(interaction: Interaction): Promise<void> {
  try {
    if (interaction.isStringSelectMenu()) return await routeSelect(interaction);
    if (interaction.isButton()) return await routeButton(interaction);
    if (interaction.isModalSubmit()) return await routeModal(interaction);
  } catch (err) {
    logger.error({ err, customId: (interaction as MessageComponentInteraction).customId }, "AFK interaction error");
    try {
      const msg = "❌ Something went wrong handling that. Please try again.";
      if (interaction.isRepliable()) {
        if (interaction.replied || interaction.deferred) await interaction.followUp({ content: msg, flags: MessageFlags.Ephemeral });
        else await interaction.reply({ content: msg, flags: MessageFlags.Ephemeral });
      }
    } catch { /* ignore */ }
  }
}

// ── Select menus ─────────────────────────────────────────────────────────────
async function routeSelect(interaction: StringSelectMenuInteraction): Promise<void> {
  const id = interaction.customId;
  if (id === "afk:set:method") return onMethodSelect(interaction);
  if (id === "afk:set:duration") return onDurationSelect(interaction);
  if (id === "afk:notes:view") return onNoteView(interaction);
}

/** Method chosen. RETURN/STATUS finalize immediately; AUTO opens a duration menu. */
async function onMethodSelect(interaction: StringSelectMenuInteraction): Promise<void> {
  const method = interaction.values[0] as "RETURN" | "STATUS" | "AUTO";
  const draft = patchDraft(interaction.user.id, { method });
  if (!draft) {
    await interaction.update({ content: "⌛ This dashboard expired. Run `/afk set` again.", embeds: [], components: [] });
    return;
  }

  if (method === "AUTO") {
    const menu = new StringSelectMenuBuilder()
      .setCustomId("afk:set:duration")
      .setPlaceholder("Pick how long you'll be away…")
      .addOptions(AFK_DURATIONS.map(d =>
        new StringSelectMenuOptionBuilder().setLabel(d.label).setValue(d.value).setEmoji(AFK_EMOJI.TIMED)));

    const embed = new EmbedBuilder()
      .setColor(AFK_BRAND.COLOR_PRIMARY)
      .setTitle(`${AFK_EMOJI.TIMED} Set your countdown`)
      .setDescription("Choose an interval. We'll automatically lift your AFK when it elapses.")
      .setFooter({ text: AFK_BRAND.FOOTER });
    await interaction.update({
      embeds: [embed],
      components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu)],
    });
    return;
  }

  // RETURN / STATUS — no extra input needed. Finalize now.
  await finalizeAfk(interaction, method, null);
}

/** Duration chosen for a timed AFK → show a preview + confirm gate. */
async function onDurationSelect(interaction: StringSelectMenuInteraction): Promise<void> {
  const preset = AFK_DURATIONS.find(d => d.value === interaction.values[0]);
  if (!preset) { await interaction.update({ content: "Unknown duration.", components: [] }); return; }

  const draft = patchDraft(interaction.user.id, { method: "AUTO", durationMs: preset.ms });
  if (!draft) {
    await interaction.update({ content: "⌛ This dashboard expired. Run `/afk set` again.", embeds: [], components: [] });
    return;
  }

  const returnAt = Math.floor((Date.now() + preset.ms) / 1000);
  const preview = new EmbedBuilder()
    .setColor(AFK_BRAND.COLOR_PRIMARY)
    .setTitle(`${AFK_EMOJI.SPARKLE} Preview — confirm to go AFK`)
    .setDescription("Here's exactly what your away state will look like:")
    .addFields(
      { name: "Reason", value: draft.reason, inline: false },
      { name: "Trigger", value: `${AFK_EMOJI.TIMED} Timed · **${preset.label}**`, inline: true },
      // <t:…:R> and <t:…:F> render in each viewer's OWN timezone automatically.
      { name: "Auto-returns", value: `<t:${returnAt}:F>\n(<t:${returnAt}:R>)`, inline: true },
    )
    .setFooter({ text: AFK_BRAND.FOOTER });

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId("afk:set:confirm").setStyle(ButtonStyle.Success).setEmoji("✅").setLabel("Confirm & Go AFK"),
    new ButtonBuilder().setCustomId("afk:set:cancel").setStyle(ButtonStyle.Secondary).setEmoji("↩️").setLabel("Cancel"),
  );
  await interaction.update({ embeds: [preview], components: [row] });
}

// ── Buttons ──────────────────────────────────────────────────────────────────
async function routeButton(interaction: ButtonInteraction): Promise<void> {
  const id = interaction.customId;
  if (id === "afk:set:confirm") return onConfirm(interaction);
  if (id === "afk:set:cancel") return onCancel(interaction);
  if (id === "afk:notes:refresh") return onNotesRefresh(interaction);
  if (id === "afk:notes:readall") return onNotesReadAll(interaction);
  if (id.startsWith("afk:notes:del:")) return onNoteDelete(interaction);
  if (id.startsWith("afk:note:")) return onLeaveNoteButton(interaction);
  if (id.startsWith("afk:notify:")) return onNotifyMe(interaction);
  if (id.startsWith("afk:profile:")) return onViewProfile(interaction);
  if (id.startsWith("afk:dismiss:")) return onDismiss(interaction);
}

async function onConfirm(interaction: ButtonInteraction): Promise<void> {
  const draft = getDraft(interaction.user.id);
  if (!draft || draft.method !== "AUTO" || !draft.durationMs) {
    await interaction.update({ content: "⌛ This dashboard expired. Run `/afk set` again.", embeds: [], components: [] });
    return;
  }
  await finalizeAfk(interaction, "AUTO", new Date(Date.now() + draft.durationMs));
}

async function onCancel(interaction: ButtonInteraction): Promise<void> {
  clearDraft(interaction.user.id);
  await interaction.update({
    content: "↩️ AFK setup cancelled — you're still active.",
    embeds: [], components: [],
  });
}

// ── Finalize: write the AFK state + apply nickname + confirm ──────────────────
async function finalizeAfk(
  interaction: StringSelectMenuInteraction | ButtonInteraction,
  method: "RETURN" | "STATUS" | "AUTO",
  autoRemoveAt: Date | null,
): Promise<void> {
  const draft = getDraft(interaction.user.id);
  const guildId = interaction.guild!.id;
  const reason = draft?.reason ?? "Away from keyboard";

  const settings = await getAfkSettings(guildId);
  const member = await interaction.guild!.members.fetch(interaction.user.id).catch(() => null) as GuildMember | null;

  // Soft hierarchy shield lives inside applyAfkNickname — never throws.
  let originalNickname: string | null = null;
  if (member) {
    const res = await applyAfkNickname(member, settings);
    originalNickname = res.originalNickname;
  }

  await setAfk({ guildId, userId: interaction.user.id, reason, removalMethod: method, autoRemoveAt, originalNickname });
  clearDraft(interaction.user.id);

  const triggerLine =
    method === "RETURN" ? `${AFK_EMOJI.RETURN} Clears when you next send a message *(45s grace)*`
    : method === "STATUS" ? `${AFK_EMOJI.STATUS} Clears when you return Online`
    : `${AFK_EMOJI.TIMED} Auto-clears <t:${Math.floor(autoRemoveAt!.getTime() / 1000)}:R>`;

  const embed = new EmbedBuilder()
    .setColor(AFK_BRAND.COLOR_SUCCESS)
    .setAuthor({ name: `${interaction.user.username} is now AFK`, iconURL: interaction.user.displayAvatarURL() })
    .setTitle(`${AFK_EMOJI.SPARKLE} Your Secretary is on duty`)
    .setDescription(`> ${reason}`)
    .addFields({ name: "Return trigger", value: triggerLine })
    .setFooter({ text: AFK_BRAND.FOOTER })
    .setTimestamp();

  await interaction.update({ embeds: [embed], components: [] });
}

// ── Notes viewer ─────────────────────────────────────────────────────────────

/**
 * Build the ephemeral inbox view. Shared by `/afk messages` and every in-view
 * mutation (open / delete / mark-all-read / refresh) so the UI stays consistent.
 * `openNote` renders one note's full body beneath the list.
 */
export function buildNotesViewer(
  notes: AfkNoteRow[],
  openNote: AfkNoteRow | null,
): { embeds: EmbedBuilder[]; components: ActionRowBuilder<StringSelectMenuBuilder | ButtonBuilder>[] } {
  if (notes.length === 0) {
    return {
      embeds: [new EmbedBuilder()
        .setColor(AFK_BRAND.COLOR_MUTED)
        .setTitle(`${AFK_EMOJI.NOTE} Inbox Zero`)
        .setDescription("No one left you any notes while you were away. Nice and quiet. ✨")
        .setFooter({ text: AFK_BRAND.FOOTER })],
      components: [],
    };
  }

  const unread = notes.filter(n => !n.isRead).length;
  const lines = notes.slice(0, 25).map((n, i) => {
    const ts = Math.floor(n.createdAt.getTime() / 1000);
    const flag = n.isRead ? "" : " 🆕";
    const snippet = n.message.length > 60 ? `${n.message.slice(0, 60)}…` : n.message;
    return `**${i + 1}.** from <@${n.senderId}> · <t:${ts}:R>${flag}\n> ${snippet}`;
  });

  const listEmbed = new EmbedBuilder()
    .setColor(AFK_BRAND.COLOR_PRIMARY)
    .setTitle(`${AFK_EMOJI.NOTE} Your Notes — ${notes.length} total · ${unread} unread`)
    .setDescription(lines.join("\n\n"))
    .setFooter({ text: `${AFK_BRAND.FOOTER} • Select a note to read it in full` });

  const embeds = [listEmbed];
  const rows: ActionRowBuilder<StringSelectMenuBuilder | ButtonBuilder>[] = [];

  const select = new StringSelectMenuBuilder()
    .setCustomId("afk:notes:view")
    .setPlaceholder("Open a note…")
    .addOptions(notes.slice(0, 25).map((n, i) =>
      new StringSelectMenuOptionBuilder()
        .setLabel(`Note ${i + 1}`)
        .setValue(String(n.id))
        .setDescription(n.message.length > 90 ? `${n.message.slice(0, 90)}…` : n.message)
        .setEmoji(n.isRead ? "📄" : "🆕")));
  rows.push(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select));

  if (openNote) {
    const ts = Math.floor(openNote.createdAt.getTime() / 1000);
    embeds.push(new EmbedBuilder()
      .setColor(AFK_BRAND.COLOR_SUCCESS)
      .setTitle("📖 Reading note")
      .setDescription(openNote.message)
      .addFields(
        { name: "From", value: `<@${openNote.senderId}>`, inline: true },
        { name: "Left", value: `<t:${ts}:F>`, inline: true },
      )
      .setFooter({ text: AFK_BRAND.FOOTER }));
  }

  const buttons = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId("afk:notes:refresh").setStyle(ButtonStyle.Secondary).setEmoji("🔄").setLabel("Refresh"),
    new ButtonBuilder().setCustomId("afk:notes:readall").setStyle(ButtonStyle.Primary).setEmoji("✅").setLabel("Mark all read").setDisabled(unread === 0),
  );
  if (openNote) {
    buttons.addComponents(
      new ButtonBuilder().setCustomId(`afk:notes:del:${openNote.id}`).setStyle(ButtonStyle.Danger).setEmoji("🗑️").setLabel("Delete this note"),
    );
  }
  rows.push(buttons);

  return { embeds, components: rows };
}

async function onNoteView(interaction: StringSelectMenuInteraction): Promise<void> {
  const noteId = parseInt(interaction.values[0], 10);
  const note = await getNoteById(noteId, interaction.user.id);
  if (note && !note.isRead) await markNoteRead(noteId, interaction.user.id);
  const notes = await getNotes(interaction.guild!.id, interaction.user.id);
  const opened = notes.find(n => n.id === noteId) ?? null;
  await interaction.update(buildNotesViewer(notes, opened));
}

async function onNotesRefresh(interaction: ButtonInteraction): Promise<void> {
  const notes = await getNotes(interaction.guild!.id, interaction.user.id);
  await interaction.update(buildNotesViewer(notes, null));
}

async function onNotesReadAll(interaction: ButtonInteraction): Promise<void> {
  const notes = await getNotes(interaction.guild!.id, interaction.user.id);
  await Promise.all(notes.filter(n => !n.isRead).map(n => markNoteRead(n.id, interaction.user.id)));
  const refreshed = await getNotes(interaction.guild!.id, interaction.user.id);
  await interaction.update(buildNotesViewer(refreshed, null));
}

async function onNoteDelete(interaction: ButtonInteraction): Promise<void> {
  const noteId = parseInt(interaction.customId.split(":")[3], 10);
  await deleteNote(noteId, interaction.user.id);
  const notes = await getNotes(interaction.guild!.id, interaction.user.id);
  await interaction.update(buildNotesViewer(notes, null));
}

// ── Secretary embed buttons ──────────────────────────────────────────────────

/** 📩 Leave a Note → open the modal. */
async function onLeaveNoteButton(interaction: ButtonInteraction): Promise<void> {
  const afkUserId = interaction.customId.split(":")[2];
  const modal = new ModalBuilder()
    .setCustomId(`afk:notemodal:${afkUserId}`)
    .setTitle("Leave a note");
  modal.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(
    new TextInputBuilder()
      .setCustomId("body")
      .setLabel("Your message")
      .setStyle(TextInputStyle.Paragraph)
      .setMinLength(1).setMaxLength(300)
      .setPlaceholder("They'll read this the moment they're back…")
      .setRequired(true),
  ));
  await interaction.showModal(modal);
}

/** 🔔 Notify Me → subscribe to a return DM. */
async function onNotifyMe(interaction: ButtonInteraction): Promise<void> {
  const afkUserId = interaction.customId.split(":")[2];
  if (afkUserId === interaction.user.id) {
    await interaction.reply({ content: "You can't subscribe to your own return. 😄", flags: MessageFlags.Ephemeral });
    return;
  }
  // Guard: only notify if they're actually still away.
  const state = await getAfk(interaction.guild!.id, afkUserId);
  if (!state) {
    await interaction.reply({ content: `${AFK_EMOJI.RETURN} They're already back — no need to wait!`, flags: MessageFlags.Ephemeral });
    return;
  }
  const { added } = await addSubscriber({
    guildId: interaction.guild!.id,
    afkUserId,
    subscriberId: interaction.user.id,
    channelId: interaction.channelId,
  });
  await interaction.reply({
    content: added
      ? `${AFK_EMOJI.NOTIFY} You're on the list — I'll DM you the moment <@${afkUserId}> returns.`
      : `${AFK_EMOJI.NOTIFY} You're already subscribed to <@${afkUserId}>'s return.`,
    flags: MessageFlags.Ephemeral,
  });
}

/** 👤 View Profile → ephemeral snapshot of the AFK member. */
async function onViewProfile(interaction: ButtonInteraction): Promise<void> {
  const afkUserId = interaction.customId.split(":")[2];
  const member = await interaction.guild!.members.fetch(afkUserId).catch(() => null) as GuildMember | null;
  const state = await getAfk(interaction.guild!.id, afkUserId);
  if (!member) {
    await interaction.reply({ content: "Couldn't load that member's profile.", flags: MessageFlags.Ephemeral });
    return;
  }
  const joined = member.joinedTimestamp ? `<t:${Math.floor(member.joinedTimestamp / 1000)}:D>` : "Unknown";
  const created = `<t:${Math.floor(member.user.createdTimestamp / 1000)}:D>`;
  const roles = member.roles.cache.filter(r => r.id !== interaction.guild!.id).map(r => r.toString()).slice(0, 10).join(" ") || "None";

  const embed = new EmbedBuilder()
    .setColor(member.displayColor || AFK_BRAND.COLOR_PRIMARY)
    .setAuthor({ name: member.user.tag, iconURL: member.displayAvatarURL() })
    .setThumbnail(member.displayAvatarURL({ size: 256 }))
    .addFields(
      { name: "Display name", value: member.displayName, inline: true },
      { name: "Status", value: state ? `${AFK_EMOJI.TIMED} AFK` : "🟢 Active", inline: true },
      { name: "Joined server", value: joined, inline: true },
      { name: "Account created", value: created, inline: true },
      { name: "Roles", value: roles, inline: false },
    )
    .setFooter({ text: AFK_BRAND.FOOTER })
    .setTimestamp();
  if (state) {
    embed.addFields({ name: "Away since", value: `<t:${Math.floor(state.startTime.getTime() / 1000)}:R>`, inline: true });
  }
  await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
}

/** ❌ Dismiss → delete the Secretary embed, honouring the ownership lock. */
async function onDismiss(interaction: ButtonInteraction): Promise<void> {
  const messageId = interaction.message.id;
  const parts = interaction.customId.split(":"); // afk:dismiss:<afkUserId>:<pingerId>
  const pingerId = parts[3];
  const member = interaction.member as GuildMember | null;
  const isMod = !!member?.permissions.has("ManageMessages");

  // The first pinger owns it immediately; anyone else must wait out the 5s lock
  // (moderators bypass). registerDismissOwner is called when the embed is sent.
  if (!isMod && interaction.user.id !== pingerId && !canDismiss(messageId, interaction.user.id)) {
    await interaction.reply({
      content: `${AFK_EMOJI.LOCK} Only <@${pingerId}> can dismiss this right now — try again in a few seconds.`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  forgetDismissOwner(messageId);
  await interaction.message.delete().catch(() => { /* already gone */ });
}

// ── Modals ───────────────────────────────────────────────────────────────────
async function routeModal(interaction: ModalSubmitInteraction): Promise<void> {
  if (interaction.customId.startsWith("afk:notemodal:")) return onNoteModalSubmit(interaction);
}

async function onNoteModalSubmit(interaction: ModalSubmitInteraction): Promise<void> {
  const afkUserId = interaction.customId.split(":")[2];
  const body = interaction.fields.getTextInputValue("body").trim();
  if (!body) {
    await interaction.reply({ content: "A note can't be empty.", flags: MessageFlags.Ephemeral });
    return;
  }

  const settings = await getAfkSettings(interaction.guild!.id);
  const { stored, atCapacity } = await addNote({
    guildId: interaction.guild!.id,
    senderId: interaction.user.id,
    receiverId: afkUserId,
    message: body,
    maxSavedMessages: settings.maxSavedMessages,
  });

  await interaction.reply({
    content: stored
      ? `${AFK_EMOJI.NOTE} Delivered — <@${afkUserId}> will see your note when they run \`/afk messages\`.`
      : atCapacity
        ? "📭 Their inbox is full right now, so I couldn't leave the note. Try again later."
        : "❌ Couldn't save that note. Please try again.",
    flags: MessageFlags.Ephemeral,
  });
}
