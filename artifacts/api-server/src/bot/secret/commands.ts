// Echo-Whisper slash-command handlers (ported into DN Cards). Three commands:
//   /whisper user:@x      — encrypted member-to-member message
//   /admin_secret          — role-gated staff message
//   /echo <sub>           — management hub (roles, override, stats, config)
//
// The heavy lifting (modal submits + reveal buttons) lives in interactions.ts.

import {
  ChatInputCommandInteraction,
  ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder,
  PermissionFlagsBits, MessageFlags, type GuildMember,
} from "discord.js";
import {
  getSecretSettings, isAdminOverrideEnabled, setAdminOverride,
  listViewerRoles, addViewerRole, removeViewerRole,
} from "./db.js";

const EPHEMERAL = { flags: MessageFlags.Ephemeral } as const;

// ── /whisper ─────────────────────────────────────────────────────────────────
export async function handleWhisperCommand(interaction: ChatInputCommandInteraction): Promise<void> {
  const targetUser = interaction.options.getUser("user", true);
  if (targetUser.id === interaction.user.id) {
    await interaction.reply({ content: "❌ You can't whisper to yourself.", ...EPHEMERAL });
    return;
  }
  if (targetUser.bot) {
    await interaction.reply({ content: "❌ You can't whisper to a bot.", ...EPHEMERAL });
    return;
  }

  const modal = new ModalBuilder()
    .setCustomId(`whisper_modal:${targetUser.id}`)
    .setTitle("Write your whisper");
  const textInput = new TextInputBuilder()
    .setCustomId("whisper_text")
    .setLabel("Your private message")
    .setStyle(TextInputStyle.Paragraph)
    .setPlaceholder("Type your encrypted message here…")
    .setMinLength(1).setMaxLength(1500).setRequired(true);
  modal.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(textInput));
  await interaction.showModal(modal);
}

// ── /admin_secret ─────────────────────────────────────────────────────────────
export async function handleAdminSecretCommand(interaction: ChatInputCommandInteraction): Promise<void> {
  const modal = new ModalBuilder()
    .setCustomId("adminsecret_modal")
    .setTitle("Write your admin secret");
  const textInput = new TextInputBuilder()
    .setCustomId("adminsecret_text")
    .setLabel("Your encrypted message")
    .setStyle(TextInputStyle.Paragraph)
    .setPlaceholder("Type your secret message here…")
    .setMinLength(1).setMaxLength(1500).setRequired(true);
  modal.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(textInput));
  await interaction.showModal(modal);
}

// ── /echo (management hub) ───────────────────────────────────────────────────
export async function handleEchoCommand(interaction: ChatInputCommandInteraction): Promise<void> {
  const guildId = interaction.guildId;
  if (!guildId) {
    await interaction.reply({ content: "❌ This command can only be used in a server.", ...EPHEMERAL });
    return;
  }

  // Admin gate (echo mirrors the Discord Administrator default-permission).
  const member = interaction.member as GuildMember | null;
  if (!member?.permissions.has(PermissionFlagsBits.Administrator)) {
    await interaction.reply({ content: "❌ You need the **Administrator** permission to use `/echo`.", ...EPHEMERAL });
    return;
  }

  const sub = interaction.options.getSubcommand();

  if (sub === "role") {
    const action = interaction.options.getString("action", true);
    if (action === "list") {
      const roleIds = await listViewerRoles(guildId);
      if (roleIds.length === 0) {
        await interaction.reply({
          content: "No authorized roles yet. Use `/echo role action:add role:@role` to add one.",
          ...EPHEMERAL,
        });
      } else {
        const list = roleIds.map(id => `• <@&${id}>`).join("\n");
        await interaction.reply({ content: `**🔐 Authorized roles for /admin_secret viewing:**\n${list}`, ...EPHEMERAL });
      }
      return;
    }
    const role = interaction.options.getRole("role", false);
    if (!role) {
      await interaction.reply({ content: "❌ Provide a role to add or remove.", ...EPHEMERAL });
      return;
    }
    if (action === "add") {
      await addViewerRole(guildId, role.id);
      await interaction.reply({ content: `✅ <@&${role.id}> can now reveal /admin_secret messages.`, ...EPHEMERAL });
    } else {
      const removed = await removeViewerRole(guildId, role.id);
      await interaction.reply({
        content: removed
          ? `✅ <@&${role.id}> removed from authorized roles.`
          : `⚠️ <@&${role.id}> was not in the authorized list.`,
        ...EPHEMERAL,
      });
    }
    return;
  }

  if (sub === "override") {
    const mode = interaction.options.getString("mode", true);
    const enable = mode === "enable";
    await setAdminOverride(guildId, enable);
    await interaction.reply({
      content: `✅ **Admin override** is now **${enable ? "enabled" : "disabled"}**.\n` +
        `Admins ${enable ? "can" : "cannot"} decrypt any /admin_secret and /whisper message.`,
      ...EPHEMERAL,
    });
    return;
  }

  if (sub === "whisper") {
    const override = await isAdminOverrideEnabled(guildId);
    await interaction.reply({
      content:
        "🔐 **Whisper Settings**\n\n" +
        "**What it does:** Members can send encrypted private messages to each other.\n" +
        "**Who can decrypt:** Only the sender, recipient, and (if enabled) server admins.\n" +
        `**Admin override:** ${override ? "✅ Enabled — admins can decrypt any whisper" : "❌ Disabled — admins follow the same rules as members"}\n\n` +
        "**Usage:** `/whisper user:@member`",
      ...EPHEMERAL,
    });
    return;
  }

  if (sub === "adminsecret") {
    const roleIds = await listViewerRoles(guildId);
    const roleList = roleIds.length > 0 ? roleIds.map(id => `• <@&${id}>`).join("\n") : "*No roles configured*";
    const override = await isAdminOverrideEnabled(guildId);
    await interaction.reply({
      content:
        "🔐 **Admin Secret Settings**\n\n" +
        "**What it does:** Staff can post encrypted messages for authorized roles only.\n" +
        `**Authorized roles:**\n${roleList}\n` +
        `**Admin override:** ${override ? "✅ Enabled — admins can decrypt any adminsecret" : "❌ Disabled — admins follow role rules"}\n\n` +
        "**Usage:** `/admin_secret`",
      ...EPHEMERAL,
    });
    return;
  }

  if (sub === "stats") {
    const client = interaction.client;
    const guildCount = client.guilds.cache.size;
    const uptime = client.uptime ? formatUptime(client.uptime) : "Unknown";
    await interaction.reply({
      content:
        "📊 **Echo-Whisper Statistics**\n\n" +
        `**Servers:** ${guildCount}\n` +
        `**Uptime:** ${uptime}\n` +
        "**Commands:** /admin_secret, /whisper, /echo\n" +
        "**Storage:** Encrypted payloads in the Dex N Cards database (per-guild)",
      ...EPHEMERAL,
    });
    return;
  }

  if (sub === "config") {
    const settings = await getSecretSettings(guildId);
    await interaction.reply({
      content:
        "⚙️ **Echo-Whisper Configuration**\n\n" +
        `**Admin override:** ${settings.adminOverride ? "✅ Enabled" : "❌ Disabled"}\n` +
        `**Viewer roles:** ${settings.viewerRoleIds.length} role(s) configured\n` +
        "**Encryption:** AES-256-CBC (key derived from ENCRYPTION_KEY)\n\n" +
        "**Available commands:**\n" +
        "• `/admin_secret` — staff encrypted messages\n" +
        "• `/whisper` — member private conversations\n" +
        "• `/echo` — this management hub",
      ...EPHEMERAL,
    });
    return;
  }
}

function formatUptime(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  if (days > 0) return `${days}d ${hours % 24}h ${minutes % 60}m`;
  if (hours > 0) return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
  return `${minutes}m ${seconds}s`;
}
