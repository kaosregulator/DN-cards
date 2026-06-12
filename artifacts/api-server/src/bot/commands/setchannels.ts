import type {
  ChatInputCommandInteraction,
  StringSelectMenuInteraction,
  ChannelSelectMenuInteraction,
} from "discord.js";
import {
  ActionRowBuilder, EmbedBuilder, MessageFlags,
  StringSelectMenuBuilder, ChannelSelectMenuBuilder, ChannelType,
} from "discord.js";
import { getOrCreateGuildSettings, updateGuildSettings, isAdmin } from "../db.js";

// ── Channel slot registry ─────────────────────────────────────────────────────
// Add new entries here to expose more configurable channels. The `column` must
// match a text() column on guildSettings; updateGuildSettings is typed as
// Partial<GuildSettings> so TS keeps this honest.
type SlotKey = "spawn" | "trade";
type Slot = {
  key: SlotKey;
  label: string;
  description: string;
  emoji: string;
  column: "spawnChannelId" | "tradeChannelId";
};

const SLOTS: readonly Slot[] = [
  {
    key: "spawn",
    label: "Spawn Channel",
    description: "Where cards drop & are caught",
    emoji: "🎴",
    column: "spawnChannelId",
  },
  {
    key: "trade",
    label: "Trade Channel",
    description: "Dedicated channel for trade announcements",
    emoji: "🔄",
    column: "tradeChannelId",
  },
];

const SLOT_BY_KEY = new Map(SLOTS.map(s => [s.key, s]));

// Full admin check (includes DB-added bot admins). Callers must defer before
// calling this so the DB query can't blow Discord's 3s interaction window.
// Uses editReply (not reply) since the interaction is already acknowledged.
async function ensureAdmin(
  interaction: ChatInputCommandInteraction | StringSelectMenuInteraction | ChannelSelectMenuInteraction | import("discord.js").ButtonInteraction,
): Promise<boolean> {
  if (!interaction.guild) return false;
  if (interaction.guild.ownerId === interaction.user.id) return true;
  const perms = interaction.memberPermissions;
  if (perms?.has("Administrator")) return true;
  const ok = await isAdmin(interaction.guild.id, interaction.user.id);
  if (!ok) {
    await interaction.editReply({ content: "❌ You don't have permission to configure channels." }).catch(() => {});
  }
  return ok;
}

// ── Entry: /setchannels (also called from adminhub button) ────────────────────
// Opens a new ephemeral channel-picker panel.
export async function handleSetChannels(
  interaction: ChatInputCommandInteraction | import("discord.js").ButtonInteraction,
): Promise<void> {
  if (!interaction.guild) return;
  // ACK immediately with a new ephemeral message — isAdmin() is a DB call.
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  if (!(await ensureAdmin(interaction))) return;

  const settings = await getOrCreateGuildSettings(interaction.guild.id);
  const embed = buildOverviewEmbed(settings);

  const select = new StringSelectMenuBuilder()
    .setCustomId("setchannels:pick")
    .setPlaceholder("Pick a channel to configure…")
    .addOptions(SLOTS.map(s => ({
      label: s.label,
      value: s.key,
      description: s.description,
      emoji: s.emoji,
    })));

  await interaction.editReply({
    embeds: [embed],
    components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select)],
  });
}

// ── Step 2: user picked which slot — show the channel picker ──────────────────
export async function handleSetChannelsPick(interaction: StringSelectMenuInteraction): Promise<void> {
  if (!interaction.guild) return;
  // Defer to edit the ephemeral message in place.
  await interaction.deferUpdate();
  if (!(await ensureAdmin(interaction))) return;

  const slotKey = interaction.values[0] as SlotKey;
  const slot = SLOT_BY_KEY.get(slotKey);
  if (!slot) {
    await interaction.editReply({ content: "❌ Unknown channel slot.", embeds: [], components: [] });
    return;
  }

  const picker = new ChannelSelectMenuBuilder()
    .setCustomId(`setchannels:set:${slot.key}`)
    .setPlaceholder(`Pick a text channel for ${slot.label}…`)
    .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement);

  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle(`${slot.emoji} Set ${slot.label}`)
    .setDescription(`${slot.description}.\n\nChoose a channel below — you can pick any text or announcement channel in this server.`);

  await interaction.editReply({
    embeds: [embed],
    components: [new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(picker)],
  });
}

// ── Step 3: user picked the actual channel — persist & confirm ────────────────
export async function handleSetChannelsApply(interaction: ChannelSelectMenuInteraction): Promise<void> {
  if (!interaction.guild) return;
  // Defer to update the ephemeral message in place.
  await interaction.deferUpdate();
  if (!(await ensureAdmin(interaction))) return;

  // customId shape: "setchannels:set:<slot>"
  const slotKey = interaction.customId.split(":")[2] as SlotKey;
  const slot = SLOT_BY_KEY.get(slotKey);
  const channel = interaction.channels.first();
  if (!slot || !channel) {
    await interaction.editReply({ content: "❌ Couldn't read your selection — try `/admin hub` then Set Channels again.", embeds: [], components: [] });
    return;
  }

  await updateGuildSettings(interaction.guild.id, { [slot.column]: channel.id });

  const settings = await getOrCreateGuildSettings(interaction.guild.id);
  const embed = buildOverviewEmbed(settings)
    .setTitle(`✅ ${slot.label} updated`)
    .setColor(0x57f287);

  // Offer the picker again so the admin can configure multiple slots in one go.
  const select = new StringSelectMenuBuilder()
    .setCustomId("setchannels:pick")
    .setPlaceholder("Configure another channel…")
    .addOptions(SLOTS.map(s => ({
      label: s.label,
      value: s.key,
      description: s.description,
      emoji: s.emoji,
    })));

  await interaction.editReply({
    embeds: [embed],
    components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select)],
  });
}

// ── Shared overview embed (shows current settings for every slot) ─────────────
function buildOverviewEmbed(settings: { spawnChannelId: string | null; tradeChannelId: string | null }): EmbedBuilder {
  const lines = SLOTS.map(slot => {
    const current = settings[slot.column];
    const value = current ? `<#${current}>` : "_not set_";
    return `${slot.emoji} **${slot.label}** — ${value}`;
  });
  return new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle("📡 Channel Settings")
    .setDescription(lines.join("\n") + "\n\nPick a slot below to change it.");
}
