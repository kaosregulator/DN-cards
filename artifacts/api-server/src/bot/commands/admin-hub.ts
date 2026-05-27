import {
  EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
  ModalBuilder, TextInputBuilder, TextInputStyle, MessageFlags,
  type ChatInputCommandInteraction, type ButtonInteraction,
  type ModalSubmitInteraction,
} from "discord.js";
import {
  isAdmin, listAdmins, addAdmin, removeAdmin,
  setUserTimeout, clearUserTimeout, listActiveTimeouts,
  getOrCreateGuildSettings,
} from "../db.js";

// ── Public entry: /adminhub command opens the ephemeral hub ──────────────────
export async function handleAdminHubCommand(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!interaction.guild) return;
  const ok = await ensureAdmin(interaction);
  if (!ok) return;

  await interaction.reply({
    embeds: [await buildHubEmbed(interaction.guild.id)],
    components: buildHubComponents(),
    flags: MessageFlags.Ephemeral,
  });
}

// ── Button router ───────────────────────────────────────────────────────────-
export async function handleAdminHubButton(interaction: ButtonInteraction): Promise<void> {
  if (!interaction.guild) return;
  const ok = await ensureAdmin(interaction);
  if (!ok) return;

  const [, action] = interaction.customId.split(":"); // adminhub:<action>

  if (action === "refresh") {
    await interaction.update({
      embeds: [await buildHubEmbed(interaction.guild.id)],
      components: buildHubComponents(),
    });
    return;
  }

  if (action === "addadmin") {
    await interaction.showModal(buildAddAdminModal());
    return;
  }
  if (action === "rmadmin") {
    await interaction.showModal(buildRemoveAdminModal());
    return;
  }
  if (action === "timeout") {
    await interaction.showModal(buildTimeoutModal());
    return;
  }
  if (action === "untimeout") {
    await interaction.showModal(buildClearTimeoutModal());
    return;
  }
  if (action === "setchannels") {
    const { handleSetChannels } = await import("./setchannels.js");
    await handleSetChannels(interaction);
    return;
  }
}

// ── Modal submit router ─────────────────────────────────────────────────────-
export async function handleAdminHubModal(interaction: ModalSubmitInteraction): Promise<void> {
  if (!interaction.guild) return;
  const ok = await ensureAdmin(interaction);
  if (!ok) return;

  const [, action] = interaction.customId.split(":");

  if (action === "addadmin") {
    const userId = parseUserId(interaction.fields.getTextInputValue("user"));
    if (!userId) { await replyError(interaction, "Couldn't parse a user. Paste the user's @mention or numeric ID."); return; }
    await addAdmin(interaction.guild.id, userId, interaction.user.id);
    await replyOk(interaction, `✅ <@${userId}> added as bot admin.`);
    return;
  }

  if (action === "rmadmin") {
    const userId = parseUserId(interaction.fields.getTextInputValue("user"));
    if (!userId) { await replyError(interaction, "Couldn't parse a user. Paste the user's @mention or numeric ID."); return; }
    await removeAdmin(interaction.guild.id, userId);
    await replyOk(interaction, `✅ <@${userId}> removed from bot admins.`);
    return;
  }

  if (action === "timeout") {
    const userId = parseUserId(interaction.fields.getTextInputValue("user"));
    if (!userId) { await replyError(interaction, "Couldn't parse a user. Paste the user's @mention or numeric ID."); return; }
    const durationStr = interaction.fields.getTextInputValue("duration").trim();
    const ms = parseDurationMs(durationStr);
    if (!ms || ms < 60_000) { await replyError(interaction, "Duration must be at least 1m. Examples: `30m`, `2h`, `1d`."); return; }
    if (ms > 30 * 24 * 60 * 60 * 1000) { await replyError(interaction, "Duration capped at 30d."); return; }
    const reason = interaction.fields.getTextInputValue("reason")?.trim() || undefined;
    const expiresAt = new Date(Date.now() + ms);
    await setUserTimeout(interaction.guild.id, userId, expiresAt, interaction.user.id, reason);
    await replyOk(interaction,
      `⏱️ <@${userId}> can't catch cards until <t:${Math.floor(expiresAt.getTime() / 1000)}:f>` +
      (reason ? ` — reason: *${escapeMd(reason)}*.` : "."),
    );
    return;
  }

  if (action === "untimeout") {
    const userId = parseUserId(interaction.fields.getTextInputValue("user"));
    if (!userId) { await replyError(interaction, "Couldn't parse a user. Paste the user's @mention or numeric ID."); return; }
    await clearUserTimeout(interaction.guild.id, userId);
    await replyOk(interaction, `✅ Timeout cleared for <@${userId}>.`);
    return;
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────
async function ensureAdmin(
  interaction: ChatInputCommandInteraction | ButtonInteraction | ModalSubmitInteraction,
): Promise<boolean> {
  // Use interaction.memberPermissions (inline in payload) — members.fetch is a
  // network RTT that under cold start blows Discord's 3s interaction window.
  if (!interaction.guild) return false;
  const perms = interaction.memberPermissions;
  const allowed =
    interaction.guild.ownerId === interaction.user.id ||
    perms?.has("Administrator") ||
    (await isAdmin(interaction.guild.id, interaction.user.id));
  if (!allowed) {
    await interaction.reply({
      content: "❌ Only admins can use the admin hub.",
      flags: MessageFlags.Ephemeral,
    }).catch(() => { /* ignore */ });
  }
  return !!allowed;
}

async function buildHubEmbed(guildId: string): Promise<EmbedBuilder> {
  const [admins, timeouts, settings] = await Promise.all([
    listAdmins(guildId),
    listActiveTimeouts(guildId),
    getOrCreateGuildSettings(guildId),
  ]);

  const adminLines = admins.length === 0
    ? "_None — only the server owner & Discord Administrators have access._"
    : admins.map(a => `• <@${a.userId}>`).join("\n");

  const timeoutLines = timeouts.length === 0
    ? "_No one is currently timed out._"
    : timeouts.map(t => {
        const until = `<t:${Math.floor(t.expiresAt.getTime() / 1000)}:R>`;
        const reason = t.reason ? ` — *${escapeMd(t.reason)}*` : "";
        return `• <@${t.userId}> · until ${until}${reason}`;
      }).join("\n");

  return new EmbedBuilder()
    .setTitle("🛡️ DN Cards — Admin Hub")
    .setColor(0xed4245)
    .setDescription(
      "Quick admin actions for this server. Buttons below open private prompts; results show only to you.\n\n" +
      "**Spawn / drop / settings:** use `/config` (channel, interval, drop rates, catch mode, toggles).\n" +
      "**Card grants:** `/drop` `/give` `/giveshards` `/takeback` `/takeshards`.\n" +
      "**Card sets:** `/setadmin load` `/setadmin unload` `/setadmin listloaded`.",
    )
    .addFields(
      {
        name: "👥 Bot Admins (besides owner & Discord Admins)",
        value: adminLines,
        inline: false,
      },
      {
        name: "⏱️ Active Catch Timeouts",
        value: timeoutLines,
        inline: false,
      },
      {
        name: "⚙️ Quick Server State",
        value:
          `${settings.spawnEnabled ? "✅" : "⏸️"} Auto-Spawning · ` +
          `${settings.tradeEnabled ? "✅" : "⏸️"} Trading · ` +
          `Catch mode: \`${(settings as unknown as { catchMode?: string }).catchMode ?? "type"}\``,
        inline: false,
      },
    )
    .setFooter({ text: "Tip: /config opens the settings panel with drop-rate controls." });
}

function buildHubComponents() {
  const row1 = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId("adminhub:addadmin").setLabel("👥 Add Admin").setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId("adminhub:rmadmin").setLabel("👥 Remove Admin").setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId("adminhub:timeout").setLabel("⏱️ Timeout User").setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId("adminhub:untimeout").setLabel("✅ Clear Timeout").setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId("adminhub:refresh").setLabel("🔄 Refresh").setStyle(ButtonStyle.Secondary),
  );
  const row2 = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId("adminhub:setchannels").setLabel("📡 Set Channels").setStyle(ButtonStyle.Primary),
  );
  return [row1, row2];
}

function buildAddAdminModal(): ModalBuilder {
  const m = new ModalBuilder().setCustomId("adminhub:addadmin").setTitle("Add Bot Admin");
  m.addComponents(rowOf(
    new TextInputBuilder().setCustomId("user").setLabel("User (@mention or numeric ID)")
      .setStyle(TextInputStyle.Short).setRequired(true).setPlaceholder("@User or 123456789012345678"),
  ));
  return m;
}

function buildRemoveAdminModal(): ModalBuilder {
  const m = new ModalBuilder().setCustomId("adminhub:rmadmin").setTitle("Remove Bot Admin");
  m.addComponents(rowOf(
    new TextInputBuilder().setCustomId("user").setLabel("User (@mention or numeric ID)")
      .setStyle(TextInputStyle.Short).setRequired(true).setPlaceholder("@User or 123456789012345678"),
  ));
  return m;
}

function buildTimeoutModal(): ModalBuilder {
  const m = new ModalBuilder().setCustomId("adminhub:timeout").setTitle("Timeout User From Catching");
  m.addComponents(
    rowOf(
      new TextInputBuilder().setCustomId("user").setLabel("User (@mention or numeric ID)")
        .setStyle(TextInputStyle.Short).setRequired(true).setPlaceholder("@User or 123456789012345678"),
    ),
    rowOf(
      new TextInputBuilder().setCustomId("duration").setLabel("Duration (e.g. 30m, 2h, 1d — max 30d)")
        .setStyle(TextInputStyle.Short).setRequired(true).setPlaceholder("30m").setMaxLength(10),
    ),
    rowOf(
      new TextInputBuilder().setCustomId("reason").setLabel("Reason (optional, visible to staff)")
        .setStyle(TextInputStyle.Paragraph).setRequired(false).setMaxLength(200),
    ),
  );
  return m;
}

function buildClearTimeoutModal(): ModalBuilder {
  const m = new ModalBuilder().setCustomId("adminhub:untimeout").setTitle("Clear User Timeout");
  m.addComponents(rowOf(
    new TextInputBuilder().setCustomId("user").setLabel("User (@mention or numeric ID)")
      .setStyle(TextInputStyle.Short).setRequired(true).setPlaceholder("@User or 123456789012345678"),
  ));
  return m;
}

function rowOf(input: TextInputBuilder): ActionRowBuilder<TextInputBuilder> {
  return new ActionRowBuilder<TextInputBuilder>().addComponents(input);
}

function parseUserId(raw: string): string | null {
  const trimmed = raw.trim();
  const mentionMatch = trimmed.match(/^<@!?(\d{15,21})>$/);
  if (mentionMatch) return mentionMatch[1]!;
  if (/^\d{15,21}$/.test(trimmed)) return trimmed;
  return null;
}

function parseDurationMs(raw: string): number | null {
  const m = raw.toLowerCase().match(/^(\d+)\s*(s|m|h|d)$/);
  if (!m) return null;
  const n = parseInt(m[1]!, 10);
  if (!Number.isFinite(n) || n <= 0) return null;
  const unit = m[2]!;
  const mult: Record<string, number> = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 };
  return n * mult[unit]!;
}

function escapeMd(s: string): string {
  return s.replace(/[*_`~|\\]/g, c => `\\${c}`);
}

async function replyOk(interaction: ModalSubmitInteraction, content: string) {
  await interaction.reply({
    content,
    flags: MessageFlags.Ephemeral,
    allowedMentions: { parse: [] },
  }).catch(() => { /* ignore */ });
}

async function replyError(interaction: ModalSubmitInteraction, content: string) {
  await interaction.reply({ content: `❌ ${content}`, flags: MessageFlags.Ephemeral }).catch(() => { /* ignore */ });
}
