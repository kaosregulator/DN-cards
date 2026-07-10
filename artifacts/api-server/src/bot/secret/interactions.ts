// Echo-Whisper modal + button interaction handlers.
//
// Flow:
//   /whisper → modal → encrypted transmission posted publicly with a "View
//   Whisper" button (only sender / recipient / override-admin can reveal).
//   /admin_secret → modal → encrypted transmission with a "View Secret" button
//   (only authorized viewer roles / override-admin can reveal).

import {
  ModalSubmitInteraction, ButtonInteraction,
  ActionRowBuilder, ButtonBuilder, ButtonStyle,
  MessageFlags, type GuildMember, PermissionFlagsBits,
} from "discord.js";
import { encryptPayload, decryptPayload, formatCodeForDisplay, extractCodeFromDisplay } from "./crypto.js";
import { storeTransmission, getTransmission, hasViewerAccess, isAdminOverrideEnabled } from "./db.js";

const EPHEMERAL = { flags: MessageFlags.Ephemeral } as const;

function isAdmin(member: GuildMember | null): boolean {
  return !!member?.permissions.has(PermissionFlagsBits.Administrator);
}

// ── Modal routing ────────────────────────────────────────────────────────────
export function isSecretModal(customId: string): boolean {
  return customId.startsWith("whisper_modal:") || customId === "adminsecret_modal";
}

export async function handleSecretModal(interaction: ModalSubmitInteraction): Promise<void> {
  if (interaction.customId.startsWith("whisper_modal:")) {
    await handleWhisperModal(interaction);
  } else if (interaction.customId === "adminsecret_modal") {
    await handleAdminSecretModal(interaction);
  }
}

async function handleWhisperModal(interaction: ModalSubmitInteraction): Promise<void> {
  const guildId = interaction.guildId;
  if (!guildId) {
    await interaction.reply({ content: "❌ This can only be used in a server.", ...EPHEMERAL });
    return;
  }
  const targetId = interaction.customId.split(":")[1];
  const text = interaction.fields.getTextInputValue("whisper_text");
  const senderId = interaction.user.id;

  const encrypted = encryptPayload({ t: text, s: senderId, r: targetId });
  const code = await storeTransmission(guildId, encrypted, "whisper", senderId, targetId);
  const display = formatCodeForDisplay(code, "whisper");

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId("reveal_whisper").setLabel("🔐 View Whisper").setStyle(ButtonStyle.Secondary),
  );
  await interaction.reply({
    content: `🔒 **Whisper for** <@${targetId}>\n\n${display}`,
    components: [row],
    allowedMentions: { users: [targetId] },
  });

  // Giveaway progress — sending an Echo whisper counts as an Echo activation.
  try {
    const { recordGiveawayEvent } = await import("../giveaway/engine.js");
    await recordGiveawayEvent(guildId, senderId, "echo_use", 1);
  } catch { /* non-fatal */ }
}

async function handleAdminSecretModal(interaction: ModalSubmitInteraction): Promise<void> {
  const guildId = interaction.guildId;
  if (!guildId) {
    await interaction.reply({ content: "❌ This can only be used in a server.", ...EPHEMERAL });
    return;
  }
  const text = interaction.fields.getTextInputValue("adminsecret_text");
  const encrypted = encryptPayload({ t: text });
  const code = await storeTransmission(guildId, encrypted, "adminsecret", interaction.user.id);
  const display = formatCodeForDisplay(code, "adminsecret");

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId("reveal_adminsecret").setLabel("🔓 View Secret").setStyle(ButtonStyle.Secondary),
  );
  await interaction.reply({ content: `🔒 **Encrypted Transmission**\n\n${display}`, components: [row] });
}

// ── Button routing ───────────────────────────────────────────────────────────
export function isSecretButton(customId: string): boolean {
  return customId === "reveal_whisper" || customId === "reveal_adminsecret";
}

export async function handleSecretButton(interaction: ButtonInteraction): Promise<void> {
  if (interaction.customId === "reveal_adminsecret") {
    await handleRevealAdminSecret(interaction);
  } else if (interaction.customId === "reveal_whisper") {
    await handleRevealWhisper(interaction);
  }
}

async function handleRevealAdminSecret(interaction: ButtonInteraction): Promise<void> {
  const guildId = interaction.guildId;
  const member = interaction.member as GuildMember | null;
  if (!guildId || !member) {
    await interaction.reply({ content: "❌ This can only be used in a server.", ...EPHEMERAL });
    return;
  }
  const code = extractCodeFromDisplay(interaction.message.content);
  if (!code) {
    await interaction.reply({ content: "❌ Could not locate the transmission code.", ...EPHEMERAL });
    return;
  }
  const tx = await getTransmission(guildId, code);
  if (!tx) {
    await interaction.reply({ content: "❌ This transmission has expired or been deleted.", ...EPHEMERAL });
    return;
  }
  try {
    const payload = decryptPayload(tx.payload);
    if (await isAdminOverrideEnabled(guildId) && isAdmin(member)) {
      await interaction.reply({ content: `🔏 **ADMIN OVERRIDE** — 🔒 **Secret Message**\n\n${payload.t}`, ...EPHEMERAL });
      return;
    }
    const memberRoleIds = [...member.roles.cache.keys()];
    if (!(await hasViewerAccess(guildId, memberRoleIds))) {
      await interaction.reply({ content: "❌ Access Denied.", ...EPHEMERAL });
      return;
    }
    await interaction.reply({ content: `🔒 **Secret Message**\n\n${payload.t}`, ...EPHEMERAL });
  } catch {
    await interaction.reply({ content: "❌ Failed to decrypt this message.", ...EPHEMERAL });
  }
}

async function handleRevealWhisper(interaction: ButtonInteraction): Promise<void> {
  const guildId = interaction.guildId;
  const member = interaction.member as GuildMember | null;
  const userId = interaction.user.id;
  if (!guildId) {
    await interaction.reply({ content: "❌ This can only be used in a server.", ...EPHEMERAL });
    return;
  }
  const code = extractCodeFromDisplay(interaction.message.content);
  if (!code) {
    await interaction.reply({ content: "❌ Could not locate the transmission code.", ...EPHEMERAL });
    return;
  }
  const tx = await getTransmission(guildId, code);
  if (!tx) {
    await interaction.reply({ content: "❌ This transmission has expired or been deleted.", ...EPHEMERAL });
    return;
  }
  try {
    const payload = decryptPayload(tx.payload);
    const { s: senderId, r: receiverId } = payload;
    if (!senderId || !receiverId) {
      await interaction.reply({ content: "❌ This is not a whisper message.", ...EPHEMERAL });
      return;
    }
    if (await isAdminOverrideEnabled(guildId) && isAdmin(member)) {
      await interaction.reply({
        content: `🔏 **ADMIN OVERRIDE** — 🔐 **Whisper**\n\nFrom: <@${senderId}>\nTo: <@${receiverId}>\n\n${payload.t}`,
        ...EPHEMERAL,
      });
      return;
    }
    if (senderId !== userId && receiverId !== userId) {
      await interaction.reply({ content: "❌ Access Denied — this whisper is not for you.", ...EPHEMERAL });
      return;
    }
    await interaction.reply({ content: `🔐 **Whisper**\n\n${payload.t}`, ...EPHEMERAL });
  } catch {
    await interaction.reply({ content: "❌ Failed to decrypt this message.", ...EPHEMERAL });
  }
}
