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
import { getMirrorStatus, triggerMirrorPass, type MirrorStatus } from "../../lib/cardMirror.js";

// ── Public entry: /admin_hub command opens the ephemeral hub ──────────────────
export async function handleAdminHubCommand(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!interaction.guild) return;
  // ACK immediately — buildHubEmbed has 3 DB calls, easily past 3s without defer.
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const ok = await ensureAdmin(interaction);
  if (!ok) return;
  await interaction.editReply({
    embeds: [await buildHubEmbed(interaction.guild.id)],
    components: buildHubComponents(),
  });
}

// ── Button router ───────────────────────────────────────────────────────────-
export async function handleAdminHubButton(interaction: ButtonInteraction): Promise<void> {
  if (!interaction.guild) return;
  const [, action] = interaction.customId.split(":"); // adminhub:<action>

  // ── Modal paths: showModal() MUST be the first response — cannot defer first.
  // Use a fast inline check (memberPermissions, zero RTT). The modal submit
  // handler re-validates with the full DB check.
  if (action === "addadmin" || action === "rmadmin" || action === "timeout" || action === "untimeout") {
    if (!ensureAdminInline(interaction)) {
      await interaction.reply({ content: "❌ Admins only.", flags: MessageFlags.Ephemeral });
      return;
    }
    if (action === "addadmin") await interaction.showModal(buildAddAdminModal());
    if (action === "rmadmin")  await interaction.showModal(buildRemoveAdminModal());
    if (action === "timeout")  await interaction.showModal(buildTimeoutModal());
    if (action === "untimeout") await interaction.showModal(buildClearTimeoutModal());
    return;
  }

  // ── setchannels: opens a new ephemeral channel-picker panel ──
  if (action === "setchannels") {
    const { handleSetChannels } = await import("./setchannels.js");
    await handleSetChannels(interaction);
    return;
  }

  // ── Card backup (R2 mirror) status panel ──
  // "mirrorstatus" (from the hub) opens a SEPARATE ephemeral panel; "mirrorrun"
  // and "mirrorrefresh" (on that panel) update it in place.
  if (action === "mirrorstatus" || action === "mirrorrun" || action === "mirrorrefresh") {
    if (action === "mirrorstatus") {
      // Fresh ephemeral panel so the hub message stays intact.
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    } else {
      await interaction.deferUpdate();
    }
    const ok = await ensureAdmin(interaction);
    if (!ok) return;
    let note: string | undefined;
    if (action === "mirrorrun") {
      const r = triggerMirrorPass();
      note = r.started
        ? "🚀 Backup pass started — refresh in a moment to watch the numbers move."
        : r.reason === "already_running"
          ? "⏳ A backup pass is already running."
          : "⚠️ Off-site backup isn't configured yet — add the `R2_*` secrets in Replit.";
    }
    const status = await getMirrorStatus();
    await interaction.editReply({
      embeds: [buildMirrorEmbed(status, note)],
      components: buildMirrorComponents(status),
    });
    return;
  }

  // ── refresh (and any unknown action): update the existing hub in-place ──
  await interaction.deferUpdate();
  const ok = await ensureAdmin(interaction);
  if (!ok) {
    await interaction.followUp({ content: "❌ Admins only.", flags: MessageFlags.Ephemeral });
    return;
  }
  await interaction.editReply({
    embeds: [await buildHubEmbed(interaction.guild.id)],
    components: buildHubComponents(),
  });
}

// ── Modal submit router ─────────────────────────────────────────────────────-
export async function handleAdminHubModal(interaction: ModalSubmitInteraction): Promise<void> {
  if (!interaction.guild) return;
  // Defer immediately — DB writes happen before we can reply.
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
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

// Fast sync check using the inline permission payload — zero RTT, safe to call
// before the interaction is acknowledged (for modal paths where showModal must
// be the first response). Does NOT check DB-added bot admins.
function ensureAdminInline(interaction: ButtonInteraction): boolean {
  if (!interaction.guild) return false;
  if (interaction.guild.ownerId === interaction.user.id) return true;
  return !!(interaction.memberPermissions?.has("Administrator"));
}

// Full check (includes DB-added bot admins). ALL callers must defer first so
// that if the DB query is slow we don't blow Discord's 3s interaction window.
// Uses editReply (not reply) because the interaction is already acknowledged.
async function ensureAdmin(
  interaction: ChatInputCommandInteraction | ButtonInteraction | ModalSubmitInteraction,
): Promise<boolean> {
  if (!interaction.guild) return false;
  const perms = interaction.memberPermissions;
  const allowed =
    interaction.guild.ownerId === interaction.user.id ||
    perms?.has("Administrator") ||
    (await isAdmin(interaction.guild.id, interaction.user.id));
  if (!allowed) {
    await interaction.editReply("❌ Only admins can use the admin hub.").catch(() => {});
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
      "**Card grants:** `/drop` `/give` `/give_shards` `/take_back` `/take_shards`.\n" +
      "**Card sets:** `/set_admin load` `/set_admin unload` `/set_admin listloaded`.",
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
    new ButtonBuilder().setCustomId("adminhub:mirrorstatus").setLabel("🗄️ Backup Status").setStyle(ButtonStyle.Secondary),
  );
  return [row1, row2];
}

// ── Card image backup (R2 mirror) status panel ───────────────────────────────

function fmtBytes(n: number): string {
  if (n <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(units.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
  return `${(n / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

function progressBar(done: number, total: number, width = 16): string {
  if (total <= 0) return "▱".repeat(width);
  const filled = Math.round((done / total) * width);
  return "▰".repeat(filled) + "▱".repeat(width - filled);
}

function buildMirrorEmbed(s: MirrorStatus, note?: string): EmbedBuilder {
  const done = s.ok;
  const total = s.totalWithImages;
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  const embed = new EmbedBuilder()
    .setTitle("🗄️ Card Art — Off-site Backup")
    .setColor(s.configured ? (s.pending === 0 && total > 0 ? 0x57f287 : 0x5865f2) : 0x9aa0a8);

  if (!s.configured) {
    embed.setDescription(
      "**Off-site backup is not turned on yet.**\n\n" +
      "It safely copies every card's art (plus a low-res thumbnail) to your own Cloudflare R2 bucket — " +
      "read-only on the originals, nothing is ever lost.\n\n" +
      "Add these secrets in **Replit → Tools → Secrets**, then reboot:\n" +
      "`R2_ACCESS_KEY_ID` · `R2_SECRET_ACCESS_KEY` · `R2_BUCKET` · `R2_ACCOUNT_ID`\n\n" +
      "_Full guide: `docs/CARD_IMAGE_MIRROR.md`._",
    );
    if (total > 0) embed.addFields({ name: "Cards with art", value: `**${total}** ready to back up once enabled`, inline: false });
    return embed;
  }

  embed.setDescription(
    `${progressBar(done, total)}  **${pct}%**\n` +
    `**${done}** / **${total}** cards backed up${s.running ? " · ⏳ _a pass is running…_" : ""}`,
  );
  embed.addFields(
    { name: "✅ Backed up", value: `**${done}**`, inline: true },
    { name: "⏳ Pending", value: `**${s.pending}**`, inline: true },
    { name: "🖼️ Thumbnails", value: `**${s.thumbs}**`, inline: true },
    { name: "💾 Stored", value: `**${fmtBytes(s.bytes)}**`, inline: true },
    { name: "⚠️ Errors", value: `**${s.errored}**${s.errored ? " _(retried)_" : ""}`, inline: true },
    { name: "🚫 Missing source", value: `**${s.sourceMissing}**`, inline: true },
  );
  if (s.lastMirroredAt) {
    embed.addFields({
      name: "🕒 Last backup",
      value: `<t:${Math.floor(s.lastMirroredAt.getTime() / 1000)}:R>`,
      inline: false,
    });
  }
  embed.setFooter({ text: `${s.bucket ?? "R2"} · new & changed art is backed up automatically every 30 min` });
  if (note) embed.addFields({ name: "​", value: note, inline: false });
  return embed;
}

function buildMirrorComponents(s: MirrorStatus): ActionRowBuilder<ButtonBuilder>[] {
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId("adminhub:mirrorrefresh").setLabel("🔄 Refresh").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId("adminhub:mirrorrun")
      .setLabel("🚀 Back up now").setStyle(ButtonStyle.Success)
      .setDisabled(!s.configured || s.running || s.pending === 0),
  );
  return [row];
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
  await interaction.editReply({ content, allowedMentions: { parse: [] } }).catch(() => {});
}

async function replyError(interaction: ModalSubmitInteraction, content: string) {
  await interaction.editReply({ content: `❌ ${content}` }).catch(() => {});
}
