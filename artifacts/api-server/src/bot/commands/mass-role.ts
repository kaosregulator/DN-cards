import {
  MessageFlags,
  type ChatInputCommandInteraction,
  GuildMember,
  roleMention,
} from "discord.js";
import { isAdmin } from "../db.js";
import { logger } from "../../lib/logger.js";

// ── Permission check (mirrors pattern in admin.ts) ────────────────────────────
async function checkAdmin(interaction: ChatInputCommandInteraction): Promise<boolean> {
  if (!interaction.guild) return false;
  if (interaction.guild.ownerId === interaction.user.id) return true;
  const member = interaction.member as GuildMember | null;
  if (member?.permissions.has("Administrator")) return true;
  return isAdmin(interaction.guild.id, interaction.user.id);
}

// ── /mass_role give|remove ────────────────────────────────────────────────────
// give  — finds every member who has <target_role> and gives them <role>
// remove — finds every member who has <target_role> and removes <role> from them
export async function handleMassRoleCommand(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  if (!interaction.guild) return;

  // ACK immediately — member fetching + role changes can easily exceed 3s.
  // Guard against already-acknowledged interactions (double-tap / gateway redelivery).
  if (!interaction.deferred && !interaction.replied) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  }

  if (!(await checkAdmin(interaction))) {
    await interaction.editReply("❌ Admins only.");
    return;
  }

  const sub = interaction.options.getSubcommand(true) as "give" | "remove";
  const actionRole = interaction.options.getRole("role", true);
  const targetRole = interaction.options.getRole("target_role", true);

  // Sanity: make sure we're not touching @everyone or a managed/bot role
  if (actionRole.id === interaction.guild.id) {
    await interaction.editReply("❌ You can't give or remove the `@everyone` role.");
    return;
  }
  const resolvedAction = interaction.guild.roles.cache.get(actionRole.id);
  if (resolvedAction?.managed) {
    await interaction.editReply("❌ That role is managed by an integration and can't be assigned manually.");
    return;
  }

  // Fetch all guild members (works even on large servers with GUILD_MEMBERS intent)
  let members: GuildMember[];
  try {
    const fetched = await interaction.guild.members.fetch();
    members = [...fetched.values()].filter(m => m.roles.cache.has(targetRole.id));
  } catch (err) {
    logger.error({ err }, "mass_role: failed to fetch guild members");
    await interaction.editReply(
      "❌ Couldn't fetch guild members. Make sure the bot has the **Server Members Intent** and **Manage Roles** permission.",
    );
    return;
  }

  if (members.length === 0) {
    await interaction.editReply(
      `⚠️ No members currently have the role ${roleMention(targetRole.id)}.`,
    );
    return;
  }

  // Show a working message so the user knows it's running
  await interaction.editReply(
    `⏳ ${sub === "give" ? "Giving" : "Removing"} ${roleMention(actionRole.id)} ` +
    `${sub === "give" ? "to" : "from"} **${members.length}** member(s) with ${roleMention(targetRole.id)}…`,
  );

  let success = 0;
  let skipped = 0;
  let failed = 0;

  for (const member of members) {
    const alreadyHas = member.roles.cache.has(actionRole.id);

    // Skip no-ops
    if (sub === "give" && alreadyHas) { skipped++; continue; }
    if (sub === "remove" && !alreadyHas) { skipped++; continue; }

    try {
      if (sub === "give") {
        await member.roles.add(actionRole.id, `mass_role give by ${interaction.user.tag}`);
      } else {
        await member.roles.remove(actionRole.id, `mass_role remove by ${interaction.user.tag}`);
      }
      success++;
    } catch (err) {
      logger.warn({ err, userId: member.id }, "mass_role: failed to modify member role");
      failed++;
    }

    // Discord rate-limits role edits to ~5/s — 210ms gap keeps us safe
    await new Promise<void>(r => setTimeout(r, 210));
  }

  // ── Final report ──────────────────────────────────────────────────────────
  const verb = sub === "give" ? "given" : "removed";
  const prep = sub === "give" ? "to" : "from";

  const lines: string[] = [
    `✅ **Done** — ${roleMention(actionRole.id)} ${verb} ${prep} members with ${roleMention(targetRole.id)}`,
    "",
    `• **${success}** member(s) updated`,
  ];
  if (skipped > 0) {
    lines.push(
      `• **${skipped}** skipped (already ${sub === "give" ? "had" : "lacked"} the role)`,
    );
  }
  if (failed > 0) {
    lines.push(
      `• **${failed}** failed — check the bot's **Manage Roles** permission and ensure its role sits above ${roleMention(actionRole.id)} in the hierarchy`,
    );
  }

  await interaction.editReply(lines.join("\n"));
}
