import {
  SlashCommandBuilder, PermissionFlagsBits, MessageFlags, EmbedBuilder,
  type ChatInputCommandInteraction, type GuildMember,
} from "discord.js";
import { logger } from "../../lib/logger.js";
import { addShards } from "../db.js";
import {
  resolveUsername, getUserProfile, getGroupMembership,
  getAvatarThumbnail, profileUrl,
} from "./api.js";
import {
  generateVerifyCode, getLinkByDiscordId, getLinkByRobloxId, upsertLink,
  deleteLink, startVerification, getVerification, clearVerification,
  getGuildRobloxSettings, upsertGuildRobloxSettings, claimLinkBonusOnce,
} from "./store.js";

// ─────────────────────────────────────────────────────────────────────────────
// Roblox integration — slash command surface + handlers.
//
//   /link  (user)  — start | verify | status | unlink | whois
//   /roblox (admin) — config | show
//
// Verification is profile-code based: the bot hands the player a code, they
// paste it into their Roblox "About" blurb, and `/link verify` reads it back
// via the public Roblox API. No OAuth app, no secrets, no Roblox-side setup.
//
// The link itself is GLOBAL (one Discord user ↔ one Roblox account). Perks
// (verified role, one-time shard bonus, group-rank display) are per-guild and
// only fire when an admin has enabled Roblox for that server.
// ─────────────────────────────────────────────────────────────────────────────

const ROBLOX_COLOR = 0x00a2ff;

// ── Builders (consumed by commands/register.ts) ──────────────────────────────

export function buildLinkCommandJson() {
  return new SlashCommandBuilder()
    .setName("link")
    .setDescription("Link your Roblox account to your Discord for verified perks")
    .setDMPermission(false)
    .addSubcommand(sc => sc
      .setName("start")
      .setDescription("Begin linking — get a code to paste into your Roblox profile")
      .addStringOption(o => o
        .setName("roblox_username")
        .setDescription("Your exact Roblox username")
        .setRequired(true)
        .setMaxLength(40)))
    .addSubcommand(sc => sc
      .setName("verify")
      .setDescription("Finish linking after adding the code to your Roblox 'About'"))
    .addSubcommand(sc => sc
      .setName("status")
      .setDescription("Show a member's Roblox link status")
      .addUserOption(o => o
        .setName("user")
        .setDescription("Member to check (default: you)")))
    .addSubcommand(sc => sc
      .setName("unlink")
      .setDescription("Remove the Roblox account linked to your Discord"))
    .addSubcommand(sc => sc
      .setName("whois")
      .setDescription("Find who a Roblox account is linked to")
      .addStringOption(o => o
        .setName("roblox_username")
        .setDescription("Roblox username to look up")
        .setRequired(true)
        .setMaxLength(40)))
    .toJSON();
}

export function buildRobloxAdminCommandJson() {
  return new SlashCommandBuilder()
    .setName("roblox")
    .setDescription("Configure Roblox linking perks for this server")
    .setDMPermission(false)
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addSubcommand(sc => sc
      .setName("config")
      .setDescription("Enable Roblox perks and set the role / bonus / group")
      .addBooleanOption(o => o
        .setName("enabled")
        .setDescription("Turn Roblox perks on or off for this server"))
      .addRoleOption(o => o
        .setName("verified_role")
        .setDescription("Role granted to members when their link verifies"))
      .addIntegerOption(o => o
        .setName("link_bonus_shards")
        .setDescription("One-time DN Shards awarded on first verified link here")
        .setMinValue(0).setMaxValue(100000))
      .addStringOption(o => o
        .setName("group_id")
        .setDescription("Roblox group ID to show a member's rank (optional)")))
    .addSubcommand(sc => sc
      .setName("show")
      .setDescription("Show the current Roblox perk configuration"))
    .toJSON();
}

// ── /link dispatcher ──────────────────────────────────────────────────────────

export async function handleLinkCommand(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!interaction.guild) return;
  const sub = interaction.options.getSubcommand(true);
  // Everything here is personal — keep it ephemeral except public status lookups.
  const ephemeral = sub !== "status" && sub !== "whois";
  await interaction.deferReply(ephemeral ? { flags: MessageFlags.Ephemeral } : {});

  switch (sub) {
    case "start":   return linkStart(interaction);
    case "verify":  return linkVerify(interaction);
    case "status":  return linkStatus(interaction);
    case "unlink":  return linkUnlink(interaction);
    case "whois":   return linkWhois(interaction);
  }
}

async function linkStart(interaction: ChatInputCommandInteraction): Promise<void> {
  const username = interaction.options.getString("roblox_username", true).trim();

  const existing = await getLinkByDiscordId(interaction.user.id);
  if (existing) {
    await interaction.editReply(
      `✅ Your Discord is already linked to Roblox **${existing.robloxUsername}**.\n` +
      "Run `/link unlink` first if you want to link a different account.",
    );
    return;
  }

  const robloxUser = await resolveUsername(username);
  if (!robloxUser) {
    await interaction.editReply(
      `❌ Couldn't find a Roblox user named **${username}**. Double-check the exact spelling (this is your username, not your display name).`,
    );
    return;
  }

  // Guard against someone claiming an already-linked Roblox account.
  const takenBy = await getLinkByRobloxId(robloxUser.id);
  if (takenBy && takenBy.discordUserId !== interaction.user.id) {
    await interaction.editReply(
      `❌ Roblox **${robloxUser.name}** is already linked to another Discord account. If that's you, have that account run \`/link unlink\` first.`,
    );
    return;
  }

  const code = generateVerifyCode();
  await startVerification({
    discordUserId: interaction.user.id,
    code,
    robloxUserId: robloxUser.id,
    robloxUsername: robloxUser.name,
    robloxDisplayName: robloxUser.displayName,
  });

  const embed = new EmbedBuilder()
    .setColor(ROBLOX_COLOR)
    .setTitle("🔗 Link your Roblox account")
    .setDescription(
      `We found Roblox user **${robloxUser.displayName ?? robloxUser.name}** (@${robloxUser.name}).\n\n` +
      "**To verify you own it:**\n" +
      `1. Copy this code: \`\`\`${code}\`\`\`\n` +
      "2. Open Roblox → your profile → **✏️ Edit** → paste the code anywhere in your **About / Description** box → **Save**.\n" +
      "3. Come back and run **`/link verify`**.\n\n" +
      "_The code expires in 30 minutes. You can remove it from your profile once verified._",
    )
    .setURL(profileUrl(robloxUser.id))
    .setFooter({ text: "Not your account? Run /link start again with the right username." });

  const thumb = await getAvatarThumbnail(robloxUser.id);
  if (thumb) embed.setThumbnail(thumb);

  await interaction.editReply({ embeds: [embed] });
}

async function linkVerify(interaction: ChatInputCommandInteraction): Promise<void> {
  const pending = await getVerification(interaction.user.id);
  if (!pending) {
    await interaction.editReply(
      "❌ No pending verification (or it expired). Start with `/link start roblox_username:<name>`.",
    );
    return;
  }

  const profile = await getUserProfile(pending.robloxUserId);
  if (!profile) {
    await interaction.editReply("⚠️ Couldn't reach Roblox right now. Try `/link verify` again in a moment.");
    return;
  }

  if (!profile.description.includes(pending.code)) {
    await interaction.editReply(
      `❌ I couldn't find the code \`${pending.code}\` in **${pending.robloxUsername}**'s Roblox About box.\n` +
      "Make sure you pasted it, hit **Save**, then run `/link verify` again. (Profile edits can take a few seconds to show.)",
    );
    return;
  }

  // Success — write the link and clear the pending code.
  const link = await upsertLink({
    discordUserId: interaction.user.id,
    robloxUserId: pending.robloxUserId,
    robloxUsername: profile.name,
    robloxDisplayName: profile.displayName,
  });
  await clearVerification(interaction.user.id);

  const embed = new EmbedBuilder()
    .setColor(0x2ecc71)
    .setTitle("✅ Roblox linked!")
    .setDescription(
      `Your Discord is now linked to Roblox **${link.robloxDisplayName ?? link.robloxUsername}** (@${link.robloxUsername}).\n` +
      "You can safely remove the code from your Roblox profile now.",
    )
    .setURL(profileUrl(link.robloxUserId));
  const thumb = await getAvatarThumbnail(link.robloxUserId);
  if (thumb) embed.setThumbnail(thumb);

  // Apply per-guild perks (best-effort — never fails the verification).
  const perkLines = await applyGuildPerks(interaction, link.robloxUserId, link.robloxUsername);
  if (perkLines.length) {
    embed.addFields({ name: "🎁 Server perks", value: perkLines.join("\n"), inline: false });
  }

  await interaction.editReply({ embeds: [embed] });
}

// Grant the verified role + one-time shard bonus + show group rank, if this
// guild has Roblox perks enabled. Returns human-readable lines for the embed.
async function applyGuildPerks(
  interaction: ChatInputCommandInteraction,
  robloxUserId: string,
  robloxUsername: string,
): Promise<string[]> {
  const guildId = interaction.guild!.id;
  const lines: string[] = [];
  try {
    const cfg = await getGuildRobloxSettings(guildId);
    if (!cfg || !cfg.enabled) return lines;

    // Verified role
    if (cfg.verifiedRoleId && interaction.member) {
      try {
        const member = interaction.member as GuildMember;
        await member.roles.add(cfg.verifiedRoleId, "Roblox account verified");
        lines.push(`• Role <@&${cfg.verifiedRoleId}> granted`);
      } catch (err) {
        logger.debug({ err }, "roblox verified-role grant failed");
        lines.push("• ⚠️ Couldn't grant the verified role (check my role position/permissions)");
      }
    }

    // One-time shard bonus (idempotent per guild+user)
    if (cfg.linkBonusShards > 0) {
      const firstTime = await claimLinkBonusOnce(guildId, interaction.user.id, cfg.linkBonusShards);
      if (firstTime) {
        await addShards(guildId, interaction.user.id, cfg.linkBonusShards);
        lines.push(`• **+${cfg.linkBonusShards}** 💠 link bonus`);
      }
    }

    // Group rank (informational)
    if (cfg.groupId) {
      const membership = await getGroupMembership(robloxUserId, cfg.groupId);
      if (membership) {
        lines.push(`• Group rank: **${membership.roleName}** in ${membership.groupName}`);
      }
    }
  } catch (err) {
    logger.debug({ err }, "roblox perk application error");
  }
  return lines;
}

async function linkStatus(interaction: ChatInputCommandInteraction): Promise<void> {
  const target = interaction.options.getUser("user") ?? interaction.user;
  const link = await getLinkByDiscordId(target.id);

  if (!link) {
    await interaction.editReply(
      target.id === interaction.user.id
        ? "❌ You haven't linked a Roblox account yet. Run `/link start roblox_username:<name>`."
        : `❌ <@${target.id}> hasn't linked a Roblox account.`,
    );
    return;
  }

  const embed = new EmbedBuilder()
    .setColor(ROBLOX_COLOR)
    .setTitle(`🔗 ${target.username}'s Roblox link`)
    .setURL(profileUrl(link.robloxUserId))
    .addFields(
      { name: "Roblox", value: `**${link.robloxDisplayName ?? link.robloxUsername}** (@${link.robloxUsername})`, inline: true },
      { name: "Linked", value: `<t:${Math.floor(link.verifiedAt.getTime() / 1000)}:R>`, inline: true },
    );

  const cfg = await getGuildRobloxSettings(interaction.guild!.id);
  if (cfg?.enabled && cfg.groupId) {
    const membership = await getGroupMembership(link.robloxUserId, cfg.groupId);
    embed.addFields({
      name: "Group rank",
      value: membership ? `**${membership.roleName}** in ${membership.groupName}` : "Not in the configured group",
      inline: false,
    });
  }

  const thumb = await getAvatarThumbnail(link.robloxUserId);
  if (thumb) embed.setThumbnail(thumb);

  await interaction.editReply({ embeds: [embed] });
}

async function linkUnlink(interaction: ChatInputCommandInteraction): Promise<void> {
  const removed = await deleteLink(interaction.user.id);
  await clearVerification(interaction.user.id);
  await interaction.editReply(
    removed
      ? "✅ Your Roblox account has been unlinked. (Any server perks already granted stay as-is.)"
      : "You don't have a Roblox account linked.",
  );
}

async function linkWhois(interaction: ChatInputCommandInteraction): Promise<void> {
  const username = interaction.options.getString("roblox_username", true).trim();
  const robloxUser = await resolveUsername(username);
  if (!robloxUser) {
    await interaction.editReply(`❌ No Roblox user named **${username}** exists.`);
    return;
  }
  const link = await getLinkByRobloxId(robloxUser.id);
  if (!link) {
    await interaction.editReply(`Roblox **${robloxUser.name}** isn't linked to any Discord account here.`);
    return;
  }
  await interaction.editReply(
    `🔗 Roblox **${robloxUser.displayName ?? robloxUser.name}** (@${robloxUser.name}) is linked to <@${link.discordUserId}>.`,
  );
}

// ── /roblox (admin) dispatcher ─────────────────────────────────────────────────

export async function handleRobloxAdminCommand(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!interaction.guild) return;
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const sub = interaction.options.getSubcommand(true);
  const guildId = interaction.guild.id;

  if (sub === "show") {
    const cfg = await getGuildRobloxSettings(guildId);
    const embed = new EmbedBuilder()
      .setColor(ROBLOX_COLOR)
      .setTitle("🔗 Roblox perk configuration")
      .setDescription(
        `**Enabled:** ${cfg?.enabled ? "✅ yes" : "❌ no"}\n` +
        `**Verified role:** ${cfg?.verifiedRoleId ? `<@&${cfg.verifiedRoleId}>` : "_none_"}\n` +
        `**Link bonus:** ${cfg?.linkBonusShards ?? 0} 💠 (one-time, per member)\n` +
        `**Group ID:** ${cfg?.groupId ? `\`${cfg.groupId}\`` : "_none_"}`,
      )
      .setFooter({ text: "Set these with /roblox config" });
    await interaction.editReply({ embeds: [embed] });
    return;
  }

  // sub === "config"
  const enabled = interaction.options.getBoolean("enabled");
  const role = interaction.options.getRole("verified_role");
  const bonus = interaction.options.getInteger("link_bonus_shards");
  const groupId = interaction.options.getString("group_id");

  const patch: Record<string, unknown> = {};
  if (enabled !== null) patch.enabled = enabled;
  if (role) patch.verifiedRoleId = role.id;
  if (bonus !== null) patch.linkBonusShards = bonus;
  if (groupId !== null) patch.groupId = groupId.trim() || null;

  if (Object.keys(patch).length === 0) {
    await interaction.editReply(
      "Nothing to change. Provide at least one option — `enabled`, `verified_role`, `link_bonus_shards`, or `group_id`.",
    );
    return;
  }

  const cfg = await upsertGuildRobloxSettings(guildId, patch as any, interaction.user.id);
  await interaction.editReply(
    "✅ Updated Roblox perks:\n" +
    `**Enabled:** ${cfg.enabled ? "yes" : "no"} · ` +
    `**Role:** ${cfg.verifiedRoleId ? `<@&${cfg.verifiedRoleId}>` : "none"} · ` +
    `**Bonus:** ${cfg.linkBonusShards} 💠 · ` +
    `**Group:** ${cfg.groupId ?? "none"}`,
  );
}
