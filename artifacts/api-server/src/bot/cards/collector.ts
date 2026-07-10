// Collector ping role — an opt-in role members can self-assign to get pinged on
// every card spawn (a lighter-touch alternative to per-card wishlist DMs).

import type { ChatInputCommandInteraction } from "discord.js";
import { PermissionFlagsBits, MessageFlags, type GuildMember } from "discord.js";
import { getOrCreateGuildSettings, updateGuildSettings } from "../db.js";

const EPHEMERAL = { flags: MessageFlags.Ephemeral } as const;

// ── /collector — member self-toggles the ping role ─────────────────────
export async function handleCollectorToggle(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!interaction.guild) return;
  const guildId = interaction.guild.id;
  const settings = await getOrCreateGuildSettings(guildId);
  if (!settings.collectorRoleId) {
    await interaction.editReply("🔕 This server hasn't set up a collector ping role yet. An admin can create one with `/collector_role role:@Collectors`.");
    return;
  }
  const role = interaction.guild.roles.cache.get(settings.collectorRoleId)
    ?? await interaction.guild.roles.fetch(settings.collectorRoleId).catch(() => null);
  if (!role) {
    await interaction.editReply("⚠️ The configured collector role no longer exists. Ask an admin to set a new one with `/collector_role`.");
    return;
  }

  const member = interaction.member as GuildMember | null
    ?? await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
  if (!member) { await interaction.editReply("❌ Couldn't load your server membership. Try again."); return; }

  const has = member.roles.cache.has(role.id);
  try {
    if (has) {
      await member.roles.remove(role.id, "Opted out of spawn pings");
      await interaction.editReply(`🔕 You'll no longer be pinged on spawns. Run this again to opt back in.`);
    } else {
      await member.roles.add(role.id, "Opted in to spawn pings");
      await interaction.editReply(`🔔 You'll now be pinged when a card spawns! Run this again to opt out.`);
    }
  } catch {
    await interaction.editReply(
      "❌ I couldn't change your roles — I need the **Manage Roles** permission and my role must sit **above** the collector role in Server Settings → Roles.",
    );
  }
}

// ── /collector_role — admin sets/clears the ping role ───────────────────
export async function handleSetCollectorRole(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!interaction.guild) return;
  const guildId = interaction.guild.id;
  const role = interaction.options.getRole("role");

  if (!role) {
    await updateGuildSettings(guildId, { collectorRoleId: null });
    await interaction.editReply("✅ Collector ping role cleared — spawns will no longer ping a role.");
    return;
  }

  await updateGuildSettings(guildId, { collectorRoleId: role.id });

  // Best-effort hierarchy check so admins learn now (not at spawn time) if the
  // bot can't manage the role for self-assignment.
  const me = interaction.guild.members.me;
  const canManage = me?.permissions.has(PermissionFlagsBits.ManageRoles)
    && me.roles.highest.comparePositionTo(role.id) > 0;
  await interaction.editReply(
    `✅ Collector ping role set to <@&${role.id}>. Members opt in with \`/collector\`.` +
    (canManage ? "" : "\n\n⚠️ Heads up: I currently **can't manage this role** for self-assignment. Give me **Manage Roles** and drag my role **above** it in Server Settings → Roles."),
  );
}
